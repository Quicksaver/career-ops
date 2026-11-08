import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preflight } from '../lib/run-agent-preflight.mjs';
import { processAlive } from '../lib/run-artifacts.mjs';

const deadPid = () => spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;
const sleeper = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { windowsHide: true, stdio: 'ignore' });
const stamp = (dir, pid) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid, token: `token-${pid}`, started_at: new Date().toISOString() }));
};

function userRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'run-agent-preflight-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['data/run-agent', 'batch/tracker-additions', 'batch/.workers-abc']) mkdirSync(join(root, dir), { recursive: true });
  return root;
}
// Real kills are tested through processes this test owns; the injected killer
// records the call and ends the same process.
const killer = calls => pid => { calls.push(pid); try { process.kill(pid); } catch { /* already gone */ } };
async function until(predicate) {
  for (const end = Date.now() + 10_000; Date.now() < end; await new Promise(done => setTimeout(done, 50))) if (predicate()) return;
  assert.fail('condition never held');
}

test('leftovers whose owners are dead are released and the run is ready', t => {
  const root = userRoot(t);
  const dead = deadPid();
  writeFileSync(join(root, 'data/run-workflow.pid'), `${dead}\n`);
  stamp(join(root, 'data/run-workflow.pid.lock'), dead);
  stamp(join(root, 'data/go-runner.pid.lock'), dead);
  writeFileSync(join(root, 'batch/batch-runner.pid'), '12345\n');
  stamp(join(root, 'batch/batch-runner.pid.owner.lock'), dead);
  writeFileSync(join(root, 'batch/.workers-abc/1.json'), JSON.stringify({ owner_pid: dead, pid: dead, state: 'running' }));
  mkdirSync(join(root, 'batch/.batch-state.lock'));
  writeFileSync(join(root, 'batch/.batch-state.lock/pid'), `999999\t${Math.floor(Date.now() / 1000)}\n`);
  writeFileSync(join(root, 'batch/tracker-additions/1.tsv'), 'num\n');
  writeFileSync(join(root, 'batch/batch-state.tsv'), 'id\turl\tstatus\n1\thttps://example.com/1\tprocessing\n');

  const calls = [];
  const report = preflight({ userRoot: root, terminate: true, kill: killer(calls) });
  assert.equal(report.ready, true, JSON.stringify(report));
  assert.deepEqual(calls, []);
  for (const path of ['data/run-workflow.pid', 'data/run-workflow.pid.lock', 'data/go-runner.pid.lock', 'batch/batch-runner.pid',
    'batch/batch-runner.pid.owner.lock', 'batch/.workers-abc/1.json', 'batch/.batch-state.lock']) {
    assert.equal(existsSync(join(root, path)), false, `${path} should be released`);
  }
  assert.equal(report.notes.length, 2);
});

test('a run started at a terminal blocks and is never ended', t => {
  const root = userRoot(t);
  const child = sleeper();
  t.after(() => child.kill());
  writeFileSync(join(root, 'data/run-workflow.pid'), `${child.pid}\n`);
  stamp(join(root, 'data/run-workflow.pid.lock'), child.pid);
  mkdirSync(join(root, 'batch/.batch-state.lock'));

  const calls = [];
  const report = preflight({ userRoot: root, terminate: true, kill: killer(calls) });
  assert.equal(report.ready, false);
  assert.equal(report.blocking[0].kind, 'coordinator');
  assert.deepEqual(calls, []);
  assert.equal(processAlive(child.pid), true);
  assert.equal(existsSync(join(root, 'data/run-workflow.pid.lock')), true);
  assert.equal(existsSync(join(root, 'batch/.batch-state.lock')), true, 'a live coordinator may hold the batch-state lock');
});

test('a leftover agent run is ended with --terminate and only reported without it', async t => {
  const root = userRoot(t);
  const child = sleeper();
  t.after(() => child.kill());
  writeFileSync(join(root, 'data/run-workflow.pid'), `${child.pid}\n`);
  stamp(join(root, 'data/run-workflow.pid.lock'), child.pid);
  writeFileSync(join(root, 'data/run-agent/state.json'), JSON.stringify({ pid: child.pid, phase: 'running', run_id: 'old-run' }));

  const reported = preflight({ userRoot: root, terminate: false, kill: killer([]) });
  assert.equal(reported.ready, false);
  assert.equal(reported.blocking[0].kind, 'agent_coordinator');
  assert.equal(processAlive(child.pid), true);

  const calls = [];
  const ended = preflight({ userRoot: root, terminate: true, kill: killer(calls) });
  assert.deepEqual(calls, [child.pid]);
  await until(() => !processAlive(child.pid));
  assert.equal(ended.terminated[0].kind, 'agent_coordinator');
  const settled = preflight({ userRoot: root, terminate: true, kill: killer([]) });
  assert.equal(settled.ready, true, JSON.stringify(settled));
  assert.equal(existsSync(join(root, 'data/run-workflow.pid.lock')), false);
});

test('a batch runner and its worker left without a coordinator are ended with --terminate', async t => {
  const root = userRoot(t);
  const runner = sleeper();
  const worker = sleeper();
  t.after(() => { runner.kill(); worker.kill(); });
  writeFileSync(join(root, 'batch/batch-runner.pid'), '4242\n');
  stamp(join(root, 'batch/batch-runner.pid.owner.lock'), runner.pid);
  writeFileSync(join(root, 'batch/.workers-abc/7.json'), JSON.stringify({ owner_pid: worker.pid, pid: worker.pid, state: 'running' }));

  const calls = [];
  const report = preflight({ userRoot: root, terminate: true, kill: killer(calls) });
  assert.ok(calls.includes(runner.pid), JSON.stringify(report));
  await until(() => !processAlive(runner.pid) && !processAlive(worker.pid));
  const settled = preflight({ userRoot: root, terminate: true, kill: killer([]) });
  assert.equal(settled.ready, true, JSON.stringify(settled));
  assert.equal(existsSync(join(root, 'batch/batch-runner.pid.owner.lock')), false);
  assert.equal(existsSync(join(root, 'batch/.workers-abc/7.json')), false);
});
