import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { archiveReportEvidence, hasEmbeddedJdArchive, extractStrippedJdSection, parseReportFilename } from '../check-jd-archive.mjs';
import { fetchJdViaKnownApi, jdHtmlToText } from '../browser-extract.mjs';
import { fetchTextHead } from '../providers/_http.mjs';
import { validUrl, isLinkedIn } from '../batch/manual-inputs.mjs';
import { acquirePipelineLock } from '../pipeline-lock.mjs';
import { resolveTrackerPath, writeFileAtomic } from '../tracker-utils.mjs';
import { assertVerificationContext, partitionReviewedFindings, readReviewLedger, reviewRecord, verificationFindings } from './verification-review.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const TEXT_CAP = 200_000;
const urlKey = value => { try { return validUrl(value) ? new URL(value).href : ''; } catch { return ''; } };

function usableText(text) {
  return typeof text === 'string' && text.length < TEXT_CAP && text.trim().split(/\s+/).length >= 60 &&
    /\b(responsibilities|requirements|qualifications|you will|you'll|your role|what you|who you are|you bring|must have|requisitos|responsabilidades|aufgaben)\b/i.test(text) &&
    hasEmbeddedJdArchive(`## Job Description (archived verbatim)\n${text}`);
}

function inside(root, path) {
  const base = realpathSync(root);
  const target = realpathSync(path);
  return target === base || target.startsWith(base + sep);
}

function readLocal(root, path) {
  try {
    if (!inside(root, path) || !statSync(path).isFile() || statSync(path).size > MAX_BYTES) return null;
    return readFileSync(path, 'utf8');
  } catch { return null; }
}

function localSources(root, wantedUrls) {
  const index = new Map();
  const add = (url, text, path, capturedAt, truncated = false) => {
    const key = urlKey(url);
    if (!wantedUrls.has(key) || truncated || !usableText(text)) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ text, source: { kind: 'saved_capture', path: relative(root, path).replaceAll('\\', '/'), captured_at: capturedAt || null } });
  };
  for (const dir of ['jds', 'data/posting-context', 'batch/logs']) {
    const path = join(root, dir);
    if (!existsSync(path) || !inside(root, path)) continue;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const isJson = dir === 'data/posting-context' ? entry.name.endsWith('.json') : entry.name.endsWith('.browser-capture.json');
      const isCapture = /\.(?:md|txt)$/i.test(entry.name) && (dir === 'jds' || entry.name.endsWith('.capture-before-browser-recovery.md'));
      if (!isJson && !isCapture) continue;
      const file = join(path, entry.name);
      const content = readLocal(root, file);
      if (content === null) continue;
      if (isJson) {
        try {
          const data = JSON.parse(content);
          const text = data.jd_text || data.text || data.description || data.body;
          add(data.url || data.source_url, text, file, data.captured_at, data.truncated);
        } catch {}
      } else {
        const header = content.slice(0, 5000);
        const url = header.match(/^(?:source_url|url|original_url):[ \t]*["']?(https?:\/\/[^\s"']+)/im)?.[1] ||
          header.match(/^(?:\*\*URL:\*\*|Source posting:|Original URL:)[ \t]*(https?:\/\/\S+)/im)?.[1];
        const body = extractStrippedJdSection(content) ?? content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/^#[^\n]*\n/, '').trim();
        add(url, body, file, null);
      }
    }
  }
  return index;
}

// Only a single role's structured description from the original page is usable.
// General page text and other postings on a board cannot repair a historical JD.
export function structuredPostingText(html, url) {
  const jobs = [];
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    if ([value['@type']].flat().includes('JobPosting')) jobs.push(value);
    if (value['@graph']) visit(value['@graph']);
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { visit(JSON.parse(match[1])); } catch {}
  }
  const matches = jobs.filter(job => urlKey(job.url) === urlKey(url));
  if (matches.length !== 1 || jobs.length !== 1) return null;
  const text = jdHtmlToText(matches[0].description);
  return usableText(text) ? { text, title: matches[0].title || '' } : null;
}

async function retrievePosting(url) {
  if (!urlKey(url) || isLinkedIn(url)) return null;
  const api = await fetchJdViaKnownApi(url, TEXT_CAP, 12_000);
  if (api && urlKey(api.url) === urlKey(url) && usableText(api.text)) return { text: api.text, source: { kind: 'exact_posting_api', url, captured_at: new Date().toISOString(), historical_text: false } };
  const html = await fetchTextHead(url, { timeoutMs: 12_000, maxBytes: MAX_BYTES, redirect: 'error' });
  const posting = structuredPostingText(html, url);
  return posting ? { text: posting.text, source: { kind: 'exact_posting_structured_data', url, captured_at: new Date().toISOString(), historical_text: false } } : null;
}

/** Called by the verification owner, never by a job evaluator. */
export async function maintainJdArchives(context, verification, { runId, retryGaps = false, retrieve = retrievePosting, onProgress = () => {} } = {}) {
  assertVerificationContext(verification, context, resolveTrackerPath(context.userRoot));
  const findings = verificationFindings(verification).filter(item => item.level === 'warning' && item.code === 'jd_archive_review_due');
  if (!findings.length) return { recovered: 0, known_gaps: 0, entries: [] };
  const root = context.userRoot;
  const statePath = join(root, 'data/jd-archive-maintenance.json');
  mkdirSync(dirname(statePath), { recursive: true });
  if (!inside(root, dirname(statePath))) throw new Error('Archive maintenance directory escapes selected user');
  const lock = await acquirePipelineLock(statePath);
  try {
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { schema_version: 1, user: context.userId, entries: {} };
    if (state.schema_version !== 1 || state.user !== context.userId || !state.entries || typeof state.entries !== 'object' || Array.isArray(state.entries)) throw new Error('Invalid user-scoped JD archive maintenance state');
    const jobs = findings.map(finding => {
      const file = finding.details?.file;
      if (!/^reports\/\d+-[A-Za-z0-9._-]+\.md$/.test(file || '')) throw new Error('Invalid JD archive report path');
      const content = readLocal(root, join(root, file));
      if (content === null) throw new Error(`Cannot read archive recovery report ${file}`);
      const evidence = archiveReportEvidence(content);
      if (finding.details.report_sha256 && finding.details.report_sha256 !== evidence.report_sha256) throw new Error(`Archive report changed since verification: ${file}`);
      return { finding, file, content, ...evidence };
    });
    const sources = localSources(root, new Set(jobs.map(job => job.source_url).filter(Boolean)));
    const results = [];
    const acknowledged = new Set(partitionReviewedFindings(verification, readReviewLedger(join(root, 'data/verification-reviews.jsonl'))).seen.map(item => item.finding.fingerprint));
    let next = 0;
    const workers = await Promise.allSettled(Array.from({ length: Math.min(3, jobs.length) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const prior = state.entries[job.file];
        const matches = sources.get(job.source_url) || [];
        // Conflicting saved descriptions are insufficient provenance for a repair.
        const texts = new Set(matches.map(item => item.text));
        let recovered = texts.size === 1 ? matches[0] : null;
        const unchangedGap = prior?.status === 'known_gap' && prior.report_sha256 === job.report_sha256 && prior.source_url === job.source_url;
        let reason = !job.source_url ? 'original_posting_url_unavailable' : !urlKey(job.source_url) ? 'unsupported_posting_url' : isLinkedIn(job.source_url) ? 'authenticated_source_unavailable' : 'original_description_unavailable';
        if (unchangedGap && !retryGaps) reason = prior.reason;
        if (texts.size > 1) reason = 'conflicting_saved_descriptions';
        if (!recovered && texts.size <= 1 && (!unchangedGap || retryGaps) && urlKey(job.source_url) && !isLinkedIn(job.source_url)) {
          try {
            const fetched = await retrieve(job.source_url);
            if (fetched && urlKey(fetched.source?.url) === urlKey(job.source_url)) recovered = fetched;
          }
          catch (error) { reason = `source_unavailable: ${String(error.message).slice(0, 200)}`; }
        }
        // Recheck after asynchronous retrieval and before publishing any evidence.
        if (readLocal(root, join(root, job.file)) !== job.content) throw new Error(`Archive report changed during recovery: ${job.file}`);
        const record = { status: 'known_gap', report_sha256: job.report_sha256, source_url: job.source_url, checked_at: new Date().toISOString(), reason };
        if (recovered && usableText(recovered.text)) {
          const meta = parseReportFilename(job.file.slice('reports/'.length));
          const capture = `jds/${String(meta.reportNum).padStart(3, '0')}-${meta.companySlug}-archive-recovery-${job.report_sha256.slice(0, 12)}.md`;
          mkdirSync(join(root, 'jds'), { recursive: true });
          if (!inside(root, join(root, 'jds'))) throw new Error('Archive capture directory escapes selected user');
          const output = `---\nsource_url: ${JSON.stringify(job.source_url)}\nreport: ${JSON.stringify(job.file)}\nrecovered_at: ${JSON.stringify(record.checked_at)}\nprovenance: ${JSON.stringify(recovered.source)}\n---\n\n# Recovered posting capture\n\nThis is source text recovered at the time shown above. A live retrieval does not establish the historical wording when the evaluation was written.\n\n## Job Description (archived verbatim)\n\n${recovered.text}\n`;
          const target = join(root, capture);
          if (existsSync(target) || lstatSafe(target)) throw new Error(`Recovery capture already exists; refusing overwrite: ${capture}`);
          writeFileAtomic(target, output);
          Object.assign(record, { status: 'recovered', capture_file: capture, source: recovered.source, reason: null });
        }
        state.entries[job.file] = record;
        writeFileAtomic(statePath, JSON.stringify(state, null, 2) + '\n');
        if (record.status === 'known_gap' && !acknowledged.has(job.finding.fingerprint)) {
          const rationale = `Known historical archive gap after bounded automatic recovery (${reason}). The JD remains unavailable; this is not an archive or a user confirmation. Changed report/source evidence must resurface.`;
          const entry = reviewRecord({ finding: job.finding, decision: { classification: 'informational', severity: 'low', rationale, evidence: [{ path: 'data/jd-archive-maintenance.json', observation: `Recovery receipt for ${job.file}` }] }, reviewedAt: record.checked_at, runId, reviewer: { kind: 'deterministic_archive_maintenance' } });
          const ledgerPath = join(root, 'data/verification-reviews.jsonl');
          const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : '';
          appendFileSync(ledgerPath, (existing && !existing.endsWith('\n') ? '\n' : '') + JSON.stringify(entry) + '\n');
          acknowledged.add(job.finding.fingerprint);
        }
        results.push({ file: job.file, ...record });
        onProgress(results.at(-1));
      }
    }));
    const failure = workers.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    return { recovered: results.filter(item => item.status === 'recovered').length, known_gaps: results.filter(item => item.status === 'known_gap').length, entries: results };
  } finally { lock.release(); }
}

function lstatSafe(path) { try { return lstatSync(path); } catch { return null; } }
