import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, renameSync } from 'node:fs';
import { extname, join } from 'node:path';
import { isMainModule } from '../lib/is-main-module.mjs';
import { resolveRunnerCommand, terminateProcessTreeSync } from '../lib/runner-command.mjs';

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}

function registration(path) {
  const owner = JSON.parse(readFileSync(path, 'utf8'));
  if (!Number.isSafeInteger(owner.owner_pid) || owner.owner_pid <= 0 ||
      (owner.pid != null && (!Number.isSafeInteger(owner.pid) || owner.pid <= 0))) throw new Error('Invalid worker ownership');
  return owner;
}

function workerTreeAlive(pid) {
  return alive(pid) || (process.platform !== 'win32' && pid && alive(-pid));
}

function removeLaunchPayload(registrationPath) {
  const path = `${registrationPath}.job-launch.json`;
  if (existsSync(path)) unlinkSync(path);
}

export function stopRegisteredWorker(path) {
  if (!existsSync(path)) return;
  const owner = registration(path);
  // The supervisor is owned before any CLI exists, including the spawn window.
  if (alive(owner.owner_pid)) terminateProcessTreeSync(owner.owner_pid);
  if (owner.pid && owner.pid !== owner.owner_pid && workerTreeAlive(owner.pid)) terminateProcessTreeSync(owner.pid);
  if (alive(owner.owner_pid) || workerTreeAlive(owner.pid)) throw new Error('Worker cleanup did not drain');
  removeLaunchPayload(path);
  unlinkSync(path);
}

function guardStaleWorkers(batchDir) {
  if (!existsSync(batchDir)) return;
  for (const dir of readdirSync(batchDir, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith('.workers-')) continue;
    for (const name of readdirSync(join(batchDir, dir.name)).filter(name => name.endsWith('.json') && !/\.job-(?:result|launch)\.json$/.test(name))) {
      const path = join(batchDir, dir.name, name);
      const owner = registration(path);
      if (alive(owner.owner_pid) || workerTreeAlive(owner.pid)) throw new Error(`Prior worker still owns processing: ${path}`);
      // Only proven dead registrations can be recovered by a new batch owner.
      removeLaunchPayload(path);
      unlinkSync(path);
    }
  }
}

export async function runWorker(command, args, { timeoutSeconds, registrationPath, terminateTree = terminateProcessTreeSync }) {
  const seconds = Number(timeoutSeconds);
  if (!String(timeoutSeconds).trim() || !Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid worker timeout');
  let child, timeout;
  let timedOut = false, interrupted = false, drained = false, stopped = false, stoppingError;
  const record = { owner_pid: process.pid, pid: null, state: 'starting' };
  let rejectCleanup;
  const cleanupFailure = new Promise((resolve, reject) => { rejectCleanup = reject; });
  // A stop can fail during the registration write, before the close race exists.
  cleanupFailure.catch(() => {});
  const save = () => {
    const pending = `${registrationPath}.pending`;
    writeFileSync(pending, JSON.stringify(record));
    renameSync(pending, registrationPath);
  };
  save();
  const failCleanup = error => {
    stoppingError ||= error;
    record.state = 'cleanup_failed'; record.error = stoppingError.message;
    try { save(); } catch { /* The original cleanup failure remains fatal. */ }
    child?.unref();
    rejectCleanup(stoppingError);
  };
  const stop = () => {
    try { if (child) terminateTree(child); stopped = true; }
    catch (error) { failCleanup(error); }
  };
  const interrupt = () => { interrupted = true; stop(); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const resultPath = `${registrationPath}.job-result.json`;
  const payloadPath = `${registrationPath}.job-launch.json`;
  try {
    let launch = resolveRunnerCommand(command, args);
    // Disposable Git Bash fixtures use extensionless Bash executables.
    if (process.platform === 'win32' && !extname(launch.command) && existsSync(launch.command) &&
        /^#![^\r\n]*\bbash(?:\s|$)/.test(readFileSync(launch.command, 'utf8').slice(0, 256).split('\n')[0])) {
      launch = resolveRunnerCommand('bash', [launch.command, ...args]);
    }
    if (interrupted) { drained = true; return 130; }
    if (process.platform === 'win32') {
      if (existsSync(resultPath)) unlinkSync(resultPath);
      writeFileSync(payloadPath, JSON.stringify({ command: launch.command, args: launch.args,
        verbatim: !!launch.options.windowsVerbatimArguments, ownerPid: process.pid }), { mode: 0o600 });
      launch = { command: join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
          join(import.meta.dirname, '../lib/windows-job-worker.ps1'), '-PayloadFile', payloadPath, '-ResultFile', resultPath],
        options: { shell: false, windowsHide: true } };
    }
    child = spawn(launch.command, launch.args, { ...launch.options, stdio: 'inherit' });
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    record.pid = child.pid || null; record.state = 'running';
    try { save(); } catch (error) {
      stop();
      let cleanupDeadline;
      try {
        await Promise.race([closed, cleanupFailure, new Promise((resolve, reject) => {
          cleanupDeadline = setTimeout(() => reject(new Error('Worker close unconfirmed after registration failure')), 5000);
        })]);
      } finally { clearTimeout(cleanupDeadline); }
      throw error;
    }
    if (seconds > 0) {
      const deadline = Date.now() + seconds * 1000;
      timeout = setInterval(() => {
        if (Date.now() < deadline || timedOut) return;
        timedOut = true;
        try { writeFileSync(`${registrationPath}.timeout`, 'worker timeout\n'); }
        catch (error) { failCleanup(error); }
        finally { stop(); }
      }, 100);
    }
    const result = await Promise.race([closed, cleanupFailure]);
    if (stoppingError) throw stoppingError;
    if (!drained) {
      if (process.platform === 'win32' && !stopped) {
        const completion = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
        if (completion?.drained !== true) throw new Error('Windows worker job did not confirm cleanup');
      } else if (process.platform !== 'win32') {
        if (!stopped) terminateTree(child);
        const deadline = Date.now() + 5000;
        while (workerTreeAlive(child.pid)) {
          if (Date.now() >= deadline) throw new Error('Worker process group did not drain');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      drained = true;
    }
    return timedOut ? 124 : interrupted ? 130 : result.code ?? 130;
  } catch (error) {
    if (!child?.pid) drained = true;
    throw error;
  } finally {
    clearInterval(timeout);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    removeLaunchPayload(registrationPath);
    if (drained) {
      if (existsSync(registrationPath)) unlinkSync(registrationPath);
    } else {
      child?.unref();
      record.state = 'cleanup_failed'; record.error = stoppingError?.message || 'Worker tree cleanup unconfirmed';
      save();
    }
  }
}

if (isMainModule(import.meta.url)) {
  if (process.argv[2] === '--help' || process.argv[2] === '-h') console.log('Usage: worker-process.mjs stop REGISTRATION | stop-pid PID | guard BATCH_DIR | run SECONDS REGISTRATION COMMAND [ARGS...]');
  else {
    try {
      const [mode, ...args] = process.argv.slice(2);
      if (mode === 'stop' && args.length === 1) stopRegisteredWorker(args[0]);
      else if (mode === 'stop-pid' && args.length === 1) terminateProcessTreeSync(Number(args[0]));
      else if (mode === 'guard' && args.length === 1) guardStaleWorkers(args[0]);
      else if (mode === 'run' && args.length >= 3) {
        const [timeoutSeconds, registrationPath, command, ...workerArgs] = args;
        process.exitCode = await runWorker(command, workerArgs, { timeoutSeconds, registrationPath });
      } else throw new Error('Invalid worker-process arguments');
    } catch (error) { console.error(error.message); process.exitCode = 125; }
  }
}
