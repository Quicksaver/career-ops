// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';

// Agentic Engineering Jobs provider — scrapes the server-rendered listing at
// https://agentic-engineering-jobs.com/jobs. The site has no public API, but
// job cards are present in the initial HTML, so the full visible page is
// parseable from one fetch (zero tokens, no browser).
//
// The current format uses `<a href="/jobs/{slug}">` cards with semantic class
// signals for title/company/remote plus ISO country codes and a date. The
// original `data-impression-slug` container parser remains as a compatibility
// fallback for cached/older markup. Legacy card text follows this order:
//   [Featured?] → title → company → location → tech tags… → 🇺🇸 flag → [date]
// The country flag emoji is decoded to a country name and appended to the
// location so scan.mjs's location_filter can gate non-US postings that only
// say "Remote".
//
// Wire in via a `job_boards:` entry with `provider: agentic-jobs`.

const SITE_ORIGIN = 'https://agentic-engineering-jobs.com';
const LISTING_URL = `${SITE_ORIGIN}/jobs`;
const TRUSTED_HOST = 'agentic-engineering-jobs.com';

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

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

function regionCodeToCountry(code) {
  try {
    const name = regionNames.of(code);
    return name && name !== code ? name : '';
  } catch {
    return '';
  }
}

/**
 * Convert a two-letter regional-indicator flag emoji (e.g. 🇩🇪) into an
 * English country name ("Germany"). Returns '' when the input isn't a flag or
 * the region code can't be resolved.
 * @param {string} s
 */
export function flagToCountry(s) {
  const cps = [...s];
  if (cps.length !== 2) return '';
  const codes = cps.map((c) => {
    const cp = c.codePointAt(0) ?? 0;
    return cp >= 0x1f1e6 && cp <= 0x1f1ff ? String.fromCharCode(cp - 0x1f1e6 + 65) : '';
  });
  if (codes.some((c) => !c)) return '';
  return regionCodeToCountry(codes.join(''));
}

function htmlText(html) {
  if (typeof html !== 'string' || !html) return '';
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Parse the current anchor-card body into a normalized Job.
 * @param {string} slug
 * @param {string} body
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeCurrentAgenticCard(slug, body) {
  if (!slug || !/^[a-z0-9_-]+$/i.test(slug) || typeof body !== 'string') return null;

  const titleMatch = body.match(/<span\b[^>]*class="[^"]*\bfont-semibold\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const companyMatch = body.match(/<p\b[^>]*class="[^"]*\btext-muted\b[^"]*\btruncate\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  const title = htmlText(titleMatch?.[1] || '');
  const company = htmlText(companyMatch?.[1] || '');
  if (!title || !company) return null;

  // bg-indigo-100 is the current work-model/location badge; violet badges are
  // technology tags and must never slide into the location field.
  const locationMatch = body.match(/<span\b[^>]*class="[^"]*\bbg-indigo-100\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const locationParts = [];
  const locationBadge = htmlText(locationMatch?.[1] || '');
  if (locationBadge) locationParts.push(locationBadge);

  // A posting can carry multiple country flags in one span, with the reliable
  // machine value exposed as title="CA, GB". Preserve every country so global
  // location filters do not mistake a country-scoped Remote role for worldwide.
  const countryCodes = [];
  for (const match of body.matchAll(/<span\b[^>]*\btitle="([A-Z]{2}(?:\s*,\s*[A-Z]{2})*)"[^>]*>/gi)) {
    countryCodes.push(...match[1].split(',').map((code) => code.trim().toUpperCase()));
  }
  for (const code of [...new Set(countryCodes)]) {
    const country = regionCodeToCountry(code);
    if (country && !locationParts.includes(country)) locationParts.push(country);
  }

  const job = {
    title,
    url: `${SITE_ORIGIN}/jobs/${slug}`,
    company,
    location: locationParts.join(', '),
  };
  const dateMatch = body.match(/>(\d{4}-\d{2}-\d{2})</);
  if (dateMatch) {
    const parsed = Date.parse(`${dateMatch[1]}T00:00:00Z`);
    if (!Number.isNaN(parsed)) job.postedAt = parsed;
  }
  return job;
}

/**
 * Parse one job card's HTML segment into text lines (tags stripped, entities
 * decoded, blanks removed). Exported for tests.
 * @param {string} segment
 */
export function cardLines(segment) {
  const noMedia = segment.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<img[^>]*>/gi, ' ');
  return noMedia
    .split(/<[^>]+>/)
    .map((t) => decodeEntities(t).trim())
    .filter(Boolean);
}

/**
 * Normalize one card. Exported for tests.
 * @param {string} slug
 * @param {string[]} lines
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeAgenticCard(slug, lines) {
  if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) return null;
  // Drop the leftover `slug">` artifact of the split plus any Featured badge.
  const fields = lines.filter((l) => !l.includes('">') && l !== 'Featured');
  if (fields.length < 2) return null;
  const [title, company, maybeLocation] = fields;
  if (!title || !company) return null;

  // A card without a location line slides the flag-emoji line into this slot —
  // a bare flag is never a location (it resolves to the country name below).
  let location =
    maybeLocation && !/^\d{4}-\d{2}-\d{2}$/.test(maybeLocation) && !flagToCountry(maybeLocation) ? maybeLocation : '';
  const flag = fields.map(flagToCountry).find(Boolean);
  if (flag) location = location ? `${location}, ${flag}` : flag;

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url: `${SITE_ORIGIN}/jobs/${slug}`, company, location };

  const dateLine = fields.find((l) => /^\d{4}-\d{2}-\d{2}$/.test(l));
  if (dateLine) {
    const parsed = Date.parse(`${dateLine}T00:00:00Z`);
    if (!Number.isNaN(parsed)) job.postedAt = parsed;
  }
  return job;
}

/**
 * Parse the full listing page. Exported for tests.
 * @param {string} html
 */
export function parseAgenticListing(html) {
  const out = [];
  const seen = new Set();

  // Current SSR format (July 2026): duplicate responsive anchors can point to
  // the same job, so URL-level dedup is required even within one response.
  const anchorPattern = /<a\b[^>]*\bhref=["']\/jobs\/([a-z0-9_-]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const job = normalizeCurrentAgenticCard(match[1], match[2]);
    if (job && !seen.has(job.url)) {
      seen.add(job.url);
      out.push(job);
    }
  }

  // Original SSR format: retain as a fallback/compatibility path. Running it
  // after the anchor parser also supports a mixed rollout without duplicates.
  const segments = html.split(/<div[^>]*\bdata-impression-slug="/).slice(1);
  for (const seg of segments) {
    const slug = seg.slice(0, seg.indexOf('"'));
    // Cards can nest other markup; stop this card at the next card boundary.
    const nextCard = seg.indexOf('data-impression-slug', slug.length + 2);
    const body = nextCard > 0 ? seg.slice(0, nextCard) : seg;
    const job = normalizeAgenticCard(slug, cardLines(body));
    if (job && !seen.has(job.url)) {
      seen.add(job.url);
      out.push(job);
    }
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'agentic-jobs',

  detect(entry) {
    return entry?.provider === 'agentic-jobs' ? { url: SITE_ORIGIN } : null;
  },

  async fetch(_entry, ctx) {
    const url = assertAgenticUrl(LISTING_URL);
    // redirect:'error' prevents SSRF via server-side redirects
    const html = await ctx.fetchText(url, { redirect: 'error' });
    const jobs = parseAgenticListing(html);
    if (jobs.length === 0) {
      throw new Error(
        'agentic-jobs: parsed 0 job cards — the site markup likely changed (expected /jobs/{slug} anchors or data-impression-slug containers)',
      );
    }
    return jobs;
  },
};
