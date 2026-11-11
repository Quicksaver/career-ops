import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { fail, pass, ROOT } from '../helpers.mjs';

console.log('\nWorkflow — run artifact cleanup and compaction');

const tmp = mkdtempSync(join(tmpdir(), 'career-ops-run-cleanup-'));
try {
  const artifacts = await import(pathToFileURL(join(ROOT, 'lib/run-artifacts.mjs')).href);
  const userRoot = join(tmp, 'users', 'test');
  const verifyRoot = join(userRoot, 'data', 'verify-runs');
  const workflowRoot = join(userRoot, 'data', 'workflow-runs');
  const legacyRoot = join(userRoot, 'data', 'go-runs');
  mkdirSync(verifyRoot, { recursive: true });
  mkdirSync(workflowRoot, { recursive: true });

  const oldVerify = join(verifyRoot, '2026-07-04T11-59-59-999Z');
  const oldWorkflow = join(workflowRoot, '2026-07-01T12-00-00-000Z');
  const oldLegacy = join(legacyRoot, '2026-07-01T12-00-00-000Z');
  const recentLegacy = join(legacyRoot, '2026-07-14T11-00-00-000Z');
  const boundary = join(verifyRoot, '2026-07-04T12-00-00-000Z');
  const recent = join(workflowRoot, '2026-07-14T11-00-00-000Z');
  const unknown = join(verifyRoot, 'manual-backup');
  for (const dir of [oldVerify, oldWorkflow, oldLegacy, recentLegacy, boundary, recent, unknown]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'artifact.log'), 'fixture artifact\n');
  }

  const verifyLock = join(userRoot, 'data', 'verify-runner.pid');
  writeFileSync(verifyLock, `${process.pid}\n`);
  const activeSkip = artifacts.cleanupExpiredRuns({
    userRoot,
    now: Date.parse('2026-07-14T12:00:00.000Z'),
  });
  rmSync(verifyLock, { force: true });
  if (activeSkip.status === 'skipped' && activeSkip.deleted_runs === 0 && existsSync(oldVerify)) {
    pass('cleanup leaves all run artifacts untouched while a user runner is active');
  } else {
    fail(`active-runner cleanup guard wrong: ${JSON.stringify(activeSkip)}`);
  }

  const legacyPid = artifacts.workflowRunnerPidPaths(userRoot)[1];
  writeFileSync(legacyPid, `${process.pid}\n`);
  const legacySkip = artifacts.cleanupExpiredRuns({ userRoot, now: Date.parse('2026-07-14T12:00:00.000Z') });
  rmSync(legacyPid);
  if (legacySkip.status === 'skipped' && existsSync(oldLegacy) && existsSync(oldWorkflow)) {
    pass('legacy workflow ownership also blocks cleanup after the rename');
  } else {
    fail(`legacy-runner cleanup guard wrong: ${JSON.stringify(legacySkip)}`);
  }

  const cleanup = artifacts.cleanupExpiredRuns({
    userRoot,
    now: Date.parse('2026-07-14T12:00:00.000Z'),
  });
  if (cleanup.status === 'completed' && cleanup.deleted_runs === 3 &&
      !existsSync(oldVerify) && !existsSync(oldWorkflow) && existsSync(boundary) &&
      !existsSync(oldLegacy) && existsSync(recentLegacy) && existsSync(recent) && existsSync(unknown)) {
    pass('cleanup removes only timestamped workflow, legacy workflow and verification runs strictly older than ten days');
  } else {
    fail(`run cleanup boundary wrong: ${JSON.stringify(cleanup)}`);
  }

  // batch/logs: finished jobs' files expire, the files still read do not.
  const logsDir = join(userRoot, 'batch', 'logs');
  const scratchRoot = join(userRoot, 'batch', 'scratch');
  mkdirSync(join(logsDir, 'quarantine'), { recursive: true });
  const oldTime = new Date('2026-07-01T12:00:00.000Z');
  const recentTime = new Date('2026-07-13T12:00:00.000Z');
  const expiring = ['042-7.log', '042-7.final.json', '7.source.json', '7.jd-closed.log', '042-7.helper.mjs', '042-7.page.png'];
  const kept = ['7.hold.json', 'discard.log', '7.browser-capture.json', '7.capture-before-browser-recovery.md', '.gitkeep'];
  for (const name of [...expiring, ...kept]) {
    writeFileSync(join(logsDir, name), 'fixture\n');
    utimesSync(join(logsDir, name), oldTime, oldTime);
  }
  writeFileSync(join(logsDir, '043-8.log'), 'recent\n');
  utimesSync(join(logsDir, '043-8.log'), recentTime, recentTime);
  writeFileSync(join(logsDir, 'quarantine', 'rejected.tsv'), 'kept\n');
  utimesSync(join(logsDir, 'quarantine', 'rejected.tsv'), oldTime, oldTime);
  const oldScratch = join(scratchRoot, '042-7');
  const recentScratch = join(scratchRoot, '043-8');
  for (const [dir, time] of [[oldScratch, oldTime], [recentScratch, recentTime]]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'helper.mjs'), 'scratch\n');
    utimesSync(dir, time, time);
  }
  const batchCleanup = artifacts.cleanupExpiredRuns({ userRoot, now: Date.parse('2026-07-14T12:00:00.000Z') });
  const remaining = readdirSync(logsDir).sort();
  const expected = [...kept, '043-8.log', 'quarantine'].sort();
  if (batchCleanup.deleted_batch_logs === expiring.length && batchCleanup.deleted_batch_scratch === 1 &&
      JSON.stringify(remaining) === JSON.stringify(expected) &&
      existsSync(join(logsDir, 'quarantine', 'rejected.tsv')) && !existsSync(oldScratch) && existsSync(recentScratch)) {
    pass('cleanup removes expired batch/logs files and scratch folders, keeping holds, discard.log, captures and quarantine/');
  } else {
    fail(`batch/logs cleanup wrong: result=${JSON.stringify(batchCleanup)} remaining=${JSON.stringify(remaining)}`);
  }

  const completedRun = join(verifyRoot, '2026-07-14T12-00-00-000Z');
  mkdirSync(join(completedRun, 'nested'), { recursive: true });
  writeFileSync(join(completedRun, '01-review.log'), 'large raw log\n');
  writeFileSync(join(completedRun, 'review-input.01.json'), '{}\n');
  writeFileSync(join(completedRun, 'review-checkpoint.01.json'), '{}\n');
  writeFileSync(join(completedRun, 'nested', 'artifact.txt'), 'nested\n');
  const compacted = artifacts.compactCompletedRun({
    runDir: completedRun,
    summary: {
      schema_version: 1,
      runner: 'verify',
      artifact_state: 'compacted',
      status: 'completed',
      run_id: '2026-07-14T12-00-00-000Z',
    },
  });
  const compactedFiles = readdirSync(completedRun);
  const compactedSummary = JSON.parse(readFileSync(join(completedRun, 'summary.json'), 'utf-8'));
  if (compacted.status === 'completed' && compactedFiles.length === 1 &&
      compactedFiles[0] === 'summary.json' && compactedSummary.status === 'completed') {
    pass('completed runs compact immediately to one summary file');
  } else {
    fail(`completed run compaction wrong: result=${JSON.stringify(compacted)} files=${JSON.stringify(compactedFiles)}`);
  }

  const failedRun = join(verifyRoot, '2026-07-14T12-01-00-000Z');
  mkdirSync(failedRun, { recursive: true });
  writeFileSync(join(failedRun, '01-review.log'), 'failure evidence\n');
  const skipped = artifacts.compactCompletedRun({
    runDir: failedRun,
    summary: { status: 'failed' },
  });
  if (skipped.status === 'skipped' && existsSync(join(failedRun, '01-review.log')) &&
      !existsSync(join(failedRun, 'summary.json'))) {
    pass('failed and interrupted-style runs remain uncompacted');
  } else {
    fail(`non-completed run was compacted: ${JSON.stringify(skipped)}`);
  }

  const cliOld = join(workflowRoot, '2000-01-01T00-00-00-000Z');
  const cliRecent = join(workflowRoot, '2999-01-01T00-00-00-000Z');
  mkdirSync(cliOld, { recursive: true });
  mkdirSync(cliRecent, { recursive: true });
  writeFileSync(join(cliOld, 'artifact.log'), 'old\n');
  writeFileSync(join(cliRecent, 'artifact.log'), 'recent\n');
  const cliResult = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'cleanup-runs.mjs'), '--user', 'test', '--json',
  ], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '', CAREER_OPS_USERS_DIR: join(tmp, 'users') },
    encoding: 'utf-8',
  }));
  if (cliResult.status === 'completed' && cliResult.deleted.some(item => item.run_id === '2000-01-01T00-00-00-000Z') &&
      !existsSync(cliOld) && existsSync(cliRecent)) {
    pass('cleanup:runs CLI applies the same user-scoped retention policy');
  } else {
    fail(`cleanup:runs CLI contract wrong: ${JSON.stringify(cliResult)}`);
  }

  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  if (packageJson.scripts?.['cleanup:runs'] === 'node cleanup-runs.mjs') {
    pass('package.json exposes npm run cleanup:runs');
  } else {
    fail('package.json does not expose cleanup:runs correctly');
  }
} catch (error) {
  fail(`run cleanup tests crashed: ${error.stack || error.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
