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
 * Run: node sync-batch-input.mjs --user <id> [--dry-run] [--json]
 */

import { isIP } from 'net';
import { isMainModule } from './lib/is-main-module.mjs';
import { PENDING_HEADER } from './lib/pipeline-queue.mjs';
import { getUserContext, printUserContextErrorAndExit } from './lib/user-context.mjs';

/** Batch source label written into the source column. */
export const SOURCE = 'pipeline';

/** Localized "Pending" section header (EN/ES/DE/FR), shared with the run queue. */
export const PENDING_RE = PENDING_HEADER;
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

function ipv4FromLow32(high, lowBits) {
  if (high > 0xffff || lowBits > 0xffff) return null;
  return [(high >>> 8) & 255, high & 255, (lowBits >>> 8) & 255, lowBits & 255];
}

function parseIpv4MappedIpv6(host) {
  const normalized = String(host || '').toLowerCase();
  const dotted = normalized.match(/^(?:0:0:0:0:0:ffff:|::ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return parseIpv4Hostname(dotted[1]);
  const hex = normalized.match(/^(?:0:0:0:0:0:ffff:|::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  return ipv4FromLow32(Number.parseInt(hex[1], 16), Number.parseInt(hex[2], 16));
}

// IPv4-compatible IPv6 (::a.b.c.d or ::h1:h2), where the low 32 bits encode an
// IPv4 address. Rejects loopback/private destinations that new URL() normalizes
// into this form (e.g. http://[::127.0.0.1]/ -> [::7f00:1] -> 127.0.0.1).
function parseIpv4CompatibleIpv6(host) {
  const bounded = String(host || '').toLowerCase();
  const dotted = bounded.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return parseIpv4Hostname(dotted[1]);
  const hex = bounded.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  return ipv4FromLow32(Number.parseInt(hex[1], 16), Number.parseInt(hex[2], 16));
}

function isPrivateIpv4(parts) {
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateOrInternalHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === ':' || host === '::') return true;
  // Reject the unspecified IPv6 address (::), including hex form.
  if (host === '::' || host === '0:0:0:0:0:0:0:0') return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (!host.includes('.') && isIP(host) === 0) return true;
  if (/\.(?:local|internal|lan|home|test|invalid)$/i.test(host)) return true;

  const ipv4 = parseIpv4Hostname(host);
  if (ipv4) return isPrivateIpv4(ipv4);

  const version = isIP(host);
  if (version !== 6) return false;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;

  const mappedIpv4 = parseIpv4MappedIpv6(host);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);

  const compatIpv4 = parseIpv4CompatibleIpv6(host);
  if (compatIpv4) return isPrivateIpv4(compatIpv4);

  const firstHextet = host.split(':')[0];
  if (/^f[cd][0-9a-f]{0,2}$/i.test(firstHextet)) return true;
  const first = Number.parseInt(firstHextet, 16);
  return Number.isFinite(first) && first >= 0xfe80 && first <= 0xfebf;
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
 * @returns {{note?: string, trust?: string, rank?: string, posted?: string}}
 */
export function extractLabels(body) {
  const labels = {};
  const labelRe = /\|\s*(posted|trust|note|rank):\s*([^|]+)/g;
  let m;
  while ((m = labelRe.exec(body)) !== null) {
    labels[m[1]] = m[2].trim();
  }
  return labels;
}

/**
 * Extract the company name (positional 2nd cell) from a pipeline row body.
 * @param {string} body - Raw pipeline row body.
 * @returns {string}
 */
export function lineCompany(body) {
  const parts = body.split('|').map((s) => s.trim());
  return parts.length > 1 ? parts[1] || '' : '';
}

/**
 * Build the batch `notes` field from labeled segments.
 * @param {{note?: string, trust?: string, rank?: string, posted?: string}} labels - Label dictionary from extractLabels.
 * @returns {string}
 */
export function buildNotes(labels) {
  return Object.entries(labels).map(([k, v]) => `${k}: ${v}`).join(' | ');
}

/**
 * Parse pending entries out of raw pipeline.md text (mirrors reconcile-pipeline.mjs).
 * @param {string} text - Raw pipeline.md contents.
 * @returns {Array<{url:string, company:string, notes:string}>}
 */
export function parsePending(text) {
  const lines = text.split(/\r?\n/);
  let pendStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (PENDING_RE.test(lines[i])) { pendStart = i; break; }
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
    out.push({ url, company: lineCompany(body), notes: buildNotes(extractLabels(body)) });
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

const USAGE = `Usage: node sync-batch-input.mjs --user <id> [--dry-run] [--json]
  Appends the selected user's pipeline Pending rows to users/{USER}/batch/batch-input.tsv
  with stable IDs (same as sync-pipeline-batch.mjs). Set CAREER_OPS_PIPELINE to read
  another inbox lane.`;
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
  // sync-pipeline-batch.mjs reads the same argv: --user, --dry-run and --json.
  await import('./sync-pipeline-batch.mjs');
}
