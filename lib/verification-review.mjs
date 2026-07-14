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
    } else if (decision.disposition === 'restore_orphan' && decision.orphan_resolution &&
        decision.orphan_resolution.report_file !== reportFile) {
      decision.orphan_resolution.report_file = reportFile;
      normalizations.push(`${key}: canonicalized restore_orphan report_file from finding evidence`);
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
        try {
          assertUniqueArrayValues(decision.duplicate_resolution.duplicate_tracker_nums, `${key}: duplicate_tracker_nums`);
        } catch (error) {
          errors.push(error.message);
        }
        try {
          assertUniqueArrayValues(decision.duplicate_resolution.duplicate_report_files, `${key}: duplicate_report_files`);
        } catch (error) {
          errors.push(error.message);
        }
      }
    } else if (decision.duplicate_resolution !== null) {
      errors.push(`${key}: unused duplicate_resolution must be null`);
    }
    if (['restore_orphan', 'archive_orphan'].includes(decision.disposition)) {
      if (decision.classification !== 'confirmed_orphan' || finding.code !== 'orphan_report' || !decision.orphan_resolution) {
        errors.push(`${key}: invalid orphan resolution`);
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
  for (const lane of lanes) lane.sort((left, right) => left.index - right.index);
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
