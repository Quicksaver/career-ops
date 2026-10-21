// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';
import { sleep } from './_http.mjs';
import { countryName } from './_country.mjs';

// Agentic Engineering Jobs provider — queries the site's public, documented
// REST API instead of scraping HTML. The previous scraper parsed
// `data-impression-slug` card containers out of the server-rendered listing;
// the site markup changed and the containers no longer exist, breaking the
// scraper outright (#2143). The API is the stable integration point going
// forward — no auth, CORS-enabled, and it's what the site itself recommends
// for programmatic access (OpenAPI spec at /api/v1/openapi.json).
//
//   GET {API_BASE}/jobs?page={n}   — 1-based, 20 per page (spec; meta.per_page wins)
//   → { data: [{ title, companyName, slug, location, countries: string[],
//                description (HTML), postedAt (ISO), salaryMin/Max/Currency,
//                geoRegion, … }], meta: { total, page, per_page } }
//
// Detail URL the site itself builds: {SITE_ORIGIN}/jobs/{slug}.
// `location` is already a human-readable string ("Remote (EU)", "Bangalore,
// India") for the overwhelming majority of postings — used as-is for
// scan.mjs's location_filter. The rare posting without one falls back to the
// ISO `countries` array, decoded to country names.
//
// Rate limit: 30 requests/60s per IP (documented in the OpenAPI info block).
// PAGE_DELAY_MS paces requests comfortably under that even for the largest
// boards; MAX_PAGES is a hard stop regardless.
//
// Failures stay loud: a non-2xx response is rethrown with the request URL and
// the API's own error code, a page whose records none normalize is a shape
// change, and zero jobs overall is a canary — never a silent empty board.
//
// Outage note (verified 2026-10-21): every data-backed endpoint — /jobs with
// any or no params, /jobs/{slug}, POST /jobs/by-slugs, /salaries?dimension=
// overview — answers 500 INTERNAL_ERROR, while /api/v1/health reports ok and
// param validation still answers 400. Uncached site pages 500 the same way;
// the homepage, /jobs and sitemap.xml are prerendered snapshots frozen at
// 2026-07-27. A homepage-markup fallback was considered and rejected: it
// would present that stale snapshot as live postings. If the board comes back
// with a different contract, re-check /api/v1/openapi.json first.
//
// Wire in via a `job_boards:` entry with `provider: agentic-jobs`.

const SITE_ORIGIN = 'https://agentic-engineering-jobs.com';
const API_BASE = `${SITE_ORIGIN}/api/v1`;
const TRUSTED_HOST = 'agentic-engineering-jobs.com';
const PAGE_SIZE = 20;
const MAX_PAGES = 40;
const MAX_JOBS = 2000;
const PAGE_DELAY_MS = 2100;

/**
 * Rethrows a transport error with the request URL and, when the API answered
 * with its documented `{ error: { code, message } }` envelope, that code —
 * keeping `HTTP <status>` and `status` so scan's error classifier still
 * files it under the right kind.
 * @param {any} err
 * @param {string} url
 */
export function describeAgenticError(err, url) {
  let detail = '';
  try {
    const body = JSON.parse(typeof err?.body === 'string' ? err.body : '');
    const code = typeof body?.error?.code === 'string' ? body.error.code : '';
    const message = typeof body?.error?.message === 'string' ? body.error.message : '';
    if (code || message) detail = ` (${[code, message].filter(Boolean).join(': ')})`;
  } catch { /* non-JSON body — the status line is all there is */ }
  const wrapped = new Error(`agentic-jobs: GET ${url} failed: ${err?.message ?? err}${detail}`, { cause: err });
  wrapped.status = err?.status;
  if (err?.retryAfter !== undefined) wrapped.retryAfter = err.retryAfter;
  return wrapped;
}

/** @param {string} url */
function assertAgenticUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`agentic-jobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`agentic-jobs: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`agentic-jobs: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

// countryName lives in _country.mjs (shared with gem.mjs); re-exported here
// because this provider's tests import it from this module.
export { countryName };

export function stripHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  const noMedia = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  return decodeEntities(noMedia.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function normalizeAgenticLocation(j) {
  if (typeof j?.location === 'string' && j.location.trim()) return j.location.trim();
  const countries = Array.isArray(j?.countries) ? j.countries : [];
  const names = [...new Set(countries.map(countryName).filter(Boolean))];
  if (names.length) return names.join(' / ');
  return typeof j?.geoRegion === 'string' ? j.geoRegion.trim() : '';
}

export function normalizeAgenticSalary(j) {
  const hasMin = typeof j?.salaryMin === 'number' && Number.isFinite(j.salaryMin);
  const hasMax = typeof j?.salaryMax === 'number' && Number.isFinite(j.salaryMax);
  if (!hasMin && !hasMax) return null;
  const salary = {};
  if (hasMin) salary.min = j.salaryMin;
  if (hasMax) salary.max = j.salaryMax;
  const currency = typeof j?.salaryCurrency === 'string' ? j.salaryCurrency.trim().toUpperCase() : '';
  if (currency) salary.currency = currency;
  return salary;
}

export function normalizeAgenticJob(j) {
  if (!j || typeof j !== 'object') return null;
  const title = typeof j.title === 'string' ? j.title.trim() : '';
  const company = typeof j.companyName === 'string' ? j.companyName.trim() : '';
  const slug = typeof j.slug === 'string' ? j.slug.trim() : '';
  if (!title || !company || !slug || !/^[A-Za-z0-9_-]+$/.test(slug)) return null;

  const job = {
    title,
    url: `${SITE_ORIGIN}/jobs/${slug}`,
    company,
    location: normalizeAgenticLocation(j),
  };

  const description = stripHtml(j.description);
  if (description) job.description = description;

  const posted = typeof j.postedAt === 'string' ? Date.parse(j.postedAt) : NaN;
  if (Number.isFinite(posted)) job.postedAt = posted;

  const salary = normalizeAgenticSalary(j);
  if (salary) job.salary = salary;

  return job;
}

/** @type {Provider} */
export default {
  id: 'agentic-jobs',

  detect(entry) {
    return entry?.provider === 'agentic-jobs' ? { url: SITE_ORIGIN } : null;
  },

  async fetch(_entry, ctx) {
    const jobs = [];
    const seen = new Set();
    let total = null;

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (page > 1) await sleep(PAGE_DELAY_MS, ctx);
      const url = assertAgenticUrl(`${API_BASE}/jobs?page=${page}`);
      let json;
      try {
        json = await ctx.fetchJson(url, { redirect: 'error', headers: { accept: 'application/json' } });
      } catch (err) {
        // Only HTTP errors are rewrapped; network/abort errors keep their
        // name and message, which scan's classifier keys on.
        throw typeof err?.status === 'number' ? describeAgenticError(err, url) : err;
      }
      if (!json || !Array.isArray(json.data)) {
        throw new Error(`agentic-jobs: unexpected API response shape on page ${page} — "data" is missing or not an array`);
      }
      const records = json.data;
      if (total === null) total = typeof json.meta?.total === 'number' ? json.meta.total : null;
      const effectivePageSize = typeof json.meta?.per_page === 'number' && json.meta.per_page > 0
        ? json.meta.per_page
        : PAGE_SIZE;

      let valid = 0;
      for (const record of records) {
        const job = normalizeAgenticJob(record);
        if (!job) continue;
        valid++;
        if (!seen.has(job.url)) {
          seen.add(job.url);
          jobs.push(job);
        }
      }
      if (records.length > 0 && valid === 0) {
        throw new Error(`agentic-jobs: none of the ${records.length} records on page ${page} has title/companyName/slug — the record shape likely changed`);
      }

      if (jobs.length >= MAX_JOBS) break;
      if (records.length < effectivePageSize) break;
      if (total !== null && page * effectivePageSize >= total) break;
    }

    if (jobs.length === 0) {
      throw new Error('agentic-jobs: parsed 0 jobs from the API — the response shape likely changed');
    }
    return jobs.slice(0, MAX_JOBS);
  },
};
