// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Working Nomads provider — board-wide aggregator feed
// (https://www.workingnomads.com/api/exposed_jobs/). Returns a JSON array of
// postings; scan.mjs applies the configured title_filter / location_filter.
//
// Wire in via a `job_boards:` entry with `provider: workingnomads`.

const DEFAULT_FEED_URL = 'https://www.workingnomads.com/api/exposed_jobs/';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toFilterArray(value) {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
  if (value === undefined || value === null) return [];
  return [String(value).trim()].filter(Boolean);
}

function normalizeSearchText(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function matchesFilter(requestedValues, actualValue) {
  if (!requestedValues || requestedValues.length === 0) return true;
  const actual = normalizeSearchText(actualValue);
  if (!actual) return false;
  return requestedValues.some(value => actual.includes(normalizeSearchText(value)));
}

function matchesTagFilter(requestedValues, tags) {
  if (!requestedValues || requestedValues.length === 0) return true;
  if (!Array.isArray(tags) || tags.length === 0) return false;
  return requestedValues.some(value => tags.some(tag => matchesFilter([value], tag)));
}

function matchesQuery(queries, job) {
  if (!queries || queries.length === 0) return true;
  const haystack = normalizeSearchText([
    job.title,
    job.company,
    job.location,
    job.category,
    job.tags.join(' '),
    job.description,
  ].filter(Boolean).join(' '));
  return queries.some(query => haystack.includes(normalizeSearchText(query)));
}

function isWithinDays(dateValue, days) {
  if (!days) return true;
  const timestamp = Date.parse(dateValue);
  if (!Number.isFinite(timestamp)) return false;
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  return timestamp >= cutoff;
}

function splitTags(value) {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  return String(value || '').split(',').map(v => v.trim()).filter(Boolean);
}

function formatLocationSlugToken(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (['apac', 'emea', 'uk', 'usa', 'eu'].includes(token)) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function inferLocationFilters(entry) {
  const explicit = toFilterArray(entry.api_params?.location);
  if (explicit.length > 0) return explicit;
  try {
    const slug = new URL(entry.careers_url || '').pathname.match(/^\/remote-([a-z-]+)-jobs\/?$/)?.[1];
    return slug ? [slug.split('-').map(formatLocationSlugToken).join(' ')] : [];
  } catch {
    return [];
  }
}

function getFeedUrl(entry) {
  return new URL(entry.api || DEFAULT_FEED_URL).toString();
}

function getFilters(entry) {
  const publishedWithinDays = Number(entry.api_params?.published_within_days);
  return {
    q: toFilterArray(entry.api_params?.q),
    category: toFilterArray(entry.api_params?.category),
    location: inferLocationFilters(entry),
    tags: toFilterArray(entry.api_params?.tags),
    publishedWithinDays: Number.isFinite(publishedWithinDays) && publishedWithinDays > 0 ? publishedWithinDays : null,
  };
}

/** @type {Provider} */
export default {
  id: 'workingnomads',

  detect(entry) {
    const candidate = entry.api || entry.careers_url || '';
    if (entry.api_provider !== 'workingnomads' && !/https?:\/\/(?:www\.)?workingnomads\.com\/(?:api\/exposed_jobs\/?|remote-[^/?#]+-jobs(?:[/?#]|$)|jobs(?:[/?#]|$))/.test(candidate)) {
      return null;
    }

    try {
      return { url: getFeedUrl(entry) };
    } catch {
      return null;
    }
  },

  /**
   * Fetches and normalizes postings from the Working Nomads public feed.
   * @param {{ name?: string, api?: string, careers_url?: string, api_provider?: string, api_params?: Record<string, unknown> }} entry - The job_boards entry being processed.
   * @param {{ fetchJson: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<any> }} ctx - HTTP context.
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string}>>}
   */
  async fetch(entry, ctx) {
    // redirect:'error' prevents SSRF via server-side redirects
    const data = await ctx.fetchJson(getFeedUrl(entry), { redirect: 'error' });
    if (!Array.isArray(data)) {
      throw new Error(`workingnomads: unexpected API response - expected a JSON array, got ${data === null ? 'null' : typeof data}`);
    }

    const filters = getFilters(entry);
    return data
      .filter(j => j && typeof j === 'object'
        && typeof j.title === 'string' && j.title.trim() !== ''
        && typeof j.url === 'string' && /^https?:\/\//i.test(j.url.trim()))
      .map(j => ({
        title: j.title.trim(),
        url: j.url.trim(),
        company: typeof j.company_name === 'string' && j.company_name.trim() ? j.company_name.trim() : (entry.name || 'Working Nomads'),
        location: typeof j.location === 'string' ? j.location.trim() : '',
        category: normalizeWhitespace(j.category_name),
        tags: splitTags(j.tags),
        publishedAt: String(j.pub_date || ''),
        description: normalizeWhitespace(String(j.description || '').replace(/<[^>]+>/g, ' ')),
      }))
      .filter(job => (
        matchesQuery(filters.q, job)
        && matchesFilter(filters.category, job.category)
        && matchesFilter(filters.location, job.location)
        && matchesTagFilter(filters.tags, job.tags)
        && isWithinDays(job.publishedAt, filters.publishedWithinDays)
      ))
      .map(({ title, url, company, location }) => ({ title, url, company, location }));
  },
};
