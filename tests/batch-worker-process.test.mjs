import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runWorker } from '../batch/worker-process.mjs';
import { processAlive } from '../lib/run-artifacts.mjs';
import { resolveRunnerCommand, terminateProcessTreeSync } from '../lib/runner-command.mjs';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const helper = resolve(import.meta.dirname, '../batch/worker-process.mjs');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-worker-tree-'));
  const script = join(dir, 'worker.mjs');
  const pids = join(dir, 'pids');
  const artifact = join(dir, 'late-artifact');
  writeFileSync(script, `import {spawn} from 'node:child_process';
import {appendFileSync,writeFileSync} from 'node:fs';
const [script, pids, artifact, rawDepth] = process.argv.slice(1);
const depth=Number(rawDepth);
appendFileSync(pids, process.pid+'\\n');
if(depth<2) spawn(process.execPath,[script,pids,artifact,String(depth+1)],{stdio:'inherit',detached:process.platform!=='win32'});
if(depth===2) setTimeout(()=>writeFileSync(artifact,'late mutation'),3000);
setInterval(()=>{},1000);
`);
  return { dir, script, pids, artifact, registration: join(dir, 'worker.json'),
    args: [script, pids, artifact, '0'],
    readPids: () => existsSync(pids) ? readFileSync(pids, 'utf8').trim().split('\n').filter(Boolean).map(Number) : [],
  };
}

test('worker timeout drains parent, child and detached grandchild before recovery', async () => {
  const f = fixture();
  try {
    assert.equal(await runWorker(process.execPath, f.args, { timeoutSeconds: 2, registrationPath: f.registration }), 124);
    const pids = f.readPids();
    assert.equal(pids.length, 3, 'fixture must have started the entire tree');
    assert.ok(pids.every(pid => !processAlive(pid)));
    assert.equal(existsSync(f.registration), false);
    await delay(1500);
    assert.equal(existsSync(f.artifact), false);
  } finally { for (const pid of f.readPids()) if (processAlive(pid)) terminateProcessTreeSync(pid); rmSync(f.dir, { recursive: true, force: true }); }
});

test('batch registration stop drains the tree and lets the supervising helper exit', async () => {
  const f = fixture();
  const launch = resolveRunnerCommand(process.execPath, [helper, 'run', '30', f.registration, process.execPath, ...f.args]);
  const supervisor = spawn(launch.command, launch.args, { ...launch.options, stdio: 'ignore' });
  const completion = new Promise(resolve => supervisor.once('close', (code, signal) => resolve({ code, signal })));
  try {
    for (let attempt = 0; attempt < 100 && f.readPids().length < 3; attempt++) await delay(25);
    assert.equal(f.readPids().length, 3);
    const stopped = spawnSync(process.execPath, [helper, 'stop', f.registration], { encoding: 'utf8', timeout: 7000 });
    assert.equal(stopped.status, 0, stopped.stderr);
    const outcome = await Promise.race([completion, delay(5000).then(() => null)]);
    assert.ok(outcome, 'supervisor must drain and exit');
    assert.ok(f.readPids().every(pid => !processAlive(pid)));
    assert.equal(existsSync(f.registration), false);
    assert.equal(existsSync(f.artifact), false);
  } finally { if (processAlive(supervisor.pid)) terminateProcessTreeSync(supervisor); for (const pid of f.readPids()) if (processAlive(pid)) terminateProcessTreeSync(pid); rmSync(f.dir, { recursive: true, force: true }); }
});

test('forced stop of an outer runner includes descendants in nested POSIX groups', { skip: process.platform === 'win32' }, async () => {
  const f = fixture();
  const launch = resolveRunnerCommand(process.execPath, f.args);
  const outer = spawn(launch.command, launch.args, { ...launch.options, stdio: 'ignore' });
  try {
    for (let attempt = 0; attempt < 100 && f.readPids().length < 3; attempt++) await delay(25);
    assert.equal(f.readPids().length, 3);
    terminateProcessTreeSync(outer);
    await delay(100);
    assert.ok(f.readPids().every(pid => !processAlive(pid)));
  } finally { for (const pid of f.readPids()) if (processAlive(pid)) terminateProcessTreeSync(pid); rmSync(f.dir, { recursive: true, force: true }); }
});

test('normal launcher exit drains its surviving descendants before unregistering', async () => {
  const f = fixture();
  writeFileSync(f.script, `import {spawn} from 'node:child_process';
import {appendFileSync,writeFileSync,existsSync} from 'node:fs';
const [script,pids,artifact,depth]=process.argv.slice(1);
appendFileSync(pids,process.pid+'\\n');
if(depth==='0') {
  const child=spawn(process.execPath,[script,pids,artifact,'1'],{stdio:'ignore',detached:process.platform==='win32'}); child.unref();
  while(!existsSync(artifact+'.ready')) await new Promise(r=>setTimeout(r,10));
} else { writeFileSync(artifact+'.ready','ready'); setTimeout(()=>writeFileSync(artifact,'late'),1500); setInterval(()=>{},1000); }
`);
  try {
    assert.equal(await runWorker(process.execPath, f.args, { timeoutSeconds: 0, registrationPath: f.registration }), 0);
    assert.equal(f.readPids().length, 2);
    assert.ok(f.readPids().every(pid => !processAlive(pid)), 'normal completion owns and drains orphaned descendants');
    assert.equal(existsSync(f.registration), false);
    await delay(1700);
    assert.equal(existsSync(f.artifact), false);
  } finally { for (const pid of f.readPids()) if (processAlive(pid)) terminateProcessTreeSync(pid); rmSync(f.dir, { recursive: true, force: true }); }
});

test('cleanup failure retains ownership and blocks recovery until the tree is proven dead', async () => {
  const f = fixture();
  writeFileSync(f.script, "setTimeout(()=>{process.exitCode=0},2000);\n");
  try {
    await assert.rejects(runWorker(process.execPath, f.args, {
      timeoutSeconds: 1.5, registrationPath: f.registration,
      terminateTree() { throw new Error('fixture cleanup denied'); },
    }), /fixture cleanup denied/);
    const owner = JSON.parse(readFileSync(f.registration, 'utf8'));
    assert.equal(owner.state, 'cleanup_failed');
    assert.equal(owner.owner_pid, process.pid);
    const workers = join(f.dir, '.workers-fixture');
    const { mkdirSync, renameSync } = await import('node:fs');
    mkdirSync(workers); renameSync(f.registration, join(workers, 'worker.json'));
    const blocked = spawnSync(process.execPath, [helper, 'guard', f.dir], { encoding: 'utf8' });
    assert.equal(blocked.status, 125); assert.match(blocked.stderr, /Prior worker still owns processing/);
    writeFileSync(join(workers, 'worker.json'), JSON.stringify({owner_pid:2147483000,pid:null,state:'cleanup_failed'}));
    const recovered = spawnSync(process.execPath, [helper, 'guard', f.dir], { encoding: 'utf8' });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(existsSync(join(workers, 'worker.json')), false);
  } finally {
    if (existsSync(f.registration)) { const owner=JSON.parse(readFileSync(f.registration,'utf8')); if(processAlive(owner.pid)) terminateProcessTreeSync(owner.pid); }
    for (const pid of f.readPids()) if (processAlive(pid)) terminateProcessTreeSync(pid);
    rmSync(f.dir, { recursive: true, force: true });
  }
});
