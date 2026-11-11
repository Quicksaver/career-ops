import './user-fixture.mjs';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { toolRequired } from './required-tools.mjs';
import LinkedInScanner, { buildLinkedInSearches } from '../scan-auth/linkedin.mjs';
import { printSummary } from '../scan-auth.mjs';

let browser;
// Chromium suites skip where no browser is installed, unless the run requires
// one (test-all.mjs --needs browser; see tests/required-tools.mjs).
const browserSkip = !toolRequired('browser') && !existsSync(chromium.executablePath()) && 'Chromium is not installed';
const browserTest = (name, ...rest) => test(name, { skip: browserSkip }, ...rest);
before(async () => { if (!browserSkip) browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

// Real scan loop and card readers, fictional local DOM. Only JD extraction is
// stubbed so failure-limit tests spend no loading budget or network requests.
// One search page's cards. Several pages add LinkedIn's numbered page buttons,
// whose click swaps the cards and moves aria-current like the real results rail.
const cardsHtml = (prefix, count) => Array.from({ length: count }, (_, i) =>
  `<div role="button"><button aria-label="Dismiss Engineer ${prefix}-${i} job">Dismiss</button><a href="/company/fictional">Fictional Employer ${prefix}-${i}</a></div>`).join('');
function searchHtml(search, pages, cardsPerPage) {
  if (pages === 1) return '<main>' + cardsHtml(search, cardsPerPage) + '</main>';
  const rails = Array.from({ length: pages }, (_, p) => cardsHtml(`${search}-${p + 1}`, cardsPerPage));
  const buttons = rails.map((_, p) => `<button aria-label="Page ${p + 1}"${p === 0 ? ' aria-current="true"' : ''} data-page="${p}">${p + 1}</button>`).join('');
  return `<main id="rail">${rails[0]}</main><nav>${buttons}</nav><script>const rails = ${JSON.stringify(rails)};
    for (const button of document.querySelectorAll('nav button')) button.onclick = () => {
      document.getElementById('rail').innerHTML = rails[button.dataset.page];
      for (const other of document.querySelectorAll('nav button')) other.removeAttribute('aria-current');
      button.setAttribute('aria-current', 'true');
    };</script>`;
}

async function scan({ limit = 25, searches = 3, readable = () => false, options = {}, pages = 1, cardsPerPage = 50 } = {}) {
  const context = await browser.newContext();
  let navigations = 0, attempts = 0;
  try {
    await context.route('**/*', route => {
      const search = ++navigations;
      return route.fulfill({ contentType: 'text/html', body: searchHtml(search, pages, cardsPerPage) });
    });
    const scanner = new LinkedInScanner();
    scanner.extractJob = async (page, card, preview) => {
      const id = String(++attempts);
      return { ...preview, jobId: id, listingUrl: `https://www.linkedin.com/jobs/view/${id}/`, applicationUrl: `https://employer.example/jobs/${id}`, jdText: readable(attempts) ? 'Fictional job requirements.' : '' };
    };
    const result = await scanner.scan(context, {
      keywords: Array.from({ length: searches }, (_, i) => `Fictional ${i}`),
      max_results: limit, skip_viewed: false, delay_pages: [0, 0], delay_searches: [0, 0],
    }, options);
    return { ...result, navigations, attempts };
  } finally { await context.close(); }
}

browserTest('unreadable postings consume the per-search admission limit', async () => {
  const result = await scan({ limit: 2, searches: 2 });
  assert.equal(result.holds.length, 4);
  assert.equal(result.attempts, 4);
  assert.equal(result.stats.searched, 2);
  assert.equal(result.stats.jd_unavailable, 4);
  assert.equal(result.stats.errors, 4);
});

browserTest('systematic capture failure stops the entire source after fifteen attempts', async () => {
  const result = await scan();
  assert.equal(result.holds.length, 15);
  assert.equal(result.attempts, 15);
  assert.equal(result.navigations, 1, 'do not repeat a failing source across searches');
  assert.equal(result.stats.errors, 15);
  assert.match(result.errors[0].error, /stopping LinkedIn scan/);
});

browserTest('search boundaries do not reset the source failure circuit breaker', async () => {
  const result = await scan({ limit: 3, searches: 10 });
  assert.equal(result.holds.length, 15);
  assert.equal(result.navigations, 5);
});

browserTest('successful captures reset consecutive failures while sharing the search limit with holds', async () => {
  const result = await scan({ limit: 4, searches: 2, readable: i => i % 2 === 0 });
  assert.equal(result.listings.length, 4);
  assert.equal(result.holds.length, 4);
  assert.equal(result.attempts, 8);
  assert.deepEqual(result.errors, []);
});

browserTest('each search page is handed over before the next one is read', async () => {
  const batches = [];
  const result = await scan({ limit: 25, searches: 2, pages: 3, cardsPerPage: 4, readable: () => true, options: {
    onResults: async batch => batches.push(batch),
  } });
  assert.equal(result.listings.length, 24);
  assert.deepEqual(batches.map(batch => batch.listings.length), [4, 4, 4, 4, 4, 4]);
  assert.deepEqual(batches.flatMap(batch => batch.listings), result.listings, 'batches cover the result once each');
});

browserTest('a search that stops at its result limit still hands over its last page', async () => {
  const batches = [];
  const result = await scan({ limit: 2, searches: 3, readable: () => true, options: {
    onResults: async batch => batches.push(batch),
  } });
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map(batch => batch.listings.length), [2, 2, 2]);
  assert.deepEqual(batches.flatMap(batch => batch.listings), result.listings, 'batches cover the result once each');
});

browserTest('a scan stopped mid-search has already handed over the pages it read', async () => {
  const batches = [];
  await assert.rejects(scan({ limit: 25, searches: 2, pages: 3, cardsPerPage: 4, readable: () => true, options: {
    onResults: async batch => { batches.push(batch); if (batches.length === 2) throw new Error('stopped'); },
  } }), /stopped/);
  assert.equal(batches.flatMap(batch => batch.listings).length, 8, 'two pages of the first search are kept');
});

test('a keyword that already names the experience level is not prefixed again', () => {
  const urls = buildLinkedInSearches({ experience_level: ['Senior'], keywords: ['Senior Backend Engineer Go', 'Product Engineer', 'Seniority Engineer'] })
    .map(search => new URL(search.url).searchParams.get('keywords'));
  assert.deepEqual(urls, ['Senior Backend Engineer Go', 'Senior Product Engineer', 'Senior Seniority Engineer']);
});

test('summary counts saved JDs separately from blocked listings and errors', () => {
  const lines = [];
  const original = console.log;
  try {
    console.log = line => lines.push(line);
    printSummary({ name: 'LinkedIn' }, { userId: 'fictional' }, {
      listings: [], stats: { searched: 1, found: 50, extracted: 15, skipped_filter: 0, skipped_dedup: 0, saved: 0, blocked: 15, jd_unavailable: 15, errors: 15 },
    });
  } finally { console.log = original; }
  assert.match(lines.join('\n'), /JDs saved:\s+0/);
  assert.match(lines.join('\n'), /JDs unavailable:\s+15/);
  assert.match(lines.join('\n'), /Blocked listings:\s+15/);
  assert.match(lines.join('\n'), /Errors:\s+15/);
  assert.match(lines.join('\n'), /blocked listings retained for recovery/);
  assert.ok(!lines.includes('\nNew listings:'));
});
