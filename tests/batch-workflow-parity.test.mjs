import { copyBatchOwnership } from './copy-batch-ownership.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, getBash, toBashPath, rmSync } from './helpers.mjs';
import { loadAnswers, loadQueue, validLocal, validateHold, canResume, writeHold, JD_SKIP_REASON, JOB_SKIP_REASON } from '../batch/manual-inputs.mjs';
import { validateWorkerArtifacts, parseTrackerAddition } from '../batch/validate-worker-artifacts.mjs';
import { savePostingContext } from '../lib/posting-context.mjs';
import { url, hold, fixture } from './fixtures/batch-workflow-parity.mjs';

for (const cli of ['claude', 'codex']) test(`${cli} closes a local capture using exact internal identity without producing a hold`, () => {
  const f=fixture({workerResult:{status:'closed',reason:'posting_closed',question:null}});
  try {
    const local='local:jds/closed.md';
    writeFileSync(join(f.root,'jds/closed.md'),'---\nsource_url: https://www.linkedin.com/jobs/view/123\n---\nArchived posting text.');
    writeFileSync(join(f.batch,'batch-input.tsv'),`id\turl\tsource\tnotes\n1\t${local}\tfixture\t\n`);
    if(cli==='codex') writeFileSync(join(f.root,'bin/codex'),'#!/usr/bin/env bash\nnode "$FIXTURE_WORKER" "$@"\n',{mode:0o755});
    const result=f.run([],cli);
    assert.equal(result.status,0,result.stdout+result.stderr);
    const cells=readFileSync(join(f.batch,'batch-state.tsv'),'utf8').trim().split('\n')[1].split('\t');
    assert.equal(cells[1],local);assert.equal(cells[2],'closed');assert.equal(cells[8],'0');
    assert.equal(existsSync(join(f.batch,'logs/1.hold.json')),false);
    assert.match(result.stdout,/Closed: local:jds\/closed.md/);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('a local capture hands the worker its apply link only when that link is a public posting URL', () => {
  const f=fixture({workerResult:{status:'closed',reason:'posting_closed',question:null}});
  try {
    const local='local:jds/captured.md';
    writeFileSync(join(f.batch,'batch-input.tsv'),`id\turl\tsource\tnotes\n1\t${local}\tfixture\t\n`);
    // LinkedIn renders an employer's apply email as http://name@host.
    for (const [applicationUrl, expected] of [['http://apply+123@example.com', url], ['https://example.com/jobs/7', 'https://example.com/jobs/7']]) {
      writeFileSync(join(f.root,'jds/captured.md'),`---\nsource_url: ${url}\napplication_url: "${applicationUrl}"\n---\nArchived posting text.`);
      rmSync(join(f.batch,'batch-state.tsv'),{force:true});
      const result=f.run([]);
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.match(readFileSync(`${f.calls}.prompt`,'utf8'),new RegExp(`^URL: ${expected.replace(/[.+?/]/g,'\\$&')}$`,'m'),applicationUrl);
    }
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('standalone defaults to Codex with system model/reasoning; env and explicit Claude overrides win', () => {
  const f = fixture();
  try {
    let result = f.run(['--dry-run'], null);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /CLI: codex/); assert.match(result.stdout, /Model: gpt-6.1-sol/); assert.match(result.stdout, /Reasoning effort: medium/);
    result = f.run(['--dry-run'], null, 'claude');
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /CLI: claude/);
    result = f.run(['--dry-run'], 'claude', 'codex');
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /CLI: claude/);
    assert.equal(existsSync(`${f.calls}.worker`), false); assert.equal(existsSync(f.calls), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('manual answers validate user, exact URL/reason and contained local references', () => {
  const f = fixture();
  try {
    const path = join(f.root, 'answers.json');
    const save = answers => writeFileSync(path, JSON.stringify({ schema_version: 1, user: 'fixture', answers }));
    save([{ url, reason: 'agency_confirmation', answer: 'Acme recruiting' }]);
    const answers = loadAnswers(path, 'fixture', f.root);
    assert.throws(() => loadAnswers(path, 'another'), /matching user/);
    assert.equal(canResume({ ...hold, user: 'fixture' }, answers, { id: '1', url, user: 'fixture' }), false);
    assert.equal(canResume({ ...hold, reason: 'agency_confirmation', user: 'fixture' }, answers, { id: '1', url, user: 'fixture' }), true);
    assert.equal(canResume({ ...hold, reason: 'agency_confirmation', user: 'fixture' }, answers, { id: '2', url, user: 'fixture' }), false);
    assert.equal(validateHold({ ...hold, pdf: 'made-up.pdf' }, { id: '1', url }).length > 0, true);
    for (const a of [
      { url, reason: 'jd_unavailable', answer: 'yes' },
      { url, reason: 'jd_unavailable', answer: 'yes', employer_url: 'http://127.0.0.1/admin' },
      { url, reason: 'jd_unavailable', answer: 'yes', employer_url: url },
      { url: 'local:jds/../../cv.md', reason: 'agency_confirmation', answer: 'agency' },
    ]) { save([a]); assert.throws(() => loadAnswers(path, 'fixture', f.root)); }
    const local = 'local:jds/auth-job.md';
    save([{ url: local, reason: 'agency_confirmation', answer: 'Agency' }]);
    assert.equal(loadAnswers(path, 'fixture', f.root)[0].url, local);
    for (const bad of ['local:/etc/passwd', 'local:jds/../cv.md', 'local:jds/%2e%2e/cv.md', 'local:jds/C:/cv.md', 'local:jds/a\\b.md']) assert.equal(validLocal(bad, f.root), false);
    const queue = join(f.root, 'queue.txt');
    writeFileSync(queue, `${local}\n${url}\n`);
    assert.deepEqual([...loadQueue(queue, f.root)], [local, url]);
    // Junctions need no elevated symlink privilege on Windows.
    const outside = mkdtempSync(join(tmpdir(), 'batch-outside-'));
    try {
      symlinkSync(outside, join(f.root, 'jds', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
      writeFileSync(join(outside, 'job.md'), 'outside');
      assert.equal(validLocal('local:jds/escape/job.md', f.root), false);
    } finally { rmSync(join(f.root, 'jds', 'escape'), { force: true, recursive: true }); rmSync(outside, { recursive: true, force: true }); }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('explicit empty JD resolution skips the real batch without fetching, reserving or invoking a worker and reconciles without artifacts', () => {
  const f = fixture();
  try {
    const queue = join(f.root, 'queue.txt'), answers = join(f.root, 'answers.json');
    writeFileSync(queue, `${url}\n`);
    let result = f.run(['--queue-file', queue]);
    assert.equal(result.status, 0, result.stderr);
    const statePath = join(f.batch, 'batch-state.tsv');
    writeFileSync(statePath, readFileSync(statePath, 'utf8').replace(/\t0\r?\n$/, '\t2\n'));
    writeFileSync(join(f.root, 'reserve-report-num.mjs'), 'throw new Error("No report reservation is allowed for an explicit no-JD resolution");\n');
    const resolution = { url, reason: 'jd_unavailable', answer: '', resolution: 'skip' };
    const save = answer => writeFileSync(answers, JSON.stringify({ schema_version: 1, user: 'fixture', answers: [answer] }));
    for (const bad of [
      { ...resolution, resolution: 'unknown' }, { ...resolution, resolution: undefined },
      { ...resolution, reason: 'agency_confirmation' }, { ...resolution, answer: 'yes' },
      { ...resolution, jd_text: 'invented' }, { ...resolution, employer_url: 'https://employer.example/job' },
    ]) { save(bad); assert.throws(() => loadAnswers(answers, 'fixture', f.root)); }
    save(resolution);
    assert.deepEqual(loadAnswers(answers, 'fixture', f.root), [resolution]);
    assert.throws(() => loadAnswers(answers, 'someone-else', f.root), /matching user/);
    result = f.run(['--queue-file', queue, '--answers-file', answers]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Skipped:.*user cannot supply/);
    const fields = readFileSync(statePath, 'utf8').trim().split('\n')[1].split('\t');
    assert.equal(fields[2], 'skipped');
    assert.deepEqual(fields.slice(5), ['-', '-', JD_SKIP_REASON, '2']);
    assert.equal(existsSync(f.calls), false);
    assert.equal(existsSync(`${f.calls}.worker`), false);
    assert.equal(existsSync(`${f.calls}.jd`), false);
    mkdirSync(join(f.root, 'data'));
    const pipeline = join(f.root, 'data/pipeline.md');
    writeFileSync(pipeline, `## Pending\n- [!] ${url} | JD unavailable\n- [ ] https://example.com/independent\n\n## Processed\n`);
    const reconcile = () => spawnSync(process.execPath, [join(ROOT, 'reconcile-pipeline.mjs'), '--user', 'fixture', '--pipeline', pipeline, '--state', statePath], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: f.root, CAREER_OPS_DATA_DIR: f.root, CAREER_OPS_PIPELINE: pipeline },
    });
    const terminalState = readFileSync(statePath, 'utf8'), unresolved = readFileSync(pipeline, 'utf8');
    for (const change of [{ 2: 'completed' }, { 5: '001' }]) {
      const invalid = [...fields];
      for (const [column, value] of Object.entries(change)) invalid[Number(column)] = value;
      writeFileSync(statePath, terminalState.split('\n')[0] + '\n' + invalid.join('\t') + '\n');
      result = reconcile(); assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(pipeline, 'utf8'), unresolved, 'only an explicit artifact-free skip bypasses report checks');
    }
    writeFileSync(statePath, terminalState);
    result = reconcile();
    assert.equal(result.status, 0, result.stderr);
    const processed = readFileSync(pipeline, 'utf8');
    assert.ok(processed.includes(`## Processed\n\n- [x] — | ${url} | Skipped: user cannot supply`));
    assert.match(processed, /- \[ \] https:\/\/example.com\/independent/);
    assert.doesNotMatch(processed, /- \[!\]/);
    assert.doesNotMatch(processed, /reports\//);
    result = reconcile(); assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(pipeline, 'utf8'), processed);
    result = f.run(['--queue-file', queue, '--answers-file', answers, '--retry-failed', '--resume-paused']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(`${f.calls}.worker`), false, 'terminal skip survives every retry flag');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('LinkedIn holds before fetch/worker; queues isolate dispatch and valid JD answers resume the exact hold', () => {
  const f = fixture();
  try {
    const queue = join(f.root, 'queue.txt');
    writeFileSync(queue, `${url}\n`);
    let result = f.run(['--queue-file', queue]);
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(f.calls), false); assert.equal(existsSync(`${f.calls}.worker`), false);
    assert.equal(existsSync(`${f.calls}.browser`), false);
    const persisted = JSON.parse(readFileSync(join(f.batch, 'logs/1.hold.json'), 'utf8'));
    assert.equal(persisted.reason, 'jd_unavailable'); assert.equal(persisted.url, url); assert.equal(persisted.user, 'fixture');
    assert.doesNotMatch(readFileSync(join(f.batch, 'batch-state.tsv'), 'utf8'), /example.com\/other/);
    const answersPath = join(f.root, 'answers.json');
    writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fixture', answers: [{ url: 'https://example.com/unrelated', reason: 'jd_unavailable', answer: 'pasted', jd_text: 'different JD' }] }));
    result = f.run(['--queue-file', queue, '--answers-file', answersPath, '--retry-failed']);
    assert.equal(result.status, 0, result.stderr); assert.equal(existsSync(`${f.calls}.worker`), false);
    const jd = 'User supplied the exact job description. '.repeat(30);
    writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fixture', answers: [{ url, reason: 'jd_unavailable', answer: 'pasted verbatim', jd_text: jd }] }));
    result = f.run(['--queue-file', queue, '--answers-file', answersPath, '--retry-failed']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(f.calls), false, 'pasted JD must not trigger curl');
    assert.equal(existsSync(`${f.calls}.browser`), false, 'pasted JD must not launch a browser');
    const worker = readFileSync(`${f.calls}.worker`, 'utf8');
    assert.match(worker, /pasted verbatim/);
    assert.equal(readFileSync(`${f.calls}.jd`, 'utf8'), jd);
    assert.equal(JSON.parse(readFileSync(join(f.batch, 'logs/1.hold.json'), 'utf8')).reason, 'agency_confirmation');
    assert.equal(existsSync(join(f.batch, 'tracker-additions/1.tsv')), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('failed-job skip bypasses exhausted retries without fetching, reserving or evaluating, quarantines partial additions and reconciles durably', () => {
  const f = fixture();
  try {
    const queue = join(f.root, 'queue.txt'), answers = join(f.root, 'answers.json');
    writeFileSync(queue, url + '\n');
    const resolution = { url, reason: 'job_failed', answer: '', resolution: 'skip' };
    const save = value => writeFileSync(answers, JSON.stringify({ schema_version: 1, user: 'fixture', answers: [value] }));
    for (const bad of [{ ...resolution, resolution: undefined, answer: 'retry' }, { ...resolution, answer: 'yes' }, { ...resolution, jd_text: 'made up' }]) {
      save(bad); assert.throws(() => loadAnswers(answers, 'fixture', f.root));
    }
    save(resolution);
    const statePath = join(f.batch, 'batch-state.tsv');
    writeFileSync(statePath, `id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n1\t${url}\tfailed\t-\t-\t042\t-\tstale posting\t7\n2\thttps://example.com/other\tfailed\t-\t-\t043\t-\tother failure\t9\n`);
    writeFileSync(join(f.root, 'reserve-report-num.mjs'), 'throw new Error("A skipped job cannot reserve a report");\n');
    mkdirSync(join(f.batch, 'tracker-additions'));
    writeFileSync(join(f.batch, 'tracker-additions/1.tsv'), 'partial failed worker output');
    const result = f.run(['--queue-file', queue, '--answers-file', answers]);
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /user discarded the failed job/);
    const fields = readFileSync(statePath, 'utf8').split('\n')[1].split('\t');
    assert.deepEqual(fields.slice(5), ['-', '-', JOB_SKIP_REASON, '7']);
    assert.equal(fields[2], 'skipped');
    assert.match(readFileSync(statePath, 'utf8'), /2\thttps:\/\/example.com\/other\tfailed/);
    assert.equal(existsSync(f.calls), false); assert.equal(existsSync(`${f.calls}.worker`), false);
    assert.equal(existsSync(join(f.batch, 'tracker-additions/1.tsv')), false);
    const quarantined = readdirSync(join(f.batch, 'logs/quarantine')).find(name => name.startsWith('skipped-1.'));
    assert.equal(readFileSync(join(f.batch, 'logs/quarantine', quarantined, '1.tsv'), 'utf8'), 'partial failed worker output');
    mkdirSync(join(f.root, 'data'));
    const pipeline = join(f.root, 'data/pipeline.md');
    writeFileSync(pipeline, `## Pending\n- [ ] ${url}\n- [ ] https://example.com/other\n\n## Processed\n`);
    const reconcile = () => spawnSync(process.execPath, [join(ROOT, 'reconcile-pipeline.mjs'), '--user', 'fixture', '--pipeline', pipeline, '--state', statePath], {
      encoding: 'utf8', timeout: 15000, env: { ...process.env, CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: f.root, CAREER_OPS_DATA_DIR: f.root, CAREER_OPS_PIPELINE: pipeline },
    });
    let checked = reconcile(); assert.equal(checked.status, 0, checked.stderr);
    const processed = readFileSync(pipeline, 'utf8');
    assert.ok(processed.includes(`- [x] — | ${url} | Skipped: user discarded the failed job`));
    assert.ok(!processed.includes(`[ ] ${url}`)); assert.match(processed, /\[ \] https:\/\/example.com\/other/);
    checked = reconcile(); assert.equal(checked.status, 0, checked.stderr); assert.equal(readFileSync(pipeline, 'utf8'), processed);
    const rerun = f.run(['--queue-file', queue, '--answers-file', answers, '--retry-failed', '--resume-paused']);
    assert.equal(rerun.status, 0, rerun.stderr); assert.equal(existsSync(`${f.calls}.worker`), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a valid local missing-JD hold retains the exact queue identity and spends no retries', () => {
  const f = fixture({ workerResult: { reason: 'jd_unavailable', question: 'Paste the full description.' } });
  try {
    const posting = 'local:jds/partial.md';
    writeFileSync(join(f.root, 'jds/partial.md'), 'Company introduction only. More...');
    writeFileSync(join(f.batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${posting}\tfixture\t\n`);
    const result = f.run([]);
    assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
    const state = readFileSync(join(f.batch, 'batch-state.tsv'), 'utf8').trim().split('\n')[1].split('\t');
    assert.equal(state[2], 'needs_confirmation'); assert.equal(state[8], '0');
    const saved = JSON.parse(readFileSync(join(f.batch, 'logs/1.hold.json'), 'utf8'));
    assert.equal(saved.url, posting); assert.equal(saved.reason, 'jd_unavailable');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('exact local agency answers resume only that held posting and survive empty state fields', () => {
  const f = fixture();
  try {
    const posting = 'local:jds/role.md'; writeFileSync(join(f.root, 'jds/role.md'), 'Archived job');
    writeFileSync(join(f.batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${posting}\tfixture\t\n2\thttps://example.com/other\tfixture\t\n`);
    mkdirSync(join(f.batch, 'logs'), { recursive: true });
    writeHold(join(f.batch, 'logs/1.hold.json'), { ...hold, url: posting, reason: 'agency_confirmation' }, 'fixture');
    writeFileSync(join(f.batch, 'batch-state.tsv'), `id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n1\t${posting}\tneeds_confirmation\t\t\t-\t-\tquestion\t0\n`);
    const queue = join(f.root, 'queue.txt'); writeFileSync(queue, posting + '\n');
    const answers = join(f.root, 'answers.json'); writeFileSync(answers, JSON.stringify({ schema_version: 1, user: 'fixture', answers: [{ url: posting, reason: 'agency_confirmation', answer: 'This is direct', direct_employer: true }] }));
    const result = f.run(['--dry-run', '--queue-file', queue, '--answers-file', answers, '--resume-paused']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Would process 1 offers/);
    assert.doesNotMatch(result.stdout, /#2:/);
    assert.match(readFileSync(join(f.batch, 'batch-state.tsv'), 'utf8'), /\tneeds_confirmation\t/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('terminal completed jobs are reconciled, never dispatched again', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.batch, 'batch-state.tsv'), `id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n1\t${url}\tcompleted\t\t\t001\t4.0\t\t0\n`);
    const queue = join(f.root, 'queue.txt'); writeFileSync(queue, `${url}\n`);
    const result = f.run(['--queue-file', queue]);
    assert.equal(result.status, 0, result.stderr); assert.equal(existsSync(`${f.calls}.worker`), false);
    assert.match(readFileSync(join(f.batch, 'batch-state.tsv'), 'utf8'), /\tcompleted\t/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('artifact gates enforce archive, format, Skip, primary PDF identity and empty Via semantics', () => {
  const f = fixture();
  try {
    const reportPath = join(f.root, 'reports/001-acme-2026-10-14.md');
    const trackerPath = join(f.batch, '1.tsv');
    const finalPath = join(f.root, 'final.json');
    const report = decision => `## Job Description (archived verbatim)\n${'Real JD requirement '.repeat(30)}\n## Machine Summary\n\n\`\`\`yaml\ncompany: Acme\nrole: Engineer\nscore: 4.0\nvia: null\ncompany_confidential: false\nfinal_decision: ${decision}\nhard_stops: []\n\`\`\`\n`;
    const tsv = (pdf, status = 'Evaluated', via = '') => `num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\tvia\n001\t2026-10-14\tAcme\tEngineer\t${status}\t4.0/5\t${pdf}\t[001](reports/001-acme-2026-10-14.md)\tnote\t${url}\t${via}\n`;
    const validate = () => validateWorkerArtifacts({ reportPath, trackerPath, finalPath, strictWorkflow: true, userRoot: f.root, reportNum: '001' });
    writeFileSync(reportPath, report('Apply')); writeFileSync(trackerPath, tsv('❌'));
    writeFileSync(finalPath, JSON.stringify({ status: 'completed', report_num: '001', company: 'Acme', role: 'Engineer', score: 4, via: null, company_confidential: false, pdf: null, report: reportPath, tracker: trackerPath }));
    assert.equal(validate().valid, true);
    const originalFinal = JSON.parse(readFileSync(finalPath, 'utf8'));
    for (const score of [null, undefined, -1, 6, '4']) {
      writeFileSync(finalPath, JSON.stringify({ ...originalFinal, score }));
      assert.match(validate().errors.join(';'), /final JSON score/);
    }
    writeFileSync(finalPath, JSON.stringify(originalFinal));
    for (const score of ['null', '.inf', '6', '-1', 'true', '[4]', '{value: 4}', '""']) {
      writeFileSync(reportPath, report('Apply').replace('score: 4.0', `score: ${score}`));
      assert.match(validate().errors.join(';'), /report score/);
    }
    writeFileSync(reportPath, report('Apply'));
    writeFileSync(trackerPath, tsv('❌').replace('4.0/5', 'N/A'));
    assert.match(validate().errors.join(';'), /tracker score/);
    writeFileSync(trackerPath, tsv('❌'));
    assert.equal(parseTrackerAddition(readFileSync(trackerPath, 'utf8')).via, '');
    writeFileSync(trackerPath, tsv('❌', 'Evaluated', 'null')); assert.equal(validate().valid, false);
    writeFileSync(trackerPath, tsv('✅')); writeFileSync(join(f.root, 'config/profile.yml'), 'cv:\n  output_format: text\n');
    assert.match(validate().errors.join(';'), /text\/latex/);
    writeFileSync(reportPath, report('Skip')); assert.match(validate().errors.join(';'), /Skip\/hard stops/);
    writeFileSync(reportPath, report('Apply')); writeFileSync(join(f.root, 'config/profile.yml'), 'cv:\n  output_format: pdf\n');
    const final = JSON.parse(readFileSync(finalPath, 'utf8')); final.pdf = join(f.root, 'output/001-acme-2026-10-14-ats.pdf'); writeFileSync(finalPath, JSON.stringify(final));
    assert.match(validate().errors.join(';'), /flat report-linked/);
    mkdirSync(join(f.root, 'output'), { recursive: true });
    mkdirSync(join(f.root, 'data'), { recursive: true });
    final.pdf = join(f.root, 'output/001-acme-2026-10-14.pdf'); writeFileSync(final.pdf, 'fixture PDF'); writeFileSync(finalPath, JSON.stringify(final));
    writeFileSync(join(f.root, 'data/pdf-index.tsv'), '001\toutput/001-acme-2026-10-14-ats.pdf\toutput/001-acme-2026-10-14-ats.html\ta4\t2026-10-14\tcv\n');
    assert.match(validate().errors.join(';'), /overwrote the primary/);
    writeFileSync(join(f.root, 'data/pdf-index.tsv'), '001\toutput/001-acme-2026-10-14.pdf\toutput/001-acme-2026-10-14.html\ta4\t2026-10-14\tcv\n');
    assert.equal(validate().valid, true);
    writeFileSync(reportPath, report('Apply').replace(/## Job Description[\s\S]*?## Machine Summary/, '## Machine Summary'));
    assert.match(validate().errors.join(';'), /archive/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('worker timeout is validated before state mutation and retains zero and decimal compatibility', () => {
  const f=fixture();
  try {
    const state=join(f.batch,'batch-state.tsv');
    const before='sentinel state\n'; writeFileSync(state,before);
    for (const value of ['NaN','Infinity','-1','invalid','']) {
      const result=f.run(['--worker-timeout',value]);
      assert.notEqual(result.status,0,result.stdout+result.stderr);
      assert.equal(readFileSync(state,'utf8'),before);
      assert.equal(existsSync(`${f.calls}.worker`),false);
      assert.equal(existsSync(join(f.batch,'batch-runner.pid.owner.lock')),false);
    }
    for(const value of ['0','0.25']) {
      const result=f.run(['--dry-run','--worker-timeout',value]);
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.equal(readFileSync(state,'utf8'),before);
    }
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('explicit JD text replaces a missing local capture and remains absent from echoed manual answers', () => {
  const f = fixture();
  try {
    const local = 'local:jds/missing.md';
    const text = 'Exact user supplied JD text.\nKeep these bytes unchanged.\n';
    writeFileSync(join(f.batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${local}\tfixture\t\n`);
    const queue = join(f.root, 'queue.txt');
    const answers = join(f.root, 'answers.json');
    writeFileSync(queue, `${local}\n`);
    writeFileSync(answers, JSON.stringify({ schema_version: 1, user: 'fixture', answers: [{ url: local, reason: 'jd_unavailable', answer: 'Captured the posting.', jd_text: text }] }));
    const result = f.run(['--queue-file', queue, '--answers-file', answers]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(`${f.calls}.jd`, 'utf8'), text);
    const prompt = readFileSync(`${f.calls}.worker`, 'utf8');
    assert.doesNotMatch(prompt, /Exact user supplied JD text/);
    assert.match(prompt, /Internal batch locator: local:jds\/missing\.md/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('batch loads canonical format/template/check workflow and defers candidate narrative', () => {
  const prompt = readFileSync(join(ROOT, 'batch/batch-prompt.md'), 'utf8');
  for (const mode of ['oferta', 'pdf', 'text', 'latex', 'pipeline', 'auto-pipeline']) assert.match(prompt, new RegExp(`modes/${mode}\\.md`));
  for (const feature of ['cv.output_format', 'cv.template', 'page_format', 'cv-templates.mjs', 'ats-payload.mjs', 'keyword', 'title-consistency', 'structure', 'fact', 'omit `--report`']) assert.ok(prompt.includes(feature), feature);
  assert.match(prompt, /before loading `cv.md`, `article-digest.md`/);
  assert.doesNotMatch(prompt, /templates\/cv-template\.html/);
});
