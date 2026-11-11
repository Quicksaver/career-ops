import { walkTree } from './walk-tree.mjs';
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
  { kind: 'run', relativePath: 'data/workflow-runs' },
  // Existing diagnostic folders retain their original names and retention.
  { kind: 'run', relativePath: 'data/go-runs' },
];

// batch/logs holds each job's transcript, final answer and per-job inputs.
// Nothing reads them once the job has finished: duplicate resolution and
// re-evaluation work from the tracker, reports (which archive the job text),
// jds/, data/posting-context/ and output/. These files are the exceptions:
// open holds are read by the coordinator, discard.log by discard-analytics,
// saved browser captures by jd-archive-maintenance, and directories such as
// quarantine/ keep partial work for manual recovery.
export const BATCH_LOGS_DIR = 'batch/logs';
// Each worker's own scratch folder; removed when its job ends, swept here if
// a crash left one behind.
export const BATCH_SCRATCH_DIR = 'batch/scratch';

export function keepBatchLogFile(name) {
  return name === 'discard.log'
    || name.startsWith('.')
    || name.endsWith('.hold.json')
    || name.endsWith('.browser-capture.json')
    || name.endsWith('.capture-before-browser-recovery.md');
}

function cleanupBatchArtifacts(userRoot, cutoff) {
  const deleted = { files: 0, scratch: 0, bytes: 0 };
  const logsDir = join(userRoot, BATCH_LOGS_DIR);
  if (existsSync(logsDir)) {
    for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
      if (!entry.isFile() || keepBatchLogFile(entry.name)) continue;
      const path = join(logsDir, entry.name);
      const stat = lstatSync(path);
      if (stat.mtimeMs >= cutoff) continue;
      rmSync(path, { force: true });
      deleted.files++;
      deleted.bytes += stat.size;
    }
  }
  const scratchDir = join(userRoot, BATCH_SCRATCH_DIR);
  if (existsSync(scratchDir)) {
    for (const entry of readdirSync(scratchDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(scratchDir, entry.name);
      if (lstatSync(path).mtimeMs >= cutoff) continue;
      deleted.bytes += artifactSize(path);
      rmSync(path, { recursive: true, force: true });
      deleted.scratch++;
    }
  }
  return deleted;
}

export function workflowRunnerPidPaths(userRoot) {
  // Both generations share ownership until the older runner is retired.
  return ['run-workflow.pid', 'go-runner.pid'].map(name => join(userRoot, 'data', name));
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') return true;
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function activeRunnerPids(userRoot, ignoredPids) {
  const active = [];
  for (const lockPath of [...workflowRunnerPidPaths(userRoot), join(userRoot, 'data', 'verify-runner.pid')]) {
    const name = basename(lockPath);
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
  let size = 0;
  walkTree(path, { allowNestedCheckouts: true, onFile: file => { size += lstatSync(file).size; } });
  return size;
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
      deleted_batch_logs: 0,
      deleted_batch_scratch: 0,
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

  const batch = cleanupBatchArtifacts(userRoot, cutoff);
  const deletedBytes = deleted.reduce((total, item) => total + item.bytes, 0) + batch.bytes;
  return {
    status: 'completed',
    retention_days: retentionMs / (24 * 60 * 60 * 1000),
    cutoff: new Date(cutoff).toISOString(),
    deleted_runs: deleted.length,
    deleted_batch_logs: batch.files,
    deleted_batch_scratch: batch.scratch,
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
