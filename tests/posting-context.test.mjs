import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from './helpers.mjs';
import { resolvePostingContext, savePostingContext, postingContextPath } from '../lib/posting-context.mjs';
import hackernews from '../providers/hackernews.mjs';

const url = 'https://example.org/';
const header = 'Example | Rust Engineer | Remote |';
const body = `${header} <a href="https://example.org/">https://example.org/</a><p>Build reliable Rust services. Apply by email to jobs@example.org.<p>Keep this original paragraph.`;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'posting-context-'));
  mkdirSync(join(root, 'data'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function history(root, title = header, portal = 'hackernews-api', date = '2026-10-02') {
  writeFileSync(join(root, 'data/scan-history.tsv'), `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\n${url}\t2026-10-15\t${portal}\t${title}\tExample\tadded\tRemote\t\t${date}\n`);
}
function api(children) {
  const calls = [];
  return { calls, fetchJson: async input => {
    const endpoint = new URL(input); calls.push(endpoint);
    if (endpoint.pathname.endsWith('/search_by_date')) return { hits: [{ objectID: '100', title: 'Ask HN: Who is hiring? (October 2026)' }] };
    assert.equal(endpoint.href, 'https://hn.algolia.com/api/v1/items/100');
    return { id: 100, type: 'story', children };
  } };
}

test('HN preserves the hiring comment, email application and every external link as source evidence', async () => {
  const jobs = await hackernews.fetch({ name: 'HN' }, { fetchJson: async endpoint => endpoint.includes('search_by_date')
    ? { hits: [{ objectID: '100', title: 'Ask HN: Who is hiring?' }] }
    : { children: [{ id: 101, text: body }, { id: 102, text: body }, { text: body }, { id: 'bad', text: body }] } });
  assert.deepEqual(jobs.map(job => job.url), ['https://news.ycombinator.com/item?id=101', 'https://news.ycombinator.com/item?id=102']);
  assert.ok(jobs[0].description.includes('jobs@example.org'));
  assert.ok(jobs[0].description.includes('https://example.org/'));
  assert.ok(jobs[0].description.includes('Keep this original paragraph.'));
});

test('scanner publishes source snapshots in the selected user root with the inbox row', async t => {
  const root = fixture(t);
  const { configureScanUserPaths, appendToPipeline } = await import('../scan.mjs');
  configureScanUserPaths({ userRoot: root });
  const offer = { url, source: 'example-api', title: 'Engineer', company: 'Example', description: 'Original provider description.' };
  await appendToPipeline([offer], { pipelinePath: join(root, 'data/pipeline.md') });
  const context = await resolvePostingContext({ root, url, notes: 'queue location and role', fetchJson: () => assert.fail('not an HN posting') });
  assert.equal(context.snapshot.description, offer.description);
  assert.equal(context.snapshot.url, url);
  assert.match(readFileSync(join(root, 'data/pipeline.md'), 'utf8'), /https:\/\/example.org\//);
  assert.equal(context.notes, 'queue location and role');
  const other = fixture(t);
  assert.equal((await resolvePostingContext({ root: other, url })).snapshot, null);
});

test('saved HN descriptions need no source rediscovery and retain snapshot age', async t => {
  const root = fixture(t), posting = 'https://news.ycombinator.com/item?id=101';
  await savePostingContext(root, { url: posting, description: body, title: header, source: 'HN', postedAt: Date.parse('2026-10-02') });
  const context = await resolvePostingContext({ root, url: posting, fetchJson: () => assert.fail('snapshot already supplied') });
  assert.equal(context.recovery, 'scanner_snapshot');
  assert.equal(context.recovered.description, body);
  assert.match(context.snapshot.captured_at, /^\d{4}-/);
  assert.equal(context.snapshot.posted_at, '2026-10-02T00:00:00.000Z');
});

test('legacy homepage recovery requires the exact original URL and header within its recorded hiring month', async t => {
  const root = fixture(t); history(root);
  const provider = api([{ id: 101, text: body }, { id: 102, text: 'Unrelated | Engineer | Remote | https://different.example' }]);
  const context = await resolvePostingContext({ root, url, source: 'pipeline', notes: 'Example / Rust Engineer', fetchJson: provider.fetchJson });
  assert.equal(context.recovery, 'recovered');
  assert.equal(context.url, url, 'original batch identity remains unchanged');
  assert.equal(context.recovered.url, 'https://news.ycombinator.com/item?id=101');
  assert.match(context.recovered.description, /jobs@example.org/);
  assert.equal(provider.calls.length, 2);
  const filters = provider.calls[0].searchParams.get('numericFilters');
  assert.ok(filters.includes(String(Date.parse('2026-10-01') / 1000)));
  assert.ok(filters.includes(String(Date.parse('2026-11-01') / 1000)));
  assert.equal(provider.calls[0].searchParams.get('tags'), 'story,author_whoishiring');
});

test('recovery declines ambiguous comments, other roles/domains, dead sources and unavailable APIs', async t => {
  for (const [name, children, status] of [
    ['ambiguous', [{ id: 101, text: body }, { id: 102, text: body }], 'ambiguous_source'],
    ['different role', [{ id: 101, text: body.replace('Rust Engineer', 'Sales Engineer') }], 'source_not_found'],
    ['different domain', [{ id: 101, text: body.replaceAll('https://example.org/', 'https://other.example/') }], 'source_not_found'],
    ['dead', [{ id: 101, text: body, dead: true }], 'source_not_found'],
  ]) await t.test(name, async t => {
    const root = fixture(t); history(root);
    const provider = api(children);
    const context = await resolvePostingContext({ root, url, fetchJson: provider.fetchJson });
    assert.equal(context.recovered, null); assert.equal(context.recovery, status);
    assert.equal(provider.calls.length, 2);
  });
  const root = fixture(t); history(root);
  const context = await resolvePostingContext({ root, url, fetchJson: async () => { throw new Error('offline'); } });
  assert.equal(context.recovery, 'source_unavailable'); assert.equal(context.recovered, null);
});

test('direct HN retrieval rejects wrong items, threads and deleted comments', async t => {
  for (const payload of [{ id: 999, type: 'comment', text: body }, { id: 101, type: 'story', text: body }, { id: 101, type: 'comment', text: body, deleted: true }]) {
    const context = await resolvePostingContext({ root: fixture(t), url: 'https://news.ycombinator.com/item?id=101', fetchJson: async () => payload });
    assert.equal(context.recovered, null);
  }
  const context = await resolvePostingContext({ root: fixture(t), url: 'https://news.ycombinator.com/item?id=101', fetchJson: async () => ({ id: 101, type: 'comment', text: body }) });
  assert.equal(context.recovered.url, 'https://news.ycombinator.com/item?id=101');
});

test('supplied JDs and non-HN history never trigger recovery; mismatched snapshots are ignored', async t => {
  const root = fixture(t); history(root);
  const fetchJson = () => assert.fail('recovery must not run');
  assert.equal((await resolvePostingContext({ root, url, recover: false, fetchJson })).recovery, 'not_needed');
  history(root, header, 'another-provider');
  await savePostingContext(root, { url, description: 'original text' });
  writeFileSync(postingContextPath(root, url), JSON.stringify({ schema_version: 1, url: 'https://other.example/', description: 'wrong posting' }));
  assert.equal((await resolvePostingContext({ root, url, fetchJson })).recovered, null);
});
