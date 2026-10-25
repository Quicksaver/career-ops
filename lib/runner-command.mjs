import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareCliLaunch } from './cli-launch.mjs';

function envValue(env, name) {
  if (Object.hasOwn(env, name)) return env[name];
  const key = Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function windowsExecutable(command, env, cwd) {
  const paths = /[\\/]/.test(command) || isAbsolute(command)
    ? [resolve(cwd, command)]
    : (envValue(env, 'PATH') || '').split(delimiter).filter(Boolean)
      .map(directory => join(directory.replace(/^"|"$/g, ''), command));
  for (const path of paths) {
    // Prefer native binaries over npm wrappers in the same directory.
    const candidates = extname(path) ? [path] : ['.exe', '.com', '.cmd', '.bat', '.ps1', ''].map(ext => path + ext);
    for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  }
  return command;
}

/** Git Bash only: never resolve Windows' bash.exe/WSL launcher from PATH. */
export function resolveGitBash({ env = process.env, bashPath } = {}) {
  const override = bashPath || envValue(env, 'CAREER_OPS_GIT_BASH');
  const roots = [envValue(env, 'ProgramFiles') || 'C:/Program Files', envValue(env, 'ProgramFiles(x86)')].filter(Boolean);
  const scoopRoots = [envValue(env, 'SCOOP'), envValue(env, 'USERPROFILE') && join(envValue(env, 'USERPROFILE'), 'scoop')].filter(Boolean);
  const candidates = override ? [override] : [
    ...roots.flatMap(root => [join(root, 'Git/bin/bash.exe'), join(root, 'Git/usr/bin/bash.exe')]),
    ...scoopRoots.flatMap(root => [join(root, 'apps/git/current/bin/bash.exe'), join(root, 'apps/git/current/usr/bin/bash.exe')]),
    ...(envValue(env, 'PATH') || '').split(delimiter).filter(Boolean)
      .flatMap(directory => [join(directory, 'bash.exe'), join(directory, '../bin/bash.exe'), join(directory, '../usr/bin/bash.exe')]),
  ];
  for (const candidate of candidates) {
    const bash = resolve(candidate);
    const cygpaths = [join(dirname(bash), 'cygpath.exe'), join(dirname(bash), '../usr/bin/cygpath.exe')];
    if (existsSync(bash) && cygpaths.some(path => existsSync(path))) return bash;
  }
  throw new Error('Git Bash is required to run .sh runners on Windows. Install Git for Windows or set CAREER_OPS_GIT_BASH to its bash.exe. WSL is not supported.');
}

/** A drive path is also accepted by Git Bash with forward slashes. */
export function toGitBashPath(path) {
  return path.replace(/\\/g, '/');
}

// MSYS also interprets single quotes in its Windows command line parser.
// Node only quotes whitespace/double quotes, so force CRT-compatible quoting
// around EVERY Bash argument, including empty strings and single quotes.
function quoteBashArgument(arg) {
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, '$&$&')}"`;
}

/**
 * Resolve an argv vector without evaluating prompts or job text in a shell.
 * Spawn with { ...launch.options, cwd, env, stdio }; preserve detached on POSIX
 * so terminateProcessTree can stop the owned process group.
 */
export function resolveRunnerCommand(command, args = [], {
  platform = process.platform, env = process.env, cwd = process.cwd(), bashPath,
} = {}) {
  if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
    throw new TypeError('Runner command and arguments must be strings');
  }
  const options = { shell: false, windowsHide: true, detached: platform !== 'win32' };
  if (platform !== 'win32') {
    return /\.sh$/i.test(command)
      ? { command: 'bash', args: [command, ...args], options }
      : { command, args: [...args], options };
  }
  if (/\.sh$/i.test(command) || /(?:^|[\\/])bash(?:\.exe)?$/i.test(command)) {
    const explicitBash = /(?:^|[\\/])bash(?:\.exe)?$/i.test(command) && /[\\/]/.test(command) ? command : undefined;
    const bash = resolveGitBash({ env, bashPath: bashPath || explicitBash });
    const bashArgs = /\.sh$/i.test(command) ? [toGitBashPath(resolve(cwd, command)), ...args] : [...args];
    return { command: bash, args: bashArgs.map(quoteBashArgument), options: { ...options, windowsVerbatimArguments: true } };
  }
  const executable = windowsExecutable(command, env, cwd);
  if (/\.(?:mjs|cjs|js)$/i.test(executable)) return { command: process.execPath, args: [executable, ...args], options };
  if (!extname(executable) && existsSync(executable) && /^#![^\r\n]*\bnode(?:\s|$)/.test(readFileSync(executable, 'utf8').split('\n')[0])) {
    return { command: process.execPath, args: [executable, ...args], options };
  }
  try {
    return { ...prepareCliLaunch(executable, [...args], platform), options };
  } catch (error) {
    // npm's .cmd wrapper can exist without its optional PowerShell sibling.
    if (/\.cmd$/i.test(executable)) {
      const wrapper = readFileSync(executable, 'utf8');
      for (const match of wrapper.matchAll(/"%dp0%[\\/]([^"\r\n]+)"\s+%\*/gi)) {
        const target = resolve(dirname(executable), match[1].replace(/[\\/]/g, '/'));
        if (!existsSync(target)) continue;
        if (/\.(?:js|cjs|mjs)$/i.test(target)) return { command: process.execPath, args: [target, ...args], options };
        if (/\.(?:exe|com)$/i.test(target)) return { command: target, args: [...args], options };
      }
    }
    throw error;
  }
}

function ownedPid(childOrPid) {
  const pid = typeof childOrPid === 'number' ? childOrPid : childOrPid?.pid;
  if (pid === undefined) return null; // A failed spawn has no process to stop.
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Refusing to terminate an invalid or current runner PID');
  return pid;
}

/** Bounded emergency cleanup, suitable for synchronous process exit handlers. */
export function terminateProcessTreeSync(childOrPid, {
  platform = process.platform, signal = 'SIGKILL', timeoutMs = 5000,
} = {}) {
  const pid = ownedPid(childOrPid);
  if (!pid) return;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive');
  if (platform === 'win32') {
    const taskkill = join(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe');
    const result = spawnSync(taskkill, ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, timeout: timeoutMs, encoding: 'utf8' });
    if (result.error) throw new Error(`Cannot stop runner tree ${pid}: ${result.error.message}`);
    // A descendant can exit while taskkill walks the tree, and a member that is
    // already exiting can refuse termination ("The operation attempted is not
    // supported"). Windows returns 1 for both even after killing the rest, and
    // the worker's job object stops its members once the root is gone. Accept
    // the failure only when the root and each reported target exit in time.
    if (result.status !== 0 && result.status !== 128) {
      const output = `${result.stdout || ''}\n${result.stderr || ''}`;
      const targets = output.split(/\r?\n/).map(line => /\bPID\s+(\d+)\b/i.exec(line)?.[1]).filter(Boolean).map(Number);
      const exited = target => { try { process.kill(target, 0); return false; } catch (error) { return error.code === 'ESRCH'; } };
      const deadline = Date.now() + timeoutMs;
      while (!targets.length || ![pid, ...targets].every(exited)) {
        if (!targets.length || Date.now() >= deadline) throw new Error(`Cannot stop runner tree ${pid}: ${(result.stderr || result.stdout).trim()}`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    return;
  }
  // Nested runners create their own process groups. Enumerate owned children
  // before stopping the parent group so those groups cannot escape a forced
  // stop of the outer workflow or batch launcher.
  const snapshot = spawnSync('ps', ['-eo', 'pid=,ppid='], { shell: false, windowsHide: true, timeout: timeoutMs, encoding: 'utf8' });
  if (snapshot.error || snapshot.status !== 0) throw new Error(`Cannot inspect runner descendants ${pid}: ${snapshot.error?.message || snapshot.stderr.trim()}`);
  const rows = snapshot.stdout.trim().split(/\n/).map(line => line.trim().split(/\s+/).map(Number));
  const children = new Map();
  for (const [childPid, parentPid] of rows) {
    if (!Number.isSafeInteger(childPid) || !Number.isSafeInteger(parentPid)) continue;
    if (!children.has(parentPid)) children.set(parentPid, []);
    children.get(parentPid).push(childPid);
  }
  const descendants = [];
  const visit = parent => {
    for (const childPid of children.get(parent) || []) {
      visit(childPid);
      descendants.push(childPid);
    }
  };
  visit(pid);
  for (const target of descendants) {
    try { process.kill(target, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  try { process.kill(-pid, signal); }
  catch (error) {
    if (error.code !== 'ESRCH') throw error;
    // Support callers whose existing child was not launched as a process group.
    try { process.kill(pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

/** Stop owned descendants as well as their launcher, with a bounded grace period. */
export async function terminateProcessTree(childOrPid, options = {}) {
  const pid = ownedPid(childOrPid);
  if (!pid) return;
  if ((options.platform || process.platform) === 'win32') return terminateProcessTreeSync(pid, options);
  const timeoutMs = options.timeoutMs ?? 1000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive');
  terminateProcessTreeSync(pid, { ...options, signal: options.signal || 'SIGTERM' });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(-pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())));
  }
  terminateProcessTreeSync(pid, { ...options, signal: 'SIGKILL' });
}
