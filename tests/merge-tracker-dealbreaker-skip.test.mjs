import { userFixtureEnv } from './user-fixture.mjs';
// tests/merge-tracker-dealbreaker-skip.test.mjs — a batch dealbreaker skip has
// no report by design (batch-prompt.md "Dealbreaker gate"), so the reserved-
// number guard proves it by the row number alone. A completed job still needs
// the report link, and a skip numbered off its reservation is still withheld.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { pass, fail, rmSync, NODE, ROOT } from './helpers.mjs';

console.log('\nmerge-tracker.mjs — a batch dealbreaker SKIP row merges without a report');

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

const D = '2026-10-20';
const URL = 'https://example.com/jobs/1';
const addition = (num, status, report) => [
  'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl',
  [num, D, 'Fabrikam', 'Product Designer', status, 'N/A', '❌', report, 'Dealbreaker: "No on-site roles" vs "On site five days a week."', URL].join('\t'),
  '',
].join('\n');

const STATE_HEADER = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries';

/** Merge job #1's addition against its batch-state row and report what happened. */
function merge(tsv, jobStatus) {
  const work = mkdtempSync(join(tmpdir(), 'cops-dealbreaker-'));
  try {
    const tracker = join(work, 'applications.md');
    const adds = join(work, 'adds');
    const state = join(work, 'batch-state.tsv');
    mkdirSync(adds, { recursive: true });
    writeFileSync(tracker, TRACKER);
    writeFileSync(join(adds, '1.tsv'), tsv);
    writeFileSync(state, [STATE_HEADER, ['1', URL, jobStatus, '-', '-', '042', '-', 'dealbreaker: x', '0'].join('\t'), ''].join('\n'));
    const r = spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      env: userFixtureEnv({ ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: adds, CAREER_OPS_BATCH_STATE: state }, false),
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const merged = readFileSync(tracker, 'utf-8').split('\n').some((l) => /^\|\s*42\s*\|.*SKIP/.test(l));
    return { merged, out };
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

const GUARD = /identity disagrees with its reserved report number/;

const skipped = merge(addition('042', 'SKIP', '-'), 'skipped');
if (skipped.merged) pass('a skipped job\'s report-less SKIP row merges under its reserved number');
else fail(`dealbreaker SKIP row was not merged: ${skipped.out.trim().split('\n').slice(-3).join(' | ')}`);

const offNumber = merge(addition('041', 'SKIP', '-'), 'skipped');
if (!offNumber.merged && GUARD.test(offNumber.out)) pass('a SKIP row numbered off its reservation is still withheld');
else fail(`off-number SKIP row: merged=${offNumber.merged}`);

const completed = merge(addition('042', 'SKIP', '-'), 'completed');
if (!completed.merged && GUARD.test(completed.out)) pass('a completed job still needs its report link');
else fail(`completed job without a report: merged=${completed.merged}`);
