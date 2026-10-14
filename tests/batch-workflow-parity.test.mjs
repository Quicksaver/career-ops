import { copyBatchOwnership } from './copy-batch-ownership.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, existsSync, symlinkSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, getBash, toBashPath, rmSync } from './helpers.mjs';
import { loadAnswers, loadQueue, validLocal, validateHold, canResume, writeHold } from '../batch/manual-inputs.mjs';
import { validateWorkerArtifacts, parseTrackerAddition } from '../batch/validate-worker-artifacts.mjs';

const url = 'https://www.linkedin.com/jobs/view/123';
const hold = { status: 'needs_confirmation', id: '1', url, report_num: '001', company: '', role: '', score: null, legitimacy: null, via: null, company_confidential: null, pdf: null, report: null, tracker: null, error: null, question: 'Paste JD text or employer URL', reason: 'jd_unavailable' };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'batch-parity-'));
  const batch = join(root, 'batch');
  const bin = join(root, 'bin');
  for (const dir of [batch, bin, join(root, 'reports'), join(root, 'jds'), join(root, 'config')]) mkdirSync(dir, { recursive: true });
  for (const name of ['batch-runner.sh', 'batch-prompt.md', 'batch-output-schema.json', 'manual-inputs.mjs']) copyFileSync(join(ROOT, 'batch', name), join(batch, name));
  mkdirSync(join(root, 'lib'), { recursive: true });
  copyBatchOwnership(root);
  copyFileSync(join(ROOT, 'lib/is-main-module.mjs'), join(root, 'lib/is-main-module.mjs'));
  writeFileSync(join(root, 'reserve-report-num.mjs'), 'if (!process.argv.includes("--release")) console.log("001");\n');
  for (const name of ['merge-tracker.mjs', 'reconcile-pipeline.mjs']) writeFileSync(join(root, name), 'console.log("fixture reconciliation");\n');
  // Any network/paid agent call becomes observable without contacting anything.
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\necho curl >> "$FIXTURE_CALLS"\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(root, 'fixture-worker.mjs'), `import {readFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2), prompt=args.at(-1);
writeFileSync(process.env.FIXTURE_CALLS+'.worker',args.join('\\n'));
const jdPath=prompt.match(/JD file: (.*?)\\. Report number:/)?.[1];
if(jdPath) writeFileSync(process.env.FIXTURE_CALLS+'.jd',readFileSync(jdPath));
const result=JSON.parse(process.env.FIXTURE_RESULT);
result.url=prompt.match(/Internal batch locator: (.*?)\\. Explicit per-posting/)?.[1] || result.url;
console.log('\u0060\u0060\u0060json\\n'+JSON.stringify(result)+'\\n\u0060\u0060\u0060');\n`);
  writeFileSync(join(bin, 'claude'), '#!/usr/bin/env bash\nnode "$FIXTURE_WORKER" "$@"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), '#!/usr/bin/env bash\necho unexpected-codex-worker >&2\nexit 99\n', { mode: 0o755 });
  writeFileSync(join(batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${url}\tfixture\t\n2\thttps://example.com/other\tfixture\t\n`);
  const calls = join(root, 'calls');
  const run = (args, cli = 'claude', envCli = '') => spawnSync(getBash(), ['-c', 'export PATH="$1:$PATH"\nshift\nexec bash "$@"', 'batch-fixture', toBashPath(bin), join(batch, 'batch-runner.sh'), '--user', 'fixture', ...(cli ? ['--cli', cli, '--model', 'fixture'] : []), '--defer-verification', ...args], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_USER: 'fixture', CAREER_OPS_BATCH_CLI: envCli, PATH: bin + delimiter + process.env.PATH, FIXTURE_CALLS: calls, FIXTURE_WORKER: join(root, 'fixture-worker.mjs'), FIXTURE_CURL_JS: join(root, 'curl-stub.mjs'), FIXTURE_RESULT: JSON.stringify({ ...hold, reason: 'agency_confirmation', question: 'Which agency?' }) },
  });
  return { root, batch, calls, run };
}

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

test('LinkedIn holds before fetch/worker; queues isolate dispatch and valid JD answers resume the exact hold', () => {
  const f = fixture();
  try {
    const queue = join(f.root, 'queue.txt');
    writeFileSync(queue, `${url}\n`);
    let result = f.run(['--queue-file', queue]);
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(f.calls), false); assert.equal(existsSync(`${f.calls}.worker`), false);
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
    const worker = readFileSync(`${f.calls}.worker`, 'utf8');
    assert.match(worker, /pasted verbatim/);
    assert.equal(readFileSync(`${f.calls}.jd`, 'utf8'), jd);
    assert.equal(JSON.parse(readFileSync(join(f.batch, 'logs/1.hold.json'), 'utf8')).reason, 'agency_confirmation');
    assert.equal(existsSync(join(f.batch, 'tracker-additions/1.tsv')), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('the HTTP prefetch reaches the worker without being erased by the local branch', () => {
  const f = fixture();
  try {
    const posting = 'https://example.com/posting';
    const queue = join(f.root, 'queue.txt'); writeFileSync(queue, posting + '\n');
    writeFileSync(join(f.batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${posting}\tfixture\t\n`);
    const jd = 'Real employer JD responsibilities and qualifications '.repeat(30).trim();
    const content = join(f.root, 'curl-content'); writeFileSync(content, jd);
    writeFileSync(join(f.root, 'curl-stub.mjs'), `import {writeFileSync} from 'node:fs'; const args=process.argv.slice(2); writeFileSync(args[args.indexOf('--output')+1], ${JSON.stringify(jd)});\n`);
    writeFileSync(join(f.root, 'bin/curl'), '#!/usr/bin/env bash\nnode "$FIXTURE_CURL_JS" "$@"\n', { mode: 0o755 });
    const result = f.run(['--queue-file', queue]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(`${f.calls}.jd`, 'utf8'), jd, result.stdout + result.stderr);
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
    writeFileSync(finalPath, JSON.stringify({ status: 'completed', report_num: '001', company: 'Acme', role: 'Engineer', via: null, company_confidential: false, pdf: null, report: reportPath, tracker: trackerPath }));
    assert.equal(validate().valid, true);
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

test('batch loads canonical format/template/check workflow and defers candidate narrative', () => {
  const prompt = readFileSync(join(ROOT, 'batch/batch-prompt.md'), 'utf8');
  for (const mode of ['oferta', 'pdf', 'text', 'latex', 'pipeline', 'auto-pipeline']) assert.match(prompt, new RegExp(`modes/${mode}\\.md`));
  for (const feature of ['cv.output_format', 'cv.template', 'page_format', 'cv-templates.mjs', 'ats-payload.mjs', 'keyword', 'title-consistency', 'structure', 'fact', 'omit `--report`']) assert.ok(prompt.includes(feature), feature);
  assert.match(prompt, /before loading `cv.md`, `article-digest.md`/);
  assert.doesNotMatch(prompt, /templates\/cv-template\.html/);
});
