import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { extname } from 'node:path';
import { isMainModule } from '../lib/is-main-module.mjs';
import { resolveRunnerCommand, terminateProcessTreeSync } from '../lib/runner-command.mjs';

function stopRegisteredWorker(path) {
  if (!existsSync(path)) return;
  const owner = JSON.parse(readFileSync(path, 'utf8'));
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !Number.isSafeInteger(owner.owner_pid) || owner.owner_pid <= 0) throw new Error('Invalid worker ownership');
  terminateProcessTreeSync(owner.pid);
}

export async function runWorker(command, args, { timeoutSeconds, registrationPath }) {
  const seconds = Number(timeoutSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid worker timeout');
  let launch = resolveRunnerCommand(command, args);
  // Disposable Git Bash fixtures can use extensionless Bash executables.
  // Launch their script explicitly; npm wrappers still use the trusted resolver.
  if (process.platform === 'win32' && !extname(launch.command) && existsSync(launch.command) &&
      /^#![^\r\n]*\bbash(?:\s|$)/.test(readFileSync(launch.command, 'utf8').slice(0, 256).split('\n')[0])) {
    launch = resolveRunnerCommand('bash', [launch.command, ...args]);
  }
  const child = spawn(launch.command, launch.args, { ...launch.options, stdio: 'inherit' });
  let timeout = null;
  let timedOut = false;
  let stoppingError = null;
  const stop = () => {
    try { terminateProcessTreeSync(child); }
    catch (error) { stoppingError = error; }
  };
  const interrupt = () => { stop(); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    if (child.pid) {
      try { writeFileSync(registrationPath, JSON.stringify({ owner_pid: process.pid, pid: child.pid })); }
      catch (error) { stop(); await closed; throw error; }
      // Check elapsed time rather than handing an oversized delay to setTimeout.
      const deadline = Date.now() + seconds * 1000;
      timeout = setInterval(() => {
        if (Date.now() < deadline || timedOut) return;
        timedOut = true;
        try { writeFileSync(`${registrationPath}.timeout`, 'worker timeout\n'); }
        catch (error) { stoppingError = error; }
        finally { stop(); }
      }, 100);
    }
    const result = await closed;
    if (stoppingError) throw stoppingError;
    // A POSIX CLI can exit before its subprocesses. Its detached group remains
    // ours until completion, so drain that group before accepting artifacts.
    if (process.platform !== 'win32') terminateProcessTreeSync(child);
    return timedOut ? 124 : result.code ?? 130;
  } finally {
    clearInterval(timeout);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (existsSync(registrationPath)) unlinkSync(registrationPath);
  }
}

if (isMainModule(import.meta.url)) {
  if (process.argv[2] === '--help' || process.argv[2] === '-h') console.log('Usage: worker-process.mjs stop REGISTRATION | run SECONDS REGISTRATION COMMAND [ARGS...]');
  else {
    try {
      const [mode, ...args] = process.argv.slice(2);
      if (mode === 'stop' && args.length === 1) stopRegisteredWorker(args[0]);
      else if (mode === 'run' && args.length >= 3) {
        const [timeoutSeconds, registrationPath, command, ...workerArgs] = args;
        process.exitCode = await runWorker(command, workerArgs, { timeoutSeconds, registrationPath });
      } else throw new Error('Invalid worker-process arguments');
    } catch (error) { console.error(error.message); process.exitCode = 125; }
  }
}
