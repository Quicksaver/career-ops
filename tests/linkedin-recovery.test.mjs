import './user-fixture.mjs';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { linkedinPostingId, publishRecovery, recoverPosting, recoveryTargets } from '../lib/linkedin-recovery.mjs';

const url = 'https://www.linkedin.com/jobs/view/1234567890/';
const jd = 'We need a fictional backend engineer to design reliable services, build APIs, review code, write tests, and work with customers. Requirements include practical programming experience, communication skills, and experience with relational databases.';
let browser;
before(async () => {browser = await chromium.launch({ headless: true });});
after(async () => {await browser?.close();});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'linkedin-recovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data')); mkdirSync(join(root, 'batch'));
  const pipelinePath = join(root, 'data/pipeline.md');
  writeFileSync(pipelinePath, `# Pipeline\n\n## Pending\n\n- [!] ${url} | Fictional | Backend Engineer | JD unavailable\n- [ ] https://other.example/job\n\n## Processed\n\n- [x] previous\n`);
  return { userRoot: root, pipelinePath, target: recoveryTargets(readFileSync(pipelinePath, 'utf8'))[0] };
}

test('recovery preserves original posting provenance, new queue additions and existing processed rows', async t => {
  const f = fixture(t);
  writeFileSync(f.pipelinePath, readFileSync(f.pipelinePath, 'utf8').replace('## Processed', '- [ ] https://concurrent.example/job\n\n## Processed'));
  const result = await publishRecovery({ ...f, result: { status: 'recovered', jdText: jd, title: 'Backend Engineer', company: 'Fictional', applicationUrl: 'https://employer.example/job' } });
  assert.equal(result.status, 'recovered');
  const capture = readFileSync(join(f.userRoot, result.capture), 'utf8');
  assert.ok(capture.includes(`source_url: ${url}`)); assert.ok(capture.includes(jd));
  const pipeline = readFileSync(f.pipelinePath, 'utf8');
  assert.ok(pipeline.includes(`- [ ] local:${result.capture}`));
  assert.ok(pipeline.includes('https://concurrent.example/job')); assert.ok(pipeline.includes('- [x] previous'));
  assert.equal(recoveryTargets(pipeline).length, 0);
});

test('a concurrently edited hold and terminal batch state are protected', async t => {
  const f = fixture(t);
  writeFileSync(join(f.userRoot, 'batch/batch-state.tsv'), `id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n1\t${url}\tclosed\t-\t-\t-\t-\tposting-closed\t0\n`);
  assert.equal((await publishRecovery({ ...f, result: { status: 'recovered', jdText: jd } })).status, 'protected');
  writeFileSync(f.pipelinePath, readFileSync(f.pipelinePath, 'utf8').replace('JD unavailable', 'User changed this hold'));
  assert.equal((await publishRecovery({ ...f, result: { status: 'recovered', jdText: jd } })).status, 'changed');
  assert.equal(existsSync(join(f.userRoot, 'jds')), false);
});

test('explicitly closed postings leave Pending as Closed without fabricated job artifacts', async t => {
  const f = fixture(t);
  assert.equal((await publishRecovery({ ...f, result: { status: 'closed', evidence: 'No longer accepting applications' } })).status, 'closed');
  const text = readFileSync(f.pipelinePath, 'utf8');
  assert.ok(text.includes(`- [x] — | ${url} | Closed:`));
  assert.equal(recoveryTargets(text).length, 0); assert.equal(existsSync(join(f.userRoot, 'jds')), false);
});

test('capture directory symlinks cannot escape the selected user', async t => {
  const f = fixture(t), outside = mkdtempSync(join(tmpdir(), 'linkedin-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  try {symlinkSync(outside, join(f.userRoot, 'jds'), 'junction');} catch (error) {t.skip(error.message); return;}
  await assert.rejects(publishRecovery({ ...f, result: { status: 'recovered', jdText: jd } }), /escapes selected user/);
});

test('canonical posting recovery uses one page navigation and expands only its JD', async () => {
  const context = await browser.newContext();
  try {
    let requests = 0;
    await context.route('**/*', route => {requests++;return route.fulfill({ contentType: 'text/html', body: `<title>Backend Engineer | Fictional | LinkedIn</title><main><section><h2>About the company</h2><span data-testid="expandable-text-box">Company biography.</span></section><section><h2>About the job</h2><span id="jd" data-testid="expandable-text-box">Partial job text… more</span><button data-testid="expandable-text-button" aria-hidden="true" onclick="document.getElementById('jd').textContent=${JSON.stringify(jd).replaceAll('"', '&quot;')};this.hidden=true">more</button></section></main>` });});
    const result = await recoverPosting(await context.newPage(), url);
    assert.equal(result.status, 'recovered'); assert.equal(result.jdText, jd); assert.equal(result.company, 'Fictional'); assert.equal(requests, 1);
  } finally {await context.close();}
});

test('recovery never accepts a different posting identity or a login wall', async () => {
  for (const destination of ['/jobs/view/999/', '/login']) {
    const context = await browser.newContext();
    try {
      await context.route('**/*', route => route.fulfill({contentType:'text/html',body:`<script>history.replaceState(null,'',${JSON.stringify(destination)})</script><main><h2>About the job</h2><span data-testid="expandable-text-box">${jd}</span></main>`}));
      const result = await recoverPosting(await context.newPage(), url);
      assert.equal(result.status, destination === '/login' ? 'login_required' : 'unavailable');
    } finally {await context.close();}
  }
  assert.equal(linkedinPostingId(url+'?other=job'), null);
});
