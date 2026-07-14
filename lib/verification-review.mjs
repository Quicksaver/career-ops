import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
    );
  }
  return value;
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
