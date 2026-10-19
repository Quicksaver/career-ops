import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import * as yaml from 'js-yaml';
import { withPipelineLock } from '../pipeline-lock.mjs';
import { writeFileAtomic } from '../tracker-utils.mjs';
import { parseBatchState, parseBlockedRows } from './pipeline-queue.mjs';
import { readLinkedInDetail } from '../scan-auth/linkedin-detail.mjs';

export function linkedinPostingId(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(u.hostname) || u.username || u.password || u.search || u.hash) return null;
    return /^\/jobs\/view\/(\d+)\/?$/.exec(u.pathname)?.[1] || null;
  } catch { return null; }
}

export function recoveryTargets(text) {
  return parseBlockedRows(text).rows.filter(row => row.reason === 'jd_unavailable' && linkedinPostingId(row.url));
}

function selectedPostingId(value) {
  const parsed = new URL(value);
  if (!['linkedin.com', 'www.linkedin.com'].includes(parsed.hostname)) return null;
  const pathId = /^\/jobs\/view\/(\d+)\/?$/.exec(parsed.pathname)?.[1];
  const selectedId = parsed.searchParams.get('currentJobId');
  if (pathId && selectedId && pathId !== selectedId) return null;
  return pathId || (/^\d+$/.test(selectedId || '') ? selectedId : null);
}

// Runs in the browser. Only exact, standalone closure notices count; references
// elsewhere in a job description are not enough to close the queued posting.
export function readRecoveryPage() {
  const notice = [...document.querySelectorAll('main h1, main h2, main p, main [role="alert"]')].find(el =>
    el.getClientRects().length && !el.closest('[hidden], [aria-hidden="true"]') &&
    /^(?:This job is no longer available\.?|This job has expired\.?|No longer accepting applications\.?|Job not found\.?|You can't view this job because it's not available at this time\.?|Não aceita mais candidaturas\.?)$/i.test(el.innerText.trim()));
  const parts = document.title.split(' | ');
  return { url: location.href, title: parts.length >= 3 ? parts.slice(0, -2).join(' | ') : '',
    company: parts.length >= 3 ? parts.at(-2) : '', closed: notice?.innerText.trim() || null };
}

export async function recoverPosting(page, url) {
  const id = linkedinPostingId(url);
  if (!id) throw new Error('Recovery requires an exact LinkedIn posting URL');
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const deadline = Date.now() + 5000;
  const contextChanged = error => /execution context was destroyed|cannot find context|JSHandles can be evaluated only in the context/i.test(error.message);
  for (;;) {
    let expansionState;
    try {
      let meta = await page.evaluate(readRecoveryPage);
      if (/\/(?:login|checkpoint|uas|authwall)\b/.test(new URL(meta.url).pathname)) return { status: 'login_required', observed_url: meta.url, error: 'LinkedIn session requires login' };
      if ([404, 410].includes(response?.status())) {
        if (selectedPostingId(meta.url) !== id || selectedPostingId(response.url()) !== id) {
          return { status: 'unavailable', observed_url: meta.url, error: 'HTTP error after navigation changed posting identity' };
        }
        return { status: 'closed', evidence: `Posting HTTP ${response.status()}`, ...meta };
      }
      if (meta.closed && selectedPostingId(meta.url) === id) return { status: 'closed', evidence: meta.closed, ...meta };
      expansionState = await page.evaluateHandle(() => ({ clicked: false }));
      try {
        const ready = await page.waitForFunction(readLinkedInDetail, { jobId: id, expansionState }, { timeout: Math.max(1, deadline - Date.now()) });
        let detail;
        try { detail = await ready.jsonValue(); } finally { await ready.dispose(); }
        meta = await page.evaluate(readRecoveryPage);
        if (selectedPostingId(meta.url) !== id) return { status: 'unavailable', observed_url: meta.url, error: 'Posting changed during extraction' };
        if (meta.closed) return { status: 'closed', evidence: meta.closed, ...meta };
        if (detail.jdText.trim().length < 80 || detail.jdText.trim().split(/\s+/).length < 15) return { status: 'unavailable', error: 'Description too short for recovery' };
        let applicationUrl = detail.applicationUrl;
        try { const u = new URL(applicationUrl); if (u.hostname.endsWith('linkedin.com') && u.pathname === '/safety/go/') applicationUrl = u.searchParams.get('url') || url; } catch { applicationUrl = url; }
        return { ...meta, status: 'recovered', jdText: detail.jdText, applicationUrl };
      } catch (error) {
        if (error.name !== 'TimeoutError') throw error;
        meta = await page.evaluate(readRecoveryPage);
        if (/\/(?:login|checkpoint|uas|authwall)\b/.test(new URL(meta.url).pathname)) return { status: 'login_required', observed_url: meta.url, error: 'LinkedIn session requires login' };
        if (meta.closed && selectedPostingId(meta.url) === id) return { ...meta, status: 'closed', evidence: meta.closed };
        return { status: 'unavailable', observed_url: meta.url, error: 'JD unavailable after one five-second loading allowance' };
      }
    } catch (error) {
      if (!contextChanged(error)) throw error;
      if (Date.now() >= deadline) return { status: 'unavailable', error: 'Posting kept navigating during the five-second loading allowance' };
      // LinkedIn can replace the document after DOMContentLoaded. Read the new
      // execution context within the same allowance; never navigate again.
      await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())));
    } finally { await expansionState?.dispose().catch(() => {}); }
  }
}

export async function publishRecovery({ userRoot, pipelinePath, target, result }) {
  return withPipelineLock(pipelinePath, () => {
    const text = readFileSync(pipelinePath, 'utf8');
    const current = recoveryTargets(text).find(row => row.url === target.url && row.line === target.line);
    if (!current) return { status: 'changed', error: 'Held row changed or was resolved during capture' };
    const statePath = join(userRoot, 'batch/batch-state.tsv');
    const states = existsSync(statePath) ? parseBatchState(readFileSync(statePath, 'utf8')) : [];
    if (states.some(row => row.url === target.url && ['completed', 'closed', 'skipped', 'processing'].includes(row.status))) return { status: 'protected', error: 'Posting has terminal or active batch state' };
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    if (result.status === 'closed') {
      if (!result.evidence?.trim()) throw new Error('Closure requires explicit evidence');
      lines.splice(current.lineIndex, 1);
      let index = lines.findIndex(line => /^##\s+(?:Processed|Procesadas)\s*$/i.test(line.trim()));
      if (index < 0) {lines.push('', '## Processed', ''); index = lines.length - 2;}
      lines.splice(index + 1, 0, `- [x] — | ${target.url} | Closed: ${result.evidence.replace(/[\r\n|]+/g, ' ')}`);
      writeFileAtomic(pipelinePath, lines.join('\n'));
      return { status: 'closed', evidence: result.evidence };
    }
    if (result.status !== 'recovered' || !result.jdText?.trim()) throw new Error('Recovery requires job-description text');
    const id = linkedinPostingId(target.url);
    const hash = createHash('sha256').update(result.jdText).digest('hex').slice(0, 12);
    const jds = join(userRoot, 'jds');
    mkdirSync(jds, { recursive: true });
    const relDir = relative(realpathSync(userRoot), realpathSync(jds));
    if (isAbsolute(relDir) || relDir === '..' || relDir.startsWith('../') || relDir.startsWith('..\\')) throw new Error('Capture directory escapes selected user');
    const capture = `jds/linkedin-recovered-${id}-${hash}.md`;
    const metadata = { title: result.title || current.body.split('|')[2]?.trim() || '', company: result.company || current.body.split('|')[1]?.trim() || '', source_url: target.url, application_url: result.applicationUrl || target.url, source: 'linkedin', scraped: new Date().toISOString().slice(0, 10), recovery: 'authenticated browser' };
    const content = `---\n${yaml.dump(metadata, { lineWidth: -1 })}---\n\n# ${metadata.title}\n\n${result.jdText}\n`;
    const file = join(userRoot, capture);
    try { writeFileSync(file, content, { flag: 'wx' }); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const actual = relative(realpathSync(jds), realpathSync(file));
      if (isAbsolute(actual) || actual.startsWith('..') || !readFileSync(file, 'utf8').includes(`source_url: ${target.url}\n`) || !readFileSync(file, 'utf8').includes(result.jdText)) throw new Error('Existing recovery capture identity mismatch');
    }
    lines[current.lineIndex] = `- [ ] local:${capture} | ${metadata.company.replace(/[\r\n|]+/g, ' ')} | ${metadata.title.replace(/[\r\n|]+/g, ' ')} | recovered from ${target.url}`;
    writeFileAtomic(pipelinePath, lines.join('\n'));
    return { status: 'recovered', capture, original_url: target.url };
  });
}
