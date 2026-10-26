import '../user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { toolRequired } from '../required-tools.mjs';
import { detectCustomProvider, fetchCustomProvider, routeCustomBrowserRequests } from '../../providers/_custom.mjs';
import { makeHttpCtx, BROWSER_LIKE_USER_AGENT } from '../../providers/_http.mjs';
import { normalizeJob } from '../../providers/arbeitsagentur.mjs';
import workingnomads from '../../providers/workingnomads.mjs';
import { loadProviders, resolveProvider } from '../../providers/_registry.mjs';
import { boundedProbeCtx } from '../../verify-portals.mjs';

const entry = { name: 'Fixture', api: 'https://careers.example/api/pcsx/search?domain=fixture' };

test('retired custom branches route through direct provider modules while active custom adapters remain available', async () => {
  const {fileURLToPath}=await import('node:url');
  const providers=await loadProviders(fileURLToPath(new URL('../../providers/',import.meta.url)));
  for(const id of ['landingjobs','nodesk','workingnomads','greenhouse','ashby','lever','pcsx']) {
    const resolved=resolveProvider({name:'Fixture',provider:id},providers);
    assert.equal(resolved.provider,providers.get(id));
    assert.equal(resolved.provider.id,id);
  }
});
const position = (id, extra = {}) => ({ id, name: 'Engineer', locations: ['Berlin'], ...extra });
const payload = (positions, count = positions.length) => ({ data: { positions, count } });
// PCSX reads raw responses (for its session cookie); the other boards read JSON.
const ctx = (fetchJson, extra = {}) => ({ fetchJson, fetchResponse: async (url, opts) => Response.json(await fetchJson(url, opts)), sleep: async () => {}, ...extra });

const boards = {
  pcsx: entry.api, devitjobs: 'https://devitjobs.uk/api/jobsLight',
  swissdevjobs: 'https://swissdevjobs.ch/api/jobsLight', germantechjobs: 'https://germantechjobs.de/api/jobsLight',
  itjobs: 'https://www.itjobs.pt/emprego', sapo: 'https://emprego.sapo.pt/offers',
  portalemprego: 'https://www.portalemprego.pt/anuncios/', dice: 'https://www.dice.com/jobs',
  euremotejobs: 'https://euremotejobs.com/job-category/engineering/', remoteineurope: 'https://remoteineurope.com/',
  englishjobs: 'https://englishjobsearch.ch/', jobsinenglish: 'https://jobsinenglish.dk/',
  jobsch: 'https://www.jobs.ch/en/vacancies/', makeitingermany: 'https://www.make-it-in-germany.com/en/working-in-germany/job-listings',
};

for (const [id, api] of Object.entries(boards)) {
  test(`${id} forwards its context and refuses redirects`, async () => {
    const provider = (await import(`../../providers/${id}.mjs`)).default;
    let calls = 0;
    const sentinel = Object.assign(new Error('offline sentinel'), { status: 404 });
    const request = async (_url, options) => {
      calls++;
      assert.equal(options.redirect, 'error');
      throw sentinel;
    };
    await assert.rejects(provider.fetch({ name: 'Fixture', api }, { ...ctx(request), fetchText: request }), error => error === sentinel);
    assert.equal(calls, 1);
  });
}

test('PCSX rejects malformed feeds and preserves canonical metadata and posting identity', async () => {
  assert.equal(detectCustomProvider('pcsx',entry),null);
  assert.ok(detectCustomProvider('pcsx',{...entry,provider:'pcsx'}));
  assert.ok(detectCustomProvider('pcsx',{...entry,api_provider:'pcsx'}));
  for (const invalid of [{}, { data: {} }, { data: { positions: {} } }]) {
    await assert.rejects(fetchCustomProvider('pcsx', entry, ctx(async () => invalid)), /unsupported response shape/);
  }
  assert.deepEqual(await fetchCustomProvider('pcsx', entry, ctx(async () => payload([]))), []);
  const jobs = await fetchCustomProvider('pcsx', entry, ctx(async () => payload([
    null, position('p1', { displayJobId: 'req1', postedTs: 1770000000, jobDescription: '<p>Build &amp; maintain systems</p>' }),
    position('p2', { displayJobId: 'req1', postedTs: 'not a date' }), position('p3', { name: '' }),
  ])));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].description, 'Build & maintain systems');
  assert.equal(jobs[0].postedAt, 1770000000000);
  assert.equal(jobs[0].externalId, 'p1');
  assert.equal(jobs[1].externalId, 'p2');
  assert.equal(jobs[0].requisitionId, jobs[1].requisitionId);
  assert.equal(jobs[1].postedAt, undefined);
  const [epoch] = await fetchCustomProvider('pcsx', entry, ctx(async () => payload([position('epoch', {postedTs:0})])));
  assert.equal(epoch.postedAt, 0);
});

const euRemoteJobsCategory = readFileSync(new URL('../fixtures/euremotejobs-category.html', import.meta.url), 'utf8');
const euRemoteJobsCard = (host, id) => `<a href="https://${host}/job/${id}/" class="job-card-link"><div class="job-card"><h2 class="job-title">Engineer ${id}</h2><div class="company-name">Fixture</div><div class="meta-item meta-location"> Europe</div><time datetime="2026-01-02">Posted</time></div></a>`;

test('EU Remote Jobs reads public category pages, follows linked pagination, and ignores the closed legacy feed', async () => {
  const legacy = { name: 'Fixture', provider: 'euremotejobs', careers_url: boards.euremotejobs, api: 'https://euremotejobs.com/job-listings/feed/', api_max_pages: 4 };
  assert.deepEqual(detectCustomProvider('euremotejobs', legacy), { url: boards.euremotejobs });
  assert.deepEqual(detectCustomProvider('euremotejobs', { name: 'Fixture', api: 'https://euremotejobs.com/job-category/marketing/feed/' }), { url: 'https://euremotejobs.com/job-category/marketing/' });
  assert.equal(detectCustomProvider('euremotejobs', { name: 'Fixture', api: 'https://euremotejobs.com/job-listings/feed/' }), null);

  const calls = [];
  const jobs = await fetchCustomProvider('euremotejobs', legacy, { fetchText: async (url, options) => {
    calls.push(url);
    // The board answers 403 to the default scanner user agent.
    assert.equal(options.headers['user-agent'], BROWSER_LIKE_USER_AGENT);
    // Page 2 repeats the featured card and adds one; it links no page 3.
    if (url.endsWith('/page/2/')) return euRemoteJobsCategory.replace(/<nav[\s\S]*<\/nav>/, '').replace(/manager-forward-deployed-engineering/g, 'page-two-role');
    return euRemoteJobsCategory;
  } });
  assert.deepEqual(calls, [boards.euremotejobs, `${boards.euremotejobs}page/2/`]);
  assert.equal(jobs.length, 4);
  assert.deepEqual(jobs[0], {
    title: 'Senior Back-end Developer', url: 'https://euremotejobs.com/job/lemon-io-senior-back-end-developer/',
    company: 'Lemon.io', location: 'APAC, Europe, LATAM, North America', postedDate: '2026-10-15', postedAt: Date.parse('2026-10-15'),
  });
  assert.equal(jobs[2].title, 'Staff Software Engineer – Platform');
  assert.equal(jobs[3].url, 'https://euremotejobs.com/job/page-two-role/');
});

test('EU Remote Jobs fails visibly on a redesigned category page instead of returning zero', async () => {
  const entry = { name: 'Fixture', careers_url: boards.euremotejobs };
  await assert.rejects(fetchCustomProvider('euremotejobs', entry, { fetchText: async () => '<html>Unexpected redesign</html>' }), /Unsupported listing page/);
  assert.deepEqual(await fetchCustomProvider('euremotejobs', entry, { fetchText: async () => '<html>No jobs found</html>' }), []);
  await assert.rejects(fetchCustomProvider('euremotejobs', entry, { fetchText: async url => url.endsWith('/page/2/') ? '<html>Unexpected redesign</html>' : euRemoteJobsCategory }), /Unsupported listing page at .*\/page\/2\//);
});

test('EU Remote Jobs details are bounded opt-in enrichment and probes keep the card fields', async()=>{
  const listing=[1,2].map(id=>euRemoteJobsCard('euremotejobs.com',id)).join('');
  for(const [options,extraCtx,expected] of [[{}, {},0],[{fetchDetails:true,detailLimit:1},{},1],[{fetchDetails:true},{maxPages:1},0]]) {
    let details=0;
    const jobs=await fetchCustomProvider('euremotejobs',{name:'Fixture',careers_url:boards.euremotejobs,...options},{...extraCtx,fetchText:async url=>{
      if(url.includes('/job/')) {details++;return '<meta name="description" content="Build systems">';}
      return listing;
    }});
    assert.equal(details,expected);
    assert.equal(jobs.length,2);
    assert.equal(jobs[0].description,expected ? 'Build systems' : undefined);
    assert.equal(jobs[0].postedAt,Date.parse('2026-01-02'));
  }
});

test('EU Remote Jobs refuses off-board details before transport and accepts www source URLs', async () => {
  for (const host of ['unrelated.example', 'euremotejobs.com.unrelated.example', 'www.euremotejobs.com']) {
    const calls = [];
    const jobs = await fetchCustomProvider('euremotejobs', {name:'Fixture',careers_url:boards.euremotejobs,fetchDetails:true,detailLimit:1}, {fetchText:async url=>{
      calls.push(url);
      if (url === boards.euremotejobs) return euRemoteJobsCard(host, 1);
      return '<meta name="description" content="Build systems">';
    }});
    assert.equal(jobs.length, 1);
    assert.equal(calls.length, host === 'www.euremotejobs.com' ? 2 : 1);
    assert.equal(jobs[0].description, host === 'www.euremotejobs.com' ? 'Build systems' : undefined);
  }
});

test('Portal Emprego parses listing cards and skips an explicit empty search without failing the board', async () => {
  const fixture = name => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
  const calls = [];
  const jobs = await fetchCustomProvider('portalemprego', { name: 'Fixture', api: boards.portalemprego, api_params: { pesquisa: ['automation', 'engenheiro'] }, api_max_pages: 2 }, { fetchText: async url => {
    calls.push(url);
    if (url.includes('pesquisa-automation')) return fixture('portalemprego-empty.html');
    const listing = fixture('portalemprego-listing.html');
    return url.includes('/pagina-2/') ? listing.replace(/referencia-0/g, 'referencia-2') : listing;
  } });
  assert.deepEqual(calls, [
    'https://www.portalemprego.pt/anuncios/pesquisa-automation/mostrar-20/',
    'https://www.portalemprego.pt/anuncios/pesquisa-engenheiro/mostrar-20/',
    'https://www.portalemprego.pt/anuncios/pesquisa-engenheiro/mostrar-20/pagina-2/',
  ]);
  assert.equal(jobs.length, 4);
  assert.deepEqual(jobs[0], {
    title: 'Engenheiro de Processos | Fanhões [269-000261-1]',
    url: 'https://www.portalemprego.pt/emprego/full-time/lisboa/engenheiro-de-processos-fanhoes-269-000261-1-/referencia-0512123/',
    company: 'Adecco Recursos Humanos, E.T.T., Lda.', location: 'Lisboa | Full-time', publicationDate: '2026-10-21', postedAt: Date.parse('2026-10-21'),
  });
  // The marker only counts as the list's first child, so a redesign still fails.
  await assert.rejects(fetchCustomProvider('portalemprego', { name: 'Fixture', api: boards.portalemprego }, { fetchText: async () => '<div id="listCont" class="jobs"><article>redesign</article><div class="message no_results"></div></div>' }), /Unsupported listing page/);
});

test('Remote in Europe bounds details and falls back from unusable employer alternatives',async()=>{
  const listing=[1,2].map(id=>`<a href="/job/${id}" class="card job w-inline-block"><div fs-cmsfilter-field="company" class="card-link homepage">Fixture</div><h3 fs-cmsfilter-field="job-title">Engineer ${id}</h3><div class="short-location">Europe</div></a>`).join('');
  for(const [options,extraCtx,expected,alternative] of [[{},{},0,''],[{fetchDetails:true,detailLimit:1},{},1,'https://employer.example/job'],[{fetchDetails:true,detailLimit:1},{},1,'javascript:alert(1)'],[{fetchDetails:true},{maxPages:1},0,'']]) {
    let details=0;
    const jobs=await fetchCustomProvider('remoteineurope',{name:'Fixture',api:boards.remoteineurope,...options},{...extraCtx,fetchText:async url=>{
      if(url.includes('/job/')) {details++;return `<h1 class="title">Engineer</h1><a href="${alternative}" class="button-primary apply-button w-button">Apply</a><div class="rich-text-block-2 w-richtext"><p>Build systems</p></div><div class="apply-div">`;}
      return listing;
    }});
    assert.equal(details,expected);
    assert.equal(jobs.length,2);
    assert.equal(jobs[0].url,'https://remoteineurope.com/job/1');
    if (expected) assert.equal(jobs[0].applyUrl, alternative);
    if(expected)assert.equal(jobs[0].description,'Build systems');
  }
});

test('PCSX pagination uses raw row offsets and honors probe page limits', async () => {
  const starts = [];
  const transport = ctx(async url => {
    const start = Number(new URL(url).searchParams.get('start'));
    starts.push(start);
    return start === 0 ? payload([null, position('one')], 3) : payload([position('two')], 3);
  });
  assert.equal((await fetchCustomProvider('pcsx', entry, transport)).length, 2);
  assert.deepEqual(starts, [0,2]);
  starts.length = 0;
  assert.equal((await fetchCustomProvider('pcsx', {...entry,fetchDetails:true}, {...transport,maxPages:1})).length, 1);
  assert.deepEqual(starts,[0]);
});

test('PCSX stops repeated pages, deduplicates before enrichment, and retains raw offsets through invalid pages', async () => {
  let requests=0,details=0;
  const jobs=await fetchCustomProvider('pcsx',{...entry,fetchDetails:true},ctx(async url=>{
    if(url.includes('position_details')) {details++;return {data:position('same',{jobDescription:'Detailed posting'})};}
    requests++;return payload([position('same'),position('same')],1000000);
  }));
  assert.equal(requests,2);assert.equal(jobs.length,1);assert.equal(details,1);
  const starts=[];
  const afterInvalid=await fetchCustomProvider('pcsx',entry,ctx(async url=>{
    const start=Number(new URL(url).searchParams.get('start'));starts.push(start);
    return start===0?payload([null,{}],5):start===2?payload([position('valid-later',{name:''})],5):start===3?payload([position('valid-later')],5):payload([],5);
  }));
  assert.deepEqual(starts,[0,2,3,4]);assert.equal(afterInvalid.length,1);
  const overlapStarts=[];
  const overlap=await fetchCustomProvider('pcsx',entry,ctx(async url=>{
    const start=Number(new URL(url).searchParams.get('start'));overlapStarts.push(start);
    return payload((start===0?['a','b']:start===2?['b','c']:['c']).map(id=>position(id)),100);
  }));
  assert.deepEqual(overlap.map(job=>job.externalId),['a','b','c']);assert.deepEqual(overlapStarts,[0,2,4]);
});

test('PCSX details are opt-in, bounded, disabled in probes, and tolerate detail failures', async () => {
  for (const [options, extraCtx, expected] of [
    [{}, {}, 0], [{fetchDetails:false,fetch_details:true},{},0],
    [{fetchDetails:true,detailLimit:2},{},2], [{fetch_details:true,detail_limit:1},{},1],
    [{fetchDetails:true},{maxPages:1},0], [{fetchDetails:true},{probing:true},0],
    [{fetchDetails:true},{},20],
  ]) {
    let details = 0;
    const jobs = await fetchCustomProvider('pcsx', {...entry,...options}, {...ctx(async url => {
      if (new URL(url).pathname.includes('position_details')) {
        details++;
        throw Object.assign(new Error('detail unavailable'), {status:404});
      }
      return payload(Array.from({length:25},(_,i)=>position(String(i+1))));
    }), ...extraCtx});
    assert.equal(details,expected);
    assert.equal(jobs.length,25);
  }
});

test('concurrent provider calls keep independent transport contexts', async () => {
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const first = fetchCustomProvider('pcsx', {...entry,fetchDetails:true,detailLimit:1}, ctx(async url => {
    await gate;
    return url.includes('position_details') ? {data:position('first',{jobDescription:'First detail'})} : payload([position('first')]);
  }));
  const second = fetchCustomProvider('pcsx', entry, ctx(async () => {release(); return payload([position('second')]);}));
  const [a,b] = await Promise.all([first,second]);
  assert.equal(a[0].externalId,'first');
  assert.equal(a[0].description,'First detail');
  assert.equal(b[0].externalId,'second');
});

test('PCSX detail content and posting date supersede listing metadata, with missing-detail fallback', async () => {
  for(const detail of [position('enriched',{jobDescription:'Complete detail',postedTs:1767312000}),position('enriched',{jobDescription:'',postedTs:null})]) {
    const [job]=await fetchCustomProvider('pcsx',{...entry,fetchDetails:true},ctx(async url=>url.includes('position_details')?{data:detail}:payload([position('enriched',{jobDescription:'Listing summary',postedTs:1767225600})])));
    assert.equal(job.description,detail.jobDescription || 'Listing summary');
    assert.equal(job.postedAt,(detail.postedTs ?? 1767225600)*1000);
  }
});

test('shared retries honor Retry-After and stop on nonretryable errors', async () => {
  let calls=0;
  const delays=[];
  await fetchCustomProvider('pcsx',entry,ctx(async()=>{calls++; if(calls===1)throw Object.assign(new Error('limited'),{status:429,retryAfter:'2'});return payload([]);},{
    sleep:async ms=>delays.push(ms),
  }));
  assert.equal(calls,2);
  assert.deepEqual(delays,[2000]);
  calls=0;
  await assert.rejects(fetchCustomProvider('pcsx',entry,ctx(async()=>{calls++;throw Object.assign(new Error('missing'),{status:404});})),/missing/);
  assert.equal(calls,1);
});

test('PCSX paces pages and keeps the newest pages when a rate limit outlasts the retry budget', async () => {
  const limited = () => Object.assign(new Error('HTTP 429 Too Many Requests'), {status:429, retryAfter:null});
  const sleeps=[];
  const starts=[];
  const warnings=[];
  const originalError=console.error;
  console.error=message=>warnings.push(String(message));
  try {
    const jobs=await fetchCustomProvider('pcsx',entry,ctx(async url=>{
      const start=Number(new URL(url).searchParams.get('start'));
      starts.push(start);
      if(start>=20) throw limited();
      return payload(Array.from({length:10},(_,i)=>position(`${start+i}`)),2401);
    },{sleep:async ms=>sleeps.push(ms)}));
    assert.equal(jobs.length,20);
    assert.equal(starts.filter(start=>start===20).length>2,true,'429 pages are retried before giving up');
    assert.match(warnings.join('\n'),/stopped early on HTTP 429 \(20 of 2401 jobs\)/);
    const pageDelays=sleeps.slice(0,2);
    assert.equal(pageDelays[0],pageDelays[1]);
    assert.ok(pageDelays[0]>=1000,`pages are paced for Microsoft's edge, got ${pageDelays[0]}ms`);
  } finally {
    console.error=originalError;
  }
  let calls=0;
  await assert.rejects(fetchCustomProvider('pcsx',entry,ctx(async()=>{calls++;throw limited();})),/HTTP 429/);
  assert.ok(calls>1 && calls<10,`first-page 429 retries within a bounded budget, got ${calls} attempts`);
});

test('PCSX carries the session cookies its host sets on later pages and details', async () => {
  const sent=[];
  const jobs=await fetchCustomProvider('pcsx',{...entry,fetchDetails:true,detailLimit:1},{sleep:async()=>{},fetchResponse:async(url,opts)=>{
    sent.push([new URL(url).pathname+new URL(url).search.replace(/.*start=/,'?start='),opts.headers.cookie,opts.redirect]);
    const start=Number(new URL(url).searchParams.get('start'));
    const body=url.includes('position_details')?{data:position('0',{jobDescription:'Detail'})}:payload([position(String(start))],2);
    const headers=new Headers({'content-type':'application/json'});
    if(start===0&&!url.includes('position_details')) {
      headers.append('set-cookie','_vs=session-1; Domain=example; Secure; HttpOnly; Path=/');
      headers.append('set-cookie','_vscid=2; Secure; Path=/');
    }
    return new Response(JSON.stringify(body),{headers});
  }});
  assert.equal(jobs.length,2);
  assert.equal(jobs[0].description,'Detail');
  assert.deepEqual(sent.map(([,cookie])=>cookie),[undefined,'_vs=session-1; _vscid=2','_vs=session-1; _vscid=2']);
  assert.ok(sent.every(([,,redirect])=>redirect==='error'));
});

test('source URLs reject HTTP, credentials, custom ports and deceptive vendor hosts before transport', async () => {
  const unexpected = ctx(async()=>assert.fail('transport must not run'));
  for(const api of ['http://itjobs.pt/emprego','https://user:pass@itjobs.pt/emprego','https://itjobs.pt:8080/emprego','https://itjobs.pt.evil.example/emprego']) {
    await assert.rejects(fetchCustomProvider('itjobs',{name:'Fixture',api},unexpected),/HTTPS|untrusted/);
  }
  await assert.rejects(fetchCustomProvider('pcsx',{...entry,api:'https://127.0.0.1/api/pcsx/search?domain=fixture'}, {...makeHttpCtx(),sleep:async()=>{}}), /private|blocked|refus/i);
});

test('DevITJobs normalizes description/date/salary text and prefers only HTTPS employer links', async () => {
  const jobs = await fetchCustomProvider('devitjobs', {name:'Fixture',api:boards.devitjobs},ctx(async()=>[
    null,
    {name:'Engineer',jobUrl:'engineer',company:'Example',description:'<p>Build tools</p>',activeFrom:'2026-01-02',redirectJobUrl:'https://employer.example/jobs/1',annualSalaryFrom:100000},
    {name:'Engineer Two',jobUrl:'two',company:'Example',redirectJobUrl:'javascript:alert(1)'},
  ]));
  assert.equal(jobs.length,2);
  assert.equal(jobs[0].description,'Build tools');
  assert.equal(jobs[0].postedAt,Date.parse('2026-01-02'));
  assert.equal(jobs[0].url,'https://employer.example/jobs/1');
  assert.deepEqual(jobs[0].salary,{min:100000,currency:'GBP'});
  assert.equal(typeof jobs[0].salaryText,'string');
  assert.equal(jobs[1].url,'https://devitjobs.uk/jobs/two');
  assert.equal(jobs[1].salary,undefined);
});

for (const [id, api, html] of [
  ['devjobsde','https://en.devjobs.de/jobs/search','<html><body>No jobs found</body></html>'],
  ['rustjobs','https://rustjobs.dev/','<html><body><article><a href="/jobs/fixture" aria-label="Engineer at Fixture">Engineer</a><a href="https://employer.example/job">Apply now</a><time datetime="2026-01-02">Jan 2</time></article></body></html>'],
]) {
  test(`${id} uses guarded context transport in its real browser`, {skip: !toolRequired('browser') && !existsSync(chromium.executablePath()) && 'Chromium is not installed'}, async()=>{
    const provider=(await import(`../../providers/${id}.mjs`)).default;
    let calls=0;
    const jobs=await provider.fetch({name:'Fixture',api},{maxPages:1,fetchResponse:async(url,opts)=>{
      calls++;
      assert.equal(new URL(url).hostname,new URL(api).hostname);
      assert.equal(opts.redirect,'error');
      return new Response(html,{headers:{'content-type':'text/html'}});
    }});
    assert.equal(calls,1);
    if(id==='rustjobs') {
      assert.equal(jobs[0].url,'https://rustjobs.dev/jobs/fixture');
      assert.equal(jobs[0].applyUrl,'https://employer.example/job');
      assert.equal(jobs[0].postedAt,Date.parse('2026-01-02'));
    } else assert.deepEqual(jobs,[]);
  });
}

test('rustjobs reports a Vercel security checkpoint as unscannable instead of retrying it', {skip: !toolRequired('browser') && !existsSync(chromium.executablePath()) && 'Chromium is not installed'}, async()=>{
  const provider=(await import('../../providers/rustjobs.mjs')).default;
  const challenge='<!DOCTYPE html><html><head><title>Vercel Security Checkpoint</title></head><body></body></html>';
  for(const [body,expected] of [[challenge,/requires a Vercel browser security check.*disable this entry/],['busy',/^Error: HTTP 429$/]]) {
    let calls=0;
    await assert.rejects(provider.fetch({name:'Fixture',careers_url:'https://rustjobs.dev',api_params:{location:['remote','europe']}},{fetchResponse:async()=>{
      calls++;
      throw Object.assign(new Error('HTTP 429'),{status:429,body});
    }}),expected);
    assert.equal(calls,1);
  }
});

const fakeRequest = (url='https://rustjobs.dev/') => ({url:()=>url,resourceType:()=> 'document',method:()=> 'GET',postData:()=>null,headers:()=>({})});
test('browser boards route all requests through context transport and surface guarded failures', async () => {
  let handler;
  let calls=0;
  const assertTransport = await routeCustomBrowserRequests({route:async(_pattern,fn)=>{handler=fn;}}, {
    fetchResponse:async(_url,opts)=>{calls++;assert.equal(opts.redirect,'error');return new Response('fixture',{headers:{'content-length':'7','content-encoding':'gzip','content-type':'text/html'}});},
  });
  let response;
  await handler({request:()=>fakeRequest(),fulfill:async value=>{response=value;},abort:async()=>assert.fail('unexpected abort')});
  assert.equal(calls,1);
  assert.equal(response.body.toString(),'fixture');
  assert.equal(response.headers['content-encoding'],undefined);
  assertTransport();
  let aborted=false;
  await handler({request:()=>fakeRequest('http://127.0.0.1/'),abort:async()=>{aborted=true;}});
  assert.equal(aborted,true);
  assert.equal(calls,1);
  assert.throws(assertTransport,/HTTPS/);
});

test('raw browser responses share the same four-request health probe budget', async () => {
  let calls=0;
  const request=async()=>{calls++;return new Response('fixture');};
  const {ctx:bounded,wasTripped}=boundedProbeCtx({fetchJson:request,fetchText:request,fetchResponse:request});
  await bounded.fetchJson('https://example.com/');
  await bounded.fetchText('https://example.com/');
  await bounded.fetchResponse('https://example.com/');
  await bounded.fetchResponse('https://example.com/');
  await assert.rejects(bounded.fetchResponse('https://example.com/'));
  assert.equal(calls,4);
  assert.equal(wasTripped(),true);
});

test('Arbeitsagentur remote normalization requires a positive remote signal without onsite/negative claims',()=>{
  const job=title=>normalizeJob({referenznummer:'1',stellenangebotsTitel:title,firma:'Fixture',stellenlokationen:[{adresse:{ort:'Berlin',land:'DEUTSCHLAND'}}]});
  for(const title of ['Engineer 100%','Engineer 100% on-site','Engineer deutschlandweit','Engineer not remote','Engineer ohne Homeoffice','Remote Engineer - on-site']) {
    assert.equal(job(title).location,'Berlin',title);
  }
  for(const title of ['Engineer 100% remote','Engineer Homeoffice','Engineer ortsunabhängig']) assert.match(job(title).location,/^Remote, /,title);
});

test('Working Nomads retains list descriptions and publication dates',async()=>{
  const [job]=await workingnomads.fetch({name:'Fixture'},{fetchJson:async()=>[{title:'Engineer',url:'https://employer.example/job',description:'<p>Build systems</p>',pub_date:'2026-01-02'}]});
  assert.equal(job.description,'Build systems');
  assert.equal(job.postedAt,Date.parse('2026-01-02'));
});

test('Remote in Europe fetches every configured category from the original base', async () => {
  const calls = [];
  await fetchCustomProvider('remoteineurope', { name: 'Fixture', api: boards.remoteineurope, api_params: { category: ['programming', 'marketing'] } }, {
    fetchText: async url => { calls.push(url); return '<p>No jobs found</p>'; },
  });
  assert.deepEqual(calls, ['https://remoteineurope.com/categories/programming', 'https://remoteineurope.com/categories/marketing']);
});

test('generic employer careers links preserve separate board posting identities', async () => {
  const jobs = await fetchCustomProvider('devitjobs', { name: 'Fixture', api: boards.devitjobs }, ctx(async () => [
    { name: 'Engineer', jobUrl: 'one', company: 'Fixture', redirectJobUrl: 'https://employer.example/careers' },
    { name: 'Engineer', jobUrl: 'two', company: 'Fixture', redirectJobUrl: 'https://employer.example/careers' },
  ]));
  assert.deepEqual(jobs.map(job => job.url), ['https://devitjobs.uk/jobs/one', 'https://devitjobs.uk/jobs/two']);
  assert.equal(jobs[0].applyUrl, 'https://employer.example/careers');
});

test('first-page parser failures differ from explicit no-results responses', async () => {
  for (const id of ['itjobs', 'portalemprego', 'remoteineurope', 'jobsinenglish', 'makeitingermany']) {
    const entry = { name: 'Fixture', api: boards[id] };
    await assert.rejects(fetchCustomProvider(id, entry, { fetchText: async () => '<html>Unexpected redesign</html>' }), /Unsupported listing page/);
    assert.deepEqual(await fetchCustomProvider(id, entry, { fetchText: async () => '<html>No jobs found</html>' }), []);
  }
});

test('itjobs reads "0 ofertas" as an empty list, not a redesign', async () => {
  const html = '<html><title>Emprego remoto e híbrido em IT: 0 ofertas em Portugal - ITJobs</title></html>';
  assert.deepEqual(await fetchCustomProvider('itjobs', { name: 'Fixture', api: 'https://www.itjobs.pt/emprego/remote' }, { fetchText: async () => html }), []);
});

test('itjobs refuses the query filters its robots.txt disallows, before any request', async () => {
  const unexpected = { fetchText: async () => { throw new Error('requested a disallowed URL'); } };
  for (const entry of [
    { name: 'Fixture', api: 'https://www.itjobs.pt/emprego', api_params: { date: '24h', work_model: [1, 2] } },
    { name: 'Fixture', api: 'https://www.itjobs.pt/emprego?location=porto' },
  ]) {
    await assert.rejects(fetchCustomProvider('itjobs', entry, unexpected), /robots\.txt disallows/);
  }
  // List paths and pagination stay allowed.
  const listed = '<div class="list-title"><a href="/oferta/1/dev">Backend Developer</a></div><div class="list-name"><a>Fixture</a></div><div class="list-details">Porto</div>';
  for (const api of ['https://www.itjobs.pt/emprego/remote', 'https://www.itjobs.pt/local/porto']) {
    const jobs = await fetchCustomProvider('itjobs', { name: 'Fixture', api }, { fetchText: async () => listed });
    assert.equal(jobs.length, 1);
  }
});

test('optional browser resource HTTP errors retain the page, while source XHR and guards fail it', async () => {
  for (const [type, url, error, fatal] of [
    ['script', 'https://cdn.example/script.js', { status: 404, body: 'missing' }, false],
    ['stylesheet', 'https://cdn.example/theme.css', { status: 302, location: 'https://cdn.example/new.css' }, false],
    ['xhr', 'https://rustjobs.dev/api/jobs', { status: 404 }, true],
    ['script', 'https://cdn.example/blocked.js', { code: 'ECAREEROPS_BLOCKED_ADDRESS' }, true],
  ]) {
    let handler, fulfilled, aborted = false;
    const assertTransport = await routeCustomBrowserRequests({ route: async (_pattern, fn) => { handler = fn; } }, {
      fetchResponse: async () => { throw Object.assign(new Error('fixture transport error'), error); },
    });
    await handler({ request: () => ({ ...fakeRequest(url), resourceType: () => type, frame: () => ({ url: () => 'https://rustjobs.dev/' }) }),
      fulfill: async value => { fulfilled = value; }, abort: async () => { aborted = true; } });
    if (fatal) { assert.equal(aborted, true); assert.throws(assertTransport); }
    else { assert.equal(fulfilled.status, error.status); assertTransport(); }
  }
});

test('browser scripts and stylesheets do not consume the document/API probe budget', async () => {
  let calls = 0;
  const request = async () => { calls++; return new Response('fixture'); };
  const { ctx: bounded, wasTripped } = boundedProbeCtx({ fetchJson: request, fetchText: request, fetchResponse: request });
  for (let index = 0; index < 8; index++) await bounded.fetchResponse('https://example.com/script.js', { browserResourceType: 'script' });
  for (let index = 0; index < 4; index++) await bounded.fetchResponse('https://example.com/', { browserResourceType: 'document' });
  await assert.rejects(bounded.fetchResponse('https://example.com/api/jobs', { browserResourceType: 'xhr' }));
  assert.equal(calls, 12);
  assert.equal(wasTripped(), true);
});
