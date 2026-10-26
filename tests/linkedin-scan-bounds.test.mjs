import './user-fixture.mjs';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { toolRequired } from './required-tools.mjs';
import LinkedInScanner from '../scan-auth/linkedin.mjs';
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
async function scan({ limit = 25, searches = 3, readable = () => false } = {}) {
  const context = await browser.newContext();
  let navigations = 0, attempts = 0;
  try {
    await context.route('**/*', route => {
      const search = ++navigations;
      return route.fulfill({ contentType: 'text/html', body: '<main>' + Array.from({ length: 50 }, (_, i) =>
        `<div role="button"><button aria-label="Dismiss Engineer ${search}-${i} job">Dismiss</button><a href="/company/fictional">Fictional Employer ${search}-${i}</a></div>`).join('') + '</main>' });
    });
    const scanner = new LinkedInScanner();
    scanner.extractJob = async (page, card, preview) => {
      const id = String(++attempts);
      return { ...preview, jobId: id, listingUrl: `https://www.linkedin.com/jobs/view/${id}/`, applicationUrl: `https://employer.example/jobs/${id}`, jdText: readable(attempts) ? 'Fictional job requirements.' : '' };
    };
    const result = await scanner.scan(context, {
      keywords: Array.from({ length: searches }, (_, i) => `Fictional ${i}`),
      max_results: limit, skip_viewed: false, delay_pages: [0, 0], delay_searches: [0, 0],
    });
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
