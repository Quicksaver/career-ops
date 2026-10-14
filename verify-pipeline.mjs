#!/usr/bin/env node

/**
 * verify-pipeline.mjs — Health check for career-ops pipeline integrity
 *
 * Checks:
 * 1. All statuses are canonical (per states.yml)
 * 2. No duplicate company+role entries
 * 3. All report links point to existing files
 * 4. Scores match format X.XX/5 or N/A or DUP
 * 5. All rows have proper pipe-delimited format
 * 6. No pending TSVs in tracker-additions/ (only in merged/ or archived/)
 * 7. states.yml canonical IDs for cross-system consistency
 * 8. Stale report-number reservation sentinels are garbage-collected
 * 9. No two report files cover the same company+role (warning — see #1425)
 * 10. Every report file has a tracker row referencing it (warning — see #1425)
 * 11. Via channel consistency (see #1596)
 * 12. No # value reused across 2+ tracker rows (error — see #1704)
 * 13. No report number prefix is reused across active report files
 * 13. applications.md <-> active-interviews.md status sync (see #1504)
 * 14. data/follow-ups.md table schema (see #2971)
 * 15. portals.yml entries no provider claims (see #3251)
 * 16. No invisible control characters in tracker cells (error — see #3892)
 * 17. JD archive coverage — check-jd-archive.mjs's findings (warning/error — see #4525)
 *
 * Run: node career-ops/verify-pipeline.mjs --user <id>
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import {
  ensureUserDirs,
  getUserContext,
  printUserContextErrorAndExit,
  systemPath,
  userPath,
} from './lib/user-context.mjs';
import {
  looksLikeScoreCell, isSeparatorRow, isHeaderRow, resolveColumns,
  normalizeTextKey, normalizeVia,
} from './tracker-parse.mjs';
import { CONTROL_CHARS, findDeadReportLink } from './tracker-utils.mjs';
import { normalizeUrl } from './url-key.mjs';
import { checkTrackerSync } from './tracker-sync-check.mjs';
import { normalizeStatus } from './followup-cadence.mjs';
import { checkFollowupsSchema } from './stats.mjs';
import { loadCanonicalStates } from './tracker-utils.mjs';
import { checkJdArchive } from './check-jd-archive.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const CODE_ROOT = CAREER_OPS;
let userContext;
try {
  userContext = getUserContext(process.argv.slice(2), { requireUser: !process.env.CAREER_OPS_TRACKER });
} catch (err) {
  printUserContextErrorAndExit(err);
}

const JSON_OUTPUT = userContext.args.includes('--json');

const APPS_FILE = process.env.CAREER_OPS_TRACKER || userPath(userContext, 'data/applications.md');
const TRACKER_DIR = dirname(APPS_FILE);
const TRACKER_ROOT = userContext.userRoot || (basename(TRACKER_DIR) === 'data' ? dirname(TRACKER_DIR) : TRACKER_DIR);
const JDS_DIR = process.env.CAREER_OPS_JDS ? resolve(TRACKER_ROOT, process.env.CAREER_OPS_JDS) : join(TRACKER_ROOT, 'jds');
const ADDITIONS_DIR = process.env.CAREER_OPS_ADDITIONS || (
  userContext.userRoot
    ? userPath(userContext, 'batch/tracker-additions')
    : join(TRACKER_ROOT, 'batch/tracker-additions')
);
const REPORTS_DIR = process.env.CAREER_OPS_REPORTS || (
  userContext.userRoot ? userPath(userContext, 'reports') : join(TRACKER_ROOT, 'reports')
);
const STATES_FILE = existsSync(systemPath('templates/states.yml'))
  ? systemPath('templates/states.yml')
  : join(CAREER_OPS, 'states.yml');

// Ensure required directories exist (fresh setup)
if (userContext.userRoot) ensureUserDirs(userContext, ['data', 'batch/tracker-additions']);
else {
  mkdirSync(TRACKER_DIR, { recursive: true });
  mkdirSync(ADDITIONS_DIR, { recursive: true });
}
mkdirSync(REPORTS_DIR, { recursive: true });

// Canonical states — loaded from templates/states.yml, the single source of truth.
const _canonicalStates = loadCanonicalStates(STATES_FILE);
const CANONICAL_STATUSES = new Set(_canonicalStates.map(s => s.id));
const ALIASES = Object.fromEntries(
  _canonicalStates.flatMap(s => s.aliases.map(a => [a.toLowerCase(), s.id]))
);

let errors = 0;
let warnings = 0;
const errorFindings = [];
const warningFindings = [];

function finding(level, code, id, message, details = {}) {
  const item = { id, code, message, details };
  if (level === 'error') {
    errors++;
    errorFindings.push(item);
    if (!JSON_OUTPUT) console.log(`❌ ${message}`);
  } else {
    warnings++;
    warningFindings.push(item);
    if (!JSON_OUTPUT) console.log(`⚠️  ${message}`);
  }
}
function error(message, code = 'integrity_error', id = code, details = {}) {
  finding('error', code, id, message, details);
}
function warn(message, code = 'integrity_warning', id = code, details = {}) {
  finding('warning', code, id, message, details);
}
function ok(msg) { if (!JSON_OUTPUT) console.log(`✅ ${msg}`); }

// --- Read applications.md ---
if (!existsSync(APPS_FILE)) {
  if (JSON_OUTPUT) {
    console.log(JSON.stringify({
      schema_version: 1,
      status: 'clean',
      errors: [],
      warnings: [],
      counts: { entries: 0, errors: 0, warnings: 0 },
    }));
    process.exit(0);
  }
  console.log('\n📊 No applications.md found. This is normal for a fresh setup.');
  console.log('   The file will be created when you evaluate your first offer.\n');
  process.exit(0);
}
const content = readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

// Map columns by header name so the checks work whether the tracker uses the
// original 9-column layout or a customized one with an extra column (e.g. a
// Location column after Role). Fixed-position indexing would otherwise read
// Location where Score is expected and flag false errors. Falls back to the
// legacy fixed layout when no recognizable header row is found.
//
// Sourced from tracker-parse.mjs rather than re-declared here: this file used
// to carry its own copy of LEGACY_COLMAP, HEADER_ALIASES and detectColumns, so
// a fix to the shared module left verify-pipeline reading a different layout
// than merge-tracker wrote — the drift tracker-parse.mjs exists to prevent, and
// the same half-application #1291 was filed for.
const COLMAP = resolveColumns(lines);
const MAX_IDX = Math.max(...Object.values(COLMAP));

const entries = [];
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  const parts = line.split('|').map(s => s.trim());
  if (parts.length <= MAX_IDX) continue;
  const num = parseInt(parts[COLMAP.num]);
  if (isNaN(num)) continue;
  entries.push({
    num,
    date: parts[COLMAP.date],
    company: parts[COLMAP.company],
    via: COLMAP.via != null ? parts[COLMAP.via] : '',
    role: parts[COLMAP.role],
    location: COLMAP.location != null ? parts[COLMAP.location] : '',
    score: parts[COLMAP.score],
    status: parts[COLMAP.status],
    pdf: parts[COLMAP.pdf],
    report: parts[COLMAP.report],
    notes: COLMAP.notes != null ? (parts[COLMAP.notes] || '') : '',
  });
}

const reportContentCache = new Map();
function reportContent(name) {
  if (!name) return null;
  if (reportContentCache.has(name)) return reportContentCache.get(name);
  try {
    const value = readFileSync(join(REPORTS_DIR, basename(name)), 'utf-8');
    reportContentCache.set(name, value);
    return value;
  } catch {
    reportContentCache.set(name, null);
    return null;
  }
}

function linkedReportName(entry) {
  const target = String(entry?.report || '').match(/\]\(([^)]+)\)/)?.[1];
  return target ? basename(target) : null;
}

function canonicalPostingUrl(value) {
  const raw = String(value || '').trim().replace(/&amp;/g, '&');
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    parsed.pathname = parsed.pathname
      .replace(/\/(?:apply|application)\/?$/i, '')
      .replace(/\/$/, '');
    // Aggregators may rewrite the descriptive slug while retaining the stable
    // posting UUID. On one host that UUID is a stronger identity than any
    // surrounding category or title text.
    const postingUuid = parsed.pathname.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
    )?.[1];
    if (postingUuid) parsed.pathname = `/_posting/${postingUuid.toLowerCase()}`;
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key) ||
          /^(?:source|src|feed_run|ref|referrer|trackingid|tracking_id|trk|li_fat_id|gh_src|lever-source)$/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    return parsed.toString().replace(/\?$/, '');
  } catch {
    return raw;
  }
}

function extractPostingUrl(content) {
  if (!content) return null;
  const value = content.match(/^\*\*URL:\*\*\s*(.+)$/im)?.[1]?.trim();
  if (!value) return null;
  const markdownTarget = value.match(/\]\((https?:\/\/[^)]+)\)/i)?.[1];
  const plainTarget = value.match(/https?:\/\/\S+/i)?.[0];
  return canonicalPostingUrl(markdownTarget || plainTarget || value);
}

function postingUrlForEntry(entry) {
  return extractPostingUrl(reportContent(linkedReportName(entry)));
}

if (!JSON_OUTPUT) {
  console.log(`\n📊 Checking ${entries.length} entries in applications.md${userContext.userId ? ` for user "${userContext.userId}"` : ''}\n`);
}

// --- Check 1: Canonical statuses ---
let badStatuses = 0;
for (const e of entries) {
  const clean = e.status.replace(/\*\*/g, '').trim().toLowerCase();
  // Strip trailing dates
  const statusOnly = clean.replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();

  if (!CANONICAL_STATUSES.has(statusOnly) && !ALIASES[statusOnly]) {
    error(`#${e.num}: Non-canonical status "${e.status}"`, 'noncanonical_status', `noncanonical-status:${e.num}`, { tracker_num: e.num, status: e.status });
    badStatuses++;
  }

  // Check for markdown bold in status
  if (e.status.includes('**')) {
    error(`#${e.num}: Status contains markdown bold: "${e.status}"`, 'bold_status', `bold-status:${e.num}`, { tracker_num: e.num, status: e.status });
    badStatuses++;
  }

  // Check for dates in status
  if (/\d{4}-\d{2}-\d{2}/.test(e.status)) {
    error(`#${e.num}: Status contains date: "${e.status}" — dates go in date column`, 'dated_status', `dated-status:${e.num}`, { tracker_num: e.num, status: e.status });
    badStatuses++;
  }
}
if (badStatuses === 0) ok('All statuses are canonical');

// --- Check 2: Duplicates ---
const companyRoleMap = new Map();
let dupes = 0;
for (const e of entries) {
  // Unicode-aware (#2393): an [a-z0-9] strip erases non-Latin scripts outright,
  // so every Japanese company and every Japanese role keyed to '' and unrelated
  // rows were reported as "possible duplicates".
  const key = normalizeTextKey(e.company) + '::' + normalizeTextKey(e.role);
  if (!companyRoleMap.has(key)) companyRoleMap.set(key, []);
  companyRoleMap.get(key).push(e);
}
function emitTrackerDuplicate(group, extraDetails = {}) {
  const nums = group.map(e => e.num).sort((a, b) => a - b);
  warn(
    `Possible duplicates: ${group.map(e => `#${e.num}`).join(', ')} (${group[0].company} — ${group[0].role})`,
    'possible_duplicate_tracker',
    `possible-duplicate-tracker:${nums.join(':')}`,
    {
      tracker_nums: nums,
      entries: group.map(e => ({
        tracker_num: e.num,
        date: e.date,
        company: e.company,
        role: e.role,
        via: e.via,
        score: e.score,
        status: e.status,
        report: e.report,
        notes: e.notes,
      })),
      ...extraDetails,
    },
  );
  dupes++;
}
for (const group of companyRoleMap.values()) {
  if (group.length < 2) continue;
  emitTrackerDuplicate(group);

  // Preserve the broad company/title warning, but also expose exact canonical
  // URL subgroups. The reviewer can safely resolve a proven subset while
  // retaining distinct re-postings in the broad group as a seen exception.
  const byUrl = new Map();
  for (const entry of group) {
    const url = postingUrlForEntry(entry);
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(entry);
  }
  for (const [url, urlGroup] of byUrl) {
    if (urlGroup.length < 2 || urlGroup.length === group.length) continue;
    emitTrackerDuplicate(urlGroup, { match_basis: 'canonical_url', canonical_url: url });
  }
}
if (dupes === 0) ok('No exact duplicates found');

// --- Check 3: Report links ---
// Markdown links resolve relative to the file that contains them, so report
// links must resolve against the tracker's own directory (see #760). For the
// transition we also accept legacy root-relative links: try the tracker dir
// first, then fall back to the active user root before flagging a link broken.
let brokenReports = 0;
let uninspectableReports = 0;
for (const e of entries) {
  let inspectionFailure = null;
  const link = findDeadReportLink(e.report, TRACKER_DIR, TRACKER_ROOT, {
    onInspectionError: failure => { inspectionFailure = failure; },
  });
  if (inspectionFailure) {
    const codes = [...new Set(inspectionFailure.errors.map(({ error: err }) => err?.code || 'unknown error'))].join(', ');
    warn(`#${e.num}: Report could not be inspected (${codes}), so it may exist: ${inspectionFailure.link}`,
      'report_uninspectable', `report-uninspectable:${e.num}`, {
        tracker_num: e.num, report_link: inspectionFailure.link, error_codes: codes,
      });
    uninspectableReports++;
    continue;
  }
  if (link !== null) {
    error(`#${e.num}: Report not found: ${link}`, 'broken_report_link', `broken-report-link:${e.num}`, { tracker_num: e.num, report_link: link });
    brokenReports++;
  }
}
if (brokenReports === 0 && uninspectableReports === 0) ok('All report links valid');

// --- Check 4: Score format ---
let badScores = 0;
for (const e of entries) {
  if (!looksLikeScoreCell(e.score)) {
    error(`#${e.num}: Invalid score format: "${e.score}"`, 'invalid_score', `invalid-score:${e.num}`, { tracker_num: e.num, score: e.score });
    badScores++;
  }
}
if (badScores === 0) ok('All scores valid');

// --- Check 5: Row format ---
let badRows = 0;
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  if (isSeparatorRow(line) || isHeaderRow(line)) continue;
  const parts = line.split('|');
  if (parts.length <= MAX_IDX) {
    error(`Row with too few columns (need ${MAX_IDX} data cols): ${line.substring(0, 80)}...`, 'malformed_tracker_row', `malformed-tracker-row:${badRows + 1}`, { row: line });
    badRows++;
  }
}
if (badRows === 0) ok('All rows properly formatted');

// --- Check 6: Pending TSVs ---
let pendingTsvs = 0;
if (existsSync(ADDITIONS_DIR)) {
  const files = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
  pendingTsvs = files.length;
  if (pendingTsvs > 0) {
    warn(
      `${pendingTsvs} pending TSVs in tracker-additions/ (not merged)`,
      'pending_tracker_additions',
      'pending-tracker-additions',
      { files: files.sort().map(name => `batch/tracker-additions/${name}`) },
    );
  }
}
if (pendingTsvs === 0) ok('No pending TSVs');

// --- Check 7: Bold in scores ---
let boldScores = 0;
for (const e of entries) {
  if (e.score.includes('**')) {
    warn(`#${e.num}: Score has markdown bold: "${e.score}"`, 'bold_score', `bold-score:${e.num}`, { tracker_num: e.num, score: e.score });
    boldScores++;
  }
}
if (boldScores === 0) ok('No bold in scores');

// --- Check 8: Stale report-number sentinels (GC) ---
// reserve-report-num.mjs drops NNN-RESERVED.md files in reports/ when a
// number is claimed.  If the process crashed before writing the real report
// and deleting the sentinel it will linger.  Sentinels older than 4 h are
// stale; remove them here so they don't skew the next slot allocation.
const SENTINEL_MAX_AGE_MS = 4 * 60 * 60 * 1000;
let staleSentinels = 0;
if (existsSync(REPORTS_DIR)) {
  const now = Date.now();
  for (const name of readdirSync(REPORTS_DIR)) {
    if (!name.endsWith('-RESERVED.md')) continue;
    const full = join(REPORTS_DIR, name);
    try {
      const { mtimeMs } = statSync(full);
      if (now - mtimeMs > SENTINEL_MAX_AGE_MS) {
        unlinkSync(full);
        warn(`Removed stale reservation sentinel: ${name}`, 'stale_reservation_removed', `stale-reservation-removed:${name}`, { file: `reports/${name}`, resolved: true });
        staleSentinels++;
      }
    } catch {
      // Already gone between readdir and stat — fine.
    }
  }
}
if (staleSentinels === 0) ok('No stale reservation sentinels');

// --- Check 9: Duplicate reports for the same company+role (#1425) ---
// Two concurrent evaluators can each write a report for the same role.
// merge-tracker dedups the TRACKER, but nothing watched reports/ itself.
// Warning-level, not error: duplicates can be legitimate (re-evaluation
// after a JD change).
const REPORT_FILE_RE = /^(\d+)-(.+)-\d{4}-\d{2}-\d{2}\.md$/;
// Shares normalizeTextKey with Check 2 so the two checks fold text the same
// way (#2393). That is where the guarantee ends: this check keys off the
// FILENAME slug, already ASCII by the time a report is written, while Check 2
// keys off the tracker's Company column with the original spelling intact. So
// the two can and do disagree — `İstanbul Tekstil` vs `Istanbul Tekstil` is
// flagged here and not there, because the dotted I survives in one input and
// not the other. Sharing a normalizer is not sharing a contract when the
// callers feed it different things. Pinned in test-all.mjs.
const normalizeKey = normalizeTextKey;

// Role comes from the report body: the Machine Summary YAML fence when
// present (field names are exact by contract), else the title line
// "# Evaluación: {Company} — {Role}". Reports where neither parses are
// skipped rather than grouped by company alone, which would false-positive
// on two different roles at the same company.
function extractRole(reportContent) {
  if (!reportContent) return null;
  const fence = reportContent.match(/##\s*Machine Summary\s*\n+```(?:yaml|yml|json)?\s*\n([\s\S]*?)\n```/i);
  if (fence) {
    const m = fence[1].match(/^role:\s*["']?(.+?)["']?\s*$/m);
    if (m && m[1].trim()) return m[1].trim();
  }
  const title = reportContent.split('\n').find(l => l.startsWith('# '));
  if (title) {
    const parts = title.split(/[—–]/);
    if (parts.length >= 2 && parts[parts.length - 1].trim()) return parts[parts.length - 1].trim();
  }
  return null;
}

// Canonical posting-URL key of a report, or '' when it carries none.
// Same extraction as merge-tracker.mjs resolveReportUrl(): `**URL:**` is
// matched anywhere on the line, not from column 0, because the documented
// header is inline (`**Score:** 4.1/5 | **URL:** https://… | **PDF:** …`);
// `[ \t]*` and `\S+` cannot cross a newline, so an empty header cannot
// capture the next header's text. What comes back is the normalizeUrl() key,
// never the raw text: `**URL:** N/A` (a recruiter-sourced role) has no key and
// must stay "unknown", not become a value that two reports can differ on.
function extractReportUrlKey(reportContent) {
  const m = reportContent.match(/\*\*URL:\*\*[ \t]*(\S+)/);
  if (!m) return '';
  const raw = m[1].replace(/^<|>$/g, '').replace(/[),.;]+$/, '');
  return normalizeUrl(raw) ? canonicalPostingUrl(raw) : '';
}

const reportFiles = existsSync(REPORTS_DIR)
  ? readdirSync(REPORTS_DIR).filter(f => REPORT_FILE_RE.test(f))
  : [];

// A numeric report prefix is the durable tracker/report/artifact identity. Two
// active files with the same prefix make historical provenance and any external
// `#N` reference ambiguous even when their company/title slugs differ.
const reportsByNumber = new Map();
for (const name of reportFiles) {
  const num = parseInt(name.match(REPORT_FILE_RE)[1], 10);
  if (!reportsByNumber.has(num)) reportsByNumber.set(num, []);
  reportsByNumber.get(num).push(name);
}
let reportNumberCollisions = 0;
for (const [num, group] of reportsByNumber) {
  if (group.length < 2) continue;
  const sorted = [...group].sort();
  error(
    `Report number #${num} is used by ${group.length} active files: ${sorted.join(', ')}`,
    'duplicate_report_number',
    `duplicate-report-number:${num}`,
    { report_num: num, files: sorted.map(name => `reports/${name}`) },
  );
  reportNumberCollisions++;
}
if (reportNumberCollisions === 0) ok('No duplicate report numbers');

let dupReports = 0;
const reportsByRole = new Map();
for (const name of reportFiles) {
  const companySlug = name.match(REPORT_FILE_RE)[2];
  let role = null;
  let urlKey = '';
  try {
    const content = readFileSync(join(REPORTS_DIR, name), 'utf-8');
    role = extractRole(content);
    urlKey = extractReportUrlKey(content);
  } catch {
    // Unreadable report — the orphan check below still sees it.
  }
  if (!role) continue;
  const key = normalizeKey(companySlug) + '::' + normalizeKey(role);
  if (!reportsByRole.has(key)) reportsByRole.set(key, []);
  reportsByRole.get(key).push({ name, urlKey });
}
for (const group of reportsByRole.values()) {
  if (group.length < 2) continue;
  // Two present-and-different posting URLs are proof of two openings (one
  // title posted per city, two reqs a recruiter opened with the same title),
  // the same rule merge-tracker.mjs applies before it merges a row. A missing
  // URL proves nothing, so the group is exempt only when EVERY report carries
  // a key and no two share one.
  const keys = group.map(r => r.urlKey);
  if (keys.every(Boolean) && new Set(keys).size === keys.length) continue;
  warn(`Duplicate reports for same company+role: ${group.map(r => r.name).join(', ')}`, 'duplicate_reports_same_role', `duplicate-reports:${group.map(r => r.name).sort().join(':')}`, { files: group.map(r => `reports/${r.name}`) });
  dupReports++;
  const byUrl = new Map();
  for (const report of group) {
    if (!report.urlKey) continue;
    if (!byUrl.has(report.urlKey)) byUrl.set(report.urlKey, []);
    byUrl.get(report.urlKey).push(report);
  }
  for (const [url, subset] of byUrl) {
    if (subset.length < 2 || subset.length === group.length) continue;
    const names = subset.map(report => report.name).sort();
    warn(`Duplicate reports for the same posting: ${names.join(', ')}`, 'duplicate_reports_same_role', `duplicate-reports:${names.join(':')}`, {
      files: names.map(name => `reports/${name}`), match_basis: 'canonical_url', canonical_url: url,
    });
    dupReports++;
  }
}
if (dupReports === 0) ok('No duplicate reports for the same company+role');

// --- Check 10: Orphan reports with no tracker row (#1425) ---
// The linked filename is the durable ownership edge. Numeric-only matching is
// insufficient: when two active reports accidentally share one prefix, a
// tracker link to one of them must not make the other appear tracked too.
// Exact link matching deliberately surfaces the unlinked collision member as
// an orphan so reviewed verification can archive a true duplicate or restore
// a distinct valid evaluation under a fresh number.
const referencedReportFiles = new Set();
const fallbackReferencedNums = new Set();
for (const e of entries) {
  const linkTargets = [...e.report.matchAll(/\]\(([^)]+)\)/g)];
  if (linkTargets.length === 0) {
    // Legacy non-link cells have no durable filename edge. Only there, use the
    // tracker number as a compatibility fallback.
    fallbackReferencedNums.add(e.num);
    continue;
  }
  for (const lt of linkTargets) {
    const name = lt[1].split('/').pop();
    if (REPORT_FILE_RE.test(name)) referencedReportFiles.add(name);
  }
}

let orphanReports = 0;
for (const name of reportFiles) {
  const num = parseInt(name.match(REPORT_FILE_RE)[1], 10);
  if (!referencedReportFiles.has(name) && !fallbackReferencedNums.has(num)) {
    warn(`Orphan report — no tracker row references #${num}: reports/${name}`, 'orphan_report', `orphan-report:${name}`, { report_num: num, file: `reports/${name}` });
    orphanReports++;
  }
}
if (orphanReports === 0) ok('No orphan reports');

// --- Check 11: Via channel consistency (#1596) ---
// The Via column records the intermediary (agency/recruiter firm; `—` when the
// application was direct). Unknown employers use the structural marker `?` in
// Company — never a word like "Confidential", which is locale-dependent and can
// collide with a real firm name.
let viaIssues = 0;
const CONFIDENTIAL_WORD_RE = /^(confidential|vertraulich|confidentiel|confidencial|riservato|gizli|機密|سري)$/i;
for (const e of entries) {
  const company = String(e.company || '').trim();
  const via = String(e.via || '').trim();
  if (company === '?') {
    if (COLMAP.via == null) {
      warn(`#${e.num}: unknown employer (?) but the tracker has no Via column — add it with: node merge-tracker.mjs --migrate-via`, 'missing_via_column', `missing-via-column:${e.num}`, { tracker_num: e.num });
      viaIssues++;
    } else if (!via || via === '—') {
      error(`#${e.num}: unknown employer (?) with no Via channel — record the agency/recruiter firm`, 'missing_via_value', `missing-via-value:${e.num}`, { tracker_num: e.num });
      viaIssues++;
    }
  }
  if (CONFIDENTIAL_WORD_RE.test(company)) {
    warn(`#${e.num}: company "${company}" looks like a confidentiality placeholder — use the structural marker ? (locale-invariant, can't collide with a real firm)`, 'confidential_company_placeholder', `confidential-company-placeholder:${e.num}`, { tracker_num: e.num, company });
    viaIssues++;
  }
}
// Same company+role reached through different channels: both submissions are
// real, so this is a warning to the human (double-submission risk), never an
// auto-merge. Channel identity uses the shared normalizeVia() that merge-tracker
// and dedup-tracker key agencies with (#2397), so "Hays" and "HAYS " read as one
// channel while リクルート and パーソル stay two; the raw spelling is kept for
// the message. Before this, both non-Latin agencies normalized to '' and fell
// back to 'direct', hiding exactly the double-submission this check exists for.
//
// A SKIP row is not a channel (#3978). The canonical way to RESOLVE a
// cross-channel collision is the one states.yml already provides: apply
// through one channel, mark the other SKIP ("Doesn't fit, don't apply").
// Counting that row as a channel warned forever about the double submission
// the user had just avoided, with no "resolve by hand" action left that could
// clear it — so the only ways out were ignoring the check permanently or
// falsifying the Via/Company to silence it. A check correct behaviour cannot
// satisfy is worse than no check.
//
// Deliberately narrow — skip only. `discarded` is ambiguous ("Discarded by
// candidate or offer closed") and can follow a real application; `rejected`
// implies one was sent; `evaluated` is pre-decision, and warning BEFORE a
// second submission is this check's most valuable moment. All three stay
// channels. Status is read through the shared states.yml-driven
// normalizeStatus() for the same reason the column layout comes from
// tracker-parse: a local alias table here would miss the states.yml spellings
// it never got told about (geo_blocker, uygun değil) and drift from Check 1.
const isNeverSubmitted = (status) => normalizeStatus(String(status || '')) === 'skip';
const normalizeChannel = (v) => normalizeVia(v ?? '') || 'direct';
const channelsByRole = new Map();
for (const e of entries) {
  const company = String(e.company || '').trim();
  if (!company || company === '?') continue;
  if (isNeverSubmitted(e.status)) continue;
  const key = `${company.toLowerCase()}::${String(e.role || '').trim().toLowerCase()}`;
  if (!channelsByRole.has(key)) channelsByRole.set(key, new Map());
  const channels = channelsByRole.get(key);
  const norm = normalizeChannel(e.via);
  if (!channels.has(norm)) channels.set(norm, { raw: String(e.via || '').trim() || '—', num: e.num });
}
for (const [key, vias] of channelsByRole) {
  if (vias.size > 1) {
    const list = [...vias.values()];
    const nums = list.map(v => v.num).sort((a, b) => a - b);
    warn(
      `Cross-channel duplicate — ${key.replace('::', ' / ')} reached via ${list.map(v => v.raw).join(' AND ')} (rows ${list.map(v => `#${v.num}`).join(', ')}) — double-submission risk, resolve by hand`,
      'cross_channel_duplicate_risk',
      `cross-channel-duplicate:${nums.join(':')}`,
      { tracker_nums: nums, channels: list.map(v => ({ tracker_num: v.num, via: v.raw })) },
    );
    viaIssues++;
  }
}
if (viaIssues === 0) ok('Via channels consistent');
// --- Check 12: Duplicate tracker numbers (#1704) ---
// The # column is a row id and must be unique. Unlike Check 2 (company+role
// dedup, which can false-positive on a legitimate re-application), the SAME
// number appearing on 2+ rows is never legitimate: it means set-status.mjs
// can't tell the rows apart, and any external reference to "application #N"
// (interview-prep notes, memory, cross-links) becomes ambiguous. Pure
// addition, no existing check covers this — see #1704 for the 124-row sweep
// that found this in the wild (merge-tracker.mjs trusted a stale TSV number
// as-is whenever it exceeded that run's max, without checking it wasn't
// already used by an unrelated row merged in a separate, earlier invocation).
const numGroups = new Map();
for (const e of entries) {
  if (!numGroups.has(e.num)) numGroups.set(e.num, []);
  numGroups.get(e.num).push(e);
}
let dupeNums = 0;
for (const [num, group] of numGroups) {
  if (group.length > 1) {
    error(`Duplicate tracker number #${num} used by ${group.length} rows: ${group.map(e => `${e.company} — ${e.role}`).join(' | ')}`, 'duplicate_tracker_number', `duplicate-tracker-number:${num}`, { tracker_num: num, entries: group.map(e => ({ company: e.company, role: e.role })) });
    dupeNums++;
  }
}
if (dupeNums === 0) ok('No duplicate tracker numbers');

// --- Check 13: applications.md <-> active-interviews.md status sync (#1504) ---
// Delegates to tracker-sync-check.mjs's exported checkTrackerSync() rather than
// re-implementing the matching/two-tier resolution logic here or shelling out
// to a second process. Read-only: this only surfaces drift, it does not write
// a fix (tracker-sync-check.mjs is intentionally reporting-only for now — see
// its module header).
let syncResult;
try {
  syncResult = checkTrackerSync({ appsFile: APPS_FILE });
} catch (err) {
  // A check that could not RUN is a failed check, not a warning. warn() does not affect the exit
  // code, so a throw here made verify-pipeline print a notice and still exit 0 — and to anything
  // reading the exit status (CI, a cron wrapper, a pre-push hook) that is indistinguishable from
  // the invariant holding. We do not know whether the tracker is in sync; we know we failed to
  // look. The honest report is failure.
  error(`Sync check could not run — the tracker was NOT verified: ${err.message}`);
}

if (syncResult) {
  const tier1Mismatches = syncResult.mismatches.filter(m => m.resolution === 'auto-tier1');
  const tier2Mismatches = syncResult.mismatches.filter(m => m.resolution === 'needs-review-tier2');
  const unmatchedRows = syncResult.mismatches.filter(m => m.resolution === 'unmatched');

  for (const m of tier1Mismatches) {
    warn(`Sync drift (auto-resolvable): ${m.company} — ${m.role}: applications.md="${m.applicationsStatus}" vs active-interviews.md="${m.activeInterviewsStatus}" -> suggest "${m.suggestedStatus}" in ${m.staleIn} (run node tracker-sync-check.mjs for details)`);
  }
  for (const m of tier2Mismatches) {
    warn(`Sync drift (needs human review): ${m.company} — ${m.role}: applications.md="${m.applicationsStatus}" (${m.applicationsLastModified || 'no blame info'}) vs active-interviews.md="${m.activeInterviewsStatus}" (${m.activeInterviewsLastModified || 'no blame info'})`);
  }
  for (const m of unmatchedRows) {
    warn(`Sync check: active-interviews.md row for "${m.company}" — "${m.role}" could not be matched to a tracker row (${m.note})`);
  }
  if (tier1Mismatches.length === 0 && tier2Mismatches.length === 0 && unmatchedRows.length === 0) {
    ok(syncResult.summary.total > 0
      ? 'applications.md and active-interviews.md are in sync'
      : 'No active-interviews.md rows to sync-check');
  }
}

// --- Check 14: data/follow-ups.md table schema (#2971) ---
// stats.mjs (computeFollowupStats) and followup-cadence.mjs both read this table
// positionally, in the shape modes/followup.md documents, and both skip any row
// whose num/appNum cells don't parse as integers. A table written with a
// different column order therefore reports as ZERO follow-ups in both tools,
// silently — indistinguishable from a file where nothing has been logged yet.
// Follow-up compliance is exactly the number a user consults to decide whether
// their follow-ups are working, so a silent zero is actively misleading. This is
// the only place that difference is visible.
//
// Path resolution deliberately matches the two consumers (CAREER_OPS/data/...)
// rather than APPS_FILE's directory: the check exists to predict what they will
// do, so it has to read the same file they read.
const FOLLOWUPS_FILE = join(TRACKER_ROOT, 'data', 'follow-ups.md');
const FOLLOWUPS_COLUMNS = '| num | appNum | date | company | role | channel | contact | notes |';
if (!existsSync(FOLLOWUPS_FILE)) {
  ok('No follow-ups.md yet — nothing to schema-check');
} else {
  const fups = checkFollowupsSchema(readFileSync(FOLLOWUPS_FILE, 'utf-8'));
  if (fups.pipeLines === 0) {
    ok('follow-ups.md has no table rows yet');
  } else if (!fups.sawSeparator) {
    error(`follow-ups.md has table rows but no header delimiter row, so every row is skipped — expected ${FOLLOWUPS_COLUMNS} (see modes/followup.md)`);
  } else if (fups.dataRows === 0) {
    ok('follow-ups.md has no logged follow-ups yet');
  } else if (fups.parsed === 0) {
    error(`follow-ups.md: none of its ${fups.dataRows} row(s) parse, so stats.mjs and followup-cadence.mjs will both report zero follow-ups — expected column order ${FOLLOWUPS_COLUMNS} (see modes/followup.md)`);
  } else if (fups.unparsedLines.length > 0) {
    warn(`follow-ups.md: ${fups.unparsedLines.length} of ${fups.dataRows} rows will be skipped by stats.mjs and followup-cadence.mjs (line${fups.unparsedLines.length === 1 ? '' : 's'} ${fups.unparsedLines.join(', ')}) — expected ${FOLLOWUPS_COLUMNS}`);
  } else {
    ok(`follow-ups.md schema valid (${fups.parsed} logged follow-up${fups.parsed === 1 ? '' : 's'})`);
  }
}

// --- Check 15: portals.yml entries no provider claims (#3251) ---
// Coverage rot is invisible from every other check here: an entry with
// `enabled: true` and a careers_url nothing matches reads as a tracked company
// in the config and contributes zero postings on every scan. Twelve of those
// were live on 2026-08-26, one of them a company whose real board existed and
// was one character off the slug in the file.
//
// Only the OFFLINE half of audit-portals.mjs runs here — provider resolution is
// pure config matching, so this check stays as fast and network-free as the rest
// of verify-pipeline. The live half (does the board answer, and with whose
// jobs?) needs 170 fetches and stays a separate command: `node audit-portals.mjs`.
//
// portals.yml is user-layer and gitignored, so its absence is not a finding.
const PORTALS_FILE = process.env.CAREER_OPS_PORTALS || join(TRACKER_ROOT, 'portals.yml');
if (!existsSync(PORTALS_FILE)) {
  ok('No portals.yml yet — nothing to coverage-check');
} else {
  try {
    const { findUnclaimedEntries } = await import('./audit-portals.mjs');
    const { loadProviders } = await import('./providers/_registry.mjs');
    const { mergeProviderPlugins } = await import('./plugins/_engine.mjs');
    const yaml = await import('js-yaml');

    const cfg = yaml.load(readFileSync(PORTALS_FILE, 'utf-8')) || {};
    // Both sections, because scan.mjs resolves both through the same registry:
    // an unclaimed aggregator board is exactly as dead as an unclaimed company.
    const entries = [
      ...(Array.isArray(cfg.tracked_companies) ? cfg.tracked_companies : []),
      ...(Array.isArray(cfg.job_boards) ? cfg.job_boards : []),
    ];
    // providers/ and plugins/ both ship in the code layer — resolve them from
    // CODE_ROOT (scan.mjs does the same). Without mergeProviderPlugins() the
    // health check sees only providers/*.mjs and reports every enabled
    // plugin-provider entry as an unknown provider that "never scans", while
    // the scanner resolves and scans it (#4026). No-op for a plugin-free
    // install: mergeProviderPlugins returns before any work when
    // config/plugins.yml is absent.
    const providers = await loadProviders(join(CODE_ROOT, 'providers'));
    await mergeProviderPlugins(providers, { root: CODE_ROOT, dataRoot: TRACKER_ROOT });
    const { silent, handoff, unknownProvider } = findUnclaimedEntries(entries, providers);

    // findUnclaimedEntries silently skips an entry with no (or blank) `name` —
    // it can't report what it can't label. Without this, that entry vanishes
    // from silent/handoff/unknownProvider entirely, and the enabled count
    // below (which doesn't share the same eligibility rule) would still
    // include it — so a malformed entry never gets a provider check AND the
    // "All N entries resolve" success line claims it as resolved anyway.
    const malformed = entries.filter(e => e && e.enabled !== false && (typeof e.name !== 'string' || !e.name.trim()));
    for (const e of malformed) {
      warn(`portals.yml: an enabled entry has no name (careers_url: ${e.careers_url || 'none'}) — it cannot be provider-checked; give it a name`);
    }

    for (const e of unknownProvider) {
      error(`portals.yml: "${e.name}" sets an unknown provider — ${e.error}. The entry never scans (see providers/ for valid ids)`);
    }
    for (const e of silent) {
      warn(`portals.yml: "${e.name}" is enabled but no provider claims ${e.careers_url || 'its careers_url'} — scan.mjs skips it on every run without naming it (run node audit-portals.mjs)`);
    }
    if (silent.length === 0 && unknownProvider.length === 0 && malformed.length === 0) {
      const enabled = entries.filter(e => e && e.enabled !== false).length;
      ok(handoff.length > 0
        ? `All ${enabled - handoff.length} scannable portals.yml entries resolve to a provider (${handoff.length} on websearch handoff)`
        : `All ${enabled} enabled portals.yml entries resolve to a provider`);
    }
  } catch (err) {
    warn(`Portal coverage check could not run: ${err.message}`);
  }
}

// --- Check 16: invisible control bytes already in tracker cells (#3892) ---
// cell() in tracker-utils.mjs strips these on the way in, which stops new ones
// entering but can do nothing about the ones already written. This is the only
// place such a byte is visible at all: it shifts or truncates the positional
// `split('|')` parse, so a row silently reads as a different row or drops out
// of a count entirely, while every renderer of the table — markdown, GitHub,
// the web dashboard — shows the cell as correct. The corruption surfaces much
// later as an unrelated arithmetic discrepancy with no trail back to the cause.
//
// Read off the RAW lines rather than the parsed `entries`, so a byte in a
// column this file has no field for is caught too, and reported with the file
// line number: a shifted parse is exactly the situation where the row's own #
// cell is the thing not to trust.
//
// CONTROL_CHARS is imported, never re-declared — a second copy of the range
// would let the write path and this detector disagree about what counts.
let controlByteRows = 0;
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].startsWith('|')) continue;
  // .match() with a /g regex resets lastIndex; .test() would not, and would
  // then skip every other offending row.
  const found = lines[i].match(CONTROL_CHARS);
  if (!found) continue;
  const points = [...new Set(found.map(c => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`))];
  error(`applications.md line ${i + 1}: tracker row contains invisible control character(s) ${points.join(', ')} — delete them; they render as nothing in every view but shift the positional column parse`);
  controlByteRows++;
}
if (controlByteRows === 0) ok('No control characters in tracker cells');

// --- Check 17: JD archive coverage (#4525) ---
// check-jd-archive.mjs is a plain local filesystem scan — no network, no cost
// reason to keep it as a command a user has to remember to run separately the
// way audit-portals.mjs's live half justifiably is. Its own CLI already
// distinguishes two severities and this mirrors that split exactly:
// `missing-jd-archive` is what its own exit code treats as hard (a SENT
// application with no archived JD and no terminal status to excuse it), so it
// reports here as an error; `jd-archive-review-due` is explicitly soft in its
// own source (a still-live/unresolved row, not yet a confirmed miss), so it
// reports as a warning, same as this file's own Check 9/10 warnings.
const jdArchiveResult = checkJdArchive(REPORTS_DIR, JDS_DIR, { trackerPath: APPS_FILE, statesPath: STATES_FILE });
const jdArchiveMissing = jdArchiveResult.findings.filter(f => f.type === 'missing-jd-archive');
const jdArchiveReviewDue = jdArchiveResult.findings.filter(f => f.type === 'jd-archive-review-due');
for (const f of jdArchiveMissing) error(`${f.file}: ${f.detail}`, 'missing_jd_archive', `missing-jd:${f.file}`, { file: `reports/${f.file}` });
for (const f of jdArchiveReviewDue) warn(`${f.file}: ${f.detail}`, 'jd_archive_review_due', `jd-review:${f.file}`, { file: `reports/${f.file}` });
for (const w of jdArchiveResult.warnings) warn(`${w.file}: ${w.detail}`);
if (jdArchiveMissing.length === 0 && jdArchiveReviewDue.length === 0 && jdArchiveResult.warnings.length === 0) {
  ok(jdArchiveResult.reportsScanned === 0
    ? 'No reports yet — nothing to check for JD archives'
    : `All ${jdArchiveResult.reportsScanned} report(s) have an archived JD or a resolvable jds/ capture`);
}

// --- Summary ---
if (JSON_OUTPUT) {
  console.log(JSON.stringify({
    schema_version: 1,
    status: errors > 0 ? 'errors' : warnings > 0 ? 'warnings' : 'clean',
    errors: errorFindings,
    warnings: warningFindings,
    counts: { entries: entries.length, errors, warnings },
  }));
} else {
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Pipeline Health: ${errors} errors, ${warnings} warnings`);
  if (errors === 0 && warnings === 0) {
    console.log('🟢 Pipeline is clean!');
  } else if (errors === 0) {
    console.log('🟡 Pipeline OK with warnings');
  } else {
    console.log('🔴 Pipeline has errors — fix before proceeding');
  }
}

// Assigning exitCode lets Node flush large JSON payloads before termination.
// Calling process.exit() here truncated warning-heavy output at 64 KiB when
// stdout was piped to run-workflow or jq.
process.exitCode = errors > 0 ? 1 : 0;
