import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
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
  const goRoot = join(userRoot, 'data', 'go-runs');
  mkdirSync(verifyRoot, { recursive: true });
  mkdirSync(goRoot, { recursive: true });

  const oldVerify = join(verifyRoot, '2026-07-04T11-59-59-999Z');
  const oldGo = join(goRoot, '2026-07-01T12-00-00-000Z');
  const boundary = join(verifyRoot, '2026-07-04T12-00-00-000Z');
  const recent = join(goRoot, '2026-07-14T11-00-00-000Z');
  const unknown = join(verifyRoot, 'manual-backup');
  for (const dir of [oldVerify, oldGo, boundary, recent, unknown]) {
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

  const cleanup = artifacts.cleanupExpiredRuns({
    userRoot,
    now: Date.parse('2026-07-14T12:00:00.000Z'),
  });
  if (cleanup.status === 'completed' && cleanup.deleted_runs === 2 &&
      !existsSync(oldVerify) && !existsSync(oldGo) && existsSync(boundary) &&
      existsSync(recent) && existsSync(unknown)) {
    pass('cleanup removes only timestamped verify/go runs strictly older than ten days');
  } else {
    fail(`run cleanup boundary wrong: ${JSON.stringify(cleanup)}`);
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

  const cliOld = join(goRoot, '2000-01-01T00-00-00-000Z');
  const cliRecent = join(goRoot, '2999-01-01T00-00-00-000Z');
  mkdirSync(cliOld, { recursive: true });
  mkdirSync(cliRecent, { recursive: true });
  writeFileSync(join(cliOld, 'artifact.log'), 'old\n');
  writeFileSync(join(cliRecent, 'artifact.log'), 'recent\n');
  const cliResult = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'cleanup-runs.mjs'), '--user', 'test', '--json',
  ], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_USERS_DIR: join(tmp, 'users') },
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
