#!/usr/bin/env node

import { spawnSync } from 'child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getUserContext,
  printUserContextErrorAndExit,
  systemPath,
  userPath,
} from './lib/user-context.mjs';
import { appendExpiredRows, parsePendingRows } from './lib/pipeline-queue.mjs';

let context;
try {
  context = getUserContext(process.argv.slice(2));
} catch (error) {
  printUserContextErrorAndExit(error);
}

const args = context.args;
const dryRun = args.includes('--dry-run');
const noFallback = args.includes('--no-fallback');
const jsonOutput = args.includes('--json');
const throttleArg = args.find((arg) => arg === '--throttle' || arg.startsWith('--throttle='));
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: node pipeline-liveness.mjs --user <id> [--throttle[=ms]] [--no-fallback] [--dry-run] [--json]');
  console.log('Checks HTTP(S) Pending rows and moves confirmed expired rows to Processed.');
  process.exit(0);
}
const allowed = new Set(['--dry-run', '--no-fallback', '--throttle', '--json']);
const unknown = args.filter((arg) => !allowed.has(arg) && !arg.startsWith('--throttle='));
if (unknown.length) {
  console.error(`Unknown option: ${unknown[0]}`);
  process.exit(1);
}

function finish(result, exitCode = 0) {
  const lines = [];
  if (jsonOutput) {
    lines.push(JSON.stringify(result));
  } else if (result.status === 'failed') {
    lines.push(`[pipeline-liveness] failed: ${result.error || 'unknown failure'}`);
    if (result.stderr) lines.push(`[pipeline-liveness] detail: ${result.stderr}`);
  } else {
    for (const item of result.results || []) {
      const reason = item.reason ? ` — ${item.reason}` : '';
      lines.push(`[pipeline-liveness] ${item.result}: ${item.url}${reason}`);
    }
    lines.push(`[pipeline-liveness] summary: checked ${result.checked || 0}, active ${result.active || 0}, expired ${result.expired || 0}, uncertain ${result.uncertain || 0}, moved ${result.moved || 0}${result.dry_run ? ' (dry run)' : ''}`);
    for (const warning of result.tracker_warnings || []) {
      lines.push(`[pipeline-liveness] tracker warning: ${warning.company} — ${warning.role}: ${warning.message}`);
    }
  }
  // This helper may emit a large machine payload. A synchronous fd write keeps
  // `--json` lossless even though this function terminates the process.
  writeFileSync(1, `${lines.join('\n')}\n`);
  process.exit(exitCode);
}

const pipelinePath = userPath(context, 'data/pipeline.md');
if (!existsSync(pipelinePath)) {
  finish({ status: 'completed', checked: 0, active: 0, expired: 0, uncertain: 0, local: 0, moved: 0, results: [], dry_run: dryRun });
}

const original = readFileSync(pipelinePath, 'utf-8');
const pendingRows = parsePendingRows(original).rows;
const webUrls = [...new Set(pendingRows.map((row) => row.url).filter((url) => /^https?:\/\//i.test(url)))];
const local = pendingRows.filter((row) => row.url.startsWith('local:')).length;
const unsupported = pendingRows.length - webUrls.length - local;

if (webUrls.length === 0) {
  finish({
    status: 'completed', checked: 0, active: 0, expired: 0, uncertain: unsupported,
    local, unsupported, moved: 0, results: [], dry_run: dryRun,
  }, unsupported ? 2 : 0);
}

const tempDir = mkdtempSync(join(tmpdir(), 'career-ops-liveness-'));
const urlFile = join(tempDir, 'urls.txt');
writeFileSync(urlFile, `${webUrls.join('\n')}\n`, 'utf-8');
const checkerArgs = [systemPath('check-liveness.mjs'), '--json'];
if (noFallback) checkerArgs.push('--no-fallback');
if (throttleArg) checkerArgs.push(throttleArg);
checkerArgs.push('--file', urlFile);
const checked = spawnSync(process.execPath, checkerArgs, {
  cwd: context.projectRoot,
  encoding: 'utf-8',
  maxBuffer: 16 * 1024 * 1024,
});
rmSync(tempDir, { recursive: true, force: true });

let payload;
try {
  payload = JSON.parse((checked.stdout || '').trim());
} catch {
  finish({
    status: 'failed',
    error: `Liveness checker returned invalid JSON (exit ${checked.status ?? 'signal'})`,
    stderr: (checked.stderr || '').trim().slice(-1000),
  }, 1);
}
if (payload.status !== 'completed' || !Array.isArray(payload.results)) {
  finish(payload, 1);
}

const expiredUrls = new Set(payload.results.filter((item) => item.result === 'expired').map((item) => item.url));
const updated = appendExpiredRows(original, expiredUrls);
const trackerUpdates = [];
const trackerWarnings = [];
for (const row of pendingRows.filter((item) => expiredUrls.has(item.url))) {
  const [company, role] = row.fields;
  if (!company || !role) continue;
  const statusArgs = [
    systemPath('set-status.mjs'), '--user', context.userId,
    company, 'Closed', '--role', role,
    '--note', 'Posting expired during pipeline liveness sweep', '--json',
  ];
  if (dryRun) statusArgs.push('--dry-run');
  const status = spawnSync(process.execPath, statusArgs, {
    cwd: context.projectRoot, encoding: 'utf-8', maxBuffer: 1024 * 1024,
  });
  if (status.status === 0) {
    trackerUpdates.push({ company, role });
  } else if (status.status !== 2) {
    trackerWarnings.push({
      company,
      role,
      exit_code: status.status,
      message: (status.stdout || status.stderr || '').trim().slice(-500),
    });
  }
}
if (!dryRun && updated.moved.length) {
  const temporary = `${pipelinePath}.tmp-${process.pid}`;
  writeFileSync(temporary, updated.text, 'utf-8');
  renameSync(temporary, pipelinePath);
}

const result = {
  status: 'completed',
  checked: webUrls.length,
  active: payload.active,
  expired: payload.expired,
  uncertain: payload.uncertain + unsupported,
  local,
  unsupported,
  moved: updated.moved.length,
  tracker_updates: trackerUpdates,
  tracker_warnings: trackerWarnings,
  results: payload.results,
  dry_run: dryRun,
};
finish(result, result.uncertain ? 2 : 0);
