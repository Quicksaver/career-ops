#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'fs';
import { basename, dirname, extname, join, relative, resolve } from 'path';
import {
  getUserContext,
  printUserContextErrorAndExit,
  systemPath,
  userPath,
} from './lib/user-context.mjs';
import {
  findingFingerprint,
  reviewRecord,
  verificationFindings,
} from './lib/verification-review.mjs';
import { parseTrackerRow, resolveColumns } from './tracker-parse.mjs';
import { normalizeReportLink } from './tracker-links.mjs';
import {
  acquireTrackerLock,
  canonicalizeTrackerPath,
  cell,
  loadCanonicalStates,
  rebuildRow,
  resolveCanonicalState,
  trackerLockDirFor,
  writeFileAtomic,
} from './tracker-utils.mjs';

const HELP = `Apply schema-validated verification review decisions.

Usage: node apply-verification-review.mjs --user <id> \\
  --verification <verify.json> --review <review.json> [--run-id <id>] [--json]

This applies mark-seen decisions, bounded tracker patches, and confirmed orphan
restore/archive actions. Confirmed duplicate actions remain owned by
resolve-verify-warnings.mjs.`;

let context;
try {
  context = getUserContext(process.argv.slice(2));
} catch (error) {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    console.log(HELP);
    process.exit(0);
  }
  printUserContextErrorAndExit(error);
}

if (context.args.includes('-h') || context.args.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}

function optionValue(name, required = true) {
  const index = context.args.indexOf(name);
  if (index < 0) {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  const value = context.args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch (error) { throw new Error(`Cannot parse ${label} (${path}): ${error.message}`); }
}

function safeUserPath(relativePath, pattern, label) {
  if (!pattern.test(relativePath)) throw new Error(`${label} has invalid user-root-relative path ${relativePath}`);
  const full = resolve(context.userRoot, relativePath);
  const rel = relative(resolve(context.userRoot), full);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`${label} escapes USER_ROOT`);
  }
  return full;
}

function decisionFinding(decision, findingMap) {
  const finding = findingMap.get(`${decision.finding_level}:${decision.finding_id}`);
  if (!finding) throw new Error(`Review references unknown finding ${decision.finding_level}:${decision.finding_id}`);
  if (finding.code !== decision.finding_code) throw new Error(`${decision.finding_id}: finding_code changed`);
  return finding;
}

function parseMergedTsv(path) {
  const lines = readFileSync(path, 'utf-8').split(/\r?\n/).filter(line => line.trim());
  if (lines.length !== 1) throw new Error(`${path}: expected exactly one non-empty TSV line`);
  const parts = lines[0].split('\t');
  if (parts.length < 9) throw new Error(`${path}: expected at least nine TSV columns`);
  const extras = parts.slice(9).map(value => value.trim()).filter(Boolean);
  const viaFields = extras.filter(value => /^via=/i.test(value));
  const untagged = extras.filter(value => !/^via=/i.test(value));
  if (viaFields.length > 1 || untagged.length > 1) throw new Error(`${path}: ambiguous optional TSV fields`);
  const num = Number.parseInt(parts[0], 10);
  if (!Number.isInteger(num) || num < 1) throw new Error(`${path}: invalid tracker/report number`);
  return {
    num,
    date: parts[1].trim(),
    company: parts[2].trim(),
    role: parts[3].trim(),
    status: parts[4].trim(),
    score: parts[5].trim(),
    pdf: parts[6].trim(),
    report: parts[7].trim(),
    notes: parts[8].trim(),
    via: viaFields.length ? viaFields[0].replace(/^via=/i, '').trim() : '',
    location: untagged[0] || '',
  };
}

function trackerLine(entry, colmap) {
  const max = Math.max(...Object.values(colmap));
  const parts = Array(max + 2).fill('');
  parts[colmap.num] = String(entry.num);
  if (colmap.date != null) parts[colmap.date] = cell(entry.date);
  parts[colmap.company] = cell(entry.company);
  if (colmap.via != null) parts[colmap.via] = cell(entry.via || '—');
  if (colmap.location != null) parts[colmap.location] = cell(entry.location || '—');
  parts[colmap.role] = cell(entry.role);
  parts[colmap.score] = cell(entry.score);
  parts[colmap.status] = cell(entry.status);
  if (colmap.pdf != null) parts[colmap.pdf] = cell(entry.pdf);
  if (colmap.report != null) parts[colmap.report] = entry.report;
  if (colmap.notes != null) parts[colmap.notes] = cell(entry.notes);
  return rebuildRow(parts);
}

function insertTrackerLine(lines, line) {
  const separator = lines.findIndex(item => item.startsWith('|') && item.includes('---'));
  if (separator < 0) throw new Error('applications.md has no table separator');
  lines.splice(separator + 1, 0, line);
}

function appendJsonl(path, records) {
  if (records.length === 0) return;
  const existing = existsSync(path) ? readFileSync(path, 'utf-8').replace(/\s*$/, '\n') : '';
  writeFileAtomic(path, existing + records.map(record => JSON.stringify(record)).join('\n') + '\n');
}

async function main() {
  const verificationPath = optionValue('--verification');
  const reviewPath = optionValue('--review');
  const runId = optionValue('--run-id', false) || new Date().toISOString().replace(/[:.]/g, '-');
  const verification = readJson(verificationPath, 'verification JSON');
  const review = readJson(reviewPath, 'review JSON');
  const findings = verificationFindings(verification);
  const findingMap = new Map(findings.map(finding => [`${finding.level}:${finding.id}`, finding]));
  const decisions = Array.isArray(review.findings) ? review.findings : [];
  const markSeen = [];
  const orphanActions = [];
  const patchActions = [];

  for (const decision of decisions) {
    const finding = decisionFinding(decision, findingMap);
    if (decision.disposition === 'mark_seen') {
      if (!['false_positive', 'legitimate_exception', 'informational'].includes(decision.classification) ||
          decision.needs_human_review) {
        throw new Error(`${finding.id}: mark_seen requires a reviewed non-action classification`);
      }
      markSeen.push({ finding, decision });
      continue;
    }
    if (['restore_orphan', 'archive_orphan'].includes(decision.disposition)) {
      if (finding.code !== 'orphan_report' || decision.classification !== 'confirmed_orphan' || !decision.orphan_resolution) {
        throw new Error(`${finding.id}: orphan action does not match an orphan_report decision`);
      }
      const expectedReport = finding.details?.file;
      if (decision.orphan_resolution.report_file !== expectedReport) {
        throw new Error(`${finding.id}: orphan report path does not match deterministic verification`);
      }
      if (decision.disposition === 'restore_orphan' && !decision.orphan_resolution.tracker_tsv) {
        throw new Error(`${finding.id}: restore_orphan requires tracker_tsv evidence`);
      }
      orphanActions.push({ finding, decision });
      continue;
    }
    if (decision.disposition === 'patch_tracker') {
      if (decision.classification !== 'actionable' || !decision.tracker_patch) {
        throw new Error(`${finding.id}: patch_tracker requires an actionable tracker_patch`);
      }
      const supported = new Set([
        'noncanonical_status', 'bold_status', 'dated_status', 'broken_report_link',
        'invalid_score', 'bold_score', 'missing_via_value', 'confidential_company_placeholder',
      ]);
      if (!supported.has(finding.code)) throw new Error(`${finding.id}: ${finding.code} has no bounded tracker patch`);
      if (finding.details?.tracker_num !== decision.tracker_patch.tracker_num) {
        throw new Error(`${finding.id}: tracker patch number does not match deterministic verification`);
      }
      patchActions.push({ finding, decision });
      continue;
    }
    if (!['resolve_duplicate', 'manual_review'].includes(decision.disposition)) {
      throw new Error(`${finding.id}: unsupported disposition ${decision.disposition}`);
    }
  }

  const reviewedAt = new Date().toISOString();
  const reviewer = review.reviewer || { kind: 'prompt' };
  const reviewRecords = markSeen.map(item => reviewRecord({
    finding: item.finding,
    decision: item.decision,
    reviewedAt,
    runId,
    reviewer,
  }));

  const needsTracker = orphanActions.some(item => item.decision.disposition === 'restore_orphan') || patchActions.length > 0;
  const appsPath = canonicalizeTrackerPath(userPath(context, 'data/applications.md'));
  const canonicalUserRoot = canonicalizeTrackerPath(context.userRoot);
  if (needsTracker && !existsSync(appsPath)) throw new Error('applications.md is missing');
  const originalTracker = existsSync(appsPath) ? readFileSync(appsPath, 'utf-8') : '';
  const lines = originalTracker ? originalTracker.split('\n') : [];
  const colmap = lines.length ? resolveColumns(lines) : null;
  const trackerRows = new Map();
  if (colmap) {
    lines.forEach((line, index) => {
      const row = parseTrackerRow(line, colmap);
      if (!row) return;
      if (!trackerRows.has(row.num)) trackerRows.set(row.num, []);
      trackerRows.get(row.num).push({ ...row, index });
    });
  }

  const states = loadCanonicalStates(systemPath('templates/states.yml'));
  const patchesByNum = new Map();
  for (const item of patchActions) {
    const patch = item.decision.tracker_patch;
    if (!patchesByNum.has(patch.tracker_num)) patchesByNum.set(patch.tracker_num, {});
    const combined = patchesByNum.get(patch.tracker_num);
    for (const field of ['company', 'via', 'status', 'score', 'report']) {
      if (patch[field] == null) continue;
      if (combined[field] != null && combined[field] !== patch[field]) {
        throw new Error(`Conflicting ${field} patches for tracker #${patch.tracker_num}`);
      }
      combined[field] = patch[field];
    }
  }

  const stamp = reviewedAt.replace(/[:.]/g, '-');
  const backupRoot = userPath(context, `data/verification-backups/${stamp}`);
  const moved = [];
  let lock = null;
  let trackerRowsRestored = 0;
  let trackerRowsPatched = 0;
  let orphansArchived = 0;
  let artifactsArchived = 0;
  const actionRecords = [];

  try {
    if (needsTracker) {
      lock = await acquireTrackerLock(trackerLockDirFor(appsPath), { tracker: appsPath });
      mkdirSync(backupRoot, { recursive: true });
      copyFileSync(appsPath, join(backupRoot, 'applications.md'));
    }

    for (const [num, patch] of patchesByNum) {
      const candidates = trackerRows.get(num) || [];
      if (candidates.length !== 1) throw new Error(`Tracker patch requires exactly one row #${num}`);
      const row = candidates[0];
      const parts = lines[row.index].split('|').map(value => value.trim());
      if (patch.status != null) {
        const canonical = resolveCanonicalState(patch.status, states);
        if (!canonical) throw new Error(`Tracker #${num}: invalid canonical status ${patch.status}`);
        parts[colmap.status] = canonical;
      }
      if (patch.score != null) {
        const score = patch.score.replace(/\*\*/g, '').trim();
        if (!/^\d+(?:\.\d+)?\/5$/.test(score) && !['N/A', 'DUP', '—', '-'].includes(score)) {
          throw new Error(`Tracker #${num}: invalid score patch ${patch.score}`);
        }
        parts[colmap.score] = score;
      }
      if (patch.company != null) parts[colmap.company] = cell(patch.company);
      if (patch.via != null) {
        if (colmap.via == null) throw new Error(`Tracker #${num}: tracker has no Via column`);
        parts[colmap.via] = cell(patch.via);
      }
      if (patch.report != null) {
        const target = String(patch.report).match(/\]\(([^)]+)\)/)?.[1] || patch.report;
        const reportFile = basename(target);
        if (!/^\d+-[A-Za-z0-9._-]+\.md$/.test(reportFile) || !existsSync(userPath(context, `reports/${reportFile}`))) {
          throw new Error(`Tracker #${num}: report patch does not name an existing report`);
        }
        parts[colmap.report] = normalizeReportLink(`[${reportFile.match(/^\d+/)[0]}](reports/${reportFile})`, dirname(appsPath), canonicalUserRoot);
      }
      const nextCompany = parts[colmap.company];
      const nextVia = colmap.via == null ? '' : parts[colmap.via];
      if (nextCompany === '?' && (!nextVia || nextVia === '—')) {
        throw new Error(`Tracker #${num}: patch would leave a confidential employer without Via`);
      }
      lines[row.index] = rebuildRow(parts);
      trackerRowsPatched++;
      actionRecords.push({
        schema_version: 1, resolved_at: reviewedAt, run_id: runId,
        action: 'patch_tracker', finding_ids: patchActions.filter(item => item.decision.tracker_patch.tracker_num === num).map(item => item.finding.id),
        tracker_num: num, patch, backup_root: backupRoot,
      });
    }

    for (const item of orphanActions.filter(item => item.decision.disposition === 'restore_orphan')) {
      const { report_file: reportFile, tracker_tsv: trackerTsv } = item.decision.orphan_resolution;
      const reportPath = safeUserPath(reportFile, /^reports\/[A-Za-z0-9._-]+\.md$/, 'orphan report');
      const tsvPath = safeUserPath(trackerTsv, /^batch\/tracker-additions\/merged\/[A-Za-z0-9._-]+\.tsv$/, 'orphan tracker TSV');
      if (!existsSync(reportPath) || !existsSync(tsvPath)) throw new Error(`${item.finding.id}: restore artifacts are missing`);
      const entry = parseMergedTsv(tsvPath);
      if (entry.num !== item.finding.details?.report_num || basename(reportPath).match(/^\d+/)?.[0] !== String(entry.num).padStart(3, '0')) {
        throw new Error(`${item.finding.id}: TSV/report number mismatch`);
      }
      const linked = entry.report.match(/\]\(([^)]+)\)/)?.[1];
      if (!linked || basename(linked) !== basename(reportPath)) throw new Error(`${item.finding.id}: TSV does not reference the orphan report`);
      if (trackerRows.has(entry.num)) throw new Error(`${item.finding.id}: tracker number #${entry.num} is already used`);
      if (entry.company === '?' && !entry.via) throw new Error(`${item.finding.id}: confidential orphan has no Via evidence`);
      if (entry.via && colmap.via == null) throw new Error(`${item.finding.id}: tracker cannot store orphan Via evidence`);
      entry.report = normalizeReportLink(entry.report, dirname(appsPath), canonicalUserRoot);
      const line = trackerLine(entry, colmap);
      insertTrackerLine(lines, line);
      trackerRows.set(entry.num, [{ ...entry, raw: line }]);
      trackerRowsRestored++;
      actionRecords.push({
        schema_version: 1, resolved_at: reviewedAt, run_id: runId,
        action: 'restore_orphan', finding_id: item.finding.id,
        report_file: reportFile, tracker_tsv: trackerTsv, tracker_num: entry.num,
        rationale: item.decision.rationale, evidence: item.decision.evidence, backup_root: backupRoot,
      });
    }

    if (needsTracker) writeFileAtomic(appsPath, lines.join('\n'));

    for (const item of orphanActions.filter(item => item.decision.disposition === 'archive_orphan')) {
      const reportFile = item.decision.orphan_resolution.report_file;
      const sourceReport = safeUserPath(reportFile, /^reports\/[A-Za-z0-9._-]+\.md$/, 'orphan report');
      if (!existsSync(sourceReport)) {
        actionRecords.push({
          schema_version: 1, resolved_at: reviewedAt, run_id: runId,
          action: 'archive_orphan', finding_id: item.finding.id, report_file: reportFile,
          already_resolved: true, rationale: item.decision.rationale, evidence: item.decision.evidence,
        });
        continue;
      }
      mkdirSync(backupRoot, { recursive: true });
      const backupReportDir = join(backupRoot, 'reports');
      mkdirSync(backupReportDir, { recursive: true });
      const backupReport = join(backupReportDir, basename(sourceReport));
      copyFileSync(sourceReport, backupReport);
      const archiveRoot = userPath(context, `reports/orphans/${stamp}`);
      mkdirSync(archiveRoot, { recursive: true });
      const archivedReport = join(archiveRoot, basename(sourceReport));
      renameSync(sourceReport, archivedReport);
      moved.push({ from: sourceReport, to: archivedReport, backup: backupReport });
      const marker = `<!-- career-ops orphan_archived; finding_id: ${item.finding.id}; resolved_at: ${reviewedAt} -->\n`;
      writeFileAtomic(archivedReport, marker + readFileSync(archivedReport, 'utf-8'));
      orphansArchived++;

      const stem = basename(sourceReport).slice(0, -extname(sourceReport).length);
      for (const extension of ['.html', '.pdf', '.tex']) {
        const sourceArtifact = userPath(context, `output/${stem}${extension}`);
        if (!existsSync(sourceArtifact)) continue;
        const backupOutputDir = join(backupRoot, 'output');
        mkdirSync(backupOutputDir, { recursive: true });
        const backupArtifact = join(backupOutputDir, basename(sourceArtifact));
        copyFileSync(sourceArtifact, backupArtifact);
        const outputArchive = userPath(context, `output/orphans/${stamp}`);
        mkdirSync(outputArchive, { recursive: true });
        const archivedArtifact = join(outputArchive, basename(sourceArtifact));
        renameSync(sourceArtifact, archivedArtifact);
        moved.push({ from: sourceArtifact, to: archivedArtifact, backup: backupArtifact });
        artifactsArchived++;
      }
      actionRecords.push({
        schema_version: 1, resolved_at: reviewedAt, run_id: runId,
        action: 'archive_orphan', finding_id: item.finding.id, report_file: reportFile,
        rationale: item.decision.rationale, evidence: item.decision.evidence, backup_root: backupRoot,
      });
    }

    appendJsonl(userPath(context, 'data/verification-reviews.jsonl'), reviewRecords);
    appendJsonl(userPath(context, 'data/verification-actions.jsonl'), actionRecords);
    return {
      status: 'completed',
      seen_recorded: reviewRecords.length,
      tracker_rows_restored: trackerRowsRestored,
      tracker_rows_patched: trackerRowsPatched,
      orphans_archived: orphansArchived,
      artifacts_archived: artifactsArchived,
      review_ledger: reviewRecords.length ? userPath(context, 'data/verification-reviews.jsonl') : null,
      action_ledger: actionRecords.length ? userPath(context, 'data/verification-actions.jsonl') : null,
      backup: needsTracker || moved.length ? backupRoot : null,
    };
  } catch (error) {
    if (needsTracker && originalTracker) writeFileAtomic(appsPath, originalTracker);
    for (const item of moved.reverse()) {
      try {
        if (existsSync(item.to)) {
          mkdirSync(dirname(item.from), { recursive: true });
          rmSync(item.from, { force: true });
          renameSync(item.to, item.from);
          if (item.backup && existsSync(item.backup)) copyFileSync(item.backup, item.from);
        }
      } catch {}
    }
    throw error;
  } finally {
    if (lock) await lock.release();
  }
}

try {
  const result = await main();
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
