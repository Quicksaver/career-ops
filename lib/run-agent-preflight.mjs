import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { lockDirFor, lockRecoveryVerdict, RECOVER_STALE, rmLockArtifactSync } from '../pipeline-lock.mjs';
import { inspectOwnership } from '../batch/runner-ownership.mjs';
import { stopRegisteredWorker } from '../batch/worker-process.mjs';
import { terminateProcessTreeSync } from './runner-command.mjs';
import { processAlive, workflowRunnerPidPaths } from './run-artifacts.mjs';
import { channelPaths, readJson } from './run-agent-channel.mjs';
import { runPipelinePath } from './run-queue.mjs';
import { canonicalizeTrackerPath, trackerLockDirFor } from '../tracker-utils.mjs';
import { resolveTrackerPath } from '../path-resolver.mjs';

// Before an agent starts a run: find what an earlier run left behind and clear
// it, so the new run starts clean or resumes. Every removal follows the rule
// the owning lock already uses (a dead owner, or nothing alive that could hold
// it). Live processes are stopped only with `terminate`, and never a run a
// person started at a terminal: that is the user's to end.

const alive = pid => { try { return processAlive(pid); } catch { return true; } };
const readPid = path => {
  try { const pid = Number(readFileSync(path, 'utf8').trim()); return Number.isSafeInteger(pid) && pid > 0 ? pid : null; }
  catch { return null; }
};

function settle(done, ms = 10_000) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (const end = Date.now() + ms; Date.now() < end && !done();) Atomics.wait(pause, 0, 0, 200);
}

function workerRegistrations(batchDir) {
  if (!existsSync(batchDir)) return [];
  return readdirSync(batchDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('.workers-'))
    .flatMap(entry => readdirSync(join(batchDir, entry.name))
      .filter(name => name.endsWith('.json') && !/\.job-(?:result|launch)\.json$/.test(name))
      .map(name => join(batchDir, entry.name, name)));
}

function workerAlive(path) {
  const owner = readJson(path);
  return Boolean(owner && (alive(owner.owner_pid) || (owner.pid && alive(owner.pid))));
}

export function preflight({ userRoot, terminate = false, kill = terminateProcessTreeSync }) {
  const report = { ready: false, terminated: [], released: [], blocking: [], notes: [] };
  const batchDir = join(userRoot, 'batch');
  const agentState = readJson(channelPaths(userRoot).state);

  // 1. A coordinator that is still alive. An agent run is ours to end; any
  //    other run belongs to whoever started it.
  for (const pidPath of workflowRunnerPidPaths(userRoot)) {
    const pid = readPid(pidPath);
    if (!pid || !alive(pid)) continue;
    const agentRun = agentState?.pid === pid && agentState.phase === 'running';
    if (!agentRun) {
      report.blocking.push({ kind: 'coordinator', pid, detail: 'A run-workflow coordinator not started in agent mode is running (an interactive or headless run). Ask the user before ending it.' });
    } else if (terminate) {
      kill(pid);
      report.terminated.push({ kind: 'agent_coordinator', pid, run_id: agentState.run_id });
    } else {
      report.blocking.push({ kind: 'agent_coordinator', pid, run_id: agentState.run_id, detail: 'An earlier agent run is still running; pass --terminate to end it.' });
    }
  }
  const coordinatorAlive = workflowRunnerPidPaths(userRoot).some(path => alive(readPid(path)));

  // 2. A batch runner that outlived its coordinator, then its workers.
  const batchPid = join(batchDir, 'batch-runner.pid');
  const batchOwner = inspectOwnership(batchPid);
  if (batchOwner.status === 'alive' && !coordinatorAlive) {
    if (terminate) {
      kill(batchOwner.pid);
      report.terminated.push({ kind: 'batch_runner', pid: batchOwner.pid });
    } else {
      report.blocking.push({ kind: 'batch_runner', pid: batchOwner.pid, detail: 'A batch runner is running without a coordinator; pass --terminate to end it.' });
    }
  } else if (batchOwner.status === 'ambiguous') {
    report.blocking.push({ kind: 'batch_runner', detail: `Batch ownership at ${batchPid}.owner.lock is unreadable; inspect it by hand.` });
  }
  const batchAlive = inspectOwnership(batchPid).status === 'alive';
  if (!batchAlive && !coordinatorAlive) {
    for (const path of workerRegistrations(batchDir)) {
      if (workerAlive(path) && !terminate) {
        report.blocking.push({ kind: 'worker', path, detail: 'A batch worker is running without its runner; pass --terminate to end it.' });
        continue;
      }
      const live = workerAlive(path);
      try {
        stopRegisteredWorker(path);
        if (live) report.terminated.push({ kind: 'worker', path });
        else report.released.push(path);
      } catch (error) {
        report.blocking.push({ kind: 'worker', path, detail: error.message });
      }
    }
  }

  // A killed tree can take a moment to exit; its locks are judged after that.
  if (report.terminated.length) settle(() => !workflowRunnerPidPaths(userRoot).some(path => alive(readPid(path)))
    && inspectOwnership(batchPid).status !== 'alive' && !workerRegistrations(batchDir).some(workerAlive));

  // 3. Locks whose owner is gone.
  const anythingAlive = workflowRunnerPidPaths(userRoot).some(path => alive(readPid(path)))
    || inspectOwnership(batchPid).status === 'alive'
    || workerRegistrations(batchDir).some(workerAlive);
  for (const pidPath of workflowRunnerPidPaths(userRoot)) {
    const lockDir = lockDirFor(pidPath);
    if (existsSync(lockDir) && lockRecoveryVerdict(lockDir, Infinity) === RECOVER_STALE) {
      rmLockArtifactSync(lockDir);
      report.released.push(lockDir);
    }
    const pid = readPid(pidPath);
    if (existsSync(pidPath) && !(pid && alive(pid))) {
      rmSync(pidPath, { force: true });
      report.released.push(pidPath);
    }
  }
  if (inspectOwnership(batchPid).status === 'dead') {
    rmSync(batchPid, { force: true });
    rmSync(`${batchPid}.owner.lock`, { recursive: true, force: true });
    report.released.push(`${batchPid}.owner.lock`);
  }
  // Only the batch runner and its workers take the batch-state lock; with none
  // of them alive it has no possible holder.
  const stateLock = join(batchDir, '.batch-state.lock');
  if (!anythingAlive && existsSync(stateLock)) {
    rmSync(stateLock, { recursive: true, force: true });
    report.released.push(stateLock);
  }
  const trackerLock = (() => { try { return trackerLockDirFor(canonicalizeTrackerPath(resolveTrackerPath(userRoot))); } catch { return null; } })();
  for (const lockDir of [lockDirFor(runPipelinePath(userRoot)), trackerLock].filter(Boolean)) {
    if (existsSync(lockDir) && lockRecoveryVerdict(lockDir, 30_000) === RECOVER_STALE) {
      rmLockArtifactSync(lockDir);
      report.released.push(lockDir);
    }
  }

  // 4. What the next run picks up by itself, for the agent's report.
  const additions = join(batchDir, 'tracker-additions');
  const pendingAdditions = existsSync(additions) ? readdirSync(additions).filter(name => name.endsWith('.tsv')).length : 0;
  if (pendingAdditions) report.notes.push(`${pendingAdditions} unmerged tracker addition(s); the run merges them before dispatching.`);
  const statePath = join(batchDir, 'batch-state.tsv');
  const processing = existsSync(statePath) ? readFileSync(statePath, 'utf8').split('\n').filter(line => line.split('\t')[2] === 'processing').length : 0;
  if (processing) report.notes.push(`${processing} job(s) left in processing; the batch runner recovers them at start.`);

  report.ready = report.blocking.length === 0;
  return report;
}
