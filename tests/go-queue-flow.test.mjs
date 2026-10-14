import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkNodeModules } from './helpers.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const offline = readFileSync(join(repo, 'tests/fixtures/go-queue-offline.mjs'), 'utf8');
const A = 'https://jobs.example.org/alpha';
const B = 'https://jobs.example.org/beta';
const C = 'https://jobs.example.org/charlie';

function copyGraph(root, file, copied = new Set()) {
  const source = resolve(repo, file);
  if (copied.has(source)) return;
  copied.add(source);
  const target = join(root, relative(repo, source));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
  const text = readFileSync(source, 'utf8');
  for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
    const dependency = resolve(dirname(source), match[1]);
    if (existsSync(dependency)) copyGraph(root, relative(repo, dependency), copied);
  }
}

function fixture(t, { rows = [A], ...config } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'go-queue-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  for (const file of ['go-runner.mjs', 'sync-pipeline-batch.mjs', 'pipeline-liveness.mjs']) copyGraph(root, file);
  cpSync(join(repo, 'tracker-aliases.json'), join(root, 'tracker-aliases.json'));
  assert.equal(linkNodeModules(root), null, 'offline fixture must resolve the checkout dependencies');
  mkdirSync(join(root, 'schemas'), { recursive: true });
  cpSync(join(repo, 'schemas/go-handoff-output.schema.json'), join(root, 'schemas/go-handoff-output.schema.json'));
  const user = join(root, 'users/fictional');
  for (const directory of ['data', 'config', 'batch/logs', 'jds']) mkdirSync(join(user, directory), { recursive: true });
  writeFileSync(join(user, 'config/profile.yml'), '{}\n');
  writeFileSync(join(user, 'fixture.json'), JSON.stringify(config));
  writeFileSync(join(user, 'data/pipeline.md'), '# Fictional test inbox\n\n## Pending\n' + rows.map(row => row.startsWith('- ') ? row : `- [ ] ${row}`).join('\n') + '\n\n## Processed\n');
  for (const phase of ['doctor', 'scan', 'scan-auth', 'pipeline-liveness', 'merge-tracker', 'reconcile-pipeline', 'cv-sync-check', 'verify-runner', 'codex-mock', 'batch-mock', 'check-liveness']) writeFileSync(join(root, `${phase}.mjs`), offline);
  writeFileSync(join(root, 'batch/batch-runner.sh'), '#!/usr/bin/env bash\nset -e\nexec node ./batch-mock.mjs "$@"\n');
  const bin = join(root, 'mock-bin');
  mkdirSync(bin);
  // Keep the mock entrypoint at checkout root so its relative imports stay real.
  writeFileSync(join(bin, 'codex.cmd'), '@ECHO OFF\r\nSET dp0=%~dp0\r\nnode "%dp0%/../codex-mock.mjs" %*\r\n');
  writeFileSync(join(bin, 'codex'), `#!/usr/bin/env node\nimport '../codex-mock.mjs';\n`, { mode: 0o755 });
  if (process.platform === 'win32') rmSync(join(bin, 'codex'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CAREER_OPS_/i.test(key) && !/^PATH$/i.test(key)));
  Object.assign(env, { PATH: bin + delimiter + process.env.PATH, CAREER_OPS_ROOT: user, CAREER_OPS_USERS_DIR: join(root, 'users'), CAREER_OPS_TRACKER: join(user, 'data/applications.md'), CAREER_OPS_USER: 'fictional' });
  const read = path => readFileSync(join(user, path), 'utf8');
  const records = path => existsSync(join(user, path)) ? read(path).trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const run = async (args = ['--skip-linkedin'], script = 'go-runner.mjs') => {
    const child = spawn(process.execPath, [join(root, script), '--user', 'fictional', '--json', ...args], { cwd: root, env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);
    const timer = setTimeout(() => child.kill(), 30000);
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    clearTimeout(timer);
    assert.ok(stdout.trim(), `runner emitted no JSON: ${stderr}`);
    let result;
    try { result = JSON.parse(stdout.trim()); } catch { assert.fail(`invalid stdout: ${stdout}\n${stderr}`); }
    return { code, result, stderr };
  };
  return { root, user, env, run, read, records, calls: () => records('calls.jsonl'), dispatched: () => records('dispatched.jsonl').map(row => row.url) };
}

test('go drains existing backlog when discovery adds zero, using real Bash and queue-file isolation', async t => {
  const f = fixture(t);
  writeFileSync(join(f.user, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n40\t${B}\thistorical\t\n`);
  const { code, result } = await f.run();
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(code, 0);
  assert.equal(result.scan.added, 0);
  assert.equal(result.remaining, 0);
  assert.deepEqual(f.dispatched(), [A]);
  const batch = f.calls().find(c => c.phase === 'batch-mock');
  assert.ok(batch, 'the Bash stub must actually invoke Node');
  assert.equal(batch.args[batch.args.indexOf('--model') + 1], 'gpt-6.1-sol');
  assert.equal(batch.args[batch.args.indexOf('--reasoning-effort') + 1], 'medium');
  const verify = f.calls().find(c => c.phase === 'verify-runner');
  assert.equal(verify.args[verify.args.indexOf('--codex-model') + 1], 'gpt-6.1-sol');
  assert.equal(verify.args[verify.args.indexOf('--codex-reasoning-effort') + 1], 'medium');
});

test('--skip-scan bypasses every discovery phase, including stale handoff', async t => {
  const f = fixture(t, { handoff: true });
  writeFileSync(join(f.user, 'data/scan-handoff.json'), JSON.stringify({ items: [{ company: 'Old' }] }));
  const { result } = await f.run(['--skip-scan', '--scan-full', '--scan-hn', '--scan-dayforce', '--scan-interamt']);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.ok(!f.calls().some(c => ['scan', 'scan-auth', 'codex-mock'].includes(c.phase)));
  assert.deepEqual(f.dispatched(), [A]);
});

for (const scenario of [{ scanError: true }, { handoff: true, handoffPartial: true }, { login: true }, { handoff: true, malformedHandoff: true }]) {
  test(`discovery remains partial while independent backlog finishes: ${JSON.stringify(scenario)}`, async t => {
    const f = fixture(t, scenario);
    const { code, result } = await f.run(scenario.login ? [] : ['--skip-linkedin']);
    assert.equal(result.status, 'partial', JSON.stringify(result));
    assert.equal(code, 2);
    assert.equal(result.remaining, 0);
    assert.deepEqual(f.dispatched(), [A]);
    if (scenario.login) assert.ok(result.manual_actions.some(a => a.kind === 'source' && a.reason === 'source_login'));
    else assert.ok(result.issues.length > 0);
    if (scenario.scanError) {
      assert.equal(result.scan.status, 'partial');
      assert.equal(result.phases.find(p => p.name === 'scan').exit_code, 2);
    }
    if (scenario.handoff) {
      const call = f.calls().find(c => c.phase === 'codex-mock');
      assert.ok(call, `real Windows .cmd launcher must reach offline Codex: ${JSON.stringify(result)}`);
      assert.equal(call.args[call.args.indexOf('--model') + 1], 'gpt-6.1-sol');
      assert.ok(call.args.includes('model_reasoning_effort="medium"'));
      if (scenario.handoffPartial) assert.equal(result.handoff.status, 'partial');
      if (scenario.malformedHandoff) assert.match(result.issues.find(i => i.phase === 'handoff').message, /counts\/status disagree/);
    }
  });
}

test('mixed holds produce structured actions without artifacts and exact answers resume both forms', async t => {
  const f = fixture(t, { rows: [A, B, C], holds: { [A]: 'agency_confirmation', [B]: 'jd_unavailable' } });
  let run = await f.run(['--skip-scan']);
  assert.equal(run.result.status, 'partial', JSON.stringify(run.result));
  assert.equal(run.result.remaining, 2);
  assert.deepEqual(run.result.manual_actions.map(a => [a.url, a.reason]).sort(), [[A, 'agency_confirmation'], [B, 'jd_unavailable']].sort());
  assert.ok(!existsSync(join(f.user, 'output/1.done')));
  assert.ok(!existsSync(join(f.user, 'output/2.done')));
  assert.ok(existsSync(join(f.user, 'output/3.done')));
  const persisted = JSON.parse(f.read('data/manual-actions.json'));
  assert.equal(persisted.user, 'fictional');
  assert.deepEqual(persisted.actions.map(a => a.url).sort(), [A, B].sort());
  writeFileSync(join(f.user, 'data/pipeline.md'), `## Pending\n- [ ] ${A}\n- [!] ${B} — JD unavailable: paste JD\n\n## Processed\n`);
  const answerPath = join(f.user, 'answers.json');
  writeFileSync(answerPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [{ url: A, reason: 'agency_confirmation', answer: 'Direct employer confirmed', direct_employer: true }, { url: B, reason: 'jd_unavailable', answer: 'Use supplied text', jd_text: 'Fictional engineering role.' }] }));
  run = await f.run(['--skip-scan', '--answers-file', answerPath]);
  assert.equal(run.result.status, 'completed', JSON.stringify(run.result));
  assert.equal(run.result.remaining, 0);
  assert.ok(f.calls().filter(c => c.phase === 'batch-mock').at(-1).args.includes(answerPath));
  assert.ok(existsSync(join(f.user, 'output/1.done')));
  assert.ok(existsSync(join(f.user, 'output/2.done')));
});

test('[!] rows remain visible and prevent false completion', async t => {
  const f = fixture(t, { rows: [`- [!] ${A} — JD unavailable: paste JD`] });
  const { result } = await f.run(['--skip-scan']);
  assert.equal(result.status, 'partial');
  assert.equal(result.final_blocked, 1);
  assert.equal(result.remaining, 1);
  assert.equal(result.manual_actions[0].url, A);
  assert.deepEqual(f.dispatched(), []);
});

test('a job added during a batch is drained in the next queue pass', async t => {
  const f = fixture(t, { concurrent: B });
  const { result } = await f.run(['--skip-scan']);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.queue_passes, 2);
  assert.deepEqual(f.dispatched(), [A, B]);
});

for (const scenario of [{ stall: true }, { retry: true }, { limit: true }]) {
  test(`bounded work leaves a partial result: ${JSON.stringify(scenario)}`, async t => {
    const f = fixture(t, { rows: [A, B], ...scenario });
    if (scenario.stall) writeFileSync(join(f.user, 'batch/batch-state.tsv'), `id\turl\tstatus\tstarted\tcompleted\treport\tscore\terror\tretries\n1\t${A}\tfailed\t\t\t\t\t\t0\n2\t${B}\tfailed\t\t\t\t\t\t0\n`);
    const args = ['--skip-scan', '--max-queue-passes', '2'];
    if (scenario.limit) args.push('--limit', '1');
    const { result } = await f.run(args);
    assert.equal(result.status, 'partial', JSON.stringify(result));
    assert.ok(result.remaining > 0);
    assert.ok(result.queue_passes <= 2);
    assert.equal(result.queue_passes, scenario.retry ? 2 : 1);
  });
}

for (const verification of ['partial', 'failed']) {
  test(`empty queue cannot complete with ${verification} verification`, async t => {
    const f = fixture(t, { rows: [], verification });
    const { result } = await f.run(['--skip-scan']);
    assert.notEqual(result.status, 'completed');
    assert.equal(result.remaining, 0);
  });
}

test('verification requiring review prevents completion after all jobs finish', async t => {
  const f = fixture(t, { review: true });
  const { result } = await f.run(['--skip-scan']);
  assert.equal(result.remaining, 0);
  assert.equal(result.status, 'partial');
  assert.equal(result.needs_human_review, true);
});

test('answers for another URL or reason do not release held jobs', async t => {
  const f = fixture(t, { rows: [A], holds: { [A]: 'agency_confirmation' } });
  const first = await f.run(['--skip-scan']);
  assert.equal(first.result.remaining, 1);
  const path = join(f.user, 'wrong-answers.json');
  writeFileSync(path, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [
    { url: B, reason: 'agency_confirmation', answer: 'This is another posting', direct_employer: true },
    { url: A, reason: 'jd_unavailable', answer: 'Different question', jd_text: 'Fictional JD.' },
  ] }));
  const second = await f.run(['--skip-scan', '--answers-file', path]);
  assert.equal(second.result.status, 'partial', JSON.stringify(second.result));
  assert.equal(second.result.remaining, 1);
  assert.equal(second.result.queue_passes, 0);
  assert.deepEqual(f.dispatched(), [A], 'second invocation must not dispatch the unanswered hold again');
});

test('contained local JD queue entries reach the batch without becoming external URLs', async t => {
  const local = 'local:jds/fictional-role.md';
  const f = fixture(t, { rows: [local] });
  writeFileSync(join(f.user, 'jds/fictional-role.md'), 'A fictional engineering job description.');
  const { result } = await f.run(['--skip-scan']);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.deepEqual(f.dispatched(), [local]);
});

test('a clean handoff and drained queue complete successfully', async t => {
  const f = fixture(t, { handoff: true });
  const { result, code } = await f.run();
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.handoff.status, 'completed');
  assert.equal(result.handoff.duplicates, 1);
  assert.equal(code, 0);
});

test('real liveness helper preserves concurrent additions and excludes LinkedIn from checker', async t => {
  const linkedin = 'https://www.linkedin.com/jobs/view/123';
  const f = fixture(t, { rows: [A, linkedin] });
  cpSync(join(repo, 'pipeline-liveness.mjs'), join(f.root, 'pipeline-liveness.mjs'));
  const { result, code } = await f.run([], 'pipeline-liveness.mjs');
  assert.equal(code, 0, JSON.stringify(result));
  assert.deepEqual(JSON.parse(f.read('checked.json')), [A]);
  assert.equal(result.moved, 1);
  const pending = f.read('data/pipeline.md').split('## Processed')[0];
  assert.ok(pending.includes('https://jobs.example.org/concurrent'));
  assert.ok(pending.includes(linkedin));
  assert.ok(!pending.includes(A));
});

test('concurrent real synchronizers preserve unique stable job IDs', async t => {
  const f = fixture(t, { rows: [A, B, C] });
  const runs = await Promise.all(Array.from({ length: 4 }, () => f.run([], 'sync-pipeline-batch.mjs')));
  for (const run of runs) assert.equal(run.code, 0, JSON.stringify(run.result));
  const before = f.read('batch/batch-input.tsv');
  const lines = before.trim().split('\n').slice(1).map(line => line.split('\t'));
  assert.equal(lines.length, 3);
  assert.equal(new Set(lines.map(row => row[0])).size, 3);
  assert.equal(new Set(lines.map(row => row[1])).size, 3);
  await f.run([], 'sync-pipeline-batch.mjs');
  assert.equal(f.read('batch/batch-input.tsv'), before);
});

test('explicit inbox lanes reach queue dispatch and the real synchronizer', async t => {
  const f = fixture(t, { rows: [B] });
  const original = f.read('data/pipeline.md');
  const lane = join(f.user, 'data/lane.md');
  writeFileSync(lane, `## Pending\n- [ ] ${A}\n\n## Processed\n`);
  f.env.CAREER_OPS_PIPELINE = lane;
  const { result } = await f.run(['--skip-scan']);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.deepEqual(f.dispatched(), [A]);
  assert.equal(f.read('data/pipeline.md'), original, 'the other lane is unchanged');
});

test('failed bulk liveness does not block independent per-job processing', async t => {
  const f = fixture(t, { rows: [A, B], livenessFailure: true });
  const { result } = await f.run(['--skip-scan']);
  assert.equal(result.status, 'partial', JSON.stringify(result));
  assert.equal(result.remaining, 0);
  assert.deepEqual(f.dispatched().sort(), [A, B]);
  assert.ok(result.issues.some(issue => issue.phase === 'liveness'));
});

test('real liveness rewrites only the selected inbox lane', async t => {
  const f = fixture(t, { rows: [B] });
  const original = f.read('data/pipeline.md');
  const lane = join(f.user, 'data/lane.md');
  writeFileSync(lane, `## Pending\n- [ ] ${A}\n\n## Processed\n`);
  f.env.CAREER_OPS_PIPELINE = lane;
  cpSync(join(repo, 'pipeline-liveness.mjs'), join(f.root, 'pipeline-liveness.mjs'));
  const { result, code } = await f.run([], 'pipeline-liveness.mjs');
  assert.equal(code, 0, JSON.stringify(result));
  assert.equal(result.moved, 1);
  assert.ok(readFileSync(lane, 'utf8').includes('https://jobs.example.org/concurrent'));
  assert.equal(f.read('data/pipeline.md'), original);
});

test('recovery flags include pending jobs and grant extra retry only on the first pass', async t => {
  const f = fixture(t, { rows: [A], concurrent: B });
  const { result } = await f.run(['--skip-scan', '--retry-failed', '--resume-paused']);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  const batches = f.calls().filter(call => call.phase === 'batch-mock');
  assert.equal(batches.length, 2);
  assert.ok(batches.every(call => call.args.includes('--include-pending')));
  assert.ok(batches.every(call => call.args.includes('--resume-paused')));
  assert.ok(batches[0].args.includes('--retry-failed'));
  assert.ok(!batches[1].args.includes('--retry-failed'));
  assert.deepEqual(f.dispatched(), [A, B]);
});

for (const kind of ['alive', 'ambiguous']) {
  test(`native ${kind} batch ownership prevents dispatch and preserves its stamp`, async t => {
    const f = fixture(t);
    const dir = join(f.user, 'batch/batch-runner.pid.owner.lock');
    mkdirSync(dir);
    const stamp = kind === 'alive' ? JSON.stringify({ pid: process.pid, token: 'fixture-owner', started_at: new Date().toISOString(), pipeline: 'fixture' }) : '{invalid';
    writeFileSync(join(dir, 'owner.json'), stamp);
    writeFileSync(join(f.user, 'batch/batch-runner.pid'), '987654\n');
    const { result } = await f.run(['--skip-scan']);
    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.deepEqual(f.dispatched(), []);
    assert.equal(readFileSync(join(dir, 'owner.json'), 'utf8'), stamp);
    assert.equal(f.read('batch/batch-runner.pid'), '987654\n');
  });
}

test('a native batch owner appearing during final verification prevents completion', async t => {
  const f = fixture(t, { finalBatchOwner: process.pid });
  const { result } = await f.run(['--skip-scan']);
  assert.equal(result.status, 'failed', JSON.stringify(result));
  assert.match(result.error, /another batch runner is active/);
  assert.equal(f.read('batch/batch-runner.pid'), '987654\n');
  assert.equal(JSON.parse(f.read('batch/batch-runner.pid.owner.lock/owner.json')).token, 'final-fixture-owner');
});

for (const resume of [false, true]) {
  test(`quota stops all following coordinator dispatch, including resume=${resume}`, async t => {
    const f = fixture(t, { rows: [A, B, C], quota: true });
    const args = ['--skip-scan', ...(resume ? ['--resume-paused'] : [])];
    const { result } = await f.run(args);
    assert.equal(result.status, 'partial', JSON.stringify(result));
    assert.deepEqual(f.dispatched(), [A]);
    assert.equal(result.queue_passes, 1);
    assert.ok(result.manual_actions.some(action => action.reason === 'rate_limit'));
    assert.ok(f.calls().some(call => call.phase === 'verify-runner'));
    const second = await f.run(['--skip-scan']);
    assert.equal(second.result.status, 'partial', JSON.stringify(second.result));
    assert.equal(second.result.queue_passes, 0);
    assert.deepEqual(f.dispatched(), [A]);
  });
}

test('legacy login-blocked row resumes with exact jd_unavailable answer', async t => {
  const f = fixture(t, { rows: [`- [!] ${A} — Error: login required`] });
  const first = await f.run(['--skip-scan']);
  assert.equal(first.result.manual_actions[0].reason, 'jd_unavailable');
  const path = join(f.user, 'answers.json');
  writeFileSync(path, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [{ url: A, reason: 'jd_unavailable', answer: 'Use supplied JD', jd_text: 'Fictional backend job description.' }] }));
  const second = await f.run(['--skip-scan', '--answers-file', path]);
  assert.equal(second.result.status, 'completed', JSON.stringify(second.result));
  assert.deepEqual(f.dispatched(), [A]);
});

test('unknown blocked errors explain their explicit manual inbox resume step', async t => {
  const f = fixture(t, { rows: [`- [!] ${A} — Error: malformed document`] });
  const { result } = await f.run(['--skip-scan']);
  assert.equal(result.status, 'partial', JSON.stringify(result));
  assert.equal(result.manual_actions[0].resume_kind, 'pipeline_edit');
  assert.match(result.manual_actions[0].question, /changing this exact row from \[!\] to \[ \]/);
  assert.deepEqual(f.dispatched(), []);
});

test('real reconciliation drains every accepted checkbox spacing from completed state', async t => {
  const f = fixture(t, { rows: [] });
  copyGraph(f.root, 'reconcile-pipeline.mjs');
  const lane = join(f.user, 'data/pipeline.md');
  writeFileSync(lane, `  ## Pending\n  - [ ] ${A}| Fictional | Engineer\n-  [ ] ${B} | Fictional | Developer\n- [!] ${C} — Error: login required\n\n  ## Processed\n`);
  mkdirSync(join(f.user, 'reports'));
  writeFileSync(join(f.user, 'reports/001-fictional.md'), '**Score:** 4.0/5\n**PDF:** Not generated\n');
  writeFileSync(join(f.user, 'reports/002-fictional.md'), '**Score:** 4.0/5\n**PDF:** Not generated\n');
  writeFileSync(join(f.user, 'batch/batch-state.tsv'), `id\turl\tstatus\tstarted\tcompleted\treport\tscore\terror\tretries\n1\t${A}\tcompleted\t-\t-\t001\t4\t-\t0\n2\t${B}\tcompleted\t-\t-\t002\t4\t-\t0\n`);
  const child = spawn(process.execPath, [join(f.root, 'reconcile-pipeline.mjs')], { cwd: f.root, env: f.env, windowsHide: true });
  let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  assert.equal(await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); }), 0, output);
  const text = f.read('data/pipeline.md');
  assert.ok(!text.includes(`[ ] ${A}`));
  assert.ok(!text.includes(`[ ] ${B}`));
  assert.ok(text.includes(`[!] ${C}`));
  assert.match(output, /Pendientes now: 0/);
});

test('retrying a previously failed job counts its new failed attempt in the summary', async t => {
  const f = fixture(t, { retry: true });
  writeFileSync(join(f.user, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${A}\tfixture\t\n`);
  writeFileSync(join(f.user, 'batch/batch-state.tsv'), `id\turl\tstatus\tstarted\tcompleted\treport\tscore\terror\tretries\n1\t${A}\tfailed\t-\t-\t001\t-\tfixture error\t0\n`);
  const { result } = await f.run(['--skip-scan', '--retry-failed']);
  assert.equal(result.status, 'partial', JSON.stringify(result));
  assert.equal(result.batch_counts.failed, 1);
  assert.ok(f.dispatched().length > 0);
});
