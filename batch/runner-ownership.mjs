import { readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { acquirePipelineLock, sameLockDirectory } from '../pipeline-lock.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

export const ownershipPath = pidFile => `${pidFile}.owner.lock`;
export function inspectOwnership(pidFile) {
  const dir = ownershipPath(pidFile);
  if (!existsSync(dir)) return { status: 'absent' };
  let owner;
  try { owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')); }
  catch { return { status: 'ambiguous' }; }
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0 || typeof owner.token !== 'string' || !owner.token) return { status: 'ambiguous' };
  try { process.kill(owner.pid, 0); return { status: 'alive', ...owner }; }
  catch (error) { return { status: error.code === 'ESRCH' ? 'dead' : 'ambiguous', ...owner }; }
}

export async function acquireOwnership(pidFile, nativePid, bashPid) {
  const verdict = inspectOwnership(pidFile);
  if (verdict.status === 'ambiguous') throw new Error('Batch ownership is ambiguous; refusing to remove it');
  // The external Bash process, rather than this short-lived helper, owns the lock.
  process.kill(nativePid, 0);
  const lock = await acquirePipelineLock(`${pidFile}.owner`, { ownerPid: nativePid, timeoutMs: 200, maxWaitMs: 200, retryMs: 20, staleMs: Infinity });
  try { writeFileSync(pidFile, `${bashPid}\n`); }
  catch (error) { lock.release(); throw error; }
  return JSON.parse(readFileSync(join(lock.lockDir, 'owner.json'), 'utf8')).token;
}

export function releaseOwnership(pidFile, token) {
  const dir = ownershipPath(pidFile);
  if (!token || !existsSync(dir)) return false;
  const before = statSync(dir);
  const owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'));
  if (owner.token !== token || !sameLockDirectory(before, statSync(dir))) return false;
  // Remove compatibility metadata while still holding the authoritative lock.
  rmSync(pidFile, { force: true });
  rmSync(dir, { recursive: true, force: true });
  return true;
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node batch/runner-ownership.mjs check PIDFILE | acquire PIDFILE NATIVE_PID BASH_PID | release PIDFILE TOKEN');
    process.exit(0);
  }
  try {
    const [action, pidFile, arg, bashPid] = process.argv.slice(2);
    if (action === 'acquire') console.log(await acquireOwnership(pidFile, Number(arg), bashPid));
    else if (action === 'release') releaseOwnership(pidFile, arg);
    else if (action === 'check') console.log(JSON.stringify(inspectOwnership(pidFile)));
    else throw new Error('unknown ownership action');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
