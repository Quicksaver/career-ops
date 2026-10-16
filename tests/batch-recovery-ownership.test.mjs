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

const stateHeader = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n';
const posting = id => `https://example.com/jobs/${id}`;
const stateRow = (id, status, retries = 0) => `${id}\t${posting(id)}\t${status}\tstart\tend\t001\t-\t-\t${retries}\n`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'batch-owner-recovery-'));
  const batch = join(root, 'batch');
  mkdirSync(batch); mkdirSync(join(root, 'bin')); mkdirSync(join(root, 'reports')); mkdirSync(join(root, 'config')); mkdirSync(join(root, 'jds'));
  copyBatchOwnership(root);
  for (const file of ['batch-runner.sh', 'manual-inputs.mjs', 'batch-output-schema.json']) copyFileSync(join(ROOT, 'batch', file), join(batch, file));
  // Use the production validator against fixture artifacts, including its CLI.
  writeFileSync(join(batch,'validate-worker-artifacts.mjs'), `import {spawnSync} from 'node:child_process'; const result=spawnSync(process.execPath,[${JSON.stringify(join(ROOT,'batch/validate-worker-artifacts.mjs'))},...process.argv.slice(2)],{stdio:'inherit'}); process.exitCode=result.status ?? 1;\n`);
  writeFileSync(join(batch, 'batch-prompt.md'), 'Offline fixture prompt');
  writeFileSync(join(batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n${[1,2,3].map(id => `${id}\t${posting(id)}\tfixture\t\n`).join('')}`);
  writeFileSync(join(root, 'reserve-report-num.mjs'), 'if (!process.argv.includes("--release")) console.log("001");\n');
  for (const file of ['merge-tracker', 'reconcile-pipeline']) writeFileSync(join(root, `${file}.mjs`), '// offline fixture\n');
  writeFileSync(join(root, 'worker.mjs'), `import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2), root=process.env.CAREER_OPS_ROOT;
appendFileSync(root+'/calls','called\\n');
if(process.env.FIXTURE_MODE.startsWith('closed')) {
  const final=args[args.indexOf('--output-last-message')+1];
  const result={status:'closed',id:'1',report_num:'001',url:'https://example.com/jobs/1',reason:'posting_closed',company:'',role:'',score:null,legitimacy:null,via:null,company_confidential:null,pdf:null,report:null,tracker:null,error:null,question:null};
  if(process.env.FIXTURE_MODE==='closed-wrong-url') result.url='https://example.com/jobs/another';
  if(process.env.FIXTURE_MODE==='closed-failed-exit') process.exitCode=1;
  if(process.env.FIXTURE_MODE==='closed-artifacts') {
    writeFileSync(root+'/reports/001-partial.md','unaccepted partial report');
    writeFileSync(root+'/batch/tracker-additions/1.tsv','unaccepted partial tracker');
  }
  console.log('Current employer application form explicitly states the position is filled.');
  writeFileSync(final,JSON.stringify(result)); console.log(JSON.stringify(result));
  process.exit(process.exitCode||0);
}
if(process.env.FIXTURE_MODE==='wait') {
  writeFileSync(root+'/ready','ready');
  const deadline=Date.now()+15000;
  while(!existsSync(root+'/release') && Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
}

if(['success429','failed429','wrong999','success001'].includes(process.env.FIXTURE_MODE)) {
  const final=args[args.indexOf('--output-last-message')+1];
  const num=['success429','failed429'].includes(process.env.FIXTURE_MODE)?'429':'001';
  const claimed=process.env.FIXTURE_MODE==='wrong999'?'999':num;
  const result={status:'completed',id:'1',report_num:num,company:'Acme',role:'Engineer',score:4,legitimacy:'Verified',via:null,company_confidential:false,pdf:null,report:root+'/reports/'+num+'-acme.md',tracker:root+'/batch/tracker-additions/1.tsv',error:null,question:null,reason:null,url:null};
  if(process.env.FIXTURE_MODE!=='failed429') {
    const fence=String.fromCharCode(96).repeat(3);
    writeFileSync(result.report,'## Job Description (archived verbatim)\\n'+'Job data discussing HTTP 429 and rate limit reached in a client API. '.repeat(20)+'\\n## Machine Summary\\n\\n'+fence+'yaml\\ncompany: Acme\\nrole: Engineer\\nscore: 4\\ncompany_confidential: false\\nvia: null\\nfinal_decision: Apply\\nhard_stops: []\\n'+fence+'\\n');
    writeFileSync(result.tracker,'num\\tdate\\tcompany\\trole\\tstatus\\tscore\\tpdf\\treport\\tnotes\\turl\\tvia\\n'+claimed+'\\t2026-10-14\\tAcme\\tEngineer\\tEvaluated\\t4.0/5\\t❌\\t['+claimed+'](reports/'+claimed+'-acme.md)\\tHTTP 429 experience\\thttps://example.com/jobs/1\\t\\n');
  } else {
    result.status='failed'; result.error='missing artifact reports/429-acme.md'; process.exitCode=1;
  }
  writeFileSync(final,JSON.stringify(result)); console.log(JSON.stringify(result));
} else if(process.env.FIXTURE_MODE==='quota') {
  // Even completed-looking artifacts cannot reach the tracker merge on quota.
  const final=args[args.indexOf('--output-last-message')+1];
  writeFileSync(root+'/reports/001-acme.md','## Machine Summary\\n'+String.fromCharCode(96).repeat(3)+'yaml\\ncompany: Acme\\nrole: Engineer\\nscore: 4\\ncompany_confidential: false\\nvia: null\\n'+String.fromCharCode(96).repeat(3)+'\\n');
  writeFileSync(root+'/batch/tracker-additions/1.tsv','001\\t2026-10-14\\tAcme\\tEngineer\\tEvaluated\\t4.0/5\\t❌\\t[001](reports/001-acme.md)\\tpartial artifact\\n');
  writeFileSync(final,JSON.stringify({status:'completed',id:'1',report_num:'001',company:'Acme',role:'Engineer',score:4,via:null,company_confidential:false,pdf:null,report:root+'/reports/001-acme.md',tracker:root+'/batch/tracker-additions/1.tsv'}));
  console.error('You have hit your usage limit. usage_limit_reached');
  process.exitCode=1;
} else { console.error('fixture ordinary failure'); process.exitCode=1; }
`);
  const runner = join(root, 'run.sh');
  writeFileSync(join(root, 'bin/codex'), '#!/usr/bin/env bash\nnode "$CAREER_OPS_ROOT/worker.mjs" "$@"\n', { mode: 0o755 });
  writeFileSync(runner, '#!/usr/bin/env bash\nset -euo pipefail\ncurl() { return 1; }\nexport -f curl\nexec bash "$CAREER_OPS_ROOT/batch/batch-runner.sh" --user fixture --cli codex --model fixture --defer-verification "$@"\n');
  const env = mode => ({ ...process.env, PATH: join(root, 'bin') + delimiter + process.env.PATH, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_USER: 'fixture', FIXTURE_MODE: mode });
  const run = (args = [], mode = 'fail') => spawnSync(getBash(), [runner, ...args], { encoding: 'utf8', timeout: 30000, env: env(mode) });
  const start = (args = [], mode = 'wait', extraEnv = {}) => {
    const child = spawn(getBash(), [runner, ...args], { env: {...env(mode),...extraEnv} });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const completion = new Promise(resolve => child.on('close', code => resolve({ code, output })));
    return { child, completion };
  };
  return { root, batch, run, start, state: join(batch, 'batch-state.tsv'), pid: join(batch, 'batch-runner.pid') };
}

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

test('required sequential preparation and quarantine errors prevent dispatch or merge', () => {
  for(const failure of ['preparation','quarantine']) {
    const f=fixture();
    try {
      writeFileSync(join(f.root,'merge-tracker.mjs'),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(join(f.root,'merged'))},'unexpected');\n`);
      if(failure==='preparation')writeFileSync(join(f.batch,'tmp'),'not a directory');
      else {mkdirSync(join(f.batch,'logs'));writeFileSync(join(f.batch,'logs/quarantine'),'not a directory');}
      const result=f.run(['--limit','2'],'wrong999');
      assert.notEqual(result.status,0,result.stdout+result.stderr);
      assert.equal(existsSync(join(f.root,'merged')),false);
      const calls=existsSync(join(f.root,'calls'))?readFileSync(join(f.root,'calls'),'utf8').trim().split('\n').length:0;
      assert.equal(calls,failure==='preparation'?0:1);
    } finally {rmSync(f.root,{recursive:true,force:true});}
  }
});

test('recovery flags union pending, failed and paused while direct selectors retain narrow behavior', () => {
  const f = fixture();
  try {
    writeFileSync(f.state, stateHeader + stateRow(1,'pending') + stateRow(2,'failed',3) + stateRow(3,'paused_rate_limit',2));
    const run = args => { const result=f.run(['--dry-run',...args]); assert.equal(result.status,0,result.stderr); return result.stdout; };
    assert.match(run(['--include-pending','--retry-failed','--resume-paused']), /Would process 3 offers/);
    assert.match(run(['--retry-failed','--resume-paused']), /Would process 2 offers/);
    assert.match(run(['--retry-failed']), /Would process 1 offers/);
    assert.match(run(['--resume-paused']), /Would process 1 offers/);
    assert.match(run([]), /Would process 1 offers/);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('the real batch defaults to three failed attempts and retains the ceiling across invocations', () => {
  const f = fixture();
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = f.run(['--limit', '1']);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Max retries: 3/);
      const state = readFileSync(f.state, 'utf8').trim().split('\n').find(line => line.startsWith('1\t')).split('\t');
      assert.equal(state[2], 'failed');
      assert.equal(Number(state[8]), attempt);
      assert.equal(readFileSync(join(f.root, 'calls'), 'utf8').trim().split('\n').length, attempt);
    }
    const next = f.run(['--dry-run', '--limit', '1']);
    assert.equal(next.status, 0, next.stdout + next.stderr);
    assert.match(next.stdout, /SKIP #1: failed and max retries reached/);
    assert.equal(readFileSync(join(f.root, 'calls'), 'utf8').trim().split('\n').length, 3);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('explicit failed retry grants one dispatch beyond historical cap and ordinary pass cannot renew it', () => {
  const f = fixture();
  try {
    writeFileSync(f.state, stateHeader + stateRow(1,'failed',3));
    const result=f.run(['--retry-failed','--limit','1']); assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(readFileSync(join(f.root,'calls'),'utf8').trim().split('\n').length,1);
    assert.equal(readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t')[8],'4');
    const next=f.run(['--include-pending','--limit','1']); assert.equal(next.status,0,next.stderr);
    // Job 2 is ordinary pending work; failed job 1 receives no renewed credit.
    assert.equal(readFileSync(f.state,'utf8').trim().split('\n').find(line=>line.startsWith('1\t')).split('\t')[8],'4');
    assert.match(next.stdout,/SKIP #1: failed and max retries reached/);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('Codex quota pauses without consuming retry or accepting completed final; stops following dispatch', () => {
  const f = fixture();
  try {
    writeFileSync(f.state,stateHeader+stateRow(1,'pending',2));
    const result=f.run([], 'quota'); assert.equal(result.status,0,result.stdout+result.stderr);
    const row=readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t');
    assert.equal(row[2],'paused_rate_limit'); assert.equal(row[8],'2');
    assert.equal(readFileSync(join(f.root,'calls'),'utf8').trim().split('\n').length,1);
    assert.doesNotMatch(readFileSync(f.state,'utf8'),/\tcompleted\t/);
    assert.equal(existsSync(join(f.batch,'tracker-additions/1.tsv')),false,'paused worker addition cannot reach merge');
    assert.equal(existsSync(join(f.root,'reports/001-acme.md')),false,'partial report is quarantined');
    const next=f.run(['--dry-run']); assert.match(next.stdout,/Would process 2 offers/);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('report 429 completes normally; ordinary report 429 artifact failure consumes a retry without pausing', () => {
  const f=fixture();
  try {
    writeFileSync(join(f.root,'reserve-report-num.mjs'),'if (!process.argv.includes("--release")) console.log("429");\n');
    const completed=f.run(['--limit','1'],'success429'); assert.equal(completed.status,0,completed.stdout+completed.stderr);
    let row=readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t');
    assert.equal(row[2],'completed',completed.stdout); assert.equal(row[5],'429');
    assert.equal(existsSync(join(f.batch,'batch-runner.paused')),false);
    assert.equal(existsSync(join(f.root,'reports/429-acme.md')),true);
    assert.equal(existsSync(join(f.batch,'tracker-additions/1.tsv')),true);
    rmSync(join(f.root,'reports/429-acme.md')); rmSync(join(f.batch,'tracker-additions/1.tsv'));
    writeFileSync(f.state,stateHeader+stateRow(1,'pending'));
    const failed=f.run(['--limit','1'],'failed429'); assert.equal(failed.status,0,failed.stdout+failed.stderr);
    row=readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t');
    assert.equal(row[2],'failed',failed.stdout); assert.equal(row[8],'1');
    assert.doesNotMatch(failed.stdout,/pausing|Batch paused/);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('production batch quarantines reserved 001 / claimed 999 failure; production merger gates persisted additions by job identity', () => {
  const f=fixture();
  try {
    const tracker=join(f.root,'data/applications.md'); mkdirSync(join(f.root,'data'));
    const header='# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n';
    writeFileSync(tracker,header);
    writeFileSync(join(f.root,'merge-tracker.mjs'),`import {spawnSync} from 'node:child_process'; const result=spawnSync(process.execPath,[${JSON.stringify(join(ROOT,'merge-tracker.mjs'))},...process.argv.slice(2)],{stdio:'inherit'}); process.exitCode=result.status ?? 1;\n`);
    const rejected=f.run(['--limit','1'],'wrong999'); assert.equal(rejected.status,0,rejected.stdout+rejected.stderr);
    const row=readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t');
    assert.equal(row[2],'failed'); assert.equal(row[5],'001'); assert.equal(row[8],'1');
    assert.equal(existsSync(join(f.batch,'tracker-additions/1.tsv')),false);
    const quarantines=readdirSync(join(f.batch,'logs/quarantine')).filter(name=>name.startsWith('rejected-001-1.'));
    assert.equal(quarantines.length,1);
    const rejectedAddition=readFileSync(join(f.batch,'logs/quarantine',quarantines[0],'1.tsv'),'utf8');
    assert.match(rejectedAddition,/\n999\t/); assert.doesNotMatch(readFileSync(tracker,'utf8'),/\|\s*999\s*\|/);
    const addition=join(f.batch,'tracker-additions/1.tsv');
    const merge=()=>spawnSync(process.execPath,[join(ROOT,'merge-tracker.mjs'),'--user','fixture'],{encoding:'utf8',timeout:30000,env:{...process.env,CAREER_OPS_ROOT:f.root,CAREER_OPS_DATA_DIR:f.root,CAREER_OPS_USER:'fixture',CAREER_OPS_TRACKER:tracker,CAREER_OPS_ADDITIONS:join(f.batch,'tracker-additions'),CAREER_OPS_BATCH_STATE:f.state}});
    // Existing rejected additions must also be safe during Go's initial merge.
    for(const status of ['failed','needs_confirmation','paused_rate_limit','rate_limited','processing','pending','closed']) {
      writeFileSync(f.state,stateHeader+stateRow(1,status)); writeFileSync(addition,rejectedAddition);
      const result=merge(); assert.equal(result.status,0,result.stdout+result.stderr);
      assert.doesNotMatch(readFileSync(tracker,'utf8'),/\|\s*999\s*\|/);
      assert.equal(existsSync(addition),true,'unaccepted addition stays available for later valid completion');
      assert.match(result.stderr,/batch job #1/);
    }
    writeFileSync(f.state,stateHeader+stateRow(1,'completed')); const mismatched=merge();
    assert.equal(mismatched.status,0,mismatched.stderr); assert.match(mismatched.stderr,/reserved report number/);
    assert.doesNotMatch(readFileSync(tracker,'utf8'),/\|\s*999\s*\|/);
    // A fresh valid completion uses the same job and reserved number and merges.
    writeFileSync(f.state,stateHeader+stateRow(1,'pending'));
    const completed=f.run(['--limit','1'],'success001'); assert.equal(completed.status,0,completed.stdout+completed.stderr);
    assert.equal(readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t')[2],'completed');
    assert.match(readFileSync(tracker,'utf8'),/^\|\s*1\s*\|.*Acme/m);
    assert.equal(existsSync(join(f.batch,'tracker-additions/merged/1.tsv')),true);
    // The same report guard does not invent batch ownership for standalone TSVs.
    writeFileSync(join(f.batch,'tracker-additions/standalone.tsv'),rejectedAddition.replaceAll('Acme','Other').replaceAll('https://example.com/jobs/1','https://example.com/jobs/standalone'));
    const standalone=merge(); assert.equal(standalone.status,0,standalone.stdout+standalone.stderr);
    assert.match(readFileSync(tracker,'utf8'),/^\|\s*999\s*\|.*Other/m);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('strict validator rejects wrong report target and unrelated posting URL; source and explicit alternatives work', () => {
  const f=fixture();
  try {
    const reportPath=join(f.root,'reports/001-acme.md'), trackerPath=join(f.batch,'1.tsv');
    writeFileSync(reportPath,`## Job Description (archived verbatim)\n${'Real substantive JD requirement '.repeat(35)}\n## Machine Summary\n\n\`\`\`yaml\ncompany: Acme\nrole: Engineer\nscore: 4\ncompany_confidential: false\nvia: null\nfinal_decision: Apply\nhard_stops: []\n\`\`\`\n`);
    const tracker = (url=posting(1), link='[001](reports/001-acme.md)') => writeFileSync(trackerPath,`num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\tvia\n001\t2026-10-14\tAcme\tEngineer\tEvaluated\t4.0/5\t❌\t${link}\tnote\t${url}\t\n`);
    const validate=(extra={})=>validateWorkerArtifacts({reportPath,trackerPath,strictWorkflow:true,userRoot:f.root,reportNum:'001',expectedUrl:posting(1),...extra});
    tracker(); assert.equal(validate().valid,true);
    tracker(posting(1),'[999](reports/999-other.md)'); assert.match(validate().errors.join(';'),/report link/);
    tracker(posting(2)); assert.match(validate().errors.join(';'),/posting identity/);
    const local='local:jds/captured.md'; writeFileSync(join(f.root,'jds/captured.md'),`---\nsource_url: ${posting(1)}\napplication_url: ${posting(3)}\n---\nCaptured JD`);
    tracker(posting(1)); assert.equal(validate({expectedUrl:local}).valid,true);
    tracker(posting(3)); assert.equal(validate({expectedUrl:local}).valid,true);
    tracker(posting(2)); assert.equal(validate({expectedUrl:local}).valid,false);
    const spaced='https://tracking.example/jobs/123?title=Tech Lead, Android Core Product - Bologna, Italy&source=linkedin';
    writeFileSync(join(f.root,'jds/captured.md'),`---\nsource_url: ${posting(1)}\napplication_url: "${spaced}"\n---\nCaptured JD`);
    for(const value of [spaced,spaced.replaceAll(' ','%20'),new URL(spaced).href]) {
      tracker(value);assert.equal(validate({expectedUrl:local}).valid,true,value);
    }
    tracker(spaced.replace('/123?','/999?'));assert.equal(validate({expectedUrl:local}).valid,false);
    tracker(spaced.replace('Tech Lead','Another role'));assert.equal(validate({expectedUrl:local}).valid,false);
    const answersPath=join(f.root,'answers.json'); writeFileSync(answersPath,JSON.stringify({schema_version:1,user:'fixture',answers:[{url:posting(1),reason:'jd_unavailable',answer:'employer alternative',employer_url:posting(3)}]}));
    tracker(posting(3)); assert.equal(validate({answersPath,user:'fixture'}).valid,true);
    const env={...process.env,CAREER_OPS_ROOT:f.root,CAREER_OPS_DATA_DIR:f.root}; delete env.CAREER_OPS_USER;
    const cli=spawnSync(process.execPath,[join(ROOT,'batch/validate-worker-artifacts.mjs'),'--user','fixture','--report',reportPath,'--tracker',trackerPath,'--strict-workflow','--user-root',f.root,'--report-num','001','--expected-url',posting(1),'--answers-file',answersPath],{env,encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);
    tracker(posting(2)); assert.equal(validate({answersPath,user:'fixture'}).valid,false);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('posting identity encodes literal spaces without loosening public URL or control-byte checks', () => {
  const raw='https://jobs.example.com/Android Core?title=Tech Lead&source=linkedin';
  assert.equal(postingIdentity(raw),postingIdentity(raw.replaceAll(' ','%20')));
  assert.equal(postingIdentity(raw),postingIdentity('https://jobs.example.com/Android%20Core?source=linkedin&title=Tech+Lead'));
  for(const value of ['https://localhost/job title','https://127.0.0.1/job title','https://10.0.0.1/job title',
    'https://user:password@example.com/job title','https://exa mple.com/job','https://example.com/job\ttitle',
    'https://example.com/job\ntitle','https://example.com/job\rtitle','file:///job title',null]) assert.equal(postingIdentity(value),null,String(value));
});
