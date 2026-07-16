import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { assertUniqueArrayValues } from './openai-output-schema.mjs';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function reviewKey(value) {
  return `${value?.finding_level || value?.level}:${value?.finding_id || value?.id}`;
}

function reviewValidationError(errors) {
  const error = new Error(`review validation failed:\n- ${errors.join('\n- ')}`);
  error.validationErrors = errors;
  return error;
}

function duplicateConsistencyError(errors) {
  const error = new Error(`duplicate consistency validation failed:\n- ${errors.join('\n- ')}`);
  error.validationErrors = errors;
  error.duplicateConsistency = true;
  return error;
}

function sameMembers(expected, actual) {
  if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return false;
  const expectedSet = new Set(expected);
  return expectedSet.size === expected.length && actual.every(value => expectedSet.has(value));
}

function canonicalMergedTrackerTsv(value) {
  if (typeof value !== 'string') return value;
  const match = value.match(/(?:^|\/)batch\/tracker-additions\/merged\/([A-Za-z0-9._-]+\.tsv)$/);
  return match ? `batch/tracker-additions/merged/${match[1]}` : value;
}

export function reviewChunkSignature({ user, findings, priorDecisions }) {
  const payload = canonicalize({
    schema_version: 1,
    user,
    findings,
    prior_decisions: priorDecisions,
  });
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function normalizeReviewDecisions(expectedFindings, review) {
  if (!review || !Array.isArray(review.findings)) return { review, normalizations: [] };
  const normalized = JSON.parse(JSON.stringify(review));
  const expected = new Map(expectedFindings.map(finding => [reviewKey(finding), finding]));
  const normalizations = [];
  for (const decision of normalized.findings) {
    const key = reviewKey(decision);
    const finding = expected.get(key);
    if (finding && decision.classification === 'confirmed_duplicate' &&
        decision.disposition === 'resolve_duplicate' && decision.duplicate_resolution) {
      if (finding.code === 'possible_duplicate_tracker') {
        const canonical = {
          ...decision.duplicate_resolution,
          keeper_report_file: null,
          duplicate_report_files: [],
        };
        if (JSON.stringify(decision.duplicate_resolution) !== JSON.stringify(canonical)) {
          decision.duplicate_resolution = canonical;
          normalizations.push(`${key}: removed report fields from tracker duplicate resolution`);
        }
      } else if (finding.code === 'duplicate_reports_same_role') {
        const candidates = finding.details?.files || [];
        const byBasename = new Map();
        for (const file of candidates) {
          const name = String(file).split('/').pop();
          if (byBasename.has(name)) byBasename.set(name, null);
          else byBasename.set(name, file);
        }
        const canonicalReport = file => {
          if (!file) return file;
          const candidate = byBasename.get(String(file).split('/').pop());
          return candidate || file;
        };
        const canonical = {
          ...decision.duplicate_resolution,
          keeper_tracker_num: null,
          duplicate_tracker_nums: [],
          keeper_report_file: canonicalReport(decision.duplicate_resolution.keeper_report_file),
          duplicate_report_files: decision.duplicate_resolution.duplicate_report_files.map(canonicalReport),
        };
        if (JSON.stringify(decision.duplicate_resolution) !== JSON.stringify(canonical)) {
          decision.duplicate_resolution = canonical;
          normalizations.push(`${key}: canonicalized report-only duplicate resolution from finding evidence`);
        }
      }
    }
    if (!finding || finding.code !== 'orphan_report' ||
        decision.classification !== 'confirmed_orphan') continue;
    const reportFile = finding.details?.file;
    if (!reportFile) continue;
    if (decision.disposition === 'archive_orphan') {
      const canonical = { report_file: reportFile, tracker_tsv: null };
      if (JSON.stringify(decision.orphan_resolution) !== JSON.stringify(canonical)) {
        decision.orphan_resolution = canonical;
        normalizations.push(`${key}: derived archive_orphan report_file from finding evidence`);
      }
    } else if (decision.disposition === 'restore_orphan' && decision.orphan_resolution) {
      const canonical = {
        report_file: reportFile,
        tracker_tsv: canonicalMergedTrackerTsv(decision.orphan_resolution.tracker_tsv),
      };
      if (JSON.stringify(decision.orphan_resolution) !== JSON.stringify(canonical)) {
        decision.orphan_resolution = canonical;
        normalizations.push(`${key}: canonicalized restore_orphan paths from finding evidence`);
      }
    }
  }
  return { review: normalized, normalizations };
}

export function validateReviewDecisions(expectedFindings, review) {
  if (!review || review.status !== 'completed' || !Array.isArray(review.findings)) {
    throw reviewValidationError(['review returned an invalid top-level contract']);
  }
  const expected = new Map(expectedFindings.map(finding => [reviewKey(finding), finding]));
  const seen = new Set();
  const errors = [];
  for (const decision of review.findings) {
    const key = reviewKey(decision);
    if (seen.has(key)) {
      errors.push(`review repeated ${key}`);
      continue;
    }
    seen.add(key);
    const finding = expected.get(key);
    if (!finding) {
      errors.push(`review returned unknown finding ${key}`);
      continue;
    }
    if (decision.finding_code !== finding.code) errors.push(`${key}: finding_code changed`);
    const markSeen = ['false_positive', 'legitimate_exception', 'informational'].includes(decision.classification);
    if (decision.disposition === 'mark_seen' && (!markSeen || decision.needs_human_review)) {
      errors.push(`${key}: invalid mark_seen decision`);
    }
    if (markSeen && decision.disposition !== 'mark_seen') {
      errors.push(`${key}: non-action classification must mark_seen`);
    }
    if (decision.disposition === 'resolve_duplicate') {
      if (decision.classification !== 'confirmed_duplicate' || !decision.duplicate_resolution ||
          !['possible_duplicate_tracker', 'duplicate_reports_same_role'].includes(finding.code)) {
        errors.push(`${key}: invalid duplicate resolution`);
      } else {
        const resolution = decision.duplicate_resolution;
        try {
          assertUniqueArrayValues(resolution.duplicate_tracker_nums, `${key}: duplicate_tracker_nums`);
        } catch (error) {
          errors.push(error.message);
        }
        try {
          assertUniqueArrayValues(resolution.duplicate_report_files, `${key}: duplicate_report_files`);
        } catch (error) {
          errors.push(error.message);
        }
        if (finding.code === 'possible_duplicate_tracker') {
          if (resolution.keeper_report_file !== null || resolution.duplicate_report_files.length !== 0) {
            errors.push(`${key}: tracker duplicate resolution cannot include report files`);
          }
          const candidates = finding.details?.tracker_nums || [];
          const chosen = [resolution.keeper_tracker_num, ...resolution.duplicate_tracker_nums];
          if (!Number.isInteger(resolution.keeper_tracker_num) ||
              resolution.duplicate_tracker_nums.length === 0 || !sameMembers(candidates, chosen)) {
            errors.push(`${key}: tracker duplicate resolution must partition the exact warning candidates`);
          }
        } else if (finding.code === 'duplicate_reports_same_role') {
          if (resolution.keeper_tracker_num !== null || resolution.duplicate_tracker_nums.length !== 0) {
            errors.push(`${key}: report duplicate resolution cannot include tracker rows`);
          }
          const candidates = finding.details?.files || [];
          const chosen = [resolution.keeper_report_file, ...resolution.duplicate_report_files];
          if (!resolution.keeper_report_file || resolution.duplicate_report_files.length === 0 ||
              !sameMembers(candidates, chosen)) {
            errors.push(`${key}: report duplicate resolution must partition the exact warning candidates`);
          }
        }
      }
    } else if (decision.duplicate_resolution !== null) {
      errors.push(`${key}: unused duplicate_resolution must be null`);
    }
    if (['restore_orphan', 'archive_orphan'].includes(decision.disposition)) {
      if (decision.classification !== 'confirmed_orphan' || finding.code !== 'orphan_report' || !decision.orphan_resolution) {
        errors.push(`${key}: invalid orphan resolution`);
      } else {
        const resolution = decision.orphan_resolution;
        if (resolution.report_file !== finding.details?.file) {
          errors.push(`${key}: orphan report path must match deterministic finding evidence`);
        }
        if (decision.disposition === 'archive_orphan' && resolution.tracker_tsv !== null) {
          errors.push(`${key}: archive_orphan tracker_tsv must be null`);
        }
        if (decision.disposition === 'restore_orphan' && resolution.tracker_tsv !== null &&
            !/^batch\/tracker-additions\/merged\/[A-Za-z0-9._-]+\.tsv$/.test(resolution.tracker_tsv || '')) {
          errors.push(`${key}: restore_orphan tracker_tsv must be null or user-root-relative under batch/tracker-additions/merged`);
        }
      }
    } else if (decision.orphan_resolution !== null) {
      errors.push(`${key}: unused orphan_resolution must be null`);
    }
    if (decision.disposition === 'patch_tracker') {
      if (decision.classification !== 'actionable' || !decision.tracker_patch) {
        errors.push(`${key}: invalid tracker patch`);
      } else if (Object.entries(decision.tracker_patch)
        .filter(([field, value]) => field !== 'tracker_num' && value !== null).length === 0) {
        errors.push(`${key}: tracker patch changes no field`);
      }
    } else if (decision.tracker_patch !== null) {
      errors.push(`${key}: unused tracker_patch must be null`);
    }
    if (decision.disposition === 'manual_review' &&
        (decision.classification !== 'needs_human_review' || !decision.needs_human_review)) {
      errors.push(`${key}: manual_review requires needs_human_review`);
    }
    if (decision.disposition !== 'manual_review' && decision.needs_human_review) {
      errors.push(`${key}: only manual_review may require human review`);
    }
    if (decision.severity === 'high' && decision.disposition !== 'manual_review') {
      errors.push(`${key}: high severity requires manual_review`);
    }
  }
  const missing = [...expected.keys()].filter(key => !seen.has(key));
  if (missing.length > 0) errors.push(`review omitted findings: ${missing.join(', ')}`);
  const observed = review.findings.some(item => item.needs_human_review);
  if (review.needs_human_review !== observed) {
    errors.push('review needs_human_review does not match decisions');
  }
  if (errors.length > 0) throw reviewValidationError(errors);
  return review;
}

export function findingFingerprint(level, finding) {
  const payload = canonicalize({
    schema_version: 1,
    level,
    id: finding.id,
    code: finding.code,
    message: finding.message,
    details: finding.details || {},
  });
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function verificationFindings(verification) {
  return [
    ...(verification.errors || []).map(finding => ({
      ...finding,
      level: 'error',
      fingerprint: findingFingerprint('error', finding),
    })),
    ...(verification.warnings || []).map(finding => ({
      ...finding,
      level: 'warning',
      fingerprint: findingFingerprint('warning', finding),
    })),
  ];
}

function reportBasename(value) {
  return String(value || '').match(/\]\(([^)]+)\)/)?.[1]?.split('/').pop() || null;
}

function exactDuplicatePairs(verification) {
  const findings = verificationFindings(verification);
  const reportFindings = findings.filter(item => item.code === 'duplicate_reports_same_role');
  return findings
    .filter(item => item.code === 'possible_duplicate_tracker')
    .map(trackerFinding => {
      const reportFiles = (trackerFinding.details?.entries || [])
        .map(entry => reportBasename(entry.report)).filter(Boolean);
      if (new Set(reportFiles).size < 2) return null;
      const reportFinding = reportFindings.find(candidate => {
        const files = (candidate.details?.files || []).map(file => String(file).split('/').pop());
        return sameMembers(reportFiles, files);
      });
      return reportFinding ? { trackerFinding, reportFinding, reportFiles } : null;
    })
    .filter(Boolean);
}

export function expandActiveDuplicatePairs(verification, activeFindings) {
  const findings = verificationFindings(verification);
  const activeKeys = new Set((activeFindings || []).map(reviewKey));
  let changed = true;
  while (changed) {
    changed = false;
    for (const { trackerFinding, reportFinding } of exactDuplicatePairs(verification)) {
      const trackerKey = reviewKey(trackerFinding);
      const reportKey = reviewKey(reportFinding);
      if (!activeKeys.has(trackerKey) && !activeKeys.has(reportKey)) continue;
      if (!activeKeys.has(trackerKey)) {
        activeKeys.add(trackerKey);
        changed = true;
      }
      if (!activeKeys.has(reportKey)) {
        activeKeys.add(reportKey);
        changed = true;
      }
    }
  }
  const expanded = findings.filter(finding => activeKeys.has(reviewKey(finding)));
  return {
    findings: expanded,
    reactivated: Math.max(0, expanded.length - (activeFindings || []).length),
  };
}

function duplicateCandidates(finding) {
  if (finding?.code === 'possible_duplicate_tracker') {
    return new Set((finding.details?.tracker_nums || []).map(value => String(value)));
  }
  if (finding?.code === 'duplicate_reports_same_role') {
    return new Set((finding.details?.files || []).map(value => String(value).split('/').pop()));
  }
  return null;
}

function isStrictSubset(subset, superset) {
  return subset && superset && subset.size < superset.size &&
    [...subset].every(value => superset.has(value));
}

function confirmedDuplicateSuperset(finding, findings, decisionsByKey) {
  const candidates = duplicateCandidates(finding);
  if (!candidates) return null;
  return findings.find(candidate => {
    if (candidate.code !== finding.code || reviewKey(candidate) === reviewKey(finding)) return false;
    const decision = decisionsByKey.get(reviewKey(candidate));
    return decision?.disposition === 'resolve_duplicate' &&
      decision.classification === 'confirmed_duplicate' &&
      isStrictSubset(candidates, duplicateCandidates(candidate));
  }) || null;
}

function seenAsSubsumedDuplicate(decision, supersetFinding) {
  return {
    ...decision,
    classification: 'informational',
    disposition: 'mark_seen',
    severity: 'low',
    needs_human_review: false,
    rationale: `${decision.rationale} This exact candidate set is already fully covered by ${supersetFinding.id}; no second overlapping mutation is required.`,
    duplicate_resolution: null,
    orphan_resolution: null,
    tracker_patch: null,
  };
}

function manualDuplicateDecision(decision, pairedDecision) {
  const pairedId = pairedDecision?.finding_id || 'the overlapping duplicate finding';
  return {
    ...decision,
    classification: 'needs_human_review',
    disposition: 'manual_review',
    severity: decision.severity === 'high' || pairedDecision?.severity === 'high' ? 'high' : 'medium',
    needs_human_review: true,
    rationale: `${decision.rationale} Paired duplicate decisions conflict with ${pairedId}; no deterministic mutation is safe until the shared identity is reviewed.`,
    duplicate_resolution: null,
    orphan_resolution: null,
    tracker_patch: null,
  };
}

export function reconcileDuplicateConsistency(verification, review) {
  if (!review || !Array.isArray(review.findings)) return { review, normalizations: [] };
  const reconciled = JSON.parse(JSON.stringify(review));
  const decisionsByKey = new Map(reconciled.findings.map(item => [reviewKey(item), item]));
  const normalizations = [];

  // Canonical-URL findings can be strict subsets of a broader group that the
  // reviewer also proved to be one posting. Only the maximal action should
  // mutate tracker/report state; otherwise the resolver receives overlapping
  // partitions and the subset cannot legally select the broader keeper.
  const duplicateFindings = verificationFindings(verification).filter(item =>
    ['possible_duplicate_tracker', 'duplicate_reports_same_role'].includes(item.code));
  for (const finding of duplicateFindings) {
    const decision = decisionsByKey.get(reviewKey(finding));
    if (!decision) continue;
    const superset = confirmedDuplicateSuperset(finding, duplicateFindings, decisionsByKey);
    if (!superset) continue;
    const index = reconciled.findings.indexOf(decision);
    const normalized = seenAsSubsumedDuplicate(decision, superset);
    reconciled.findings[index] = normalized;
    decisionsByKey.set(reviewKey(finding), normalized);
    normalizations.push(`${reviewKey(finding)}: collapsed duplicate action into confirmed superset ${reviewKey(superset)}`);
  }

  for (const { trackerFinding, reportFinding } of exactDuplicatePairs(verification)) {
    const trackerDecision = decisionsByKey.get(reviewKey(trackerFinding));
    const reportDecision = decisionsByKey.get(reviewKey(reportFinding));
    if (!trackerDecision || !reportDecision) continue;

    const trackerResolves = trackerDecision.disposition === 'resolve_duplicate';
    const reportResolves = reportDecision.disposition === 'resolve_duplicate';
    const eitherManual = trackerDecision.disposition === 'manual_review' ||
      reportDecision.disposition === 'manual_review';

    if (eitherManual || trackerResolves !== reportResolves) {
      const trackerIndex = reconciled.findings.indexOf(trackerDecision);
      const reportIndex = reconciled.findings.indexOf(reportDecision);
      reconciled.findings[trackerIndex] = manualDuplicateDecision(trackerDecision, reportDecision);
      reconciled.findings[reportIndex] = manualDuplicateDecision(reportDecision, trackerDecision);
      decisionsByKey.set(reviewKey(trackerFinding), reconciled.findings[trackerIndex]);
      decisionsByKey.set(reviewKey(reportFinding), reconciled.findings[reportIndex]);
      normalizations.push(
        `${reviewKey(trackerFinding)} + ${reviewKey(reportFinding)}: promoted conflicting duplicate component to manual_review`,
      );
      continue;
    }

    if (!trackerResolves) continue;
    const keeperEntry = (trackerFinding.details?.entries || []).find(entry =>
      entry.tracker_num === trackerDecision.duplicate_resolution?.keeper_tracker_num);
    const expectedKeeperName = reportBasename(keeperEntry?.report);
    const reportCandidates = [
      reportDecision.duplicate_resolution?.keeper_report_file,
      ...(reportDecision.duplicate_resolution?.duplicate_report_files || []),
    ];
    const expectedKeeper = reportCandidates.find(file =>
      String(file || '').split('/').pop() === expectedKeeperName);
    if (!expectedKeeper || reportDecision.duplicate_resolution.keeper_report_file === expectedKeeper) continue;
    reportDecision.duplicate_resolution = {
      ...reportDecision.duplicate_resolution,
      keeper_report_file: expectedKeeper,
      duplicate_report_files: reportCandidates.filter(file => file !== expectedKeeper),
    };
    normalizations.push(
      `${reviewKey(reportFinding)}: aligned report keeper with tracker keeper #${trackerDecision.duplicate_resolution.keeper_tracker_num}`,
    );
  }

  reconciled.needs_human_review = reconciled.findings.some(item => item.needs_human_review);
  return { review: reconciled, normalizations };
}

export function validateDuplicateConsistency(verification, review, { allowMissing = false } = {}) {
  const decisionsByKey = new Map((review?.findings || []).map(item => [reviewKey(item), item]));
  const duplicateFindings = verificationFindings(verification).filter(item =>
    ['possible_duplicate_tracker', 'duplicate_reports_same_role'].includes(item.code));
  const errors = [];

  for (const { trackerFinding, reportFinding } of exactDuplicatePairs(verification)) {
    const trackerDecision = decisionsByKey.get(reviewKey(trackerFinding));
    const reportDecision = decisionsByKey.get(reviewKey(reportFinding));
    // A pass review intentionally contains only currently active findings. An
    // exact pair that is wholly absent belongs to an earlier settled pass and
    // has no consistency claim on this review.
    if (!trackerDecision && !reportDecision) continue;
    if (!trackerDecision || !reportDecision) {
      if (!allowMissing) {
        errors.push(`${trackerFinding.id} is missing its paired decision ${reportFinding.id}`);
      }
      continue;
    }
    const trackerResolves = trackerDecision.disposition === 'resolve_duplicate';
    const reportResolves = reportDecision.disposition === 'resolve_duplicate';
    if (trackerResolves !== reportResolves) {
      // During lane review, one side of an exact subset may already recognise
      // that a broader confirmed action owns the mutation while its paired
      // decision still comes from an earlier chunk. Aggregate reconciliation
      // later collapses both subset decisions to the same seen disposition.
      const trackerSuperset = confirmedDuplicateSuperset(
        trackerFinding, duplicateFindings, decisionsByKey,
      );
      const reportSuperset = confirmedDuplicateSuperset(
        reportFinding, duplicateFindings, decisionsByKey,
      );
      if (trackerSuperset && reportSuperset) continue;
      errors.push(`${trackerFinding.id} conflicts with ${reportFinding.id}: duplicate dispositions differ`);
      continue;
    }
    if (!trackerResolves) continue;
    const keeperEntry = (trackerFinding.details?.entries || []).find(entry =>
      entry.tracker_num === trackerDecision.duplicate_resolution?.keeper_tracker_num);
    const expectedKeeper = reportBasename(keeperEntry?.report);
    const selectedKeeper = String(
      reportDecision.duplicate_resolution?.keeper_report_file || '',
    ).split('/').pop();
    if (expectedKeeper && selectedKeeper !== expectedKeeper) {
      errors.push(`${reportFinding.id}: report keeper must match tracker keeper #${trackerDecision.duplicate_resolution.keeper_tracker_num}`);
    }
  }
  if (errors.length > 0) {
    throw duplicateConsistencyError(errors);
  }
}

export function readReviewLedger(path) {
  if (!existsSync(path)) return [];
  const records = [];
  const lines = readFileSync(path, 'utf-8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const record = JSON.parse(line);
      if (!record || typeof record !== 'object') throw new Error('record is not an object');
      records.push(record);
    } catch (error) {
      throw new Error(`Cannot parse verification review ledger ${path}:${index + 1}: ${error.message}`);
    }
  }
  return records;
}

function ledgerKey(record) {
  return `${record.finding_level}:${record.finding_id}:${record.finding_fingerprint}`;
}

export function partitionReviewedFindings(verification, ledgerRecords) {
  const acknowledged = new Map();
  for (const record of ledgerRecords) {
    if (record.disposition !== 'mark_seen') continue;
    if (!record.finding_level || !record.finding_id || !record.finding_fingerprint) continue;
    acknowledged.set(ledgerKey(record), record);
  }

  const active = [];
  const seen = [];
  for (const finding of verificationFindings(verification)) {
    const record = acknowledged.get(`${finding.level}:${finding.id}:${finding.fingerprint}`);
    if (record) seen.push({ finding, review: record });
    else active.push(finding);
  }
  return { active, seen };
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function addReportResource(keys, value) {
  if (typeof value !== 'string') return;
  const candidates = [value];
  for (const match of value.matchAll(/\]\(([^)]+\.md)\)/gi)) candidates.push(match[1]);
  for (const candidate of candidates) {
    const normalized = candidate.split(/[?#]/, 1)[0].replace(/\\/g, '/');
    const base = normalized.split('/').pop();
    if (!base || !/\.md$/i.test(base)) continue;
    keys.add(`report:${base.toLowerCase()}`);
    const reportNum = positiveInteger(base.match(/^(\d+)-/)?.[1]);
    if (reportNum) keys.add(`identity:${reportNum}`);
  }
}

export function findingReviewResourceKeys(finding) {
  const keys = new Set();
  function visit(value, field = '') {
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, field));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, key);
      return;
    }
    const normalizedField = field.toLowerCase();
    if (normalizedField.includes('tracker_num') || normalizedField === 'report_num') {
      const number = positiveInteger(value);
      if (number) keys.add(`identity:${number}`);
    }
    if (typeof value === 'string') addReportResource(keys, value);
  }
  visit(finding?.details || {});
  if (keys.size === 0) keys.add(`finding:${finding?.level || ''}:${finding?.id || ''}`);
  return [...keys].sort();
}

export function findingJobIds(finding) {
  const trackerIds = new Set();
  const reportIds = new Set();
  function visit(value, field = '') {
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, field));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, key);
      return;
    }
    const normalizedField = field.toLowerCase();
    if (normalizedField.includes('tracker_num')) {
      const number = positiveInteger(value);
      if (number) trackerIds.add(number);
    }
    if (normalizedField === 'report_num') {
      const number = positiveInteger(value);
      if (number) reportIds.add(number);
    }
    if (typeof value !== 'string') return;
    const candidates = [value, ...[...value.matchAll(/\]\(([^)]+\.md)\)/gi)].map(match => match[1])];
    for (const candidate of candidates) {
      const normalized = candidate.split(/[?#]/, 1)[0].replace(/\\/g, '/');
      const reportId = positiveInteger(normalized.split('/').pop()?.match(/^(\d+)-/)?.[1]);
      if (reportId) reportIds.add(reportId);
    }
  }
  visit(finding?.details || {});
  return [...(trackerIds.size > 0 ? trackerIds : reportIds)].sort((left, right) => left - right);
}

export function buildReviewLanes(findings, parallel) {
  if (!Array.isArray(findings)) throw new Error('review findings must be an array');
  if (!Number.isInteger(parallel) || parallel < 1) throw new Error('review parallelism must be a positive integer');
  if (findings.length === 0) return [];

  const parent = findings.map((_, index) => index);
  const find = index => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const resourceOwner = new Map();
  findings.forEach((finding, index) => {
    for (const resource of findingReviewResourceKeys(finding)) {
      if (resourceOwner.has(resource)) union(index, resourceOwner.get(resource));
      else resourceOwner.set(resource, index);
    }
  });

  const componentsByRoot = new Map();
  findings.forEach((finding, index) => {
    const root = find(index);
    if (!componentsByRoot.has(root)) componentsByRoot.set(root, []);
    componentsByRoot.get(root).push({ finding, index });
  });
  const components = [...componentsByRoot.values()].sort((left, right) =>
    right.length - left.length || left[0].index - right[0].index);
  const laneCount = Math.min(parallel, components.length);
  const lanes = Array.from({ length: laneCount }, () => []);
  const loads = Array(laneCount).fill(0);
  for (const component of components) {
    let laneIndex = 0;
    for (let index = 1; index < laneCount; index++) {
      if (loads[index] < loads[laneIndex]) laneIndex = index;
    }
    lanes[laneIndex].push(...component);
    loads[laneIndex] += component.length;
  }
  // Keep each dependency component contiguous. Re-sorting the flattened lane by
  // global finding position interleaved unrelated components and could place an
  // exact tracker/report pair dozens of five-item review chunks apart.
  return lanes;
}

export function reviewRecord({ finding, decision, reviewedAt, runId, reviewer }) {
  return {
    schema_version: 1,
    reviewed_at: reviewedAt,
    run_id: runId,
    finding_level: finding.level,
    finding_id: finding.id,
    finding_code: finding.code,
    finding_fingerprint: finding.fingerprint,
    disposition: 'mark_seen',
    classification: decision.classification,
    severity: decision.severity,
    rationale: decision.rationale,
    evidence: decision.evidence,
    reviewer,
  };
}
