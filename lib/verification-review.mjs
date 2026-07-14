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
