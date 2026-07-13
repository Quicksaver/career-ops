import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { fail, pass, ROOT } from '../helpers.mjs';

console.log('\nWorkflow — batch artifact integrity');

const { validateWorkerArtifacts } = await import(pathToFileURL(join(ROOT, 'batch/validate-worker-artifacts.mjs')).href);
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-batch-artifacts-'));

try {
  const reportPath = join(tmp, '001-confidential-2026-01-01.md');
  const trackerPath = join(tmp, '7.tsv');
  const finalPath = join(tmp, '001-7.final.json');
  const report = via => [
    '# Evaluation: ? — Backend Engineer', '',
    '## Machine Summary', '', '```yaml',
    'company: "?"',
    'role: "Backend Engineer"',
    'score: 4.1',
    `via: ${via == null ? 'null' : JSON.stringify(via)}`,
    'company_confidential: true',
    '```', '',
  ].join('\n');
  const baseTsv = '001\t2026-01-01\t?\tBackend Engineer\tEvaluated\t4.1/5\t❌\t[001](reports/001-confidential-2026-01-01.md)\tconfidential client';

  writeFileSync(reportPath, report('Hays'));
  writeFileSync(trackerPath, `${baseTsv}\n`);
  writeFileSync(finalPath, JSON.stringify({
    status: 'completed', id: '7', report_num: '001', company: '?', role: 'Backend Engineer', score: 4.1,
    legitimacy: 'Proceed with Caution', via: 'Hays', company_confidential: true, pdf: null,
    report: reportPath, tracker: trackerPath, error: null,
  }));
  const repaired = validateWorkerArtifacts({ reportPath, trackerPath, finalPath, repair: true });
  if (repaired.valid && repaired.repaired && readFileSync(trackerPath, 'utf8').includes('\tvia=Hays')) {
    pass('artifact finalizer deterministically appends report Via to a confidential tracker TSV');
  } else {
    fail(`artifact finalizer did not repair a supported Via: ${JSON.stringify(repaired.errors)}`);
  }

  writeFileSync(trackerPath, `${baseTsv}\tvia=Other Agency\n`);
  const mismatch = validateWorkerArtifacts({ reportPath, trackerPath, finalPath, repair: true });
  if (!mismatch.valid && mismatch.errors.some(error => error.includes('disagrees with report Via'))) {
    pass('artifact validator rejects cross-artifact Via mismatches');
  } else {
    fail(`artifact validator accepted a mismatched Via: ${JSON.stringify(mismatch.errors)}`);
  }

  writeFileSync(reportPath, report(null));
  writeFileSync(trackerPath, `${baseTsv}\n`);
  const untraceable = validateWorkerArtifacts({ reportPath, trackerPath, repair: true });
  if (!untraceable.valid && untraceable.errors.some(error => error.includes('confidential employer requires'))) {
    pass('artifact validator rejects confidential employers without a supported channel');
  } else {
    fail(`artifact validator accepted an untraceable confidential employer: ${JSON.stringify(untraceable.errors)}`);
  }

  const mergeRoot = join(tmp, 'merge');
  const additions = join(mergeRoot, 'additions');
  const reports = join(mergeRoot, 'reports');
  const data = join(mergeRoot, 'data');
  mkdirSync(additions, { recursive: true });
  mkdirSync(reports, { recursive: true });
  mkdirSync(data, { recursive: true });
  const applications = join(data, 'applications.md');
  writeFileSync(applications, [
    '# Applications Tracker', '',
    '| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|-----|------|-------|--------|-----|--------|-------|',
    '',
  ].join('\n'));
  writeFileSync(join(additions, '7.tsv'), `${baseTsv}\n`);
  let mergeRejected = false;
  try {
    execFileSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_TRACKER: applications, CAREER_OPS_ADDITIONS: additions, CAREER_OPS_REPORTS: reports },
      stdio: 'pipe',
    });
  } catch (error) {
    mergeRejected = error.status === 1;
  }
  const mergedTracker = readFileSync(applications, 'utf8');
  if (mergeRejected && !mergedTracker.includes('Backend Engineer') && readFileSync(join(additions, '7.tsv'), 'utf8').includes('confidential client')) {
    pass('merge-tracker leaves company=? additions pending and exits nonzero when Via is missing');
  } else {
    fail('merge-tracker did not block a company=? addition without Via');
  }

  const flushRoot = join(tmp, 'flush');
  const flushReports = join(flushRoot, 'reports');
  const flushAdditions = join(flushRoot, 'additions');
  mkdirSync(flushReports, { recursive: true });
  mkdirSync(flushAdditions, { recursive: true });
  const flushTracker = join(flushRoot, 'applications.md');
  writeFileSync(flushTracker, [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '',
  ].join('\n'));
  for (let index = 1; index <= 700; index++) {
    const num = String(index).padStart(4, '0');
    writeFileSync(join(flushReports, `${num}-company-${num}-2026-01-01.md`), [
      `# Evaluation: Company ${num} — Role ${num}`, '',
      '## Machine Summary', '', '```yaml', `company: "Company ${num}"`, `role: "Role ${num}"`, '```', '',
    ].join('\n'));
  }
  const largeJson = execFileSync(process.execPath, [join(ROOT, 'verify-pipeline.mjs'), '--json'], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_TRACKER: flushTracker, CAREER_OPS_REPORTS: flushReports, CAREER_OPS_ADDITIONS: flushAdditions },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsedLargeJson = JSON.parse(largeJson);
  if (largeJson.length > 65536 && parsedLargeJson.counts.warnings === 700) {
    pass('verify-pipeline flushes warning-heavy JSON larger than 64 KiB');
  } else {
    fail(`large verifier JSON was incomplete: bytes=${largeJson.length} warnings=${parsedLargeJson.counts?.warnings}`);
  }
} catch (error) {
  fail(`batch artifact integrity tests crashed: ${error.stack || error.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
