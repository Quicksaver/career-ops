import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquirePipelineLock } from '../pipeline-lock.mjs';
import { releaseOwnership } from './runner-ownership.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const HEADER = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries';

// The Bash critical section outlives this helper. Its native OS PID, rather
// than an MSYS PID or this short-lived Node PID, owns the shared lock.
export async function acquireStateLease(path, ownerPid, waitMs = 30000) {
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error('Invalid state owner PID');
  process.kill(ownerPid, 0);
  const lock = await acquirePipelineLock(`${path}.owner`, {
    ownerPid, staleMs: Infinity, timeoutMs: waitMs, maxWaitMs: waitMs, retryMs: 40,
  });
  return JSON.parse(readFileSync(join(lock.lockDir, 'owner.json'), 'utf8')).token;
}

function atomicStateWrite(path, lines) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, lines.join('\n') + '\n', { flag: 'wx' });
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
}

// Caller holds the state lease. Read/write once, rather than reopening the
// same temporary file once for every row through Bash redirection on Windows.
export function updateStateRow(path, fields) {
  if (fields.length !== 9 || !/^\d+$/.test(fields[0])) throw new Error('Invalid state row');
  const row = fields.map((field, index) => {
    if (index === 7) return field.replace(/[\r\n\t]/g, ' ');
    if (/[\r\n\t]/.test(field)) throw new Error('Invalid state field');
    return field;
  }).join('\t');
  const lines = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n').filter(Boolean) : [HEADER];
  let found = false;
  const output = [];
  for (const [index, line] of lines.entries()) {
    if (index === 0 || line.split('\t', 1)[0] !== fields[0]) output.push(line);
    else if (!found) { output.push(row); found = true; }
  }
  // Exactly one row for the updated ID, including recovery from prior duplicate
  // writes. Other IDs, including historical rows, remain byte-for-byte intact.
  if (!found) output.push(row);
  atomicStateWrite(path, output);
  return found;
}

export function recoverProcessing(path, now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')) {
  if (!existsSync(path)) return 0;
  let recovered = 0;
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n').filter(Boolean).map((line, index) => {
    const fields = line.split('\t');
    if (!index || fields[2] !== 'processing') return line;
    fields[2] = 'failed'; fields[4] = now; fields[7] = 'stale-processing-state';
    fields[8] = String((/^\d+$/.test(fields[8]) ? Number(fields[8]) : 0) + 1);
    recovered++;
    return fields.join('\t');
  });
  if (recovered) atomicStateWrite(path, lines);
  return recovered;
}

if (isMainModule(import.meta.url)) {
  try {
    const [action, path, ...args] = process.argv.slice(2);
    if (action === 'acquire') console.log(await acquireStateLease(path, Number(args[0]), Number(args[1]) || 30000));
    else if (action === 'release') {
      if (!releaseOwnership(path, args[0])) throw new Error('State lease ownership changed');
    } else if (action === 'update') updateStateRow(path, args);
    else if (action === 'recover') {
      const count = recoverProcessing(path);
      if (count) console.log(`WARN: Recovered ${count} stale processing rows from a previous interrupted run.`);
    } else if (action === '--help') console.log('Usage: state-store.mjs acquire PATH NATIVE_PID WAIT_MS | release PATH TOKEN | update STATE_FILE <9 fields> | recover STATE_FILE');
    else throw new Error('Unknown state store action');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
