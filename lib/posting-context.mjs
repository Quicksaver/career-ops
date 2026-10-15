import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseHnComment, resolveLatestThreadId } from '../providers/hackernews.mjs';
import { normalizeUrl } from '../url-key.mjs';
import { parseScanHistoryLine } from './scan-history-columns.mjs';
import { isMainModule } from './is-main-module.mjs';

const MAX_DESCRIPTION = 200_000;
const hnUrl = id => `https://news.ycombinator.com/item?id=${id}`;
const textKey = text => String(text || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

export function hnCommentId(url) {
  try {
    const u = new URL(url);
    const id = u.searchParams.get('id');
    return u.hostname === 'news.ycombinator.com' && u.pathname === '/item' && /^[1-9]\d*$/.test(id || '') ? id : null;
  } catch { return null; }
}

export function postingContextPath(root, url) {
  return join(root, 'data/posting-context', createHash('sha256').update(url).digest('hex') + '.json');
}

// Persist the description already returned by the provider before its queue row
// is published. This is external source evidence, never candidate/profile data.
export async function savePostingContext(root, offer) {
  if (typeof offer.description !== 'string' || !offer.description.trim()) return;
  const context = {
    schema_version: 1, url: offer.url, source: offer.source || '',
    title: offer.title || '', company: offer.company || '', location: offer.location || '',
    posted_at: Number.isFinite(offer.postedAt) && Number.isFinite(new Date(offer.postedAt).getTime()) ? new Date(offer.postedAt).toISOString() : '',
    captured_at: new Date().toISOString(),
    description: offer.description.slice(0, MAX_DESCRIPTION),
    truncated: offer.description.length > MAX_DESCRIPTION,
  };
  const path = postingContextPath(root, offer.url);
  mkdirSync(join(root, 'data/posting-context'), { recursive: true });
  const { writeFileAtomic } = await import('../tracker-utils.mjs');
  writeFileAtomic(path, JSON.stringify(context) + '\n');
}

async function fetchHnJson(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HN source HTTP ${response.status}`);
  return response.json();
}

function recoveredComment(comment) {
  if (!comment || comment.deleted || comment.dead) return null;
  const id = String(comment.id ?? comment.objectID ?? '');
  if (!/^[1-9]\d*$/.test(id)) return null;
  const parsed = parseHnComment(comment.text, hnUrl(id));
  if (!parsed || !parsed.description.trim()) return null;
  return { url: hnUrl(id), title: parsed.title, description: parsed.description, posted_at: comment.created_at || '', captured_at: new Date().toISOString() };
}

export async function resolvePostingContext({ root, url, source = '', notes = '', recover = true, fetchJson = fetchHnJson }) {
  const result = { schema_version: 1, url, source, notes, history: [], snapshot: null, recovered: null, recovery: 'not_applicable' };
  const contextPath = postingContextPath(root, url);
  if (existsSync(contextPath)) {
    try {
      const saved = JSON.parse(readFileSync(contextPath, 'utf8'));
      if (saved.schema_version === 1 && saved.url === url && typeof saved.description === 'string') result.snapshot = saved;
    } catch { result.recovery = 'invalid_snapshot'; }
  }
  const historyPath = process.env.CAREER_OPS_SCAN_HISTORY || join(root, 'data/scan-history.tsv');
  if (existsSync(historyPath)) {
    const key = normalizeUrl(url);
    result.history = readFileSync(historyPath, 'utf8').split(/\r?\n/).map(parseScanHistoryLine)
      .filter(row => key && normalizeUrl(row.url) === key).slice(-3)
      .map(({ portal, title, company, location, posted_at, first_seen }) => ({ portal, title, company, location, posted_at, first_seen }));
  }
  if (!recover) { result.recovery = 'not_needed'; return result; }
  const id = hnCommentId(url);
  // A scanner snapshot is sufficient context. Its age and provenance stay
  // visible to the worker, which still performs the canonical liveness gates.
  if (id && result.snapshot && !result.snapshot.truncated) {
    result.recovered = { url: hnUrl(id), title: result.snapshot.title, description: result.snapshot.description, posted_at: result.snapshot.posted_at, captured_at: result.snapshot.captured_at };
    result.recovery = 'scanner_snapshot';
    return result;
  }
  const history = [...result.history].reverse().find(row => /hackernews|hacker news/i.test(row.portal));
  if (!id && !history) return result;
  try {
    if (id) {
      const comment = await fetchJson(`https://hn.algolia.com/api/v1/items/${id}`);
      // Never replace an exact comment with another item or a whole thread.
      if (String(comment?.id) === id && comment?.type === 'comment') result.recovered = recoveredComment(comment);
    } else {
      // Legacy rows used an external homepage as identity. Search only their
      // recorded hiring month, then require both the original URL and header.
      const date = history.posted_at || history.first_seen;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { result.recovery = 'missing_source_date'; return result; }
      const start = new Date(date.slice(0, 7) + '-01T00:00:00Z');
      const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
      const search = new URL('https://hn.algolia.com/api/v1/search_by_date');
      search.searchParams.set('tags', 'story,author_whoishiring');
      search.searchParams.set('hitsPerPage', '5');
      search.searchParams.set('numericFilters', `created_at_i>=${start.getTime() / 1000},created_at_i<${end.getTime() / 1000}`);
      const thread = resolveLatestThreadId(await fetchJson(search.href));
      if (!thread || !/^[1-9]\d*$/.test(thread)) { result.recovery = 'thread_unavailable'; return result; }
      const item = await fetchJson(`https://hn.algolia.com/api/v1/items/${thread}`);
      if (String(item?.id) !== thread || item?.type !== 'story') { result.recovery = 'thread_unavailable'; return result; }
      const matches = (Array.isArray(item?.children) ? item.children : []).filter(comment => {
        const parsed = parseHnComment(comment.text, '');
        if (!parsed || textKey(parsed.title) !== textKey(history.title)) return false;
        const urls = parsed.description.match(/https?:\/\/[^\s<>"')]+/g) || [];
        return urls.some(link => normalizeUrl(link.replace(/[.,;!?)]+$/, '')) === normalizeUrl(url));
      }).map(recoveredComment).filter(Boolean);
      if (matches.length === 1) result.recovered = matches[0];
      else if (matches.length > 1) { result.recovery = 'ambiguous_source'; return result; }
    }
    result.recovery = result.recovered ? 'recovered' : 'source_not_found';
  } catch (error) {
    result.recovery = 'source_unavailable'; result.error = error.message;
  }
  return result;
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node lib/posting-context.mjs --user USER URL SOURCE NOTES JD_FILE\nWrites posting context JSON to stdout and fills an empty JD_FILE from an exact HN source.');
    process.exit(0);
  }
  const { getCareerOpsRoot } = await import('../path-resolver.mjs');
  const root = getCareerOpsRoot();
  const [url, source, notes, jdFile] = process.argv.slice(2);
  const context = await resolvePostingContext({ root, url, source, notes, recover: !readFileSync(jdFile, 'utf8').trim() });
  if (context.recovered && jdFile && !readFileSync(jdFile, 'utf8').trim()) {
    writeFileSync(jdFile, `Source posting: ${context.recovered.url}\nOriginal queue URL: ${url}\nSource captured: ${context.recovered.captured_at}\n\n${context.recovered.description}`);
  }
  process.stdout.write(JSON.stringify(context));
}
