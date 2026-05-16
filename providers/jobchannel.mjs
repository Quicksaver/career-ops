// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

function values(value) {
  if (value === false || value === null || value === undefined || value === '') return [];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [String(value)];
}

function buildListUrl(baseUrl, term, page, params = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set('format', 'markdown');
  if (term) url.searchParams.set('terms', term);
  if (page > 1) url.searchParams.set('page', String(page));

  for (const key of ['workloadMin', 'workloadMax']) {
    if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
      url.searchParams.set(key, String(params[key]));
    }
  }

  for (const province of values(params.provinces)) {
    url.searchParams.append('provinces', province);
  }

  return url.toString();
}

function parseMarkdownJobs(markdown, sourceUrl, seen) {
  const jobs = [];
  const origin = new URL(sourceUrl).origin;

  for (const match of markdown.matchAll(/\[([^\]\n]{4,})\]\(([^)\s]+)\)/g)) {
    const title = match[1].replace(/\s+/g, ' ').trim();
    const href = match[2];
    let url;
    try {
      url = new URL(href, origin).toString();
    } catch {
      continue;
    }

    if (seen.has(url)) continue;
    if (new URL(url).origin !== origin) continue;
    if (!/\/(?:job|jobs|stellen|vacanc|position|all-)/i.test(new URL(url).pathname)) continue;

    seen.add(url);
    jobs.push({ title, url, company: 'Jobchannel', location: '' });
  }

  return jobs;
}

/** @type {Provider} */
export default {
  id: 'jobchannel',

  detect(entry) {
    const url = entry.careers_url || entry.api || '';
    return /https?:\/\/(?:www\.)?it-jobs-switzerland\.ch(?:\/|$)/.test(url)
      ? { url }
      : null;
  },

  async fetch(entry, ctx) {
    const baseUrl = entry.api || entry.careers_url;
    if (!baseUrl) throw new Error(`jobchannel: missing careers_url for ${entry.name}`);

    const terms = values(entry.api_params?.terms || entry.api_params?.term || entry.api_params?.q);
    const termValues = terms.length > 0 ? terms : [''];
    const maxPages = Math.max(1, Number(entry.api_max_pages) || 3);
    const seen = new Set();
    const jobs = [];

    for (const term of termValues) {
      for (let page = 1; page <= maxPages; page++) {
        const listUrl = buildListUrl(baseUrl, term, page, entry.api_params || {});
        const markdown = await ctx.fetchText(listUrl, {
          headers: {
            accept: 'text/markdown,text/plain,*/*',
            'accept-language': 'en-US,en;q=0.9',
          },
        });
        jobs.push(...parseMarkdownJobs(markdown, listUrl, seen));
      }
    }

    return jobs.map(job => ({ ...job, company: entry.name }));
  },
};
