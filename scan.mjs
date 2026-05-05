#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner
 *
 * Fetches Greenhouse, Ashby, Lever, and PCSX APIs plus structured feed/HTML
 * providers such as Landing.jobs, EU Remote Jobs, ITJobs, SAPO Emprego,
 * Portal Emprego, Dice, and Working Nomads, applies title
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

function splitCommaSeparatedValues(value) {
  return String(value || '')
    .split(',')
    .map(item => normalizeWhitespace(item))
    .filter(Boolean);
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

  if (company.api_provider === 'sapo' || /https?:\/\/emprego\.sapo\.pt\/offers(?:\/search)?/.test(company.api || company.careers_url || '')) {
    const sapo = getSapoConfig(company);
    return sapo ? { type: 'sapo', url: sapo.listUrls[0], sapo } : null;
  }

  if (company.api_provider === 'portalemprego' || /https?:\/\/(?:www\.)?portalemprego\.pt\/anuncios(?:\/|$)/.test(company.api || company.careers_url || '')) {
    const portalemprego = getPortalEmpregoConfig(company);
    return portalemprego ? { type: 'portalemprego', url: portalemprego.listUrls[0], portalemprego } : null;
  }

  if (company.api_provider === 'dice' || /https?:\/\/(?:www\.)?dice\.com\/jobs(?:[/?#]|$)/.test(company.api || company.careers_url || '')) {
    const dice = getDiceConfig(company);
    return dice ? { type: 'dice', url: dice.listUrls[0], dice } : null;
  }

  if (company.api_provider === 'remoteineurope' || /https?:\/\/(?:www\.)?remoteineurope\.com\/(?:categories\/[^/?#]+|job\/[^/?#]+|$)/.test(company.api || company.careers_url || '')) {
    const remoteineurope = getRemoteInEuropeConfig(company);
    return remoteineurope ? { type: 'remoteineurope', url: remoteineurope.listUrls[0], remoteineurope } : null;
  }

  // Greenhouse: explicit api field
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
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
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
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

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever, pcsx: parsePcsx };

// ── Fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
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

  if (type === 'sapo') {
    return fetchSapoJobs(url, company);
  }

  if (type === 'portalemprego') {
    return fetchPortalEmpregoJobs(url, company);
  }

  if (type === 'dice') {
    return fetchDiceJobs(url, company);
  }

  if (type === 'remoteineurope') {
    return fetchRemoteInEuropeJobs(url, company);
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

  let text = readFileSync(PIPELINE_PATH, 'utf-8');

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
  // Ensure file + header exist
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }

  const lines = offers.map(o =>
    `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded`
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

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFiltered = 0;
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
          totalFiltered++;
          continue;
        }
        if (seenUrls.has(job.url)) {
          totalDupes++;
          continue;
        }
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }
        // Mark as seen to avoid intra-scan dupes
        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        candidateJobs.push(job);
      }

      const enrichedJobs = type === 'pcsx'
        ? await enrichPcsxJobs(company, candidateJobs)
        : type === 'remoteineurope'
          ? await enrichRemoteInEuropeJobs(candidateJobs)
          : candidateJobs;

      for (const job of enrichedJobs) {
        seenUrls.add(job.url);
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
  console.log(`Filtered by title:     ${totalFiltered} removed`);
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
