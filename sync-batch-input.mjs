#!/usr/bin/env node
/**
 * sync-batch-input.mjs — compatibility entry point for upstream's pipeline →
 * batch-input sync (#3391, #3442).
 *
 * The fork already owns this step: sync-pipeline-batch.mjs (lib/run-batch-sync.mjs)
 * appends the selected user's Pending rows to users/{USER}/batch/batch-input.tsv
 * under the pipeline lock, recovers stable IDs from batch-state.tsv, and fails
 * on input/state ID conflicts. run-workflow.mjs uses it. Upstream's own CLI wrote
 * to the checkout-level batch/ directory without a lock, which the per-user
 * batch runner never reads, so the CLI here only forwards to the fork's
 * synchronizer for an explicitly selected user.
 *
 * The pure pipeline-row helpers below stay exported for callers and tests. The
 * Pending header is the shared queue definition in lib/pipeline-queue.mjs.
 *
 * --url <url> queues that one Pending row (#5269; the dashboard's Inbox `e`
 * key calls it) with the same ID recovery and conflict checks. Its exit status
 * says what happened: 0 queued (or, with --dry-run, would be), 3 nothing to
 * queue because the URL is already in batch-input.tsv, 4 not an unchecked
 * Pending row (its URL must be the first cell after "- [ ] "), 1 any other
 * error, such as a --url that is not a public http(s) URL. A URL known only to
 * batch-state.tsv is queued again with its saved ID, as a full sync does.
 *
 * dropAggregatorDuplicates() (#7259) stays exported for callers and tests, but
 * the fork synchronizer does not apply it: upstream leaves a dropped row in
 * Pending, and the fork run completes only when every Pending row reaches a
 * terminal state (FORK.md, Deterministic run runner).
 *
 * Run: node sync-batch-input.mjs --user <id> [--dry-run] [--json] [--url <url>]
 */

import { isIP } from 'net';
import { isBlockedAddress } from './providers/_ip-guard.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { sectionKind } from './lib/pipeline-sections.mjs';
import { getUserContext, printUserContextErrorAndExit } from './lib/user-context.mjs';
import { isAggregatorUrl } from './url-key.mjs';
import { normalizeCompany } from './tracker-utils.mjs';
import { normalizeTextKey } from './tracker-parse.mjs';

export { URL_EXIT } from './lib/run-batch-sync.mjs';

/** Batch source label written into the source column. */
export const SOURCE = 'pipeline';

const SECTION_RE = /^##\s+/;
const PENDING_ITEM_RE = /^- \[ \]\s+/;

/**
 * Extract URL from a pipeline row body (first positional cell before " |").
 * @param {string} body - Raw pipeline row body after stripping the checkbox prefix.
 * @returns {string}
 */
export function lineUrl(body) {
  const i = body.indexOf(' |');
  return (i >= 0 ? body.slice(0, i) : body).trim();
}

function parseIpv4Part(part) {
  if (/^0x[0-9a-f]+$/i.test(part)) return Number.parseInt(part.slice(2), 16);
  if (/^0[0-7]+$/.test(part)) return Number.parseInt(part, 8);
  if (/^\d+$/.test(part)) return Number.parseInt(part, 10);
  return NaN;
}

function parseIpv4Hostname(host) {
  const parts = String(host || '').split('.');
  if (parts.length < 1 || parts.length > 4 || parts.some((part) => part === '')) return null;
  if (!parts.every((part) => /^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(part))) return null;
  const nums = parts.map(parseIpv4Part);
  if (nums.some((num) => !Number.isSafeInteger(num) || num < 0)) return null;
  const prefix = nums.slice(0, -1);
  if (prefix.some((num) => num > 255)) return null;
  const last = nums.at(-1);
  const remainingBytes = 5 - nums.length;
  if (last > 256 ** remainingBytes - 1) return null;
  if (nums.length === 1) return [(last >>> 24) & 255, (last >>> 16) & 255, (last >>> 8) & 255, last & 255];
  if (nums.length === 2) return [nums[0], (last >>> 16) & 255, (last >>> 8) & 255, last & 255];
  if (nums.length === 3) return [nums[0], nums[1], (last >>> 8) & 255, last & 255];
  return nums;
}

// An IP literal is judged by the providers' address list
// (providers/_ip-guard.mjs isBlockedAddress), the one the batch prefetch and
// every fetcher use, so a URL this lets into batch-input.tsv is one they would
// fetch. Names keep this file's stricter rules.
function isPrivateOrInternalHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === ':' || host === '::') return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (!host.includes('.') && isIP(host) === 0) return true;
  if (/\.(?:local|internal|lan|home|test|invalid)$/i.test(host)) return true;

  const ipv4 = parseIpv4Hostname(host);
  if (ipv4) return isBlockedAddress(ipv4.join('.'));
  if (isIP(host) === 6) return isBlockedAddress(new URL(`http://[${host}]/`).hostname.slice(1, -1));
  return false;
}

/**
 * Validate a URL is a publicly-reachable HTTP(S) destination.
 * Rejects loopback, link-local, multicast, private, and internal hostnames.
 * @param {string} raw - Raw URL string to validate.
 * @returns {boolean}
 */
export function isSafePublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  return !isPrivateOrInternalHostname(url.hostname);
}

/**
 * Extract labeled segments from a pipeline row body ("| label: value").
 * @param {string} body - Raw pipeline row body.
 * @returns {{note?: string, trust?: string, yrs?: string, rank?: string, posted?: string}}
 */
export function extractLabels(body) {
  const labels = {};
  const labelRe = /\|\s*(posted|trust|yrs|note|rank):\s*([^|]+)/g;
  let m;
  while ((m = labelRe.exec(body)) !== null) {
    labels[m[1]] = m[2].trim();
  }
  return labels;
}

// A labeled segment (see extractLabels) is never a positional company or title cell.
const LABEL_CELL_RE = /^(?:posted|trust|yrs|note|rank):/;

/**
 * Extract the company name (positional 2nd cell) from a pipeline row body.
 * @param {string} body - Raw pipeline row body.
 * @returns {string}
 */
export function lineCompany(body) {
  const parts = body.split('|').map((s) => s.trim());
  return parts.length > 1 && !LABEL_CELL_RE.test(parts[1]) ? parts[1] : '';
}

/**
 * Extract the job title (positional 3rd cell) from a pipeline row body.
 * @param {string} body - Raw pipeline row body.
 * @returns {string}
 */
export function lineTitle(body) {
  const parts = body.split('|').map((s) => s.trim());
  return parts.length > 2 && !LABEL_CELL_RE.test(parts[2]) ? parts[2] : '';
}

/**
 * Build the batch `notes` field from labeled segments.
 * @param {{note?: string, trust?: string, yrs?: string, rank?: string, posted?: string}} labels - Label dictionary from extractLabels.
 * @returns {string}
 */
export function buildNotes(labels) {
  return Object.entries(labels).map(([k, v]) => `${k}: ${v}`).join(' | ');
}

/**
 * Parse pending entries out of raw pipeline.md text (mirrors reconcile-pipeline.mjs).
 * @param {string} text - Raw pipeline.md contents.
 * @returns {Array<{url:string, company:string, title:string, notes:string}>}
 */
export function parsePending(text) {
  const lines = text.split(/\r?\n/);
  let pendStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (sectionKind(lines[i].trim()) === 'pending') { pendStart = i; break; }
  }
  if (pendStart < 0) return [];

  let pendEnd = lines.length;
  for (let i = pendStart + 1; i < lines.length; i++) {
    if (SECTION_RE.test(lines[i])) { pendEnd = i; break; }
  }

  const out = [];
  for (let i = pendStart + 1; i < pendEnd; i++) {
    if (!PENDING_ITEM_RE.test(lines[i])) continue;
    const body = lines[i].replace(PENDING_ITEM_RE, '');
    const raw = lineUrl(body);
    if (!isSafePublicHttpUrl(raw)) continue;
    const url = new URL(raw).href;
    out.push({ url, company: lineCompany(body), title: lineTitle(body), notes: buildNotes(extractLabels(body)) });
  }
  return out;
}

/**
 * Collect URLs already in an existing TSV (batch-input.tsv or batch-state.tsv).
 * Handles the header/# comments and whitespace-only rows.
 * @param {string} [text] - Raw TSV contents.
 * @param {number} urlCol - Column index (0-based) holding the URL.
 * @returns {Set<string>}
 */
export function urlsFromTsv(text, urlCol) {
  const set = new Set();
  if (!text) return set;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('id\t')) continue;
    const url = line.split('\t')[urlCol];
    if (url) set.add(url.trim());
  }
  return set;
}

function tsvCell(value) {
  return String(value || '').replace(/[\t\r\n]+/g, ' ').trim();
}

/**
 * Find the largest numeric id in a TSV's first column (id<tab>url<tab>...).
 * Ignores the header row, # comments, and blanks. 0 if none found.
 * @param {string} [text] - Raw TSV contents.
 * @returns {number}
 */
export function maxTsvId(text) {
  let max = 0;
  if (!text) return max;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('id\t')) continue;
    const [field] = line.split('\t');
    const n = Number(field);
    if (Number.isInteger(n) && n > 0 && n > max) max = n;
  }
  return max;
}

/**
 * Drop aggregator rows that repeat a job another Pending row already carries.
 * Rows match on an exact normalized company plus title; a row missing either is
 * never matched. In a group with an employer-hosted row every aggregator row
 * goes; an aggregator-only group keeps its first row. Employer rows are never
 * dropped here, and input order is kept (#7259).
 * @param {Array<{url:string, company:string, title?:string}>} pending
 * @returns {Array<{url:string, company:string, title?:string}>}
 */
export function dropAggregatorDuplicates(pending) {
  const keyOf = (e) => {
    const company = normalizeCompany(e.company);
    const title = normalizeTextKey(e.title, ' ');
    return company && title ? `${company}\t${title}` : null;
  };
  const hasEmployer = new Set();
  for (const e of pending) {
    const key = keyOf(e);
    if (key && !isAggregatorUrl(e.url)) hasEmployer.add(key);
  }
  const keptAggregator = new Set();
  return pending.filter((e) => {
    const key = keyOf(e);
    if (!key || !isAggregatorUrl(e.url)) return true;
    if (hasEmployer.has(key) || keptAggregator.has(key)) return false;
    keptAggregator.add(key);
    return true;
  });
}

/**
 * Build the final batch-input.tsv rows for the pending entries not already queued
 * or processed. Each row is id<tab>url<tab>source<tab>notes with a numeric id
 * allocated sequentially starting at `startId`.
 * @param {Array<{url:string, company:string, notes:string}>} pending
 * @param {Set<string>} existingUrls
 * @param {number} [startId] - First id to allocate (default 1).
 * @returns {Array<{url:string, notes:string, id:number, row:string}>}
 */
export function planBatchRows(pending, existingUrls, startId = 1) {
  const rows = [];
  const accepted = new Set();
  let nextId = startId;
  for (const e of pending) {
    if (existingUrls.has(e.url) || accepted.has(e.url)) continue;
    accepted.add(e.url);
    const notes = tsvCell(e.notes);
    rows.push({ ...e, notes, id: nextId, row: `${nextId}\t${e.url}\t${SOURCE}\t${notes}` });
    nextId++;
  }
  return rows;
}

// ── CLI entry point ────────────────────────────────────────────────────────

const USAGE = `Usage: node sync-batch-input.mjs --user <id> [--dry-run] [--json] [--url <url>]
  Appends the selected user's pipeline Pending rows to users/{USER}/batch/batch-input.tsv
  with stable IDs (same as sync-pipeline-batch.mjs). Set CAREER_OPS_PIPELINE to read
  another inbox lane.
  --url <url>  queue only the Pending row with this posting URL. Exit status:
               0 queued, 3 already in batch-input.tsv (nothing to queue),
               4 not an unchecked Pending row whose URL is the first cell after "- [ ] ", 1 other errors.`;
const RETIRED_PATH_FLAGS = ['--input', '--state', '--pipeline'];

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
  }
  // Batch input/state live in the selected user's batch directory, and an inbox
  // lane is chosen with CAREER_OPS_PIPELINE, so path overrides are refused.
  const retired = argv.find(arg => RETIRED_PATH_FLAGS.some(flag => arg === flag || arg.startsWith(`${flag}=`)));
  if (retired) {
    console.error(`${retired.split('=')[0]} is not supported: batch input and state belong to the selected user (users/{USER}/batch/); use CAREER_OPS_PIPELINE to select an inbox lane.`);
    console.error(USAGE);
    process.exit(1);
  }
  try {
    getUserContext(argv);
  } catch (error) {
    printUserContextErrorAndExit(error);
  }
  const urlIndex = argv.findIndex(arg => arg === '--url' || arg.startsWith('--url='));
  if (urlIndex >= 0) {
    const value = argv[urlIndex] === '--url' ? argv[urlIndex + 1] : argv[urlIndex].slice('--url='.length);
    if (value && !value.startsWith('--') && !isSafePublicHttpUrl(value)) {
      console.error(`--url must be a public http(s) URL: ${value}`);
      process.exit(1);
    }
  }
  // sync-pipeline-batch.mjs reads the same argv: --user, --dry-run, --json and --url.
  await import('./sync-pipeline-batch.mjs');
}
