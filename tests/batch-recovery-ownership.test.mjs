import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, getBash, rmSync, linkNodeModules } from './helpers.mjs';
import { copyBatchOwnership } from './copy-batch-ownership.mjs';
import { inspectOwnership, ownershipPath, releaseOwnership } from '../batch/runner-ownership.mjs';
import { validateWorkerArtifacts, postingIdentity } from '../batch/validate-worker-artifacts.mjs';
import { pathToFileURL } from 'node:url';
import { processAlive } from '../lib/run-artifacts.mjs';
import { terminateProcessTreeSync } from '../lib/runner-command.mjs';
import { copyGraph } from './fixtures/run-workflow.mjs';
import { queueActions, actionableQueue } from '../lib/run-queue.mjs';
import { nextLiveInput } from '../lib/run-live-inputs.mjs';
import { stateHeader, posting, stateRow, delay, fixture } from './fixtures/batch-recovery-ownership.mjs';

test('confirmed closure is terminal on first attempt, quarantines partial artifacts and reconciles as Closed', () => {
  const f = fixture();
  try {
    for (const file of ['reconcile-pipeline.mjs', 'set-status.mjs']) copyGraph(f.root, file);
    copyFileSync(join(ROOT, 'tracker-aliases.json'), join(f.root, 'tracker-aliases.json'));
    mkdirSync(join(f.root, 'templates'));
    copyFileSync(join(ROOT, 'templates/states.yml'), join(f.root, 'templates/states.yml'));
    assert.equal(linkNodeModules(f.root), null);
    mkdirSync(join(f.root, 'data'));
    writeFileSync(join(f.root, 'data/pipeline.md'), `## Pending\n- [ ] ${posting(1)}\n\n## Processed\n`);
    const result = f.run(['--limit', '1'], 'closed-artifacts');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const cells = readFileSync(f.state, 'utf8').trim().split('\n')[1].split('\t');
    assert.equal(cells[2], 'closed'); assert.equal(cells[5], '-'); assert.equal(cells[6], '-');
    assert.equal(cells[7], 'posting-closed'); assert.equal(cells[8], '0');
    assert.match(result.stdout, /Closed: https:\/\/example.com\/jobs\/1/);
    assert.match(result.stdout, /Closed: 1/);
    assert.match(readFileSync(join(f.root, 'data/pipeline.md'), 'utf8'), /\[x\].*Closed: posting confirmed closed/);
    assert.equal(existsSync(join(f.root, 'reports/001-partial.md')), false);
    assert.equal(existsSync(join(f.root, 'batch/tracker-additions/1.tsv')), false);
    assert.ok(readdirSync(join(f.root, 'batch/logs/quarantine')).some(name => name.startsWith('closed-001-1.')));
    assert.deepEqual(queueActions(f.root, 'fixture'), []);
    assert.deepEqual(actionableQueue(f.root, 'fixture', [], {resumePaused:true,retryUrls:[posting(1)]}), []);
    // Even a stale blocked queue row cannot re-create a question or live dispatch.
    writeFileSync(join(f.root, 'data/pipeline.md'), `## Pending\n- [!] ${posting(1)} | jd_unavailable | stale question\n\n## Processed\n`);
    assert.deepEqual(queueActions(f.root, 'fixture'), []);
    const controlPath=join(f.root,'control.json'), queuePath=join(f.root,'queue.txt');
    writeFileSync(controlPath,JSON.stringify({schema_version:1,user:'fixture',status:'open',owner_pid:process.pid,retries:[{url:posting(1),token:'retry'}]}));
    writeFileSync(queuePath,posting(1)+'\n');
    assert.equal(nextLiveInput({controlPath,userRoot:f.root,user:'fixture',queuePath,retryFailed:true,resumePaused:true}).selected,null);
    const rerun=f.run(['--limit','1','--queue-file',queuePath,'--retry-failed','--resume-paused','--include-pending']);
    assert.equal(rerun.status,0,rerun.stdout+rerun.stderr);
    assert.equal(readFileSync(join(f.root,'calls'),'utf8').trim().split('\n').length,1);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('closure after earlier failed attempts preserves retry history and stops further dispatch', () => {
  const f=fixture();
  try {
    writeFileSync(join(f.batch,'batch-input.tsv'),`id\turl\tsource\tnotes\n1\t${posting(1)}\tfixture\t\n`);
    writeFileSync(f.state,stateHeader+stateRow(1,'failed',2));
    const closed=f.run([],'closed');assert.equal(closed.status,0,closed.stdout+closed.stderr);
    const cells=readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t');
    assert.equal(cells[2],'closed');assert.equal(cells[8],'2');
    const retry=f.run(['--retry-failed']);assert.equal(retry.status,0,retry.stdout+retry.stderr);
    assert.equal(readFileSync(join(f.root,'calls'),'utf8').trim().split('\n').length,1);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

for (const mode of ['closed-wrong-url','closed-failed-exit']) test(`invalid closure stays retryable (${mode})`, () => {
  const f=fixture();
  try {
    const result=f.run(['--limit','1'],mode);
    assert.equal(result.status,0,result.stdout+result.stderr);
    const cells=readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t');
    assert.equal(cells[2],'failed'); assert.equal(cells[8],'1');
    assert.equal(existsSync(join(f.batch,'logs/1.hold.json')),false);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('native Git Bash ownership survives rejected concurrent runner and token mismatch; dead owner recovers', async () => {
  const f = fixture(); let running;
  try {
    running = f.start(['--limit', '1']);
    for (let i=0; i<200 && !existsSync(join(f.root, 'ready')); i++) await delay(25);
    assert.ok(existsSync(join(f.root, 'ready')), 'first runner launched its fixture worker');
    const owner = inspectOwnership(f.pid);
    assert.equal(owner.status, 'alive'); process.kill(owner.pid, 0);
    const compat = readFileSync(f.pid, 'utf8');
    if (process.platform === 'win32') {
      assert.notEqual(owner.pid, Number(compat));
      const mapped = spawnSync(getBash(), ['-c', 'cat "/proc/$1/winpid"', 'native-owner', compat.trim()], {encoding:'utf8'});
      assert.equal(Number(mapped.stdout), owner.pid);
    }
    const rejected = f.run(['--limit', '1']); assert.notEqual(rejected.status, 0, rejected.stdout + rejected.stderr);
    assert.equal(inspectOwnership(f.pid).token, owner.token);
    assert.equal(readFileSync(f.pid, 'utf8'), compat);
    assert.equal(releaseOwnership(f.pid, 'wrong-token'), false);
    writeFileSync(join(f.root, 'release'), 'release');
    assert.equal((await running.completion).code, 0);
    assert.equal(inspectOwnership(f.pid).status, 'absent'); assert.equal(existsSync(f.pid), false);
    mkdirSync(ownershipPath(f.pid));
    writeFileSync(join(ownershipPath(f.pid), 'owner.json'), JSON.stringify({pid:2147483000,token:'dead-owner',started_at:'2020-01-01'}));
    writeFileSync(f.pid, '99999999\n');
    writeFileSync(f.state, stateHeader + stateRow(1, 'pending'));
    const recovered = f.run(['--limit', '1']); assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.equal(inspectOwnership(f.pid).status, 'absent');
  } finally {
    if (running && !existsSync(join(f.root, 'release'))) { writeFileSync(join(f.root, 'release'), 'release'); await running.completion; }
    rmSync(f.root, {recursive:true,force:true});
  }
});

test('interrupt before supervisor registration drains the pending supervisor before unlocking', async () => {
  const f=fixture(); let running, supervisorPid;
  const preload=join(f.root,'startup-barrier.mjs');
  writeFileSync(preload,`import {writeFileSync} from 'node:fs';
if(process.argv[1]?.endsWith('worker-process.mjs')&&process.argv[2]==='run') {writeFileSync(${JSON.stringify(join(f.root,'startup-ready'))},String(process.pid));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000);}\n`);
  try {
    running=f.start(['--limit','1'],'fail',{NODE_OPTIONS:`--import=${pathToFileURL(preload).href}`});
    for(let i=0;i<400&&!existsSync(join(f.root,'startup-ready'));i++)await delay(25);
    assert.ok(existsSync(join(f.root,'startup-ready')),'supervisor reached the pre-registration barrier');
    supervisorPid=Number(readFileSync(join(f.root,'startup-ready'),'utf8'));
    const compat=readFileSync(f.pid,'utf8').trim();
    const signal=spawnSync(getBash(),['-c','kill -TERM "$1"','stop-fixture',compat],{encoding:'utf8'});
    assert.equal(signal.status,0,signal.stderr);
    const outcome=await Promise.race([running.completion,delay(7000).then(()=>null)]);
    assert.ok(outcome,'batch interruption must drain without waiting for the barrier');
    assert.notEqual(outcome.code,0); assert.equal(processAlive(supervisorPid),false);
    assert.equal(existsSync(join(f.root,'calls')),false,'no paid CLI boundary was reached');
    assert.equal(inspectOwnership(f.pid).status,'absent');
  } finally {
    if(running && processAlive(running.child.pid))terminateProcessTreeSync(running.child);
    if(supervisorPid && processAlive(supervisorPid))terminateProcessTreeSync(supervisorPid);
    if(running)await running.completion;
    rmSync(f.root,{recursive:true,force:true});
  }
});

test('failed offer stop skips waiting, attempts other registrations and retains ownership', async () => {
  const root=mkdtempSync(join(tmpdir(),'batch-stop-failure-'));
  const source=readFileSync(join(ROOT,'batch/batch-runner.sh'),'utf8');
  const stop=source.slice(source.indexOf('stop_owned_workers() {'),source.indexOf('\ninterrupt_batch() {'));
  const release=source.slice(source.indexOf('release_lock() {'),source.indexOf('\nstop_owned_workers() {'));
  mkdirSync(join(root,'workers')); writeFileSync(join(root,'workers/worker.json'),'{}');
  writeFileSync(join(root,'workers/worker.json.job-launch.json'),'{}');
  writeFileSync(join(root,'ownership'),'owned');
  writeFileSync(join(root,'run.sh'),`#!/usr/bin/env bash\nset -u\ncd "$(dirname "$0")"\nMAIN_PID=$BASHPID\nWORKER_DIR="$PWD/workers"\nSCRIPT_DIR="$PWD"\nLOCK_FILE="$PWD/ownership"\nOWNER_TOKEN=fixture\nnode() { case "$2" in stop-pid) return 1;; stop) printf '%s\\n' "$3" >> stopped; return 0;; release) rm "$LOCK_FILE";; esac; }\n${release}\n${stop}\nsleep 30 &\nprintf '%s' "$!" > offer\nrelease_lock || exit 125\n`);
  const child=spawn(getBash(),[join(root,'run.sh')],{stdio:'ignore'});
  const completed=new Promise(resolve=>child.once('close',code=>resolve(code)));
  let offer;
  try {
    const result=await Promise.race([completed,delay(5000).then(()=>null)]);
    assert.equal(result,125,'failed termination must reach fatal ownership-preserving return');
    assert.ok(existsSync(join(root,'ownership')));
    const calls=readFileSync(join(root,'stopped'),'utf8').trim().split('\n');
    assert.equal(calls.length,1,'remaining worker attempted, payload metadata excluded');
    assert.match(calls[0],/worker\.json$/);
  } finally {
    if(existsSync(join(root,'offer'))) {
      const bashPid=readFileSync(join(root,'offer'),'utf8');
      const mapped=spawnSync(getBash(),['-c',process.platform==='win32'?'cat "/proc/$1/winpid"':'printf "%s" "$1"','fixture',bashPid],{encoding:'utf8'});
      offer=Number(mapped.stdout);
      if(offer&&processAlive(offer))terminateProcessTreeSync(offer);
    }
    if(processAlive(child.pid))terminateProcessTreeSync(child);
    await completed;
    rmSync(root,{recursive:true,force:true});
  }
});
