import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { pathToFileURL } from 'url';
import { fail, getBash, pass, ROOT, toBashPath } from '../helpers.mjs';

console.log('\nWorkflow — deterministic go runner');

try {
  const queue = await import(pathToFileURL(join(ROOT, 'lib/pipeline-queue.mjs')).href);
  const codexConfig = await import(pathToFileURL(join(ROOT, 'lib/codex-config.mjs')).href);
  const parallelConfig = await import(pathToFileURL(join(ROOT, 'lib/parallel-config.mjs')).href);
  const fixture = [
    '# Pipeline', '', '## Pending',
    '- [ ] https://example.com/a | Acme | AI Engineer',
    '- [ ] local:jds/example.md | LocalCo | Product Engineer',
    '', '## Processed', '- [x] old', '',
  ].join('\n');
  const parsed = queue.parsePendingRows(fixture);
  if (parsed.rows.length === 2 && parsed.rows[0].url === 'https://example.com/a' && parsed.rows[1].fields[0] === 'LocalCo') {
    pass('pipeline queue parser handles URL and local JD rows');
  } else {
    fail(`pipeline queue parser returned ${JSON.stringify(parsed.rows)}`);
  }

  const expired = queue.appendExpiredRows(fixture, new Set(['https://example.com/a']));
  if (expired.moved.length === 1 && !expired.text.includes('- [ ] https://example.com/a') && expired.text.includes('posting expired (liveness sweep)')) {
    pass('liveness rewrite moves only confirmed expired rows to Processed');
  } else {
    fail(`expired pipeline rewrite was wrong: ${JSON.stringify(expired)}`);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-go-test-'));
  const usersDir = join(tmp, 'users');
  const userRoot = join(usersDir, 'test');
  mkdirSync(join(userRoot, 'data'), { recursive: true });
  mkdirSync(join(userRoot, 'batch'), { recursive: true });
  writeFileSync(join(userRoot, 'data/pipeline.md'), fixture);
  writeFileSync(join(userRoot, 'batch/batch-input.tsv'), [
    'id\turl\tsource\tnotes',
    '7\thttps://existing.example/job\tpipeline\tExisting | Role',
  ].join('\n') + '\n');
  writeFileSync(join(userRoot, 'batch/batch-state.tsv'), [
    'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
    '20\thttps://historical.example/job\tcompleted\t-\t-\t001\t4.0\t-\t0',
  ].join('\n') + '\n');
  const syncOut = execFileSync(process.execPath, [
    join(ROOT, 'sync-pipeline-batch.mjs'), '--user', 'test', '--json',
  ], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_USERS_DIR: usersDir },
    encoding: 'utf-8',
  });
  const sync = JSON.parse(syncOut);
  const input = readFileSync(join(userRoot, 'batch/batch-input.tsv'), 'utf-8');
  if (sync.added === 2 && input.includes('21\thttps://example.com/a\tpipeline\tAcme | AI Engineer') && input.includes('22\tlocal:jds/example.md')) {
    pass('pipeline-to-batch sync appends collision-free stable IDs and preserves local rows');
  } else {
    fail(`pipeline-to-batch sync wrong: result=${syncOut} input=${input}`);
  }
  const second = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'sync-pipeline-batch.mjs'), '--user', 'test', '--json',
  ], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_USERS_DIR: usersDir },
    encoding: 'utf-8',
  }));
  if (second.added === 0) pass('pipeline-to-batch sync is idempotent by URL');
  else fail(`second pipeline-to-batch sync added ${second.added} rows`);
  rmSync(tmp, { recursive: true, force: true });

  const warningTmp = mkdtempSync(join(tmpdir(), 'career-ops-warning-triage-'));
  const warningUsers = join(warningTmp, 'users');
  const warningRoot = join(warningUsers, 'test');
  mkdirSync(join(warningRoot, 'data'), { recursive: true });
  mkdirSync(join(warningRoot, 'reports'), { recursive: true });
  mkdirSync(join(warningRoot, 'output'), { recursive: true });
  mkdirSync(join(warningRoot, 'batch/tracker-additions'), { recursive: true });
  writeFileSync(join(warningRoot, 'data/applications.md'), [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | — | [1](../reports/001-acme-2026-01-01.md) | first |',
    '| 2 | 2026-01-02 | Acme | Engineer | 3.5/5 | Applied | — | [2](../reports/002-acme-2026-01-02.md) | second |',
  ].join('\n') + '\n');
  const reportBody = role => [
    `# Evaluation: Acme — ${role}`, '', '## Machine Summary', '```yaml', `role: ${role}`, '```', '',
  ].join('\n');
  writeFileSync(join(warningRoot, 'reports/001-acme-2026-01-01.md'), reportBody('Engineer'));
  writeFileSync(join(warningRoot, 'reports/002-acme-2026-01-02.md'), reportBody('Engineer'));
  writeFileSync(join(warningRoot, 'output/002-acme-2026-01-02.html'), '<html></html>\n');
  writeFileSync(join(warningRoot, 'output/002-acme-2026-01-02.pdf'), 'fixture pdf\n');

  const verification = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'verify-pipeline.mjs'), '--user', 'test', '--json',
  ], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_USERS_DIR: warningUsers },
    encoding: 'utf-8',
  }));
  const warningCodes = new Set(verification.warnings.map(item => item.code));
  if (verification.schema_version === 1 && warningCodes.has('possible_duplicate_tracker') &&
      warningCodes.has('duplicate_reports_same_role') && verification.counts.errors === 0) {
    pass('verify-pipeline JSON exposes stable warning identities and duplicate evidence');
  } else {
    fail(`structured verification warnings wrong: ${JSON.stringify(verification)}`);
  }

  const trackerWarning = verification.warnings.find(item => item.code === 'possible_duplicate_tracker');
  const reportWarning = verification.warnings.find(item => item.code === 'duplicate_reports_same_role');
  const triage = {
    status: 'completed',
    needs_human_review: false,
    warnings: verification.warnings.map(warning => {
      if (warning.id === trackerWarning.id) {
        return {
          warning_id: warning.id,
          warning_code: warning.code,
          classification: 'confirmed_duplicate',
          severity: 'low',
          needs_human_review: false,
          rationale: 'Fixture rows represent the same posting.',
          evidence: [{ path: 'data/applications.md', observation: 'Same company and exact role in fixture.' }],
          duplicate_resolution: {
            keeper_tracker_num: 1,
            duplicate_tracker_nums: [2],
            keeper_report_file: null,
            duplicate_report_files: [],
          },
        };
      }
      if (warning.id === reportWarning.id) {
        return {
          warning_id: warning.id,
          warning_code: warning.code,
          classification: 'confirmed_duplicate',
          severity: 'low',
          needs_human_review: false,
          rationale: 'Fixture reports represent the same posting.',
          evidence: [{ path: 'reports/001-acme-2026-01-01.md', observation: 'Same fixture report identity.' }],
          duplicate_resolution: {
            keeper_tracker_num: null,
            duplicate_tracker_nums: [],
            keeper_report_file: 'reports/001-acme-2026-01-01.md',
            duplicate_report_files: ['reports/002-acme-2026-01-02.md'],
          },
        };
      }
      return {
        warning_id: warning.id,
        warning_code: warning.code,
        classification: 'informational',
        severity: 'low',
        needs_human_review: false,
        rationale: 'Fixture informational warning.',
        evidence: [],
        duplicate_resolution: null,
      };
    }),
  };
  const verificationPath = join(warningTmp, 'verification.json');
  const triagePath = join(warningTmp, 'triage.json');
  writeFileSync(verificationPath, JSON.stringify(verification));
  writeFileSync(triagePath, JSON.stringify(triage));
  const conflictingTriage = JSON.parse(JSON.stringify(triage));
  const conflictingReport = conflictingTriage.warnings.find(item => item.warning_code === 'duplicate_reports_same_role');
  conflictingReport.duplicate_resolution.keeper_report_file = 'reports/002-acme-2026-01-02.md';
  conflictingReport.duplicate_resolution.duplicate_report_files = ['reports/001-acme-2026-01-01.md'];
  const conflictingTriagePath = join(warningTmp, 'triage-conflicting-keeper.json');
  writeFileSync(conflictingTriagePath, JSON.stringify(conflictingTriage));
  let conflictingKeeperRejected = false;
  try {
    execFileSync(process.execPath, [
      join(ROOT, 'resolve-verify-warnings.mjs'), '--user', 'test',
      '--verification', verificationPath, '--triage', conflictingTriagePath, '--json',
    ], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_USERS_DIR: warningUsers },
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch (error) {
    conflictingKeeperRejected = String(error.stderr || '').includes('report keeper must match');
  }
  if (conflictingKeeperRejected) pass('report keeper cannot contradict the model-selected tracker keeper');
  else fail('duplicate resolver accepted conflicting tracker/report keepers');
  const repair = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'resolve-verify-warnings.mjs'), '--user', 'test',
    '--verification', verificationPath, '--triage', triagePath, '--json',
  ], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_USERS_DIR: warningUsers },
    encoding: 'utf-8',
  }));
  const repairedTracker = readFileSync(join(warningRoot, 'data/applications.md'), 'utf-8');
  const reportArchiveDirs = readdirSync(join(warningRoot, 'reports/duplicates'));
  const archivedReport = join(warningRoot, 'reports/duplicates', reportArchiveDirs[0], '002-acme-2026-01-02.md');
  const repairedVerification = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'verify-pipeline.mjs'), '--user', 'test', '--json',
  ], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_USERS_DIR: warningUsers },
    encoding: 'utf-8',
  }));
  if (repair.tracker_rows_removed === 1 && repair.reports_archived === 1 &&
      !repairedTracker.includes('| 2 |') && repairedTracker.includes('| Applied |') &&
      existsSync(archivedReport) && readFileSync(archivedReport, 'utf-8').includes('duplicate_of: reports/001-acme') &&
      repairedVerification.counts.errors === 0 && repairedVerification.warnings.length === 0) {
    pass('confirmed duplicates are deterministically merged, archived, logged, and reverified');
  } else {
    fail(`duplicate resolution wrong: repair=${JSON.stringify(repair)} verify=${JSON.stringify(repairedVerification)}`);
  }

  const forbiddenVerificationPath = join(warningTmp, 'forbidden-verification.json');
  const forbiddenTriagePath = join(warningTmp, 'forbidden-triage.json');
  writeFileSync(forbiddenVerificationPath, JSON.stringify({
    warnings: [{ id: 'orphan-report:999.md', code: 'orphan_report', details: { file: 'reports/999.md' } }],
  }));
  writeFileSync(forbiddenTriagePath, JSON.stringify({
    warnings: [{
      warning_id: 'orphan-report:999.md',
      warning_code: 'orphan_report',
      classification: 'confirmed_duplicate',
      duplicate_resolution: {
        keeper_tracker_num: null,
        duplicate_tracker_nums: [],
        keeper_report_file: 'reports/001-acme-2026-01-01.md',
        duplicate_report_files: ['reports/999.md'],
      },
    }],
  }));
  let forbiddenRejected = false;
  try {
    execFileSync(process.execPath, [
      join(ROOT, 'resolve-verify-warnings.mjs'), '--user', 'test',
      '--verification', forbiddenVerificationPath, '--triage', forbiddenTriagePath, '--json',
    ], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_USERS_DIR: warningUsers },
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch (error) {
    forbiddenRejected = String(error.stderr || '').includes('never auto-remediable');
  }
  if (forbiddenRejected) pass('non-duplication warnings cannot trigger automatic repair');
  else fail('orphan warning was not rejected by the duplicate-only resolver');
  rmSync(warningTmp, { recursive: true, force: true });

  const configTmp = mkdtempSync(join(tmpdir(), 'career-ops-codex-config-'));
  const profilePath = join(configTmp, 'profile.yml');
  writeFileSync(profilePath, [
    'codex:',
    '  model: profile-model',
    '  reasoning_effort: high',
    'batch:',
    '  parallel: 4',
  ].join('\n') + '\n');
  const fromProfile = codexConfig.resolveCodexSettings({ profilePath });
  const mixed = codexConfig.resolveCodexSettings({
    profilePath,
    modelOverride: 'argument-model',
  });
  if (fromProfile.model === 'profile-model' && fromProfile.reasoningEffort === 'high' &&
      fromProfile.modelSource === 'profile' && fromProfile.reasoningEffortSource === 'profile') {
    pass('Codex settings fall back to profile.yml before global defaults');
  } else {
    fail(`profile Codex resolution wrong: ${JSON.stringify(fromProfile)}`);
  }
  if (mixed.model === 'argument-model' && mixed.reasoningEffort === 'high' &&
      mixed.modelSource === 'argument' && mixed.reasoningEffortSource === 'profile') {
    pass('Codex model and reasoning hierarchy resolves independently');
  } else {
    fail(`mixed Codex resolution wrong: ${JSON.stringify(mixed)}`);
  }
  const global = codexConfig.resolveCodexSettings({ profilePath: join(configTmp, 'missing.yml') });
  if (global.model === null && global.reasoningEffort === null &&
      global.modelSource === 'global' && global.reasoningEffortSource === 'global') {
    pass('absent Codex arguments and profile values preserve global CLI fallback');
  } else {
    fail(`global Codex fallback wrong: ${JSON.stringify(global)}`);
  }
  const profileParallel = parallelConfig.resolveParallel({ profilePath });
  const argumentParallel = parallelConfig.resolveParallel({ profilePath, override: '2' });
  const defaultParallel = parallelConfig.resolveParallel({
    profilePath: join(configTmp, 'missing.yml'),
  });
  if (profileParallel.parallel === 4 && profileParallel.source === 'profile') {
    pass('parallelism falls back to profile.yml batch.parallel');
  } else {
    fail(`profile parallel resolution wrong: ${JSON.stringify(profileParallel)}`);
  }
  if (argumentParallel.parallel === 2 && argumentParallel.source === 'argument') {
    pass('--parallel overrides profile.yml batch.parallel');
  } else {
    fail(`argument parallel resolution wrong: ${JSON.stringify(argumentParallel)}`);
  }
  if (defaultParallel.parallel === 1 && defaultParallel.source === 'default') {
    pass('parallelism defaults to one when argument and profile are absent');
  } else {
    fail(`default parallel resolution wrong: ${JSON.stringify(defaultParallel)}`);
  }
  writeFileSync(profilePath, 'batch:\n  parallel: 33\n');
  let invalidParallelRejected = false;
  try {
    parallelConfig.resolveParallel({ profilePath });
  } catch (error) {
    invalidParallelRejected = error.message.includes('batch.parallel must be an integer from 1 to 32');
  }
  if (invalidParallelRejected) pass('invalid profile batch.parallel values are rejected');
  else fail('invalid profile batch.parallel was not rejected');
  rmSync(configTmp, { recursive: true, force: true });

  const batchTmp = mkdtempSync(join(tmpdir(), 'career-ops-codex-batch-'));
  const batchDir = join(batchTmp, 'batch');
  const batchUserRoot = join(batchTmp, 'users', 'test');
  const fakeBin = join(batchTmp, 'bin');
  mkdirSync(batchDir, { recursive: true });
  mkdirSync(join(batchUserRoot, 'batch'), { recursive: true });
  mkdirSync(join(batchUserRoot, 'reports'), { recursive: true });
  mkdirSync(join(batchUserRoot, 'data'), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(batchDir, 'batch-runner.sh'), readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8'));
  writeFileSync(join(batchDir, 'batch-prompt.md'), 'URL={{URL}}\nUSER={{USER}}\n');
  writeFileSync(join(batchDir, 'batch-output-schema.json'), '{}\n');
  writeFileSync(join(batchUserRoot, 'batch/batch-input.tsv'), [
    'id\turl\tsource\tnotes',
    '1\thttps://example.com/job\tfixture\t-',
  ].join('\n') + '\n');
  for (const script of ['merge-tracker.mjs', 'reconcile-pipeline.mjs', 'verify-pipeline.mjs']) {
    writeFileSync(join(batchTmp, script), 'process.exit(0);\n');
  }
  writeFileSync(join(batchTmp, 'resolve-parallel.mjs'), 'console.log("1\\tdefault");\n');
  writeFileSync(join(batchTmp, 'reserve-report-num.mjs'), [
    'if (!process.argv.includes("--release")) console.log("001");',
  ].join('\n') + '\n');
  const argvPath = join(batchTmp, 'codex-argv.txt');
  writeFileSync(join(fakeBin, 'codex'), [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$@" > "$CODEX_ARGV_FILE"',
    'cat >/dev/null',
    'exit 1',
  ].join('\n') + '\n');
  if (process.platform === 'win32') {
    execFileSync(getBash(), [
      '-c',
      `chmod +x '${toBashPath(join(batchDir, 'batch-runner.sh'))}' '${toBashPath(join(fakeBin, 'codex'))}'`,
    ]);
  } else {
    execFileSync('chmod', ['+x', join(batchDir, 'batch-runner.sh'), join(fakeBin, 'codex')]);
  }
  try {
    execFileSync(getBash(), [
      toBashPath(join(batchDir, 'batch-runner.sh')), '--user', 'test', '--cli', 'codex',
      '--model', 'profile-model', '--reasoning-effort', 'high', '--max-retries', '0',
    ], {
      cwd: batchTmp,
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        CAREER_OPS_USERS_DIR: join(batchTmp, 'users'),
        CODEX_ARGV_FILE: argvPath,
      },
      encoding: 'utf-8',
    });
  } catch {
    // A deliberately failing fake worker may make the fixture runner non-zero;
    // argv capture is the contract under test.
  }
  const codexArgv = readFileSync(argvPath, 'utf-8');
  if (codexArgv.includes('--model\nprofile-model\n') &&
      codexArgv.includes('-c\nmodel_reasoning_effort="high"\n')) {
    pass('batch execution passes resolved model and reasoning to codex exec');
  } else {
    fail(`batch Codex argv missing resolved settings: ${JSON.stringify(codexArgv)}`);
  }
  rmSync(batchTmp, { recursive: true, force: true });

  const runner = readFileSync(join(ROOT, 'go-runner.mjs'), 'utf-8');
  const verifyRunner = readFileSync(join(ROOT, 'verify-runner.mjs'), 'utf-8');
  const batchRunner = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8');
  const schema = JSON.parse(readFileSync(join(ROOT, 'schemas/go-handoff-output.schema.json'), 'utf-8'));
  const reviewSchema = JSON.parse(readFileSync(join(ROOT, 'schemas/verify-review-output.schema.json'), 'utf-8'));
  if (runner.includes('--output-schema') && runner.includes('--output-last-message') && schema.additionalProperties === false) {
    pass('handoff agent uses a strict schema-constrained final response');
  } else {
    fail('handoff agent JSON contract is not strict or not wired into go-runner');
  }
  if (runner.includes("systemPath('verify-runner.mjs')") && runner.includes('verification_review') &&
      verifyRunner.includes('review-agent-') && verifyRunner.includes('resolve-verify-warnings.mjs') &&
      verifyRunner.includes('apply-verification-review.mjs') && verifyRunner.includes('verify-pipeline-post-duplicates-') &&
      verifyRunner.includes('verify-pipeline-post-review-') && verifyRunner.includes('decisionsStillPresent') &&
      verifyRunner.includes('prior_decisions: decisions') && verifyRunner.includes('validateDuplicateConsistency') &&
      reviewSchema.additionalProperties === false) {
    pass('go runner delegates final integrity handling to schema-constrained reviewed verification');
  } else {
    fail('go runner reviewed-verification final step is not fully wired');
  }
  if (runner.includes('--codex-model') && runner.includes('--codex-reasoning-effort') &&
      runner.includes("batchArgs.push('--model'") && runner.includes("batchArgs.push('--reasoning-effort'") &&
      runner.includes("verifyArgs.push('--codex-model'") && runner.includes("verifyArgs.push('--codex-reasoning-effort'")) {
    pass('go runner forwards resolved Codex model and reasoning to handoff, reviewed verification, and batch calls');
  } else {
    fail('go runner does not forward both Codex settings to every Codex call');
  }
  if (batchRunner.includes('model_reasoning_effort=') && batchRunner.includes('--reasoning-effort')) {
    pass('batch runner passes reasoning effort to each Codex worker');
  } else {
    fail('batch runner does not pass reasoning effort to Codex workers');
  }
  if (batchRunner.includes('validate-worker-artifacts.mjs') && batchRunner.includes('--repair') &&
      batchRunner.includes('artifact-validation:')) {
    pass('batch runner validates and normalizes report/TSV artifacts before completed state');
  } else {
    fail('batch runner can mark inconsistent report/TSV artifacts completed');
  }
  if (runner.includes('resolveParallel') && runner.includes('parallel_source') &&
      batchRunner.includes('resolve-parallel.mjs')) {
    pass('go and direct batch runners share argument/profile/default parallel resolution');
  } else {
    fail('parallel profile fallback is not wired into both runners');
  }
  if (runner.includes('createProgressForwarder') && runner.includes('progress: scanProgressLine') &&
      runner.includes('progress: scanAuthProgressLine') && runner.includes('progress: handoffProgressLine') &&
      runner.includes('progress: true') &&
      runner.includes('--quiet')) {
    pass('go runner streams bounded live progress to stderr with a quiet opt-out');
  } else {
    fail('go runner live progress forwarding is not fully wired');
  }
  if (runner.includes("child.once('close'") && runner.includes('stream.end(resolve)') &&
      verifyRunner.includes("child.once('close'") && verifyRunner.includes('stream.end(resolveStream)') &&
      batchRunner.includes('--defer-verification')) {
    pass('go and verify runners drain phase logs before consuming structured results');
  } else {
    fail('go runner can still truncate or obscure structured verifier failures');
  }
  if (process.platform === 'win32' || (statSync(join(ROOT, 'go-runner.mjs')).mode & 0o111)) {
    pass('go-runner.mjs is executable');
  } else {
    fail('go-runner.mjs is not executable');
  }
} catch (error) {
  fail(`deterministic go runner tests crashed: ${error.message}`);
}
