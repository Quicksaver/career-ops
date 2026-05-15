#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner
 *
 * Fetches Greenhouse, Ashby, Lever, and PCSX APIs plus structured feed/HTML
 * providers such as Landing.jobs, SwissDevJobs/GermanTechJobs/DevITJobs,
 * jobs.ch, DEVjobs.de, Jobs in English Denmark, Make it in Germany,
 * EU Remote Jobs, ITJobs, SAPO Emprego, Portal Emprego, Dice,
 * Working Nomads, and RustJobs.dev, applies title
 * filters from portals.yml,
 * deduplicates against existing history, and appends new offers to
 * pipeline.md + scan-history.tsv.
 *
 * Zero Claude API tokens — pure HTTP + JSON.
 *
 * Usage:
 *   node scan.mjs                  # scan all enabled companies
 *   node scan.mjs --dry-run        # preview without writing files
 *   node scan.mjs --company Cohere # scan a single company
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';
const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';
const PIPELINE_TEMPLATE = '## Pendientes\n\n## Procesadas\n';

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;
const PCSX_DETAIL_CONCURRENCY = 20;
const EUREMOTEJOBS_DETAIL_CONCURRENCY = 5;
const EUREMOTEJOBS_MAX_PAGES = 5;
const ITJOBS_MAX_PAGES = 5;
const SAPO_MAX_PAGES = 5;
const PORTALEMPREGO_MAX_PAGES = 5;
const DICE_MAX_PAGES = 5;
const REMOTEINEUROPE_DETAIL_CONCURRENCY = 5;
const REMOTEINEUROPE_MAX_PAGES = 5;
const NODESK_MAX_PAGES = 5;
const NODESK_DETAIL_CONCURRENCY = 5;
const ENGLISHJOBS_MAX_PAGES = 5;
const JOBSINENGLISH_MAX_PAGES = 5;
const JOBSCH_MAX_PAGES = 5;
const MAKEITINGERMANY_MAX_PAGES = 5;
const DEVJOBSDE_MAX_PAGES = 5;
const RUSTJOBS_MAX_PAGES = 20;
const DEVJOBSDE_NAVIGATION_TIMEOUT_MS = 45_000;
const RUSTJOBS_NAVIGATION_TIMEOUT_MS = 45_000;
const NODESK_ALGOLIA_APP_ID = '0586L1SOK8';
const NODESK_ALGOLIA_API_KEY = '8dacb58c6f375cba28e19ecf1f03e9e1';
const NODESK_ALGOLIA_JOB_INDEX = 'jobPosts';
const DEVITJOBS_FAMILY_DEFAULT_BASE_URL = 'https://swissdevjobs.ch';
const DEVJOBSDE_BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEVJOBSDE_WORKING_MODELS = new Set(['Full Remote', 'Hybrid', 'Onsite']);
const DEVJOBSDE_EMPLOYMENT_TYPES = new Set(['Full Time', 'Part Time', 'Part Time/Full Time', 'Freelance', 'Internship', 'Apprenticeship']);
const DEVJOBSDE_EXPERIENCE_LEVELS = new Set(['Junior', 'Senior', 'Lead']);

const LANDINGJOBS_REMOTE_POLICY_ALIASES = {
  fullremote: ['fullremote', 'remote'],
  globalremote: ['globalremote', 'remoteacrossborders'],
  partialremote: ['partialremote', 'hybrid'],
  onsite: ['onsite', 'onsitejob'],
};

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeSearchText(value) {
  return normalizeWhitespace(String(value || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeSearchKey(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, '');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => {
      const entities = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
      };
      return entities[name.toLowerCase()] || `&${name};`;
    });
}

function cleanHtmlText(value) {
  return normalizeWhitespace(
    decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\u00a0/g, ' '))
  );
}

function splitHtmlSegments(value) {
  const prepared = value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<i\b[^>]*><\/i>/g, '|')
    .replace(/<br\s*\/?>/gi, '|')
    .replace(/<\/(div|p|li)>/gi, '|')
    .replace(/&nbsp;/gi, ' ');

  return decodeHtmlEntities(prepared.replace(/<[^>]+>/g, ' ').replace(/\u00a0/g, ' '))
    .split('|')
    .map(normalizeWhitespace)
    .filter(Boolean);
}

function getUrlOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getPcsxConfig(company) {
  const origin = getUrlOrigin(company.careers_url) || getUrlOrigin(company.api);
  if (!origin) return null;

  let domain = company.api_domain || null;

  if (!domain && company.api) {
    try {
      domain = new URL(company.api).searchParams.get('domain');
    } catch {
      domain = null;
    }
  }

  if (!domain) return null;

  const searchUrl = company.api
    ? new URL(company.api)
    : new URL(company.api_search_path || '/api/pcsx/search', origin);

  if (!searchUrl.searchParams.get('domain')) {
    searchUrl.searchParams.set('domain', domain);
  }

  if (company.api_sort_by !== false && !searchUrl.searchParams.get('sort_by')) {
    searchUrl.searchParams.set('sort_by', company.api_sort_by || 'timestamp');
  }

  return {
    origin,
    domain,
    searchUrl: searchUrl.toString(),
    detailPath: company.api_detail_path || '/api/pcsx/position_details',
  };
}

function getItjobsConfig(company) {
  const baseUrl = company.api || company.careers_url;
  if (!baseUrl) return null;

  let listUrl;
  try {
    listUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  let urls = [listUrl];

  for (const [key, rawValue] of Object.entries(company.api_params || {})) {
    if (rawValue === false || rawValue === null || rawValue === undefined || rawValue === '') {
      continue;
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const nextUrls = [];

    for (const existingUrl of urls) {
      for (const value of values) {
        const nextUrl = new URL(existingUrl.toString());
        nextUrl.searchParams.set(key, String(value));
        nextUrls.push(nextUrl);
      }
    }

    urls = nextUrls;
  }

  return {
    listUrls: urls.map(url => url.toString()),
    maxPages: Math.max(1, Number(company.api_max_pages) || ITJOBS_MAX_PAGES),
  };
}

function getEuRemoteJobsConfig(company) {
  const baseUrl = company.api || company.careers_url || 'https://euremotejobs.com/job-listings/feed/';

  let feedUrl;
  try {
    feedUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  return {
    feedUrl: feedUrl.toString(),
    maxPages: Math.max(1, Number(company.api_max_pages) || EUREMOTEJOBS_MAX_PAGES),
  };
}

function formatWorkingNomadsSlugToken(value) {
  const token = String(value || '').trim();
  if (!token) return '';

  if (['apac', 'emea', 'uk', 'usa', 'eu'].includes(token)) {
    return token.toUpperCase();
  }

  return token.charAt(0).toUpperCase() + token.slice(1);
}

function inferWorkingNomadsLocationFilters(company) {
  const explicitFilters = toFilterArray(company.api_params?.location);
  if (explicitFilters.length > 0) return explicitFilters;

  try {
    const pathname = new URL(company.careers_url || '').pathname;
    const slug = pathname.match(/^\/remote-([a-z-]+)-jobs\/?$/)?.[1];
    if (!slug) return [];

    return [slug.split('-').map(formatWorkingNomadsSlugToken).join(' ')];
  } catch {
    return [];
  }
}

function getWorkingNomadsConfig(company) {
  const baseUrl = company.api || 'https://www.workingnomads.com/api/exposed_jobs/';
  let apiUrl;

  try {
    apiUrl = new URL(baseUrl).toString();
  } catch {
    return null;
  }

  const publishedWithinDays = Number(company.api_params?.published_within_days);

  return {
    apiUrl,
    filters: {
      q: toFilterArray(company.api_params?.q),
      category: toFilterArray(company.api_params?.category),
      location: inferWorkingNomadsLocationFilters(company),
      tags: toFilterArray(company.api_params?.tags),
      publishedWithinDays: Number.isFinite(publishedWithinDays) && publishedWithinDays > 0
        ? publishedWithinDays
        : null,
    },
  };
}

function getDevITJobsFamilyBaseUrl(company) {
  const configuredUrl = company.careers_url || company.api || DEVITJOBS_FAMILY_DEFAULT_BASE_URL;

  try {
    return new URL(configuredUrl).origin;
  } catch {
    return DEVITJOBS_FAMILY_DEFAULT_BASE_URL;
  }
}

function getDevITJobsFamilyCurrencyConfig(baseUrl) {
  const host = new URL(baseUrl).hostname.replace(/^www\./, '');

  if (host === 'swissdevjobs.ch') {
    return { symbol: 'CHF', separator: "'", spaceBetween: true };
  }

  if (host === 'germantechjobs.de' || host === 'devitjobs.nl') {
    return { symbol: 'EUR', separator: '.', spaceBetween: false };
  }

  if (host === 'devitjobs.uk') {
    return { symbol: 'GBP', separator: ',', spaceBetween: false };
  }

  return { symbol: '', separator: ',', spaceBetween: true };
}

function getDevITJobsFamilyConfig(company) {
  const baseUrl = getDevITJobsFamilyBaseUrl(company);
  const apiUrlCandidate = company.api || new URL('/api/jobsLight', baseUrl).toString();
  let apiUrl;

  try {
    apiUrl = new URL(apiUrlCandidate).toString();
  } catch {
    return null;
  }

  const publishedWithinDays = Number(company.api_params?.published_within_days);

  return {
    baseUrl,
    apiUrl,
    currency: getDevITJobsFamilyCurrencyConfig(baseUrl),
    filters: {
      q: toFilterArray(company.api_params?.q),
      city: toFilterArray(company.api_params?.city || company.api_params?.actual_city),
      cityCategory: toFilterArray(company.api_params?.city_category),
      workplace: toFilterArray(company.api_params?.workplace),
      language: toFilterArray(company.api_params?.language),
      visaSponsorship: toFilterArray(company.api_params?.visa_sponsorship),
      jobType: toFilterArray(company.api_params?.job_type),
      expLevel: toFilterArray(company.api_params?.exp_level),
      techCategory: toFilterArray(company.api_params?.tech_category),
      metaCategory: toFilterArray(company.api_params?.meta_category),
      companyType: toFilterArray(company.api_params?.company_type),
      companySize: toFilterArray(company.api_params?.company_size),
      technologies: toFilterArray(company.api_params?.technologies),
      publishedWithinDays: Number.isFinite(publishedWithinDays) && publishedWithinDays > 0
        ? publishedWithinDays
        : null,
    },
  };
}

function getSapoConfig(company) {
  const baseUrl = company.api || company.careers_url;
  if (!baseUrl) return null;

  let listUrl;
  try {
    listUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  let urls = [listUrl];

  for (const [key, rawValue] of Object.entries(company.api_params || {})) {
    if (rawValue === false || rawValue === null || rawValue === undefined || rawValue === '') {
      continue;
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const nextUrls = [];

    for (const existingUrl of urls) {
      for (const value of values) {
        const nextUrl = new URL(existingUrl.toString());
        nextUrl.searchParams.set(key, String(value));
        nextUrls.push(nextUrl);
      }
    }

    urls = nextUrls;
  }

  return {
    listUrls: urls.map(url => url.toString()),
    maxPages: Math.max(1, Number(company.api_max_pages) || SAPO_MAX_PAGES),
  };
}

function getDiceConfig(company) {
  const baseUrl = company.api || company.careers_url || 'https://www.dice.com/jobs';

  let listUrl;
  try {
    listUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  const apiParams = company.api_params || {};
  let urls = [listUrl];

  for (const [key, rawValue] of Object.entries(apiParams)) {
    if (rawValue === false || rawValue === null || rawValue === undefined || rawValue === '') {
      continue;
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const nextUrls = [];

    for (const existingUrl of urls) {
      for (const value of values) {
        const nextUrl = new URL(existingUrl.toString());
        nextUrl.searchParams.set(key, String(value));
        nextUrls.push(nextUrl);
      }
    }

    urls = nextUrls;
  }

  return {
    listUrls: urls.map(url => url.toString()),
    maxPages: Math.max(1, Number(company.api_max_pages) || DICE_MAX_PAGES),
    pageSize: Math.max(1, Math.min(Number(company.api_page_size) || Number(apiParams.pageSize) || 20, 100)),
  };
}

function getRemoteInEuropeConfig(company) {
  const baseUrl = company.api || company.careers_url || 'https://remoteineurope.com/categories/programming';

  let listUrl;
  try {
    listUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  let urls = [listUrl];

  for (const rawCategory of toFilterArray(company.api_params?.category)) {
    const slug = normalizeWhitespace(rawCategory).toLowerCase();
    const nextUrls = [];

    for (const existingUrl of urls) {
      const nextUrl = new URL(existingUrl.toString());
      nextUrl.pathname = `/categories/${slug}`;
      nextUrls.push(nextUrl);
    }

    urls = nextUrls;
  }

  return {
    listUrls: urls.map(url => url.toString()),
    maxPages: Math.max(1, Number(company.api_max_pages) || REMOTEINEUROPE_MAX_PAGES),
  };
}

function normalizeNodeskFilterPath(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/nodesk\.co\//, '')
    .replace(/^\/+|\/+$/g, '');
}

function getNodeskConfig(company) {
  const filters = toFilterArray(company.api_params?.search_filter || company.api_params?.search_filters)
    .map(normalizeNodeskFilterPath)
    .filter(Boolean);

  const query = toFilterArray(company.api_params?.q || company.api_params?.query);
  const hitsPerPage = Math.max(1, Math.min(Number(company.api_page_size) || 90, 1000));

  return {
    filters: filters.length > 0 ? filters : ['remote-jobs'],
    query: query.length > 0 ? query : [''],
    maxPages: Math.max(1, Number(company.api_max_pages) || NODESK_MAX_PAGES),
    hitsPerPage,
  };
}

function slugifyPortalEmpregoTerm(value) {
  return normalizeWhitespace(String(value || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toFilterArray(value) {
  if (value === false || value === null || value === undefined || value === '') {
    return [];
  }

  return (Array.isArray(value) ? value : [value])
    .map(item => normalizeWhitespace(String(item || '')))
    .filter(Boolean);
}

function buildRustJobsListUrl(baseUrl, locationSlug) {
  const url = new URL(baseUrl);
  url.search = '';
  url.hash = '';
  url.pathname = locationSlug ? `/locations/${encodeURIComponent(locationSlug)}` : '/';
  return url.toString();
}

function getRustJobsConfig(company) {
  const baseUrl = company.careers_url || company.api || 'https://rustjobs.dev';

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  let locations = toFilterArray(company.api_params?.location)
    .map(value => normalizeWhitespace(value).toLowerCase())
    .filter(Boolean);

  if (locations.length === 0) {
    const locationMatch = parsedUrl.pathname.match(/^\/locations\/([^/?#]+)/);
    if (locationMatch) {
      locations = [decodeURIComponent(locationMatch[1]).toLowerCase()];
    }
  }

  const listUrls = (locations.length > 0 ? locations : [''])
    .map(location => buildRustJobsListUrl(parsedUrl.origin, location))
    .filter((value, index, array) => value && array.indexOf(value) === index);

  return {
    listUrls,
    maxPages: Math.max(1, Number(company.api_max_pages) || RUSTJOBS_MAX_PAGES),
  };
}

function splitCommaSeparatedValues(value) {
  return String(value || '')
    .split(',')
    .map(item => normalizeWhitespace(item))
    .filter(Boolean);
}

function slugifyEnglishJobsQuery(value) {
  return normalizeWhitespace(String(value || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function slugifyEnglishJobsLocation(value) {
  return normalizeWhitespace(String(value || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeEnglishJobsLanguage(value) {
  return normalizeWhitespace(String(value || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '');
}

function buildEnglishJobsSearchUrl(origin, location, query, includeLanguages) {
  const locationSlug = slugifyEnglishJobsLocation(location);
  const querySlug = slugifyEnglishJobsQuery(query);

  let pathname = '/';
  if (locationSlug && querySlug) {
    pathname = `/in/${locationSlug}/${querySlug}`;
  } else if (locationSlug) {
    pathname = `/in/${locationSlug}`;
  } else if (querySlug) {
    pathname = `/jobs/${querySlug}`;
  }

  const url = new URL(pathname, origin);
  if (includeLanguages.length > 0) {
    url.searchParams.set('include', includeLanguages.join('.'));
  }
  return url.toString();
}

function getEnglishJobsConfig(company) {
  const baseUrl = company.api || company.careers_url || 'https://englishjobsearch.ch';

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  const origin = parsedUrl.origin;
  const queries = toFilterArray(company.api_params?.q || company.api_params?.query);
  const locations = toFilterArray(company.api_params?.location);
  const includeLanguages = toFilterArray(company.api_params?.include || company.api_params?.languages)
    .map(normalizeEnglishJobsLanguage)
    .filter(Boolean);

  const queryValues = queries.length > 0 ? queries : [''];
  const locationValues = locations.length > 0 ? locations : [''];
  const generatedUrls = [];

  for (const location of locationValues) {
    for (const query of queryValues) {
      generatedUrls.push(buildEnglishJobsSearchUrl(origin, location, query, includeLanguages));
    }
  }

  const listUrls = generatedUrls
    .map(value => value.trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);

  return {
    listUrls: listUrls.length > 0 ? listUrls : [origin],
    maxPages: Math.max(1, Number(company.api_max_pages) || ENGLISHJOBS_MAX_PAGES),
  };
}

function buildJobsInEnglishSearchUrl(baseUrl, query, regions, categories, useViewAll) {
  const url = new URL(baseUrl);

  if (useViewAll) {
    url.pathname = '/view_all_ads/';
  }

  url.searchParams.delete('page');
  url.searchParams.delete('search');
  url.searchParams.delete('region');
  url.searchParams.delete('category');

  if (query) {
    url.searchParams.set('search', query);
  }

  regions.forEach(region => url.searchParams.append('region', region));
  categories.forEach(category => url.searchParams.append('category', category));

  return url.toString();
}

function getJobsInEnglishConfig(company) {
  const baseUrl = company.api || company.careers_url || 'https://jobsinenglish.dk/';

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  const queries = toFilterArray(company.api_params?.search || company.api_params?.q || company.api_params?.query);
  const regions = toFilterArray(company.api_params?.region);
  const categories = toFilterArray(company.api_params?.category);
  const hasServerSideFilters = queries.length > 0 || regions.length > 0 || categories.length > 0;
  const useViewAll = company.api_use_view_all !== false && hasServerSideFilters;
  const queryValues = queries.length > 0 ? queries : [''];
  const listUrls = queryValues
    .map(query => buildJobsInEnglishSearchUrl(parsedUrl.toString(), query, regions, categories, useViewAll))
    .filter((value, index, array) => value && array.indexOf(value) === index);

  return {
    listUrls: listUrls.length > 0 ? listUrls : [parsedUrl.toString()],
    useViewAll,
    maxPages: Math.max(1, Number(company.api_max_pages) || JOBSINENGLISH_MAX_PAGES),
  };
}

function normalizeDevJobsDeApiParamKey(key) {
  if (key === 'query') return 'q';
  if (key === 'english_only') return 'englishOnly';
  return key;
}

function getDevJobsDeConfig(company) {
  const baseUrl = company.api || company.careers_url || 'https://en.devjobs.de/jobs/search';

  let listUrl;
  try {
    listUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  let urls = [listUrl];

  for (const [rawKey, rawValue] of Object.entries(company.api_params || {})) {
    if (rawValue === false || rawValue === null || rawValue === undefined || rawValue === '') {
      continue;
    }

    const key = normalizeDevJobsDeApiParamKey(rawKey);
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const nextUrls = [];

    for (const existingUrl of urls) {
      for (const value of values) {
        const nextUrl = new URL(existingUrl.toString());
        nextUrl.searchParams.set(key, String(value));
        nextUrls.push(nextUrl);
      }
    }

    urls = nextUrls;
  }

  const listUrls = urls
    .map(url => url.toString())
    .filter((value, index, array) => array.indexOf(value) === index);

  return {
    listUrls: listUrls.length > 0 ? listUrls : [listUrl.toString()],
    maxPages: Math.max(1, Number(company.api_max_pages) || DEVJOBSDE_MAX_PAGES),
  };
}

function getJobsChLocaleFromPathname(pathname) {
  if (/^\/fr\/offres-emplois(?:[/?#]|$)/.test(pathname)) return 'fr';
  if (/^\/de\/stellenangebote(?:[/?#]|$)/.test(pathname)) return 'de';
  return 'en';
}

function getJobsChDetailPathTemplate(locale) {
  if (locale === 'fr') return '/fr/offres-emplois/detail/{ID}/';
  if (locale === 'de') return '/de/stellenangebote/detail/{ID}/';
  return '/en/vacancies/detail/{ID}/';
}

function buildJobsChSearchUrl(baseUrl, term) {
  const url = new URL(baseUrl);
  url.searchParams.set('term', String(term || ''));
  url.searchParams.delete('page');
  return url.toString();
}

function getJobsChConfig(company) {
  const baseUrl = company.careers_url || company.api || 'https://www.jobs.ch/en/vacancies/';

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  const terms = toFilterArray(company.api_params?.term || company.api_params?.q || company.api_params?.query);
  const values = terms.length > 0 ? terms : [''];
  const listUrls = values
    .map(value => buildJobsChSearchUrl(parsedUrl.toString(), value))
    .filter((value, index, array) => value && array.indexOf(value) === index);

  return {
    listUrls: listUrls.length > 0 ? listUrls : [buildJobsChSearchUrl(parsedUrl.toString(), '')],
    locale: getJobsChLocaleFromPathname(parsedUrl.pathname),
    maxPages: Math.max(1, Number(company.api_max_pages) || JOBSCH_MAX_PAGES),
  };
}

function buildMakeItInGermanySearchUrl(baseUrl, query, filters) {
  const url = new URL(baseUrl);

  url.searchParams.delete('tx_solr[page]');
  for (const key of [...url.searchParams.keys()]) {
    if (/^tx_solr\[filter\]\[\d+\]$/.test(key)) {
      url.searchParams.delete(key);
    }
  }

  if (query) {
    url.searchParams.set('tx_solr[q]', query);
  } else {
    url.searchParams.delete('tx_solr[q]');
  }

  filters.forEach((filterValue, index) => {
    url.searchParams.set(`tx_solr[filter][${index}]`, filterValue);
  });

  return url.toString();
}

function getMakeItInGermanyConfig(company) {
  const baseUrl = company.api || company.careers_url || 'https://www.make-it-in-germany.com/en/working-in-germany/job-listings';

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  const queries = toFilterArray(company.api_params?.q || company.api_params?.query);
  const filters = toFilterArray(company.api_params?.filter || company.api_params?.filters);
  const values = queries.length > 0 ? queries : [''];
  const listUrls = values
    .map(value => buildMakeItInGermanySearchUrl(parsedUrl.toString(), value, filters))
    .filter((value, index, array) => value && array.indexOf(value) === index);

  return {
    listUrls: listUrls.length > 0 ? listUrls : [buildMakeItInGermanySearchUrl(parsedUrl.toString(), '', filters)],
    maxPages: Math.max(1, Number(company.api_max_pages) || MAKEITINGERMANY_MAX_PAGES),
  };
}

function getLandingJobsConfig(company) {
  const baseUrl = company.api || 'https://landing.jobs/feed';
  let feedUrl;

  try {
    feedUrl = new URL(baseUrl).toString();
  } catch {
    return null;
  }

  const publishedWithinDays = Number(company.api_params?.published_within_days);
  const updatedWithinDays = Number(company.api_params?.updated_within_days);

  return {
    feedUrl,
    filters: {
      q: toFilterArray(company.api_params?.q),
      category: toFilterArray(company.api_params?.category),
      remotePolicy: toFilterArray(company.api_params?.remote_policy),
      country: toFilterArray(company.api_params?.country),
      city: toFilterArray(company.api_params?.city),
      jobType: toFilterArray(company.api_params?.job_type),
      publishedWithinDays: Number.isFinite(publishedWithinDays) && publishedWithinDays > 0
        ? publishedWithinDays
        : null,
      updatedWithinDays: Number.isFinite(updatedWithinDays) && updatedWithinDays > 0
        ? updatedWithinDays
        : null,
    },
  };
}

function buildPortalEmpregoListUrl(origin, searchTerm, itemsPerPage) {
  const safeItemsPerPage = Math.max(1, Number(itemsPerPage) || 20);
  const slug = slugifyPortalEmpregoTerm(searchTerm);
  const pathname = slug
    ? `/anuncios/pesquisa-${slug}/mostrar-${safeItemsPerPage}/`
    : `/anuncios/mostrar-${safeItemsPerPage}/`;

  return new URL(pathname, origin).toString();
}

function getPortalEmpregoConfig(company) {
  const baseUrl = company.api || company.careers_url;
  if (!baseUrl) return null;

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return null;
  }

  const itemsPerPage = company.api_params?.mostrar || company.api_items_per_page || 20;
  const searchTerms = company.api_params?.pesquisa;
  const values = Array.isArray(searchTerms) ? searchTerms : (searchTerms ? [searchTerms] : []);
  const listUrls = values.length > 0
    ? values
        .map(value => buildPortalEmpregoListUrl(parsedUrl.origin, value, itemsPerPage))
        .filter((value, index, array) => value && array.indexOf(value) === index)
    : [buildPortalEmpregoListUrl(parsedUrl.origin, '', itemsPerPage)];

  return {
    listUrls,
    maxPages: Math.max(1, Number(company.api_max_pages) || PORTALEMPREGO_MAX_PAGES),
  };
}

function buildPcsxDetailUrl(company, positionId, queriedLocation) {
  const pcsx = company._api?.pcsx || getPcsxConfig(company);
  if (!pcsx || !positionId) return null;

  const detailUrl = new URL(pcsx.detailPath, pcsx.origin);
  detailUrl.searchParams.set('domain', pcsx.domain);
  detailUrl.searchParams.set('position_id', String(positionId));

  if (queriedLocation) {
    detailUrl.searchParams.set('queried_location', queriedLocation);
  }

  return detailUrl.toString();
}

// ── API detection ───────────────────────────────────────────────────

const ALLOWED_GREENHOUSE_HOSTS = new Set([
  'boards-api.greenhouse.io',
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'job-boards.eu.greenhouse.io',
]);

function assertGreenhouseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`greenhouse: invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`greenhouse: URL must use HTTPS: ${url}`);
  }

  if (!ALLOWED_GREENHOUSE_HOSTS.has(parsed.hostname)) {
    throw new Error(`greenhouse: untrusted hostname "${parsed.hostname}"`);
  }

  return url;
}

function detectApi(company) {
  if (company.api_provider === 'landingjobs' || /https?:\/\/(?:www\.)?landing\.jobs\/(?:feed(?:\.atom)?|jobs)(?:[/?#]|$)/.test(company.api || company.careers_url || '')) {
    const landingjobs = getLandingJobsConfig(company);
    return landingjobs ? { type: 'landingjobs', url: landingjobs.feedUrl, landingjobs } : null;
  }

  if (company.api_provider === 'pcsx' || (company.api && company.api.includes('/api/pcsx/search'))) {
    const pcsx = getPcsxConfig(company);
    return pcsx ? { type: 'pcsx', url: pcsx.searchUrl, pcsx } : null;
  }

  if (company.api_provider === 'itjobs' || /https?:\/\/(?:www\.)?itjobs\.pt\/emprego/.test(company.api || company.careers_url || '')) {
    const itjobs = getItjobsConfig(company);
    return itjobs ? { type: 'itjobs', url: itjobs.listUrls[0], itjobs } : null;
  }

  if (company.api_provider === 'euremotejobs' || /https?:\/\/(?:www\.)?euremotejobs\.com\/(?:job-listings\/feed\/?|job-category\/[^/?#]+\/feed\/?)(?:[?#].*)?$/.test(company.api || company.careers_url || '')) {
    const euremotejobs = getEuRemoteJobsConfig(company);
    return euremotejobs ? { type: 'euremotejobs', url: euremotejobs.feedUrl, euremotejobs } : null;
  }

  if (company.api_provider === 'workingnomads' || /https?:\/\/(?:www\.)?workingnomads\.com\/(?:api\/exposed_jobs\/?|remote-[^/?#]+-jobs(?:[/?#]|$)|jobs(?:[/?#]|$))/.test(company.api || company.careers_url || '')) {
    const workingnomads = getWorkingNomadsConfig(company);
    return workingnomads ? { type: 'workingnomads', url: workingnomads.apiUrl, workingnomads } : null;
  }

  if (
    company.api_provider === 'swissdevjobs'
    || company.api_provider === 'germantechjobs'
    || company.api_provider === 'devitjobs'
    || /https?:\/\/(?:www\.)?(?:swissdevjobs\.ch|germantechjobs\.de|devitjobs\.uk|devitjobs\.nl)\/api\/jobsLight(?:[/?#]|$)/.test(company.api || company.careers_url || '')
  ) {
    const devitjobs = getDevITJobsFamilyConfig(company);
    return devitjobs ? { type: 'devitjobs', url: devitjobs.apiUrl, devitjobs } : null;
  }

  if (company.api_provider === 'sapo' || /https?:\/\/emprego\.sapo\.pt\/offers(?:\/search)?/.test(company.api || company.careers_url || '')) {
    const sapo = getSapoConfig(company);
    return sapo ? { type: 'sapo', url: sapo.listUrls[0], sapo } : null;
  }

  if (company.api_provider === 'portalemprego' || /https?:\/\/(?:www\.)?portalemprego\.pt\/anuncios(?:\/|$)/.test(company.api || company.careers_url || '')) {
    const portalemprego = getPortalEmpregoConfig(company);
    return portalemprego ? { type: 'portalemprego', url: portalemprego.listUrls[0], portalemprego } : null;
  }

  if (
    company.api_provider === 'englishjobs'
    || company.api_provider === 'englishjobsearch'
    || /https?:\/\/(?:www\.)?(?:englishjobsearch\.ch|englishjobs\.dk|englishjobsearch\.se|englishjobs\.no|englishjobs\.fi|englishjobsearch\.nl|englishjobs\.de)(?:\/|$)/.test(company.api || company.careers_url || '')
  ) {
    const englishjobs = getEnglishJobsConfig(company);
    return englishjobs ? { type: 'englishjobs', url: englishjobs.listUrls[0], englishjobs } : null;
  }

  if (company.api_provider === 'jobsinenglish' || /https?:\/\/(?:www\.)?jobsinenglish\.dk(?:\/|$)/.test(company.api || company.careers_url || '')) {
    const jobsinenglish = getJobsInEnglishConfig(company);
    return jobsinenglish ? { type: 'jobsinenglish', url: jobsinenglish.listUrls[0], jobsinenglish } : null;
  }

  if (
    company.api_provider === 'devjobsde'
    || /https?:\/\/(?:www\.)?(?:en\.)?devjobs\.de\/jobs\/search(?:[/?#]|$)/.test(company.api || company.careers_url || '')
  ) {
    const devjobsde = getDevJobsDeConfig(company);
    return devjobsde ? { type: 'devjobsde', url: devjobsde.listUrls[0], devjobsde } : null;
  }

  if (company.api_provider === 'jobsch' || /https?:\/\/(?:www\.)?jobs\.ch\/(?:en\/vacancies|de\/stellenangebote|fr\/offres-emplois)(?:[/?#]|$)/.test(company.api || company.careers_url || '')) {
    const jobsch = getJobsChConfig(company);
    return jobsch ? { type: 'jobsch', url: jobsch.listUrls[0], jobsch } : null;
  }

  if (company.api_provider === 'makeitingermany' || /https?:\/\/(?:www\.)?make-it-in-germany\.com\/(?:[a-z]{2}\/)?working-in-germany\/job-listings(?:[/?#]|$)/.test(company.api || company.careers_url || '')) {
    const makeitingermany = getMakeItInGermanyConfig(company);
    return makeitingermany ? { type: 'makeitingermany', url: makeitingermany.listUrls[0], makeitingermany } : null;
  }

  if (company.api_provider === 'dice' || /https?:\/\/(?:www\.)?dice\.com\/jobs(?:[/?#]|$)/.test(company.api || company.careers_url || '')) {
    const dice = getDiceConfig(company);
    return dice ? { type: 'dice', url: dice.listUrls[0], dice } : null;
  }

  if (company.api_provider === 'remoteineurope' || /https?:\/\/(?:www\.)?remoteineurope\.com\/(?:categories\/[^/?#]+|job\/[^/?#]+|$)/.test(company.api || company.careers_url || '')) {
    const remoteineurope = getRemoteInEuropeConfig(company);
    return remoteineurope ? { type: 'remoteineurope', url: remoteineurope.listUrls[0], remoteineurope } : null;
  }

  if (company.api_provider === 'rustjobs' || /https?:\/\/(?:www\.)?rustjobs\.dev(?:\/locations\/[^/?#]+)?(?:[/?#]|$)/.test(company.api || company.careers_url || '')) {
    const rustjobs = getRustJobsConfig(company);
    return rustjobs ? { type: 'rustjobs', url: rustjobs.listUrls[0], rustjobs } : null;
  }

  if (company.api_provider === 'nodesk' || /https?:\/\/(?:www\.)?nodesk\.co\/remote-jobs(?:\/|$)/.test(company.api || company.careers_url || '')) {
    const nodesk = getNodeskConfig(company);
    return { type: 'nodesk', url: company.api || company.careers_url || 'https://nodesk.co/remote-jobs/', nodesk };
  }

  // Greenhouse: explicit api field
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: assertGreenhouseUrl(company.api) };
  }

  const url = company.careers_url || '';

  // Ashby
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  // Lever
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  // Greenhouse EU boards
  const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghEuMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: assertGreenhouseUrl(`https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`),
    };
  }

  return null;
}

// ── API parsers ─────────────────────────────────────────────────────

function parseGreenhouse(json, company) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: company.name,
    location: j.location?.name || '',
  }));
}

function parseAshby(json, company) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: company.name,
    location: j.location || '',
  }));
}

function parseLever(json, company) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: company.name,
    location: j.categories?.location || '',
  }));
}

function parsePcsxPosition(position, company) {
  const origin = company._api?.pcsx?.origin || getUrlOrigin(company.careers_url) || getUrlOrigin(company.api) || 'https://apply.careers.microsoft.com';
  const locations = Array.isArray(position.locations)
    ? position.locations.filter(Boolean)
    : (position.location ? [position.location] : []);

  return {
    title: position.name || '',
    url: position.publicUrl || new URL(position.positionUrl || `/careers/job/${position.id}`, origin).toString(),
    company: company.name,
    location: locations.join(' | '),
    positionId: position.id || null,
    externalId: position.displayJobId || position.atsJobId || '',
    department: position.department || '',
    postedTs: position.postedTs || null,
    workLocationOption: position.workLocationOption || '',
    locationFlexibility: position.locationFlexibility || null,
    jobDescription: position.jobDescription || '',
    queriedLocation: position.location || '',
  };
}

function parsePcsx(json, company) {
  const positions = json.data?.positions || [];
  return positions.map(position => parsePcsxPosition(position, company));
}

function stripCdata(value) {
  return String(value || '')
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '');
}

function extractXmlTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}(?:\s[^>]*)?>([\\s\\S]*?)<\/${tagName}>`));
  return match ? stripCdata(match[1]) : '';
}

function extractLandingJobsAuthor(block) {
  const authorBlock = extractXmlTag(block, 'author');
  return authorBlock ? cleanHtmlText(extractXmlTag(authorBlock, 'name')) : '';
}

function cleanFeedText(value) {
  const cleaned = cleanHtmlText(stripCdata(value));
  return cleaned === 'false' ? '' : cleaned;
}

function extractMetaContent(html, attribute, name) {
  const escapedName = escapeRegExp(name);
  const match = html.match(new RegExp(`<meta[^>]+${attribute}=["']${escapedName}["'][^>]+content=["']([\s\S]*?)["'][^>]*>`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([\s\S]*?)["'][^>]+${attribute}=["']${escapedName}["'][^>]*>`, 'i'));
  return match ? decodeHtmlEntities(match[1]) : '';
}

function parseLandingJobsDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildEuRemoteJobsFeedPageUrl(url, pageNumber) {
  const feedUrl = new URL(url);
  if (pageNumber <= 1) {
    feedUrl.searchParams.delete('paged');
  } else {
    feedUrl.searchParams.set('paged', String(pageNumber));
  }
  return feedUrl.toString();
}

function extractEuRemoteJobsFirstParagraph(content) {
  const match = content.match(/<p>([\s\S]*?)<\/p>/i);
  return match ? cleanHtmlText(match[1]) : '';
}

function extractEuRemoteJobsCompanyFromText(text, title = '') {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return '';

  const stopPattern = '(?=\\s+(?:Location|Employment Type|Location Type|Department|Compensation):|[.,]|\\s+based\\b|\\s+located\\b|\\s+within\\b|\\s+to\\s+join\\b|$)';

  const patterns = [
    title ? new RegExp(`^${escapeRegExp(title)}\\s+at\\s+(.+?)${stopPattern}`, 'i') : null,
    /^([^.,|]+?)\s+is\s+(?:hiring|looking for)\b/i,
    new RegExp(`^.+?\\s+position\\s+at\\s+(.+?)${stopPattern}`, 'i'),
    new RegExp(`^.+?\\s+role\\s+at\\s+(.+?)${stopPattern}`, 'i'),
    new RegExp(`^.+?\\s+at\\s+(.+?)${stopPattern}`, 'i'),
  ].filter(Boolean);

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const company = normalizeWhitespace(match?.[1] || '');
    if (company) return company;
  }

  return '';
}

function extractEuRemoteJobsCompany(content) {
  const match = content.match(/<p><strong>(?:Company|Employer):<\/strong>\s*([\s\S]*?)<\/p>/i);
  if (match) return cleanHtmlText(match[1]);
  return extractEuRemoteJobsCompanyFromText(extractEuRemoteJobsFirstParagraph(content));
}

function extractEuRemoteJobsLocation(content) {
  const match = content.match(/<p><strong>Location:\s*<\/strong>\s*([\s\S]*?)<\/p>/i);
  return match ? cleanHtmlText(match[1]) : '';
}

function parseEuRemoteJobsDetailPage(html, fallbackTitle = '') {
  const metaDescription = extractMetaContent(html, 'name', 'description')
    || extractMetaContent(html, 'property', 'og:description');
  const companyLinkMatch = html.match(/<a[^>]+href=["']https?:\/\/(?:www\.)?euremotejobs\.com\/company\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
  const company = cleanHtmlText(companyLinkMatch?.[1] || '')
    || extractEuRemoteJobsCompanyFromText(metaDescription, fallbackTitle);
  const locationMatch = html.match(/<a[^>]+href=["']https?:\/\/maps\.google\.com\/maps\?q=[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);

  return {
    company,
    location: cleanHtmlText(locationMatch?.[1] || ''),
    jobDescription: metaDescription,
  };
}

function parseEuRemoteJobsFeed(xml) {
  const jobs = [];

  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const item = match[1];
    const title = cleanFeedText(extractXmlTag(item, 'title'));
    const url = cleanFeedText(extractXmlTag(item, 'link'));
    const content = stripCdata(extractXmlTag(item, 'content:encoded')) || stripCdata(extractXmlTag(item, 'description'));
    const company = extractEuRemoteJobsCompany(content) || extractEuRemoteJobsCompanyFromText(cleanFeedText(extractXmlTag(item, 'description')), title);

    if (!title || !url) continue;

    jobs.push({
      title,
      url,
      company: company || 'EU Remote Jobs',
      location: extractEuRemoteJobsLocation(content),
      publishedAt: cleanFeedText(extractXmlTag(item, 'pubDate')),
      jobDescription: cleanFeedText(content),
    });
  }

  return jobs;
}

async function fetchEuRemoteJobsJobDetails(job) {
  const html = await fetchText(job.url);
  const detail = parseEuRemoteJobsDetailPage(html, job.title);

  return {
    ...job,
    company: detail.company || job.company,
    location: detail.location || job.location,
    jobDescription: job.jobDescription || detail.jobDescription,
  };
}

function normalizeLandingJobsRemotePolicy(value) {
  const key = normalizeSearchKey(value);

  for (const [canonical, aliases] of Object.entries(LANDINGJOBS_REMOTE_POLICY_ALIASES)) {
    if (aliases.includes(key)) return canonical;
  }

  return key;
}

function matchesLandingJobsFilter(requestedValues, candidate) {
  if (!requestedValues || requestedValues.length === 0) return true;
  const candidateKey = normalizeSearchKey(candidate);
  if (!candidateKey) return false;

  return requestedValues.some(value => {
    const filterKey = normalizeSearchKey(value);
    return filterKey && (candidateKey === filterKey || candidateKey.includes(filterKey) || filterKey.includes(candidateKey));
  });
}

function matchesLandingJobsRemotePolicy(requestedValues, policy) {
  if (!requestedValues || requestedValues.length === 0) return true;
  const candidate = normalizeLandingJobsRemotePolicy(policy);
  if (!candidate) return false;

  return requestedValues.some(value => normalizeLandingJobsRemotePolicy(value) === candidate);
}

function matchesLandingJobsQuery(queries, job) {
  if (!queries || queries.length === 0) return true;

  const haystack = normalizeSearchText([
    job.title,
    job.company,
    job.category,
    job.location,
    job.remotePolicy,
    job.jobDescription,
  ].filter(Boolean).join(' '));

  return queries.some(query => haystack.includes(normalizeSearchText(query)));
}

function isWithinDays(value, maxAgeDays) {
  if (!maxAgeDays) return true;
  const date = parseLandingJobsDate(value);
  if (!date) return false;

  const diffMs = Date.now() - date.getTime();
  return diffMs <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function parseLandingJobsFeed(xml) {
  const jobs = [];

  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1];
    const url = cleanFeedText(extractXmlTag(entry, 'id')) || cleanFeedText(extractXmlTag(entry, 'link'));
    const title = cleanFeedText(extractXmlTag(entry, 'title'));
    const company = extractLandingJobsAuthor(entry);

    if (!url || !title || !company) continue;

    const city = cleanFeedText(extractXmlTag(entry, 'lj:city'));
    const country = cleanFeedText(extractXmlTag(entry, 'lj:country'));
    const remotePolicy = cleanFeedText(extractXmlTag(entry, 'lj:remote_policy'));
    const location = [city, country, remotePolicy].filter(Boolean).join(' | ');

    jobs.push({
      title,
      url,
      company,
      location,
      city,
      country,
      category: cleanFeedText(extractXmlTag(entry, 'lj:category')),
      jobType: cleanFeedText(extractXmlTag(entry, 'lj:job_type')),
      salary: cleanFeedText(extractXmlTag(entry, 'lj:salary')),
      remotePolicy,
      publishedAt: cleanFeedText(extractXmlTag(entry, 'published')),
      updatedAt: cleanFeedText(extractXmlTag(entry, 'updated')),
      expiresAt: cleanFeedText(extractXmlTag(entry, 'lj:expires_at')),
      jobDescription: cleanFeedText(extractXmlTag(entry, 'content')),
    });
  }

  return jobs;
}

function formatDevITJobsFamilyNumber(value, separator = ',') {
  if (!Number.isFinite(value)) return '';
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

function formatDevITJobsFamilySalary(job, currency = {}) {
  const from = Number(job.annualSalaryFrom);
  const to = Number(job.annualSalaryTo);
  const hasFrom = Number.isFinite(from) && from > 0;
  const hasTo = Number.isFinite(to) && to > 0;
  const symbol = currency.symbol || '';
  const separator = currency.separator || ',';
  const spaceBetween = currency.spaceBetween !== false;
  const prefix = symbol ? `${symbol}${spaceBetween ? ' ' : ''}` : '';
  const formatValue = value => `${prefix}${formatDevITJobsFamilyNumber(value, separator)}`;

  if (hasFrom && hasTo) {
    return `${formatValue(from)} - ${formatDevITJobsFamilyNumber(to, separator)}`;
  }

  if (hasFrom) return formatValue(from);
  if (hasTo) return formatValue(to);
  return '';
}

function formatDevITJobsFamilyLocation(job) {
  const city = normalizeWhitespace(String(job.actualCity || ''));
  const cityCategory = normalizeWhitespace(String(job.cityCategory || ''));
  const workplace = normalizeWhitespace(String(job.workplace || ''));
  return [...new Set([city || cityCategory, workplace].filter(Boolean))].join(' | ');
}

function parseDevITJobsFamilyJobs(json, company) {
  if (!Array.isArray(json)) return [];

  const providerConfig = company._api?.devitjobs || getDevITJobsFamilyConfig(company);
  const baseUrl = providerConfig?.baseUrl || getDevITJobsFamilyBaseUrl(company);
  const currency = providerConfig?.currency || getDevITJobsFamilyCurrencyConfig(baseUrl);

  return json
    .map(job => {
      const slug = normalizeWhitespace(String(job.jobUrl || ''));
      const title = normalizeWhitespace(String(job.name || ''));
      const company = normalizeWhitespace(String(job.company || ''));

      if (!slug || !title || !company || job.isPaused || job.isDisabledOrOutdated) {
        return null;
      }

      return {
        title,
        url: new URL(`/jobs/${slug}`, baseUrl).toString(),
        company,
        location: formatDevITJobsFamilyLocation(job),
        actualCity: normalizeWhitespace(String(job.actualCity || '')),
        cityCategory: normalizeWhitespace(String(job.cityCategory || '')),
        workplace: normalizeWhitespace(String(job.workplace || '')),
        language: normalizeWhitespace(String(job.language || '')),
        visaSponsorship: normalizeWhitespace(String(job.hasVisaSponsorship || '')),
        employmentType: normalizeWhitespace(String(job.jobType || '')),
        experienceLevel: normalizeWhitespace(String(job.expLevel || '')),
        techCategory: normalizeWhitespace(String(job.techCategory || '')),
        metaCategory: normalizeWhitespace(String(job.metaCategory || '')),
        companyType: normalizeWhitespace(String(job.companyType || '')),
        companySize: normalizeWhitespace(String(job.companySize || '')),
        technologies: Array.isArray(job.technologies)
          ? [...new Set(job.technologies.map(value => normalizeWhitespace(String(value || ''))).filter(Boolean))]
          : [],
        filterTags: Array.isArray(job.filterTags)
          ? [...new Set(job.filterTags.map(value => normalizeWhitespace(String(value || ''))).filter(Boolean))]
          : [],
        salary: formatDevITJobsFamilySalary(job, currency),
        publishedAt: String(job.activeFrom || ''),
        applyUrl: normalizeWhitespace(String(job.redirectJobUrl || '')),
        candidateContactWay: normalizeWhitespace(String(job.candidateContactWay || '')),
      };
    })
    .filter(Boolean);
}

function matchesDevITJobsFamilyQuery(queries, job) {
  if (!queries || queries.length === 0) return true;

  const haystack = normalizeSearchText([
    job.title,
    job.company,
    job.location,
    job.actualCity,
    job.cityCategory,
    job.workplace,
    job.language,
    job.visaSponsorship,
    job.employmentType,
    job.experienceLevel,
    job.techCategory,
    job.metaCategory,
    job.companyType,
    job.companySize,
    job.technologies.join(' '),
    job.filterTags.join(' '),
  ].filter(Boolean).join(' '));

  return queries.some(query => haystack.includes(normalizeSearchText(query)));
}

function matchesDevITJobsFamilyTechnologies(requestedValues, job) {
  if (!requestedValues || requestedValues.length === 0) return true;
  const values = [...job.technologies, ...job.filterTags];
  if (values.length === 0) return false;

  return requestedValues.some(value => values.some(candidate => matchesLandingJobsFilter([value], candidate)));
}

function filterDevITJobsFamilyJobs(jobs, filters) {
  return jobs.filter(job => (
    matchesDevITJobsFamilyQuery(filters?.q, job)
    && matchesLandingJobsFilter(filters?.city, job.actualCity)
    && matchesLandingJobsFilter(filters?.cityCategory, job.cityCategory)
    && matchesLandingJobsFilter(filters?.workplace, job.workplace)
    && matchesLandingJobsFilter(filters?.language, job.language)
    && matchesLandingJobsFilter(filters?.visaSponsorship, job.visaSponsorship)
    && matchesLandingJobsFilter(filters?.jobType, job.employmentType)
    && matchesLandingJobsFilter(filters?.expLevel, job.experienceLevel)
    && matchesLandingJobsFilter(filters?.techCategory, job.techCategory)
    && matchesLandingJobsFilter(filters?.metaCategory, job.metaCategory)
    && matchesLandingJobsFilter(filters?.companyType, job.companyType)
    && matchesLandingJobsFilter(filters?.companySize, job.companySize)
    && matchesDevITJobsFamilyTechnologies(filters?.technologies, job)
    && isWithinDays(job.publishedAt, filters?.publishedWithinDays)
  ));
}

function parseWorkingNomadsJobs(json) {
  if (!Array.isArray(json)) return [];

  return json
    .map(job => {
      const title = normalizeWhitespace(String(job.title || ''));
      const url = String(job.url || '').trim();
      const company = normalizeWhitespace(String(job.company_name || ''));

      if (!title || !url || !company) {
        return null;
      }

      return {
        title,
        url,
        company,
        location: normalizeWhitespace(String(job.location || '')),
        category: normalizeWhitespace(String(job.category_name || '')),
        publishedAt: String(job.pub_date || ''),
        tags: splitCommaSeparatedValues(job.tags),
        jobDescription: cleanHtmlText(String(job.description || '')),
      };
    })
    .filter(Boolean);
}

function matchesWorkingNomadsQuery(queries, job) {
  if (!queries || queries.length === 0) return true;

  const haystack = normalizeSearchText([
    job.title,
    job.company,
    job.location,
    job.category,
    job.tags.join(' '),
    job.jobDescription,
  ].filter(Boolean).join(' '));

  return queries.some(query => haystack.includes(normalizeSearchText(query)));
}

function matchesWorkingNomadsTagFilter(requestedValues, tags) {
  if (!requestedValues || requestedValues.length === 0) return true;
  if (!Array.isArray(tags) || tags.length === 0) return false;

  return requestedValues.some(value => tags.some(tag => matchesLandingJobsFilter([value], tag)));
}

function filterWorkingNomadsJobs(jobs, filters) {
  return jobs.filter(job => (
    matchesWorkingNomadsQuery(filters?.q, job)
    && matchesLandingJobsFilter(filters?.category, job.category)
    && matchesLandingJobsFilter(filters?.location, job.location)
    && matchesWorkingNomadsTagFilter(filters?.tags, job.tags)
    && isWithinDays(job.publishedAt, filters?.publishedWithinDays)
  ));
}

function filterLandingJobsJobs(jobs, filters) {
  return jobs.filter(job => (
    matchesLandingJobsQuery(filters?.q, job)
    && matchesLandingJobsFilter(filters?.category, job.category)
    && matchesLandingJobsRemotePolicy(filters?.remotePolicy, job.remotePolicy)
    && matchesLandingJobsFilter(filters?.country, job.country)
    && matchesLandingJobsFilter(filters?.city, job.city)
    && matchesLandingJobsFilter(filters?.jobType, job.jobType)
    && isWithinDays(job.publishedAt, filters?.publishedWithinDays)
    && isWithinDays(job.updatedAt, filters?.updatedWithinDays)
  ));
}

function buildItjobsPageUrl(url, pageNumber) {
  const pageUrl = new URL(url);
  if (pageNumber <= 1) {
    pageUrl.searchParams.delete('page');
  } else {
    pageUrl.searchParams.set('page', String(pageNumber));
  }
  return pageUrl.toString();
}

function extractItjobsDetails(itemHtml) {
  const detailsMatch = itemHtml.match(/<div class="list-details">([\s\S]*?)<\/div>/);
  if (!detailsMatch) return '';
  return splitHtmlSegments(detailsMatch[1]).join(' | ');
}

function parseItjobsPage(html, sourceUrl, seenUrls) {
  const origin = new URL(sourceUrl).origin;
  const jobs = [];

  const jobPattern = /<div class="list-title">\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/div>\s*<div class="list-name">\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/div>\s*<div class="list-details">([\s\S]*?)<\/div>/g;

  for (const match of html.matchAll(jobPattern)) {
    const url = new URL(decodeHtmlEntities(match[1]), origin).toString();
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    jobs.push({
      title: cleanHtmlText(match[2]),
      url,
      company: cleanHtmlText(match[3]),
      location: splitHtmlSegments(match[4]).join(' | '),
    });
  }

  return jobs;
}

function getItjobsPageCount(html) {
  let maxPage = 1;
  for (const match of html.matchAll(/[?&]page=(\d+)/g)) {
    maxPage = Math.max(maxPage, Number(match[1]));
  }
  return maxPage;
}

function buildSapoPageUrl(url, pageNumber) {
  const pageUrl = new URL(url);
  if (pageNumber <= 1) {
    pageUrl.searchParams.delete('pagina');
  } else {
    pageUrl.searchParams.set('pagina', String(pageNumber));
  }
  return pageUrl.toString();
}

function buildPortalEmpregoPageUrl(url, pageNumber) {
  const pageUrl = new URL(url);
  let pathname = pageUrl.pathname.replace(/\/pagina-\d+\/?$/, '/');
  if (!pathname.endsWith('/')) pathname += '/';

  pageUrl.pathname = pageNumber <= 1 ? pathname : `${pathname}pagina-${pageNumber}/`;
  return pageUrl.toString();
}

function decodeJsSingleQuotedString(value) {
  return value
    .replace(/\\\//g, '/')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function extractSapoBinding(html, bindingName) {
  const match = html.match(new RegExp(`:${bindingName}='((?:\\\\.|[^'])*)'`));
  if (!match) return null;

  try {
    return JSON.parse(decodeJsSingleQuotedString(match[1]));
  } catch {
    return null;
  }
}

function parseSapoOffer(offer, company) {
  const title = cleanHtmlText(offer.offer_name || offer.title || '');
  const url = offer.link || '';
  const companyName = cleanHtmlText(offer.company_name || company.name || '');

  if (!title || !url || !companyName || offer.is_image_highlight) {
    return null;
  }

  const locationParts = [offer.location, offer.job_district, offer.job_work_hours]
    .map(value => cleanHtmlText(String(value || '')))
    .filter(Boolean);

  return {
    title,
    url,
    company: companyName,
    location: [...new Set(locationParts)].join(' | '),
    publicationDate: offer.publication_date || '',
    remoteWork: Boolean(offer.remote_work),
  };
}

function parseSapoPage(html, company, seenUrls) {
  const offers = extractSapoBinding(html, 'offers') || [];
  const jobs = [];

  for (const offer of offers) {
    const parsed = parseSapoOffer(offer, company);
    if (!parsed) continue;
    if (seenUrls.has(parsed.url)) continue;
    seenUrls.add(parsed.url);
    jobs.push(parsed);
  }

  return jobs;
}

function extractPortalEmpregoField(itemHtml, className) {
  const match = itemHtml.match(new RegExp(`<span class="${className}(?: [^"]*)?"[^>]*>([\\s\\S]*?)<\\/span>`));
  return match ? cleanHtmlText(match[1]) : '';
}

function parsePortalEmpregoPage(html, sourceUrl, seenUrls) {
  const origin = new URL(sourceUrl).origin;
  const jobs = [];
  const listHtml = html.match(/<div id="listCont" class="jobs">([\s\S]*?)(?:<nav>|<script type="application\/ld\+json">|<footer|$)/)?.[1] || html;
  const jobPattern = /<a class="d-flex" href="([^"]*\/emprego\/[^\"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  for (const match of listHtml.matchAll(jobPattern)) {
    const url = new URL(decodeHtmlEntities(match[1]), origin).toString();
    if (seenUrls.has(url)) continue;

    const itemHtml = match[2];
    const title = cleanHtmlText(itemHtml.match(/<div class="title">[\s\S]*?<h5>([\s\S]*?)<\/h5>/)?.[1] || '');
    const companyName = extractPortalEmpregoField(itemHtml, 'company');

    if (!title || !companyName) continue;

    seenUrls.add(url);

    const location = [
      extractPortalEmpregoField(itemHtml, 'city'),
      extractPortalEmpregoField(itemHtml, 'type'),
    ].filter(Boolean).join(' | ');

    jobs.push({
      title,
      url,
      company: companyName,
      location,
      publicationDate: extractPortalEmpregoField(itemHtml, 'postedDate'),
    });
  }

  return jobs;
}

function getPortalEmpregoPageCount(html) {
  let maxPage = 1;
  for (const match of html.matchAll(/\/pagina-(\d+)\/?/g)) {
    maxPage = Math.max(maxPage, Number(match[1]));
  }
  return maxPage;
}

function getSapoPageCount(html) {
  const pagination = extractSapoBinding(html, 'pagination');
  const total = Number(pagination?.total || pagination?.offers_total || 0);
  const size = Number(pagination?.size || 0);
  const currentPage = Number(pagination?.page || 1) || 1;

  if (total > 0 && size > 0) {
    return Math.max(currentPage, Math.ceil(total / size));
  }

  return currentPage;
}

function buildDicePageUrl(url, pageNumber, pageSize) {
  const pageUrl = new URL(url);
  pageUrl.searchParams.set('page', String(pageNumber));
  pageUrl.searchParams.set('pageSize', String(pageSize));

  if (!pageUrl.searchParams.has('includeRemote')) {
    pageUrl.searchParams.set('includeRemote', 'true');
  }
  if (!pageUrl.searchParams.has('recommendations')) {
    pageUrl.searchParams.set('recommendations', 'true');
  }
  if (!pageUrl.searchParams.has('fj')) {
    pageUrl.searchParams.set('fj', 'true');
  }
  if (!pageUrl.searchParams.has('radiusUnit')) {
    pageUrl.searchParams.set('radiusUnit', 'mi');
  }
  if (!pageUrl.searchParams.has('filters.workplaceTypes')) {
    pageUrl.searchParams.set('filters.workplaceTypes', '');
  }

  return pageUrl.toString();
}

function decodeJsStringLiteral(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return null;
  }
}

function extractJsonObject(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = startIndex; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractEmbeddedAssignmentObject(html, variableName) {
  const match = new RegExp(`${escapeRegExp(variableName)}\\s*=\\s*\\{`).exec(html);
  if (!match) return null;

  const objectStart = html.indexOf('{', match.index);
  if (objectStart === -1) return null;

  const objectText = extractJsonObject(html, objectStart);
  if (!objectText) return null;

  try {
    return JSON.parse(objectText);
  } catch {
    return null;
  }
}

function extractDiceJobList(html) {
  const decodedFlight = Array.from(html.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g))
    .map(match => decodeJsStringLiteral(match[1]))
    .filter(Boolean)
    .join('');

  const marker = '"jobList":';
  const markerIndex = decodedFlight.indexOf(marker);
  if (markerIndex === -1) return null;

  const objectStart = decodedFlight.indexOf('{', markerIndex + marker.length);
  if (objectStart === -1) return null;

  const objectText = extractJsonObject(decodedFlight, objectStart);
  if (!objectText) return null;

  try {
    return JSON.parse(objectText);
  } catch {
    return null;
  }
}

function formatDiceLocation(job) {
  const displayName = normalizeWhitespace(String(job.jobLocation?.displayName || '').replace(/,\s*USA$/, ''));
  const workplaceTypes = Array.isArray(job.workplaceTypes)
    ? job.workplaceTypes.map(value => normalizeWhitespace(String(value || ''))).filter(Boolean)
    : [];

  return [...new Set([...workplaceTypes, displayName].filter(Boolean))].join(' | ');
}

function parseDiceJob(job, seenUrls) {
  const url = job.detailsPageUrl || '';
  const title = normalizeWhitespace(String(job.title || ''));
  const company = normalizeWhitespace(String(job.companyName || ''));

  if (!url || !title || !company || seenUrls.has(url)) {
    return null;
  }

  seenUrls.add(url);

  return {
    title,
    url,
    company,
    location: formatDiceLocation(job),
    salary: normalizeWhitespace(String(job.salary || '')),
    employmentType: normalizeWhitespace(String(job.employmentType || '')),
    easyApply: Boolean(job.easyApply),
    employerType: normalizeWhitespace(String(job.employerType || '')),
    postedDate: job.postedDate || '',
    jobDescription: normalizeWhitespace(String(job.summary || '')),
  };
}

function buildRemoteInEuropePageUrl(url, pageNumber) {
  const pageUrl = new URL(url);

  if (pageNumber <= 1) {
    for (const key of [...pageUrl.searchParams.keys()]) {
      if (/_page$/.test(key)) pageUrl.searchParams.delete(key);
    }
  } else if (!Array.from(pageUrl.searchParams.keys()).some(key => /_page$/.test(key))) {
    pageUrl.searchParams.set('b31548a3_page', String(pageNumber));
  } else {
    for (const key of [...pageUrl.searchParams.keys()]) {
      if (/_page$/.test(key)) pageUrl.searchParams.set(key, String(pageNumber));
    }
  }

  return pageUrl.toString();
}

function getRemoteInEuropePageCount(html) {
  const pageCountMatch = html.match(/class="w-page-count[^"]*">\s*(\d+)\s*\/\s*(\d+)\s*</i);
  if (pageCountMatch) {
    return Number(pageCountMatch[2]) || 1;
  }

  let maxPage = 1;
  for (const match of html.matchAll(/[?&][^\s"'>]*?_page=(\d+)/g)) {
    maxPage = Math.max(maxPage, Number(match[1]));
  }
  return maxPage;
}

function parseRemoteInEuropePage(html, sourceUrl, seenUrls) {
  const origin = new URL(sourceUrl).origin;
  const jobs = [];
  const jobPattern = /<a[^>]+href="(\/job\/[^"#?]+)"[^>]+class="card job w-inline-block[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(jobPattern)) {
    const path = match[1] || '';
    const itemHtml = match[2];
    const company = cleanHtmlText(itemHtml.match(/<div fs-cmsfilter-field="company" class="card-link homepage">([\s\S]*?)<\/div>/i)?.[1] || '');
    const title = cleanHtmlText(itemHtml.match(/<h3[^>]+fs-cmsfilter-field="job-title"[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '');

    if (!path || !company || !title) continue;

    const url = new URL(path, origin).toString();
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    jobs.push({
      title,
      url,
      company,
      location: cleanHtmlText(itemHtml.match(/<div[^>]+class="short-location">([\s\S]*?)<\/div>/i)?.[1] || ''),
      category: cleanHtmlText(itemHtml.match(/<div[^>]+class="category-filter">([\s\S]*?)<\/div>/i)?.[1] || ''),
      publishedAt: cleanHtmlText(itemHtml.match(/<div class="date-text">([\s\S]*?)<\/div>/i)?.[1] || itemHtml.match(/<div class="date-text-mobile">([\s\S]*?)<\/div>/i)?.[1] || ''),
    });
  }

  return jobs;
}

function extractRemoteInEuropeHiddenField(html, id) {
  const match = html.match(new RegExp(`<div id="${escapeRegExp(id)}">([\\s\\S]*?)<\\/div>`, 'i'));
  return match ? decodeHtmlEntities(match[1]) : '';
}

function parseRemoteInEuropeDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function stripMarkdownFormatting(value) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(value || '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1')
        .replace(/[*_`>#]+/g, ' ')
    )
  );
}

function canonicalizeEnglishJobsClickout(url) {
  const parsed = new URL(url);
  return new URL(parsed.pathname, parsed.origin).toString();
}

function getEnglishJobsPageCount(markdown) {
  let maxPage = 1;

  for (const match of markdown.matchAll(/[?&]page=(\d+)/g)) {
    maxPage = Math.max(maxPage, Number(match[1]));
  }

  return maxPage;
}

function buildEnglishJobsPageUrl(url, pageNumber) {
  const pageUrl = new URL(url);
  pageUrl.searchParams.set('format', 'markdown');

  if (pageNumber <= 1) {
    pageUrl.searchParams.delete('page');
  } else {
    pageUrl.searchParams.set('page', String(pageNumber));
  }

  return pageUrl.toString();
}

function parseEnglishJobsPage(markdown, sourceUrl, seenUrls) {
  const jobs = [];
  const origin = new URL(sourceUrl).origin;
  const lines = markdown.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/^\[### ([\s\S]+?)\]\((\/clickout\/[^)]+)\)$/);
    if (!match) continue;

    const title = stripMarkdownFormatting(match[1]);
    const clickoutUrl = new URL(match[2], origin).toString();
    const canonicalUrl = canonicalizeEnglishJobsClickout(clickoutUrl);

    if (!title || seenUrls.has(canonicalUrl)) {
      continue;
    }

    seenUrls.add(canonicalUrl);
    seenUrls.add(clickoutUrl);

    let company = '';
    let location = '';
    let postedDate = '';
    const descriptionLines = [];

    let j = i + 1;
    for (; j < lines.length; j++) {
      const nextLine = lines[j].trim();

      if (!nextLine) continue;
      if (/^\[### /.test(nextLine)) break;
      if (nextLine === 'report probem') {
        j += 1;
        break;
      }

      if (nextLine.startsWith('* ')) {
        const value = stripMarkdownFormatting(nextLine.slice(2));
        if (!value) continue;

        if (!company) {
          company = value;
        } else if (!location) {
          location = value;
        } else if (!postedDate) {
          postedDate = value;
        } else {
          descriptionLines.push(value);
        }
        continue;
      }

      if (!/^Email me future jobs like these/.test(nextLine)) {
        const value = stripMarkdownFormatting(nextLine);
        if (value) descriptionLines.push(value);
      }
    }

    i = j - 1;

    if (!company) continue;

    jobs.push({
      title,
      url: canonicalUrl,
      sourceUrl: clickoutUrl,
      company,
      location,
      postedDate,
      publishedAt: postedDate,
      jobDescription: descriptionLines.join(' '),
    });
  }

  return jobs;
}

function getJobsInEnglishPageCount(html) {
  let maxPage = 1;

  for (const match of html.matchAll(/[?&]page=(\d+)/g)) {
    maxPage = Math.max(maxPage, Number(match[1]));
  }

  return maxPage;
}

function buildJobsInEnglishPageUrl(url, pageNumber) {
  const pageUrl = new URL(url);

  if (pageNumber <= 1) {
    pageUrl.searchParams.delete('page');
  } else {
    pageUrl.searchParams.set('page', String(pageNumber));
  }

  return pageUrl.toString();
}

function parseJobsInEnglishPage(html, sourceUrl, seenUrls) {
  const origin = new URL(sourceUrl).origin;
  const jobs = [];
  const listHtml = html.match(/<div id="ad-list-and-pagination">([\s\S]*?)(?:<footer|$)/i)?.[1] || html;
  const jobPattern = /<a href="(\/ads\/[^\"]+)" class="block group">([\s\S]*?)<\/a>/g;

  for (const match of listHtml.matchAll(jobPattern)) {
    const url = new URL(decodeHtmlEntities(match[1]), origin).toString();
    if (seenUrls.has(url)) continue;

    const itemHtml = match[2];
    const title = cleanHtmlText(itemHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '');
    const company = cleanHtmlText(itemHtml.match(/<p[^>]*class="[^"]*text-sm[^"]*text-gray-(?:500|600)[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');

    if (!title || !company) continue;

    seenUrls.add(url);

    jobs.push({
      title,
      url,
      sourceUrl: url,
      company,
      location: cleanHtmlText(itemHtml.match(/<div class="inline-flex items-center gap-1\.5[^"]*">([\s\S]*?)<\/div>/i)?.[1] || ''),
      category: cleanHtmlText(itemHtml.match(/<span[^>]*class="[^"]*text-xs[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ''),
      postedDate: cleanHtmlText(itemHtml.match(/<span class="text-xs text-gray-400">([\s\S]*?)<\/span>/i)?.[1] || ''),
      publishedAt: cleanHtmlText(itemHtml.match(/<span class="text-xs text-gray-400">([\s\S]*?)<\/span>/i)?.[1] || ''),
    });
  }

  return jobs;
}

function buildDevJobsDePageUrl(url, pageNumber) {
  const pageUrl = new URL(url);

  if (pageNumber <= 1) {
    pageUrl.searchParams.delete('page');
  } else {
    pageUrl.searchParams.set('page', String(pageNumber));
  }

  return pageUrl.toString();
}

function isDevJobsDeSalary(value) {
  return /(?:\d[\d.,]*k?\s*-\s*\d[\d.,]*k?\s*(?:€|EUR|CHF|GBP)|\d[\d.,]*\s*(?:€|EUR|CHF|GBP))/i.test(value);
}

function parseDevJobsDeCard(card, seenUrls) {
  const url = String(card?.url || '').trim();
  if (!url || seenUrls.has(url)) {
    return null;
  }

  const lines = String(card?.text || '')
    .split('\n')
    .map(line => normalizeWhitespace(line))
    .filter(Boolean);

  if (lines.length < 3) {
    return null;
  }

  const [title, ...rest] = lines;
  const values = [...rest];

  while (values.length > 0 && ['NEW', 'TOP'].includes(values[0].toUpperCase())) {
    values.shift();
  }

  const company = values.shift() || '';
  const location = values.shift() || '';
  let jobDescription = '';

  if (values.length > 0 && !DEVJOBSDE_WORKING_MODELS.has(values[0]) && !DEVJOBSDE_EMPLOYMENT_TYPES.has(values[0]) && !DEVJOBSDE_EXPERIENCE_LEVELS.has(values[0]) && !/^(?:m\/w\/x|Easy Apply|\+\d+)$/i.test(values[0]) && !isDevJobsDeSalary(values[0])) {
    jobDescription = values.shift() || '';
  }

  const workplace = [];
  const technologies = [];
  let salary = '';
  let employmentType = '';
  let experienceLevel = '';
  let diversity = '';
  let easyApply = false;

  for (const value of values) {
    if (!salary && isDevJobsDeSalary(value)) {
      salary = value;
      continue;
    }

    if (DEVJOBSDE_WORKING_MODELS.has(value)) {
      workplace.push(value);
      continue;
    }

    if (!employmentType && DEVJOBSDE_EMPLOYMENT_TYPES.has(value)) {
      employmentType = value;
      continue;
    }

    if (!experienceLevel && DEVJOBSDE_EXPERIENCE_LEVELS.has(value)) {
      experienceLevel = value;
      continue;
    }

    if (/^m\/w\/x$/i.test(value)) {
      diversity = value;
      continue;
    }

    if (/^easy apply$/i.test(value)) {
      easyApply = true;
      continue;
    }

    if (!/^\+\d+$/.test(value)) {
      technologies.push(value);
    }
  }

  if (!title || !company) {
    return null;
  }

  seenUrls.add(url);

  return {
    title,
    url,
    company,
    location,
    salary,
    workplace: [...new Set(workplace)].join(' | '),
    employmentType,
    experienceLevel,
    diversity,
    easyApply,
    technologies: [...new Set(technologies)],
    jobDescription,
  };
}

async function waitForDevJobsDeSearchResults(page) {
  await page.waitForFunction(() => {
    const title = document.title || '';
    const text = document.body?.innerText || '';

    if (/^Just a moment/i.test(title)) {
      return false;
    }

    if (document.querySelectorAll('a[href^="/job/"] h2').length > 0) {
      return true;
    }

    return /job openings found|Stellenangebote gefunden|Keinen Job gefunden|No jobs found/i.test(text);
  }, null, { timeout: DEVJOBSDE_NAVIGATION_TIMEOUT_MS });
}

async function fetchDevJobsDeSearchPage(page, url, seenUrls) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEVJOBSDE_NAVIGATION_TIMEOUT_MS });
  await waitForDevJobsDeSearchResults(page);

  const cards = await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="/job/"]'))
    .filter(anchor => anchor.querySelector('h2'))
    .map(anchor => ({
      url: anchor.href,
      text: anchor.innerText,
    })));

  return cards
    .map(card => parseDevJobsDeCard(card, seenUrls))
    .filter(Boolean);
}

function buildJobsChPageUrl(url, pageNumber) {
  const pageUrl = new URL(url);

  if (pageNumber <= 1) {
    pageUrl.searchParams.delete('page');
  } else {
    pageUrl.searchParams.set('page', String(pageNumber));
  }

  if (!pageUrl.searchParams.has('term')) {
    pageUrl.searchParams.set('term', '');
  }

  return pageUrl.toString();
}

function buildMakeItInGermanyPageUrl(url, pageNumber) {
  const pageUrl = new URL(url);

  if (pageNumber <= 1) {
    pageUrl.searchParams.delete('tx_solr[page]');
  } else {
    pageUrl.searchParams.set('tx_solr[page]', String(pageNumber));
  }

  return pageUrl.toString();
}

function formatJobsChLocation(job) {
  const place = normalizeWhitespace(String(job.place || ''));
  const regions = Array.isArray(job.regions)
    ? job.regions.map(region => normalizeWhitespace(String(region?.name || region || ''))).filter(Boolean)
    : [];

  return [...new Set([place, ...regions].filter(Boolean))].join(' | ');
}

function parseJobsChJob(job, origin, detailPathTemplate, seenUrls) {
  const id = normalizeWhitespace(String(job.id || ''));
  const title = normalizeWhitespace(String(job.title || ''));
  const company = normalizeWhitespace(String(job.company?.name || ''));

  if (!job?.isActive || !id || !title || !company) {
    return null;
  }

  const url = new URL(detailPathTemplate.replace('{ID}', encodeURIComponent(id)), origin).toString();
  if (seenUrls.has(url)) {
    return null;
  }

  seenUrls.add(url);

  return {
    title,
    url,
    company,
    location: formatJobsChLocation(job),
    postedDate: normalizeWhitespace(String(job.relativeDate || job.relativeDateInitial || '')),
    publishedAt: String(job.publicationDate || job.initialPublicationDate || ''),
    initialPublishedAt: String(job.initialPublicationDate || ''),
  };
}

function parseJobsChSearchPage(html, sourceUrl, seenUrls) {
  const initData = extractEmbeddedAssignmentObject(html, '__INIT__');
  const globalData = extractEmbeddedAssignmentObject(html, '__GLOBAL__') || {};
  const results = initData?.vacancy?.results?.main?.results;

  if (!Array.isArray(results)) {
    throw new Error('Unable to parse jobs.ch embedded results payload');
  }

  const source = new URL(sourceUrl);
  const locale = getJobsChLocaleFromPathname(source.pathname);
  const detailPathTemplate = globalData?.ROUTES?.VACANCY_DETAIL?.[locale] || getJobsChDetailPathTemplate(locale);
  const jobs = [];

  for (const item of results) {
    const parsed = parseJobsChJob(item, source.origin, detailPathTemplate, seenUrls);
    if (parsed) jobs.push(parsed);
  }

  const pageCount = Number(initData?.vacancy?.results?.main?.meta?.numPages || 1);
  return {
    jobs,
    pageCount: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1,
  };
}

function extractMakeItInGermanyLabeledValue(itemHtml, label) {
  const match = itemHtml.match(new RegExp(`<span class="sr-only">\\s*${escapeRegExp(label)}\\s*<\\/span>\\s*<span class="element">([\\s\\S]*?)<\\/span>`, 'i'));
  return match ? cleanHtmlText(match[1]) : '';
}

function getMakeItInGermanyPageCount(html) {
  let maxPage = 1;

  for (const match of html.matchAll(/(?:tx_solr%5Bpage%5D|tx_solr\[page\])=(\d+)/gi)) {
    maxPage = Math.max(maxPage, Number(match[1]));
  }

  return maxPage;
}

function parseMakeItInGermanyPage(html, sourceUrl, seenUrls) {
  const origin = new URL(sourceUrl).origin;
  const jobs = [];
  const listHtml = html.match(/<ul class="list list--jobs">([\s\S]*?)(?:<div class="pagination|<!--TYPO3SEARCH_end|<\/main>|$)/i)?.[1] || html;
  const jobPattern = /<article class="card card--job"[^>]*>([\s\S]*?)<\/article>/gi;

  for (const match of listHtml.matchAll(jobPattern)) {
    const itemHtml = match[1];
    const href = decodeHtmlEntities(itemHtml.match(/<h3 class="h5">[\s\S]*?<a href="([^"]+)"/i)?.[1] || '');
    const title = cleanHtmlText(itemHtml.match(/<h3 class="h5">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '');
    const company = cleanHtmlText(itemHtml.match(/<\/header>\s*<p>\s*([\s\S]*?)\s*<\/p>/i)?.[1] || '');

    if (!href || !title || !company) continue;

    const url = new URL(href, origin).toString();
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const timeMatch = itemHtml.match(/<time class="element" datetime="([^"]+)">([\s\S]*?)<\/time>/i);

    jobs.push({
      title,
      url,
      company,
      location: extractMakeItInGermanyLabeledValue(itemHtml, 'Place of work:'),
      sector: extractMakeItInGermanyLabeledValue(itemHtml, 'Sector:'),
      employmentType: extractMakeItInGermanyLabeledValue(itemHtml, 'Type of job offer:'),
      publishedAt: normalizeWhitespace(timeMatch?.[1] || ''),
      postedDate: cleanHtmlText(timeMatch?.[2] || ''),
    });
  }

  return jobs;
}

function parseRemoteInEuropeDetailPage(html, fallbackJob) {
  const title = cleanHtmlText(html.match(/<h1 class="title">([\s\S]*?)<\/h1>/i)?.[1] || fallbackJob.title || '');
  const company = cleanHtmlText(html.match(/<h3 class="title h4-size card-job-post-sidebar">([\s\S]*?)<\/h3>/i)?.[1] || extractRemoteInEuropeHiddenField(html, 'schema-company') || fallbackJob.company || '');
  const applyUrl = decodeHtmlEntities(
    html.match(/<a[^>]+href="([^"]+)"[^>]+class="button-primary apply-button w-button"/i)?.[1]
    || html.match(/<a[^>]+href="([^"]+)"[^>]+class="button-primary small card-job-post-sidebar w-button"/i)?.[1]
    || ''
  );
  const companyUrl = decodeHtmlEntities(html.match(/<a[^>]+href="([^"]+)"[^>]*class="card-link-wrapper w-inline-block"/i)?.[1] || extractRemoteInEuropeHiddenField(html, 'schema-company-url') || '');
  const location = cleanHtmlText(html.match(/<div class="label-location">([\s\S]*?)<\/div>/i)?.[1] || fallbackJob.location || '');
  const category = cleanHtmlText(html.match(/<a href="\/categories\/[^"#?]+"[^>]*class="job-detail-wrapper w-inline-block"[^>]*>[\s\S]*?<div>([\s\S]*?)<\/div>/i)?.[1] || fallbackJob.category || '');
  const jobType = cleanHtmlText(html.match(/<div class="job-post-type-value">([\s\S]*?)<\/div>/i)?.[1] || '');
  const descriptionHtml = html.match(/<div class="rich-text-block-2 w-richtext">([\s\S]*?)<\/div><div class="apply-div">/i)?.[1] || '';
  const hiddenDescription = extractRemoteInEuropeHiddenField(html, 'schema-desc');

  return {
    title,
    url: applyUrl || fallbackJob.url,
    sourceUrl: fallbackJob.url,
    company,
    location,
    category,
    companyUrl,
    employmentType: jobType,
    publishedAt: parseRemoteInEuropeDate(extractRemoteInEuropeHiddenField(html, 'schema-date')) || fallbackJob.publishedAt || '',
    validThrough: parseRemoteInEuropeDate(extractRemoteInEuropeHiddenField(html, 'schema-valid')),
    jobDescription: cleanHtmlText(descriptionHtml || hiddenDescription),
  };
}

function formatNodeskLocation(job) {
  const values = Array.isArray(job.applicantLocations)
    ? job.applicantLocations.map(location => normalizeWhitespace(String(location?.name || ''))).filter(Boolean)
    : [];
  return [...new Set(values)].join(' | ');
}

function formatNodeskEmploymentTypes(job) {
  const values = Array.isArray(job.employmentTypes)
    ? job.employmentTypes.map(type => normalizeWhitespace(String(type?.name || ''))).filter(Boolean)
    : [];
  return [...new Set(values)].join(' | ');
}

function formatNodeskKeywords(job) {
  return Array.isArray(job.keywords)
    ? [...new Set(job.keywords.map(keyword => normalizeWhitespace(String(keyword?.name || ''))).filter(Boolean))]
    : [];
}

function parseNodeskJob(job, seenUrls) {
  const path = normalizeWhitespace(String(job.permalink || ''));
  const title = normalizeWhitespace(String(job.title || ''));
  const company = normalizeWhitespace(String(job.company?.name || ''));

  if (!path || !title || !company) {
    return null;
  }

  const sourceUrl = new URL(path, 'https://nodesk.co').toString();
  if (seenUrls.has(sourceUrl)) {
    return null;
  }
  seenUrls.add(sourceUrl);

  const salary = normalizeWhitespace(String(job.baseSalary || ''));
  const employmentType = formatNodeskEmploymentTypes(job);
  const keywords = formatNodeskKeywords(job);

  return {
    title,
    url: sourceUrl,
    sourceUrl,
    company,
    location: formatNodeskLocation(job),
    salary,
    employmentType,
    role: normalizeWhitespace(String(job.role?.name || '')),
    keywords,
    postedDate: String(job.datePublished || ''),
    publishedAt: String(job.datePublished || ''),
    relativeDate: normalizeWhitespace(String(job.date || '')),
  };
}

function extractNodeskJobPostingSchema(html) {
  const match = html.match(/<script type=application\/ld\+json>([\s\S]*?)<\/script>/i);
  if (!match) return null;

  try {
    return JSON.parse(decodeHtmlEntities(match[1]));
  } catch {
    return null;
  }
}

function parseNodeskDetailPage(html, fallbackJob) {
  const schema = extractNodeskJobPostingSchema(html) || {};
  const title = cleanHtmlText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || schema.title || fallbackJob.title || '');
  const company = cleanHtmlText(html.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i)?.[1] || schema.hiringOrganization?.name || fallbackJob.company || '');
  const applyUrl = decodeHtmlEntities(
    html.match(/<a[^>]+href="([^"]+)"[^>]*>Apply (?:Now|for this job)<\/a>/i)?.[1]
    || ''
  );
  const salary = cleanHtmlText(html.match(/tracked-wide">([\s\S]*?)<\/p>/i)?.[1] || fallbackJob.salary || '');
  const description = cleanHtmlText(
    html.match(/<section[^>]*class="fr [^"]*">[\s\S]*?<div class=grey-800>([\s\S]*?)<\/div>/i)?.[1]
    || schema.description
    || ''
  );

  return {
    ...fallbackJob,
    title: title || fallbackJob.title,
    url: applyUrl || fallbackJob.url,
    sourceUrl: fallbackJob.sourceUrl || fallbackJob.url,
    company: company || fallbackJob.company,
    salary: salary || fallbackJob.salary || '',
    publishedAt: parseRemoteInEuropeDate(schema.datePosted) || fallbackJob.publishedAt || '',
    validThrough: parseRemoteInEuropeDate(schema.validThrough) || '',
    jobDescription: description,
  };
}

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever, pcsx: parsePcsx };

// ── Fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = {};

    if (/https?:\/\/(?:www\.)?(?:swissdevjobs\.ch|germantechjobs\.de|devitjobs\.uk|devitjobs\.nl)\/api\//.test(url)) {
      const origin = new URL(url).origin;
      headers['user-agent'] = 'Mozilla/5.0';
      headers['accept'] = 'application/json,text/plain,*/*';
      headers['accept-language'] = 'en-US,en;q=0.9';
      headers['referer'] = `${origin}/`;
      headers['origin'] = origin;
    }

    const options = { signal: controller.signal, headers };
    if (/https:\/\/(?:boards-api|boards|job-boards(?:\.eu)?)\.greenhouse\.io\//.test(url)) {
      assertGreenhouseUrl(url);
      options.redirect = 'error';
    }

    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = {};
    if (/https?:\/\/emprego\.sapo\.pt\//.test(url)) {
      headers['user-agent'] = 'Mozilla/5.0';
      headers['accept-language'] = 'pt-PT,pt;q=0.9,en;q=0.8';
    }

    if (/https?:\/\/(?:www\.)?dice\.com\//.test(url)) {
      headers['user-agent'] = 'Mozilla/5.0';
      headers['accept-language'] = 'en-US,en;q=0.9';
    }

    if (/https?:\/\/(?:www\.)?jobs\.ch\//.test(url)) {
      headers['user-agent'] = 'Mozilla/5.0';
      headers['accept-language'] = 'en-US,en;q=0.9';
    }

    if (/https?:\/\/(?:www\.)?make-it-in-germany\.com\//.test(url)) {
      headers['user-agent'] = 'Mozilla/5.0';
      headers['accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
      headers['accept-language'] = 'en-US,en;q=0.9';
      headers['referer'] = 'https://www.make-it-in-germany.com/en/working-in-germany/job-listings';
    }

    if (/https?:\/\/(?:www\.)?nodesk\.co\//.test(url)) {
      headers['user-agent'] = 'Mozilla/5.0';
      headers['accept-language'] = 'en-US,en;q=0.9';
      headers['referer'] = 'https://nodesk.co/remote-jobs/';
      headers['origin'] = 'https://nodesk.co';
    }

    if (/https?:\/\/(?:www\.)?jobsinenglish\.dk\//.test(url)) {
      headers['user-agent'] = 'Mozilla/5.0';
      headers['accept-language'] = 'en-US,en;q=0.9';

      if (/https?:\/\/(?:www\.)?jobsinenglish\.dk\/view_all_ads\//.test(url)) {
        headers['hx-request'] = 'true';
      }
    }

    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPcsxJobs(url, company) {
  const pageUrl = new URL(url);
  const jobs = [];
  let start = Number(pageUrl.searchParams.get('start') || '0');
  let total = Infinity;
  let requests = 0;

  while (jobs.length < total && requests < 500) {
    pageUrl.searchParams.set('start', String(start));

    const json = await fetchJson(pageUrl.toString());
    const pageJobs = parsePcsx(json, company);
    const count = Number(json.data?.count || pageJobs.length);

    total = Number.isFinite(count) && count > 0 ? count : pageJobs.length;
    requests += 1;

    if (pageJobs.length === 0) break;

    jobs.push(...pageJobs);
    start += pageJobs.length;
  }

  return jobs;
}

async function fetchLandingJobsJobs(url, company) {
  const xml = await fetchText(url);
  const jobs = parseLandingJobsFeed(xml);
  return filterLandingJobsJobs(jobs, company._api?.landingjobs?.filters);
}

async function fetchEuRemoteJobsJobs(url, company) {
  const jobs = [];
  const seenUrls = new Set();
  const maxPages = company._api?.euremotejobs?.maxPages || EUREMOTEJOBS_MAX_PAGES;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    const pageUrl = buildEuRemoteJobsFeedPageUrl(url, pageNumber);
    const xml = await fetchText(pageUrl);
    const pageJobs = parseEuRemoteJobsFeed(xml);

    if (pageJobs.length === 0) break;

    let addedOnPage = 0;
    for (const job of pageJobs) {
      if (seenUrls.has(job.url)) continue;
      seenUrls.add(job.url);
      jobs.push(job);
      addedOnPage += 1;
    }

    if (addedOnPage === 0) break;
  }

  const detailConcurrency = Math.max(1, Math.min(EUREMOTEJOBS_DETAIL_CONCURRENCY, jobs.length));
  const tasks = jobs.map(job => async () => {
    if (job.company && job.company !== 'EU Remote Jobs' && job.location) {
      return job;
    }

    try {
      return await fetchEuRemoteJobsJobDetails(job);
    } catch {
      return job;
    }
  });

  return parallelFetch(tasks, detailConcurrency);
}

async function fetchWorkingNomadsJobs(url, company) {
  const json = await fetchJson(url);
  const jobs = parseWorkingNomadsJobs(json);
  return filterWorkingNomadsJobs(jobs, company._api?.workingnomads?.filters);
}

async function fetchDevITJobsFamilyJobs(url, company) {
  const json = await fetchJson(url);
  const jobs = parseDevITJobsFamilyJobs(json, company);
  return filterDevITJobsFamilyJobs(jobs, company._api?.devitjobs?.filters);
}

async function fetchPcsxPositionDetails(company, job) {
  const detailUrl = buildPcsxDetailUrl(company, job.positionId, job.queriedLocation);
  if (!detailUrl) return job;

  const json = await fetchJson(detailUrl);
  const position = json.data || null;

  if (!position) return job;

  return {
    ...job,
    ...parsePcsxPosition(position, company),
  };
}

async function enrichPcsxJobs(company, jobs) {
  if (company.fetch_details === false || jobs.length === 0) {
    return jobs;
  }

  const detailConcurrency = Math.max(1, Math.min(Number(company.detail_concurrency) || PCSX_DETAIL_CONCURRENCY, jobs.length));

  const tasks = jobs.map(job => async () => {
    if (!job.positionId) return job;

    try {
      return await fetchPcsxPositionDetails(company, job);
    } catch {
      return job;
    }
  });

  return parallelFetch(tasks, detailConcurrency);
}

async function fetchItjobsJobs(url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const listUrls = company._api?.itjobs?.listUrls || [url];

  for (const listUrl of listUrls) {
    const firstPageHtml = await fetchText(listUrl);
    const pageCount = getItjobsPageCount(firstPageHtml);
    const maxPages = Math.min(company._api?.itjobs?.maxPages || ITJOBS_MAX_PAGES, pageCount);
    jobs.push(...parseItjobsPage(firstPageHtml, listUrl, seenUrls));

    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
      const html = await fetchText(buildItjobsPageUrl(listUrl, pageNumber));
      jobs.push(...parseItjobsPage(html, listUrl, seenUrls));
    }
  }

  return jobs;
}

async function fetchSapoJobs(url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const listUrls = company._api?.sapo?.listUrls || [url];

  for (const listUrl of listUrls) {
    const firstPageHtml = await fetchText(listUrl);
    const pageCount = getSapoPageCount(firstPageHtml);
    const maxPages = Math.min(company._api?.sapo?.maxPages || SAPO_MAX_PAGES, pageCount);
    jobs.push(...parseSapoPage(firstPageHtml, company, seenUrls));

    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
      const html = await fetchText(buildSapoPageUrl(listUrl, pageNumber));
      jobs.push(...parseSapoPage(html, company, seenUrls));
    }
  }

  return jobs;
}

async function fetchPortalEmpregoJobs(url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const listUrls = company._api?.portalemprego?.listUrls || [url];

  for (const listUrl of listUrls) {
    const firstPageHtml = await fetchText(listUrl);
    const pageCount = getPortalEmpregoPageCount(firstPageHtml);
    const maxPages = Math.min(company._api?.portalemprego?.maxPages || PORTALEMPREGO_MAX_PAGES, pageCount);
    jobs.push(...parsePortalEmpregoPage(firstPageHtml, listUrl, seenUrls));

    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
      const html = await fetchText(buildPortalEmpregoPageUrl(listUrl, pageNumber));
      jobs.push(...parsePortalEmpregoPage(html, listUrl, seenUrls));
    }
  }

  return jobs;
}

async function fetchEnglishJobsJobs(url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const listUrls = company._api?.englishjobs?.listUrls || [url];

  for (const listUrl of listUrls) {
    const firstPageMarkdown = await fetchText(buildEnglishJobsPageUrl(listUrl, 1));
    const pageCount = getEnglishJobsPageCount(firstPageMarkdown);
    const maxPages = Math.min(company._api?.englishjobs?.maxPages || ENGLISHJOBS_MAX_PAGES, pageCount);
    jobs.push(...parseEnglishJobsPage(firstPageMarkdown, listUrl, seenUrls));

    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
      const markdown = await fetchText(buildEnglishJobsPageUrl(listUrl, pageNumber));
      const pageJobs = parseEnglishJobsPage(markdown, listUrl, seenUrls);
      if (pageJobs.length === 0) break;
      jobs.push(...pageJobs);
    }
  }

  return jobs;
}

async function fetchJobsInEnglishJobs(url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const config = company._api?.jobsinenglish;
  const listUrls = config?.listUrls || [url];

  for (const listUrl of listUrls) {
    if (config?.useViewAll || /\/view_all_ads\/(?:[?#]|$)/.test(listUrl)) {
      const html = await fetchText(listUrl);
      jobs.push(...parseJobsInEnglishPage(html, listUrl, seenUrls));
      continue;
    }

    const firstPageHtml = await fetchText(buildJobsInEnglishPageUrl(listUrl, 1));
    const pageCount = getJobsInEnglishPageCount(firstPageHtml);
    const maxPages = Math.min(config?.maxPages || JOBSINENGLISH_MAX_PAGES, pageCount);
    jobs.push(...parseJobsInEnglishPage(firstPageHtml, listUrl, seenUrls));

    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
      const html = await fetchText(buildJobsInEnglishPageUrl(listUrl, pageNumber));
      const pageJobs = parseJobsInEnglishPage(html, listUrl, seenUrls);
      if (pageJobs.length === 0) break;
      jobs.push(...pageJobs);
    }
  }

  return jobs;
}

async function fetchDevJobsDeJobs(url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const listUrls = company._api?.devjobsde?.listUrls || [url];
  const maxPages = company._api?.devjobsde?.maxPages || DEVJOBSDE_MAX_PAGES;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: DEVJOBSDE_BROWSER_USER_AGENT,
    });
    const page = await context.newPage();

    for (const listUrl of listUrls) {
      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        const pageUrl = buildDevJobsDePageUrl(listUrl, pageNumber);
        const pageJobs = await fetchDevJobsDeSearchPage(page, pageUrl, seenUrls);

        if (pageJobs.length === 0) {
          break;
        }

        jobs.push(...pageJobs);
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return jobs;
}

async function fetchJobsChJobs(url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const listUrls = company._api?.jobsch?.listUrls || [url];

  for (const listUrl of listUrls) {
    const firstPageHtml = await fetchText(buildJobsChPageUrl(listUrl, 1));
    const firstPage = parseJobsChSearchPage(firstPageHtml, listUrl, seenUrls);
    const maxPages = Math.min(company._api?.jobsch?.maxPages || JOBSCH_MAX_PAGES, firstPage.pageCount);
    jobs.push(...firstPage.jobs);

    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
      const html = await fetchText(buildJobsChPageUrl(listUrl, pageNumber));
      const pageData = parseJobsChSearchPage(html, listUrl, seenUrls);
      if (pageData.jobs.length === 0) break;
      jobs.push(...pageData.jobs);
    }
  }

  return jobs;
}

async function fetchMakeItInGermanyJobs(url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const listUrls = company._api?.makeitingermany?.listUrls || [url];

  for (const listUrl of listUrls) {
    const firstPageHtml = await fetchText(buildMakeItInGermanyPageUrl(listUrl, 1));
    const maxPages = Math.min(company._api?.makeitingermany?.maxPages || MAKEITINGERMANY_MAX_PAGES, getMakeItInGermanyPageCount(firstPageHtml));
    jobs.push(...parseMakeItInGermanyPage(firstPageHtml, listUrl, seenUrls));

    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
      const html = await fetchText(buildMakeItInGermanyPageUrl(listUrl, pageNumber));
      const pageJobs = parseMakeItInGermanyPage(html, listUrl, seenUrls);
      if (pageJobs.length === 0) break;
      jobs.push(...pageJobs);
    }
  }

  return jobs;
}

async function fetchDiceJobs(url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const listUrls = company._api?.dice?.listUrls || [url];
  const pageSize = company._api?.dice?.pageSize || 20;

  for (const listUrl of listUrls) {
    const firstPageHtml = await fetchText(buildDicePageUrl(listUrl, 1, pageSize));
    const firstPageData = extractDiceJobList(firstPageHtml);
    if (!firstPageData) {
      throw new Error('Unable to parse Dice embedded job data');
    }

    const pageCount = Number(firstPageData.meta?.pageCount || 1);
    const maxPages = Math.min(company._api?.dice?.maxPages || DICE_MAX_PAGES, pageCount);

    for (const item of firstPageData.data || []) {
      const parsed = parseDiceJob(item, seenUrls);
      if (parsed) jobs.push(parsed);
    }

    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
      const html = await fetchText(buildDicePageUrl(listUrl, pageNumber, pageSize));
      const pageData = extractDiceJobList(html);
      if (!pageData) break;

      for (const item of pageData.data || []) {
        const parsed = parseDiceJob(item, seenUrls);
        if (parsed) jobs.push(parsed);
      }
    }
  }

  return jobs;
}

async function fetchRemoteInEuropeJobDetails(job) {
  const html = await fetchText(job.url);
  return parseRemoteInEuropeDetailPage(html, job);
}

async function enrichRemoteInEuropeJobs(jobs) {
  if (jobs.length === 0) {
    return jobs;
  }

  const detailConcurrency = Math.max(1, Math.min(REMOTEINEUROPE_DETAIL_CONCURRENCY, jobs.length));
  const tasks = jobs.map(job => async () => {
    try {
      return await fetchRemoteInEuropeJobDetails(job);
    } catch {
      return job;
    }
  });

  return parallelFetch(tasks, detailConcurrency);
}

async function fetchRemoteInEuropeJobs(url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const listUrls = company._api?.remoteineurope?.listUrls || [url];

  for (const listUrl of listUrls) {
    const firstPageHtml = await fetchText(listUrl);
    const pageCount = getRemoteInEuropePageCount(firstPageHtml);
    const maxPages = Math.min(company._api?.remoteineurope?.maxPages || REMOTEINEUROPE_MAX_PAGES, pageCount);
    jobs.push(...parseRemoteInEuropePage(firstPageHtml, listUrl, seenUrls));

    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
      const html = await fetchText(buildRemoteInEuropePageUrl(listUrl, pageNumber));
      jobs.push(...parseRemoteInEuropePage(html, listUrl, seenUrls));
    }
  }

  return jobs;
}

function normalizeRustJobsPublishedAt(value) {
  const trimmed = normalizeWhitespace(String(value || ''));
  if (!trimmed) return '';

  const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    return parseRemoteInEuropeDate(trimmed);
  }

  return parseRemoteInEuropeDate(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
}

async function extractRustJobsCards(page) {
  return page.evaluate(() => {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const salaryPattern = /(?:[$€£]|\b(?:CAD|USD|EUR|GBP|CHF)\b|\b\d{2,3}k\b)/i;

    return Array.from(document.querySelectorAll('article'))
      .map(article => {
        const titleLink = article.querySelector('a[href^="/jobs/"]');
        if (!titleLink) return null;

        const title = clean(titleLink.textContent);
        const detailUrl = titleLink.href;
        const companyFromImage = clean(article.querySelector('img[alt$=" logo"]')?.getAttribute('alt')?.replace(/ logo$/, '') || '');
        const companyFromAria = clean(titleLink.getAttribute('aria-label')).match(/ at (.+)$/)?.[1] || '';
        const remotePolicy = clean(article.querySelector('div.mb-2 span')?.textContent || '');
        const time = article.querySelector('time');
        const postedDate = clean(time?.textContent || '');
        const publishedAt = clean(time?.getAttribute('datetime') || '');
        const applyUrl = Array.from(article.querySelectorAll('a'))
          .find(link => /apply now/i.test(link.textContent || ''))?.href || '';
        const pillTexts = Array.from(article.querySelectorAll('div[class*="rounded-lg"]'))
          .map(node => clean(node.textContent))
          .filter(Boolean);
        const salary = pillTexts.find(text => salaryPattern.test(text)) || '';
        const location = pillTexts.find(text => (
          text !== salary
          && text !== postedDate
          && !/^(remote|hybrid|on-site)$/i.test(text)
        )) || '';

        if (!title || !detailUrl) return null;

        return {
          title,
          url: detailUrl,
          company: companyFromImage || companyFromAria,
          location,
          salary,
          remotePolicy,
          applyUrl,
          postedDate,
          publishedAt,
        };
      })
      .filter(Boolean);
  });
}

async function fetchRustJobsJobs(url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const listUrls = company._api?.rustjobs?.listUrls || [url];
  const maxPages = company._api?.rustjobs?.maxPages || RUSTJOBS_MAX_PAGES;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: DEVJOBSDE_BROWSER_USER_AGENT,
    });
    const page = await context.newPage();

    for (const listUrl of listUrls) {
      await page.goto(listUrl, { waitUntil: 'networkidle', timeout: RUSTJOBS_NAVIGATION_TIMEOUT_MS });

      let loadedPages = 1;
      while (loadedPages < maxPages) {
        const loadMoreButton = page.getByRole('button', { name: /load more jobs/i });
        const hasLoadMore = await loadMoreButton.isVisible().catch(() => false);
        if (!hasLoadMore) break;

        const previousCount = await page.locator('a[href^="/jobs/"]').count();
        await loadMoreButton.click();
        await page.waitForFunction(
          previous => document.querySelectorAll('a[href^="/jobs/"]').length > previous,
          previousCount,
          { timeout: FETCH_TIMEOUT_MS },
        ).catch(() => {});
        await page.waitForTimeout(400);
        loadedPages += 1;
      }

      const pageJobs = await extractRustJobsCards(page);
      for (const job of pageJobs) {
        if (!job.company || seenUrls.has(job.url)) continue;
        seenUrls.add(job.url);
        jobs.push({
          ...job,
          publishedAt: normalizeRustJobsPublishedAt(job.publishedAt),
        });
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return jobs;
}

async function fetchNodeskIndexPage({ filter, page, hitsPerPage, query, referer }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://${NODESK_ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${NODESK_ALGOLIA_JOB_INDEX}/query`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-algolia-application-id': NODESK_ALGOLIA_APP_ID,
        'x-algolia-api-key': NODESK_ALGOLIA_API_KEY,
        'origin': 'https://nodesk.co',
        'referer': referer,
        'user-agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        query,
        hitsPerPage,
        page,
        filters: `searchFilter:${filter}`,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNodeskJobDetails(job) {
  const html = await fetchText(job.sourceUrl || job.url);
  return parseNodeskDetailPage(html, job);
}

async function enrichNodeskJobs(jobs, seenUrls) {
  if (jobs.length === 0) {
    return jobs;
  }

  const detailConcurrency = Math.max(1, Math.min(NODESK_DETAIL_CONCURRENCY, jobs.length));
  const tasks = jobs.map(job => async () => {
    try {
      return await fetchNodeskJobDetails(job);
    } catch {
      return job;
    }
  });

  const enriched = await parallelFetch(tasks, detailConcurrency);
  const deduped = [];

  for (const job of enriched) {
    const finalUrl = job.url || job.sourceUrl;
    const sourceUrl = job.sourceUrl || job.url;

    if (!finalUrl || !sourceUrl) continue;
    if (finalUrl !== sourceUrl && seenUrls.has(finalUrl)) continue;

    seenUrls.add(finalUrl);
    seenUrls.add(sourceUrl);
    deduped.push(job);
  }

  return deduped;
}

async function fetchNodeskJobs(_url, company) {
  const seenUrls = new Set();
  const jobs = [];
  const filters = company._api?.nodesk?.filters || ['remote-jobs'];
  const maxPages = company._api?.nodesk?.maxPages || NODESK_MAX_PAGES;
  const hitsPerPage = company._api?.nodesk?.hitsPerPage || 90;
  const queries = company._api?.nodesk?.query || [''];

  for (const filter of filters) {
    const referer = `https://nodesk.co/${filter.replace(/^\/+/, '')}/`;

    for (const query of queries) {
      const firstPage = await fetchNodeskIndexPage({ filter, page: 0, hitsPerPage, query, referer });
      const pageCount = Number(firstPage.nbPages || 1);
      const boundedPages = Math.min(maxPages, pageCount);

      for (const hit of firstPage.hits || []) {
        const parsed = parseNodeskJob(hit, seenUrls);
        if (parsed) jobs.push(parsed);
      }

      for (let pageNumber = 1; pageNumber < boundedPages; pageNumber++) {
        const pageData = await fetchNodeskIndexPage({ filter, page: pageNumber, hitsPerPage, query, referer });
        for (const hit of pageData.hits || []) {
          const parsed = parseNodeskJob(hit, seenUrls);
          if (parsed) jobs.push(parsed);
        }
      }
    }
  }

  return enrichNodeskJobs(jobs, seenUrls);
}

async function fetchJobs(company) {
  const { type, url } = company._api;

  if (type === 'landingjobs') {
    return fetchLandingJobsJobs(url, company);
  }

  if (type === 'pcsx') {
    return fetchPcsxJobs(url, company);
  }

  if (type === 'itjobs') {
    return fetchItjobsJobs(url, company);
  }

  if (type === 'euremotejobs') {
    return fetchEuRemoteJobsJobs(url, company);
  }

  if (type === 'workingnomads') {
    return fetchWorkingNomadsJobs(url, company);
  }

  if (type === 'devitjobs') {
    return fetchDevITJobsFamilyJobs(url, company);
  }

  if (type === 'sapo') {
    return fetchSapoJobs(url, company);
  }

  if (type === 'portalemprego') {
    return fetchPortalEmpregoJobs(url, company);
  }

  if (type === 'englishjobs') {
    return fetchEnglishJobsJobs(url, company);
  }

  if (type === 'jobsinenglish') {
    return fetchJobsInEnglishJobs(url, company);
  }

  if (type === 'devjobsde') {
    return fetchDevJobsDeJobs(url, company);
  }

  if (type === 'jobsch') {
    return fetchJobsChJobs(url, company);
  }

  if (type === 'makeitingermany') {
    return fetchMakeItInGermanyJobs(url, company);
  }

  if (type === 'dice') {
    return fetchDiceJobs(url, company);
  }

  if (type === 'remoteineurope') {
    return fetchRemoteInEuropeJobs(url, company);
  }

  if (type === 'rustjobs') {
    return fetchRustJobsJobs(url, company);
  }

  if (type === 'nodesk') {
    return fetchNodeskJobs(url, company);
  }

  const json = await fetchJson(url);
  return PARSERS[type](json, company);
}

// ── Title filter ────────────────────────────────────────────────────

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());

  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

// ── Location filter ─────────────────────────────────────────────────
// Optional. If `location_filter` is absent from portals.yml, all locations pass.
// Semantics:
//   - Empty location string → pass (don't penalize missing data)
//   - `block` matches → reject (takes precedence over allow)
//   - `allow` empty → pass (already cleared block)
//   - `allow` non-empty → must match at least one keyword
// All matches are case-insensitive substring.

function buildLocationFilter(locationFilter) {
  if (!locationFilter) return () => true;
  const allow = (locationFilter.allow || []).map(k => k.toLowerCase());
  const block = (locationFilter.block || []).map(k => k.toLowerCase());

  return (location) => {
    if (!location) return true;
    const lower = location.toLowerCase();
    if (block.length > 0 && block.some(k => lower.includes(k))) return false;
    if (allow.length === 0) return true;
    return allow.some(k => lower.includes(k));
  };
}

// ── Dedup ───────────────────────────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();

  // scan-history.tsv
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    // Parse markdown table rows: | # | Date | Company | Role | ...
    for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') {
        seen.add(`${company}::${role}`);
      }
    }
  }
  return seen;
}

// ── Pipeline writer ─────────────────────────────────────────────────

function appendToPipeline(offers) {
  if (offers.length === 0) return;

  let text = existsSync(PIPELINE_PATH)
    ? readFileSync(PIPELINE_PATH, 'utf-8')
    : PIPELINE_TEMPLATE;

  if (!text.trim()) {
    text = PIPELINE_TEMPLATE;
  }

  // Find "## Pendientes" section and append after it
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // No Pendientes section — append at end before Procesadas
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    // Find the end of existing Pendientes content (next ## or end)
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;

    const block = '\n' + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  // Ensure file + header exist. Location appended as 7th column for non-breaking
  // backward compat — older scan-history.tsv files with 6 columns still parse fine
  // since loadSeenUrls only reads column 0.
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n', 'utf-8');
  }

  const lines = offers.map(o =>
    `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded\t${o.location || ''}`
  ).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;

  // 1. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const companies = config.tracked_companies || [];
  const titleFilter = buildTitleFilter(config.title_filter);
  const locationFilter = buildLocationFilter(config.location_filter);

  // 2. Filter to enabled companies with detectable APIs
  const targets = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany))
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api !== null);

  const skippedCount = companies.filter(c => c.enabled !== false).length - targets.length;

  console.log(`Scanning ${targets.length} companies via API (${skippedCount} skipped — no API detected)`);
  if (dryRun) console.log('(dry run — no files will be written)\n');

  // 3. Load dedup sets
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();
  const reservedUrls = new Set();
  const reservedCompanyRoles = new Set();

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFilteredTitle = 0;
  let totalFilteredLocation = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];

  const tasks = targets.map(company => async () => {
    const { type } = company._api;
    try {
      const jobs = await fetchJobs(company);
      totalFound += jobs.length;
      const candidateJobs = [];

      for (const job of jobs) {
        if (!titleFilter(job.title)) {
          totalFilteredTitle++;
          continue;
        }
        if (!locationFilter(job.location)) {
          totalFilteredLocation++;
          continue;
        }
        if (seenUrls.has(job.url) || reservedUrls.has(job.url)) {
          totalDupes++;
          continue;
        }
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key) || reservedCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }

        // Reserve candidates during this scan without polluting the persisted dedup sets.
        reservedUrls.add(job.url);
        reservedCompanyRoles.add(key);
        candidateJobs.push(job);
      }

      const enrichedJobs = type === 'pcsx'
        ? await enrichPcsxJobs(company, candidateJobs)
        : type === 'remoteineurope'
          ? await enrichRemoteInEuropeJobs(candidateJobs)
          : candidateJobs;

      for (const job of enrichedJobs) {
        const finalUrl = job.url;
        const sourceUrl = job.sourceUrl || job.url;

        if (seenUrls.has(finalUrl) || (sourceUrl && seenUrls.has(sourceUrl))) {
          totalDupes++;
          continue;
        }

        seenUrls.add(finalUrl);
        if (sourceUrl) seenUrls.add(sourceUrl);
        newOffers.push({ ...job, source: `${type}-api` });
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  // 5. Write results
  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
  }

  // 6. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scanned:     ${targets.length}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFilteredTitle} removed`);
  console.log(`Filtered by location:  ${totalFilteredLocation} removed`);
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`New offers added:      ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
  console.log('→ Share results and get help: https://discord.gg/8pRpHETxa4');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
