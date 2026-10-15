import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { getBash, linkNodeModules, rmSync } from './helpers.mjs';
import { copyGraph, repo } from './fixtures/run-workflow.mjs';
import { copyBatchOwnership } from './copy-batch-ownership.mjs';
import { inspectOwnership } from '../batch/runner-ownership.mjs';
import { terminateProcessTreeSync } from '../lib/runner-command.mjs';
import { writeFileAtomic } from '../tracker-utils.mjs';
import { parseBatchState } from '../lib/pipeline-queue.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, output) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (predicate()) return; await delay(30); }
  assert.fail(output());
}

test('production Bash pool resumes an answered LinkedIn hold before its other worker exits', async t => {
  const root = mkdtempSync(join(tmpdir(), 'run-live-batch-'));
  for (const dir of ['batch', 'bin', 'config', 'jds', 'reports']) mkdirSync(join(root, dir));
  copyBatchOwnership(root); copyGraph(root, 'lib/run-live-inputs.mjs');
  cpSync(join(repo, 'tracker-aliases.json'), join(root, 'tracker-aliases.json'));
  assert.equal(linkNodeModules(root), null);
  for (const file of ['batch-runner.sh', 'manual-inputs.mjs', 'batch-output-schema.json']) cpSync(join(repo, 'batch', file), join(root, 'batch', file));
  writeFileSync(join(root, 'batch/batch-prompt.md'), 'Offline workflow fixture.');
  writeFileSync(join(root, 'reserve-report-num.mjs'), 'if(!process.argv.includes("--release")) console.log("001");');
  for (const name of ['merge-tracker', 'reconcile-pipeline']) writeFileSync(join(root, `${name}.mjs`), '// offline only');
  writeFileSync(join(root, 'jds/slow.md'), 'A local fictional job description. '.repeat(100));
  const linkedIn = 'https://www.linkedin.com/jobs/view/1234567';
  writeFileSync(join(root, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n1\tlocal:jds/slow.md\tfixture\t\n2\t${linkedIn}\tfixture\t\n3\thttps://example.org/historical\told\t\n`);
  const queuePath = join(root, 'queue.txt'), answersPath = join(root, 'answers.json'), controlPath = join(root, 'live.json');
  writeFileSync(queuePath, `local:jds/slow.md\n${linkedIn}\n`);
  const control = status => writeFileAtomic(controlPath, JSON.stringify({ schema_version: 1, user: 'fictional', owner_pid: process.pid, status, retries: [] }));
  control('open');
  writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [] }));
  writeFileSync(join(root, 'worker.mjs'), `import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const args=process.argv.slice(2), final=args[args.indexOf('--output-last-message')+1], id=/-(\\d+)\\.final\\.json$/.exec(final)[1], root=process.env.CAREER_OPS_ROOT;
writeFileSync(root+'/ready-'+id,'ready');
if(id==='1') {const deadline=Date.now()+30000;while(!existsSync(root+'/release')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));}
console.error('ordinary fixture failure after launch');process.exitCode=1;`);
  writeFileSync(join(root, 'bin/codex.cmd'), '@ECHO OFF\r\nSET dp0=%~dp0\r\nnode "%dp0%/../worker.mjs" %*\r\n');
  if (process.platform !== 'win32') writeFileSync(join(root, 'bin/codex'), '#!/usr/bin/env node\nimport "../worker.mjs";', { mode: 0o755 });
  const runner = join(root, 'fixture.sh');
  writeFileSync(runner, '#!/usr/bin/env bash\nset -euo pipefail\ncurl() { return 1; }; export -f curl\nexec bash "$CAREER_OPS_ROOT/batch/batch-runner.sh" --user fictional --parallel 2 --max-retries 1 --cli codex --model fixture --defer-verification --include-pending "$@"\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CAREER_OPS_/i.test(key) && !/^PATH$/i.test(key)));
  Object.assign(env, { PATH: join(root, 'bin') + delimiter + process.env.PATH, CAREER_OPS_ROOT: root, CAREER_OPS_USER: 'fictional' });
  const child = spawn(getBash(), [runner, '--queue-file', queuePath, '--answers-file', answersPath, '--live-inputs', controlPath], { cwd: root, env });
  let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  const completion = new Promise(resolve => child.once('close', code => resolve(code)));
  t.after(() => {
    if (child.exitCode === null) terminateProcessTreeSync(child);
    rmSync(root, { recursive: true, force: true });
  });
  await until(() => existsSync(join(root, 'ready-1')) && existsSync(join(root, 'batch/logs/2.hold.json')), () => output);
  assert.equal(inspectOwnership(join(root, 'batch/batch-runner.pid')).status, 'alive');
  assert.equal(existsSync(join(root, 'ready-2')), false, 'LinkedIn holds before any worker');
  writeFileAtomic(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [{ url: linkedIn, reason: 'jd_unavailable', answer: 'Provided JD', jd_text: 'Build and operate reliable infrastructure for a fictional employer. '.repeat(20) }] }));
  await until(() => existsSync(join(root, 'ready-2')), () => output);
  assert.equal(existsSync(join(root, 'release')), false, 'free slot resumed the answer while worker 1 remained active');
  writeFileSync(join(root, 'release'), 'release'); control('finish');
  assert.equal(await completion, 0, output);
  const states = parseBatchState(readFileSync(join(root, 'batch/batch-state.tsv'), 'utf8'));
  assert.deepEqual(states.map(row => [row.id, row.status, row.retries]).sort(), [['1', 'failed', '1'], ['2', 'failed', '1']]);
  assert.equal(existsSync(join(root, 'ready-3')), false);
  assert.equal(inspectOwnership(join(root, 'batch/batch-runner.pid')).status, 'absent');
});
