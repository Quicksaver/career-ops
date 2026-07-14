import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { basename, join } from 'path';

export const RUN_RETENTION_DAYS = 10;
export const RUN_RETENTION_MS = RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const RUN_ROOTS = [
  { kind: 'verify', relativePath: 'data/verify-runs' },
  { kind: 'go', relativePath: 'data/go-runs' },
];

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function activeRunnerPids(userRoot, ignoredPids) {
  const active = [];
  for (const name of ['go-runner.pid', 'verify-runner.pid']) {
    const lockPath = join(userRoot, 'data', name);
    if (!existsSync(lockPath)) continue;
    const pid = Number.parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);
    if (ignoredPids.has(pid) || !processAlive(pid)) continue;
    active.push({ lock: name, pid });
  }
  return active;
}

export function runIdTimestamp(runId) {
  const match = String(runId).match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
  );
  if (!match) return null;
  const timestamp = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function artifactSize(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((total, name) => total + artifactSize(join(path, name)), 0);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function cleanupExpiredRuns({
  userRoot,
  now = Date.now(),
  retentionMs = RUN_RETENTION_MS,
  ignoreActivePids = [],
} = {}) {
  if (!userRoot) throw new Error('cleanupExpiredRuns requires userRoot');
  const active = activeRunnerPids(userRoot, new Set(ignoreActivePids));
  if (active.length > 0) {
    return {
      status: 'skipped',
      retention_days: retentionMs / (24 * 60 * 60 * 1000),
      deleted_runs: 0,
      deleted_bytes: 0,
      deleted: [],
      active_runners: active,
    };
  }

  const cutoff = now - retentionMs;
  const deleted = [];
  for (const root of RUN_ROOTS) {
    const runRoot = join(userRoot, root.relativePath);
    if (!existsSync(runRoot)) continue;
    for (const entry of readdirSync(runRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const startedAt = runIdTimestamp(entry.name);
      if (startedAt === null || startedAt >= cutoff) continue;
      const path = join(runRoot, entry.name);
      const bytes = artifactSize(path);
      rmSync(path, { recursive: true, force: true });
      deleted.push({
        kind: root.kind,
        run_id: entry.name,
        started_at: new Date(startedAt).toISOString(),
        bytes,
      });
    }
  }

  const deletedBytes = deleted.reduce((total, item) => total + item.bytes, 0);
  return {
    status: 'completed',
    retention_days: retentionMs / (24 * 60 * 60 * 1000),
    cutoff: new Date(cutoff).toISOString(),
    deleted_runs: deleted.length,
    deleted_bytes: deletedBytes,
    deleted_human: formatBytes(deletedBytes),
    deleted,
    active_runners: [],
  };
}

export function compactCompletedRun({ runDir, summary }) {
  if (!runDir) throw new Error('compactCompletedRun requires runDir');
  if (summary?.status !== 'completed') {
    return { status: 'skipped', reason: `run status is ${summary?.status || 'unknown'}` };
  }

  mkdirSync(runDir, { recursive: true });
  const summaryPath = join(runDir, 'summary.json');
  const temporary = join(runDir, `.summary.json.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(temporary, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
  renameSync(temporary, summaryPath);

  let deletedFiles = 0;
  let deletedBytes = 0;
  for (const entry of readdirSync(runDir, { withFileTypes: true })) {
    const path = join(runDir, entry.name);
    if (path === summaryPath) continue;
    deletedBytes += artifactSize(path);
    deletedFiles++;
    rmSync(path, { recursive: true, force: true });
  }

  return {
    status: 'completed',
    run_id: basename(runDir),
    summary: summaryPath,
    deleted_files: deletedFiles,
    deleted_bytes: deletedBytes,
    deleted_human: formatBytes(deletedBytes),
  };
}

export function compactPhaseRecords(phases = []) {
  return phases.map(({ log: _log, ...phase }) => phase);
}
