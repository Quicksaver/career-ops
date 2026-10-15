import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
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

test('live pool reduces capacity after a rate limit while draining its active worker', t => {
  const root = mkdtempSync(join(tmpdir(), 'run-live-throttle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const production = readFileSync(join(repo, 'batch/batch-runner.sh'), 'utf8').replace(/\r\n/g, '\n');
  const loop = production.slice(production.indexOf('process_live_offers() {'), production.indexOf('\n# Main\n'));
  const shell = join(root, 'throttle.sh');
  writeFileSync(shell, `set -euo pipefail
PROJECT_DIR=.; USER_ROOT=.; USER_ID=fictional
LIVE_INPUTS=control; ANSWERS_FILE=answers; QUEUE_FILE=queue
MAX_RETRIES=2; LIMIT=0; RETRY_FAILED=false; RESUME_PAUSED=false
PARALLEL=3; PAUSE_FILE=pause; THROTTLE_FILE=throttle
node() {
  printf '%s\\n' "\${12}" >> capacities
  if [[ ! -f offered ]]; then
    touch offered
    printf 'job\\0371\\037https://example.org/job\\037fixture\\037notes\\037false\\037false\\n'
  elif [[ -f throttle ]]; then
    echo done
  else
    echo busy
  fi
}
process_offer() { touch throttle; sleep 1; touch drained; }
${loop}
process_live_offers
[[ -f drained ]]
`);
  const output = execFileSync(getBash(), [shell], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.match(output, /Rate limited: running the remaining offers on 1 worker/);
  const capacities = readFileSync(join(root, 'capacities'), 'utf8').trim().split('\n');
  assert.equal(capacities[0], '3');
  assert.equal(capacities.at(-1), '1');
});

for (const duplicateHold of [false, true]) test(`production Bash pool resumes an answered LinkedIn hold before its other worker exits${duplicateHold ? ' under the held historical ID' : ''}`, async t => {
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
  const duplicate = duplicateHold ? `old-import\t${linkedIn}\tinvalid\t\n4\t${linkedIn}\tolder duplicate\t\n` : '';
  writeFileSync(join(root, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n1\tlocal:jds/slow.md\tfixture\t\n${duplicate}2\t${linkedIn}\tfixture\t\n3\thttps://example.org/historical\told\t\n`);
  if (duplicateHold) {
    mkdirSync(join(root, 'batch/logs'), { recursive: true });
    writeFileSync(join(root, 'batch/batch-state.tsv'), `id\turl\tstatus\tstarted\tcompleted\treport\tscore\terror\tretries\n2\t${linkedIn}\tneeds_confirmation\t\t\t\t\t\t0\n`);
    writeFileSync(join(root, 'batch/logs/2.hold.json'), JSON.stringify({ schema_version: 1, user: 'fictional', id: '2', url: linkedIn, status: 'needs_confirmation', reason: 'jd_unavailable', question: 'Provide the exact JD.', company: '', role: '', score: null, legitimacy: null, via: null, company_confidential: null, pdf: null, report: null, tracker: null, error: null }));
  }
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
  assert.equal(existsSync(join(root, 'ready-4')), false, 'the unheld historical ID cannot take over the posting');
  assert.equal(inspectOwnership(join(root, 'batch/batch-runner.pid')).status, 'absent');
  assert.match(output, /Pending: live queue/);
  assert.match(output, /remaining -/);
});

test('production live loop retains active URL exclusion through reap and failure budget across holds', async t => {
  const root = mkdtempSync(join(tmpdir(), 'run-live-loop-'));
  mkdirSync(join(root, 'batch/logs'), { recursive: true });
  copyGraph(root, 'lib/run-live-inputs.mjs'); copyGraph(root, 'pipeline-lock.mjs');
  cpSync(join(repo, 'tracker-aliases.json'), join(root, 'tracker-aliases.json'));
  assert.equal(linkNodeModules(root), null);
  const a = 'https://example.org/jobs/a', b = 'https://example.org/jobs/b';
  const controlPath = join(root, 'live.json'), answersPath = join(root, 'answers.json');
  const control = status => writeFileAtomic(controlPath, JSON.stringify({ schema_version: 1, user: 'fictional', owner_pid: process.pid, status, retries: [] }));
  control('open');
  writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [] }));
  writeFileSync(join(root, 'queue.txt'), `${a}\n${b}\n`);
  writeFileSync(join(root, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${a}\t\t\n2\t${b}\t\t\n`);
  writeFileSync(join(root, 'state.mjs'), `import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {withPipelineLock} from './pipeline-lock.mjs';
const [id,url,status,retries]=process.argv.slice(2), path=process.env.CAREER_OPS_ROOT+'/batch/batch-state.tsv';
await withPipelineLock(path,()=>{const lines=existsSync(path)?readFileSync(path,'utf8').trimEnd().split('\\n'):['id\\turl\\tstatus\\tstarted\\tcompleted\\treport\\tscore\\terror\\tretries'];
writeFileSync(path,lines.filter((line,index)=>!index||line.split('\\t')[0]!==id).concat([[id,url,status,'','','','','',retries].join('\\t')]).join('\\n')+'\\n');});`);
  const production = readFileSync(join(repo, 'batch/batch-runner.sh'), 'utf8').replace(/\r\n/g, '\n');
  const loop = production.slice(production.indexOf('process_live_offers() {'), production.indexOf('\n# Main\n'));
  const shell = join(root, 'loop.sh');
  writeFileSync(shell, `#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$CAREER_OPS_ROOT"; USER_ROOT="$PROJECT_DIR"; USER_ID=fictional
LIVE_INPUTS="$PROJECT_DIR/live.json"; ANSWERS_FILE="$PROJECT_DIR/answers.json"; QUEUE_FILE="$PROJECT_DIR/queue.txt"
MAX_RETRIES=2; LIMIT=0; RETRY_FAILED=false; RESUME_PAUSED=false; PARALLEL=2; PAUSE_FILE="$PROJECT_DIR/pause"
get_retries() { awk -F '\\t' -v id="$1" '$1==id{print $9; found=1} END{if(!found) print 0}' "$PROJECT_DIR/batch/batch-state.tsv"; }
update_state_retrying() { node "$PROJECT_DIR/state.mjs" "$1" "$2" "$3" "$9"; }
process_offer() {
  local id="$1" url="$2" attempt=0
  [[ ! -f "$PROJECT_DIR/count-$id" ]] || attempt=$(cat "$PROJECT_DIR/count-$id")
  attempt=$((attempt+1)); echo "$attempt" > "$PROJECT_DIR/count-$id"
  if [[ "$id" == 2 ]]; then node "$PROJECT_DIR/state.mjs" "$id" "$url" completed 0; touch "$PROJECT_DIR/independent-done"; return; fi
  if (( attempt == 1 )); then
    node "$PROJECT_DIR/state.mjs" "$id" "$url" failed 1; touch "$PROJECT_DIR/failure-published"
    while [[ ! -f "$PROJECT_DIR/reap-first" ]]; do sleep 0.1; done
  elif (( attempt == 2 )); then
    cp "$PROJECT_DIR/hold.json" "$PROJECT_DIR/batch/logs/1.hold.json"
    node "$PROJECT_DIR/state.mjs" "$id" "$url" needs_confirmation 1; touch "$PROJECT_DIR/hold-published"
    while [[ ! -f "$PROJECT_DIR/reap-hold" ]]; do sleep 0.1; done
  else
    local retries; retries=$(get_retries "$id")
    node "$PROJECT_DIR/state.mjs" "$id" "$url" failed "$((retries+1))"; touch "$PROJECT_DIR/final-failure"
  fi
}
${loop}
process_live_offers
`);
  writeFileSync(join(root, 'hold.json'), JSON.stringify({ schema_version: 1, user: 'fictional', id: '1', url: a, status: 'needs_confirmation', reason: 'agency_confirmation', question: 'Name the agency.', company: '', role: '', score: null, legitimacy: null, via: null, company_confidential: null, pdf: null, report: null, tracker: null, error: null }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CAREER_OPS_/i.test(key)));
  env.CAREER_OPS_ROOT = root;
  const child = spawn(getBash(), [shell], { cwd: root, env, detached: process.platform !== 'win32' });
  let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  const completion = new Promise(resolve => child.once('close', resolve));
  t.after(() => { if (child.exitCode === null) terminateProcessTreeSync(child); rmSync(root, { recursive: true, force: true }); });
  await until(() => existsSync(join(root, 'failure-published')) && existsSync(join(root, 'independent-done')), () => output);
  await delay(1300);
  assert.equal(readFileSync(join(root, 'count-1'), 'utf8').trim(), '1', 'published failure cannot overlap its still-running process');
  writeFileSync(join(root, 'reap-first'), 'release');
  await until(() => existsSync(join(root, 'hold-published')), () => output);
  writeFileAtomic(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [{ url: a, reason: 'agency_confirmation', answer: 'Fictional agency' }] }));
  await delay(1300);
  assert.equal(readFileSync(join(root, 'count-1'), 'utf8').trim(), '2', 'answer cannot overlap the still-running hold publisher');
  writeFileSync(join(root, 'reap-hold'), 'release');
  await until(() => existsSync(join(root, 'final-failure')), () => output);
  await delay(1300); control('finish');
  assert.equal(await completion, 0, output);
  assert.equal(readFileSync(join(root, 'count-1'), 'utf8').trim(), '3');
  const state = parseBatchState(readFileSync(join(root, 'batch/batch-state.tsv'), 'utf8')).find(row => row.id === '1');
  assert.equal(state.retries, '2', `the hold must not reset the failure budget: ${output}`);
});
