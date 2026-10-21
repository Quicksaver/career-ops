// Live-shape regressions for jobs.ch, Make it in Germany and DEVjobs.de (2026-10-21).
import '../user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { fetchCustomProvider } from '../../providers/_custom.mjs';

const JOBSCH = 'https://www.jobs.ch/en/vacancies/';
const MAKEITINGERMANY = 'https://www.make-it-in-germany.com/en/working-in-germany/job-listings';

// Trimmed from the live search page: `__GLOBAL__` routes plus `__INIT__` rows.
const jobsChRow = (id, extra = {}) => ({
  id, isActive: true, title: `Backend Engineer ${id}`, company: { name: 'Puzzle ITC AG' }, place: 'Bern', regions: [],
  publicationDate: '2026-10-06T15:49:37+02:00', initialPublicationDate: '2026-10-06T13:49:37+00:00', relativeDate: '2 weeks ago', ...extra,
});
const jobsChPage = (results, meta = { numPages: 1, totalHits: results.length, fetched: true }) => `<html><head><script>
      __GLOBAL__ = {"ROUTES":{"VACANCY_DETAIL":{"en":"/en/vacancies/detail/{ID}/","de":"/de/stellenangebote/detail/{ID}/"}}};
      __INIT__ = ${JSON.stringify({ clientClassification: 'human', vacancy: { results: { main: { results, meta } } } })};
    </script></head><body></body></html>`;

test('jobs.ch encodes spaces as %20 so multi-word terms are not redirected', async () => {
  const urls = [];
  const jobs = await fetchCustomProvider('jobsch', { name: 'Fixture', careers_url: JOBSCH, api_params: { term: ['backend engineer', 'c++'] }, api_max_pages: 2 }, {
    fetchText: async (url, options) => {
      urls.push(url);
      assert.equal(options.redirect, 'error');
      const page = new URL(url).searchParams.get('page') || '1';
      return jobsChPage([jobsChRow(`${new URL(url).searchParams.get('term')}-${page}`)], { numPages: 2, totalHits: 2, fetched: true });
    },
  });
  assert.deepEqual(urls, [
    'https://www.jobs.ch/en/vacancies/?term=backend%20engineer',
    'https://www.jobs.ch/en/vacancies/?term=backend%20engineer&page=2',
    'https://www.jobs.ch/en/vacancies/?term=c%2B%2B',
    'https://www.jobs.ch/en/vacancies/?term=c%2B%2B&page=2',
  ]);
  assert.equal(jobs.length, 4);
  assert.equal(jobs[0].url, 'https://www.jobs.ch/en/vacancies/detail/backend%20engineer-1/');
  assert.equal(jobs[0].company, 'Puzzle ITC AG');
  assert.equal(jobs[0].location, 'Bern');
  assert.equal(jobs[0].postedAt, Date.parse('2026-10-06T15:49:37+02:00'));
});

test('jobs.ch fails visibly on payload changes but returns [] for a genuine empty search', async () => {
  const run = html => fetchCustomProvider('jobsch', { name: 'Fixture', careers_url: JOBSCH }, { fetchText: async () => html });
  await assert.rejects(run('<html>redesign</html>'), /Unable to parse jobs.ch embedded results payload/);
  await assert.rejects(run(jobsChPage([], { numPages: 3, totalHits: 42, fetched: true })), /reported 42 hits but embedded no result rows/);
  await assert.rejects(run(jobsChPage([{ uuid: 'renamed', headline: 'Engineer' }])), /Unsupported jobs.ch result shape/);
  assert.deepEqual(await run(jobsChPage([], { numPages: 0, totalHits: 0, fetched: true })), []);
});

test('jobs.ch duplicate rows across terms are deduplicated without tripping the shape guard', async () => {
  const jobs = await fetchCustomProvider('jobsch', { name: 'Fixture', careers_url: JOBSCH, api_params: { term: ['backend', 'platform'] } }, {
    fetchText: async () => jobsChPage([jobsChRow('same')]),
  });
  assert.equal(jobs.length, 1);
});

// Trimmed from the live response: Radware Bot Manager answers HTTP 200.
const RADWARE_CHALLENGE = `<!DOCTYPE html><html lang="en"><head><title>Radware Page</title>
  <meta name="description" content="Loader page." /><script>var __uzdbm_1 = "fixture";</script></head>
  <body><div class="container"><div class="content"><p class="verify-message"> Verifying your browser before proceeding... </p></div></div>
  <div class="incident-id"><p><span class="bold">Incident ID:</span> fixture</p></div></body></html>`;

test('Make it in Germany reports a Radware bot challenge instead of a markup change', async () => {
  const entry = { name: 'Fixture', careers_url: MAKEITINGERMANY, api_params: { q: ['entwickler'], filter: ['industry:9', 'tstamp:fortnight'] } };
  await assert.rejects(
    fetchCustomProvider('makeitingermany', entry, { fetchText: async () => RADWARE_CHALLENGE }),
    error => /Radware bot challenge/.test(error.message) && !/Unsupported listing page/.test(error.message),
  );
});

test('DEVjobs.de names a Cloudflare challenge instead of a bare HTTP 403', {skip: !existsSync(chromium.executablePath()) && 'Chromium is not installed'}, async () => {
  const challenge = Object.assign(new Error('HTTP 403 Forbidden'), {
    status: 403, body: '<html><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></html>',
  });
  await assert.rejects(
    fetchCustomProvider('devjobsde', { name: 'Fixture', careers_url: 'https://en.devjobs.de/jobs/search' }, { maxPages: 1, fetchResponse: async () => { throw challenge; } }),
    error => /Cloudflare bot challenge/.test(error.message) && error.cause === challenge,
  );
  const plain = Object.assign(new Error('HTTP 403 Forbidden'), { status: 403, body: 'Forbidden' });
  await assert.rejects(
    fetchCustomProvider('devjobsde', { name: 'Fixture', careers_url: 'https://en.devjobs.de/jobs/search' }, { maxPages: 1, fetchResponse: async () => { throw plain; } }),
    error => error === plain,
  );
});
