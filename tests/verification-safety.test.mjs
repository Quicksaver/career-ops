import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { acquirePipelineLock } from '../pipeline-lock.mjs';
import { acquireOwnership, releaseOwnership, inspectOwnership } from '../batch/runner-ownership.mjs';
import { processAlive } from '../lib/run-artifacts.mjs';
import { assertTrackerPatchScope, reconcileDuplicateConsistency } from '../lib/verification-review.mjs';

const systemRoot = resolve(import.meta.dirname, '..');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-verification-safety-'));
  const root = join(dir, 'selected');
  const tracker = join(dir, 'custom-tracker.md');
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_')));
  Object.assign(env, { CAREER_OPS_USER: 'fictional', CAREER_OPS_DATA_DIR: root, CAREER_OPS_TRACKER: tracker });
  writeFileSync(tracker, [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-01-01 | Fictional | Engineer | **3.0/5** | Evaluated | — | — | untouched |', '',
  ].join('\n'));
  const verification = { user: 'fictional', root, tracker, errors: [], warnings: [{
    level: 'warning', id: 'bold-score:1', code: 'bold_score', message: 'Bold score',
    details: { tracker_num: 1, score: '**3.0/5**' },
  }] };
  const review = { status: 'completed', needs_human_review: false, findings: [{
    finding_level: 'warning', finding_id: 'bold-score:1', finding_code: 'bold_score',
    classification: 'actionable', disposition: 'patch_tracker', severity: 'low',
    needs_human_review: false, rationale: 'Remove formatting only.', evidence: [],
    duplicate_resolution: null, orphan_resolution: null,
    tracker_patch: { tracker_num: 1, score: '3.0/5', status: null, company: null, report: null, via: null },
  }] };
  function apply() {
    writeFileSync(join(dir, 'verification.json'), JSON.stringify(verification));
    writeFileSync(join(dir, 'review.json'), JSON.stringify(review));
    return spawnSync(process.execPath, [join(systemRoot, 'apply-verification-review.mjs'),
      '--user', 'fictional', '--verification', join(dir, 'verification.json'),
      '--review', join(dir, 'review.json'), '--run-id', 'safety', '--json'],
    { env, cwd: systemRoot, encoding: 'utf8', timeout: 15000 });
  }
  return { dir, root, tracker, env, verification, review, apply, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('repair uses the selected tracker override and only removes score formatting', () => {
  const f = fixture();
  try {
    const result = f.apply();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).tracker_rows_patched, 1);
    assert.match(readFileSync(f.tracker, 'utf8'), /\| 3\.0\/5 \| Evaluated \|/);
    assert.equal(existsSync(join(f.root, 'data/applications.md')), false);
  } finally { f.cleanup(); }
});

test('repair rejects an unrelated field and wrong-user saved verification without changing the tracker', () => {
  const f = fixture();
  try {
    const original = readFileSync(f.tracker, 'utf8');
    f.review.findings[0].tracker_patch.status = 'Hired';
    assert.notEqual(f.apply().status, 0);
    assert.equal(readFileSync(f.tracker, 'utf8'), original);
    f.review.findings[0].tracker_patch.status = null;
    f.verification.user = 'another';
    assert.notEqual(f.apply().status, 0);
    assert.equal(readFileSync(f.tracker, 'utf8'), original);
  } finally { f.cleanup(); }
});

test('repair refuses a stale score value under the lock instead of replacing the current score', () => {
  const f = fixture();
  try {
    const changed = readFileSync(f.tracker, 'utf8').replace('**3.0/5**', '**4.0/5**');
    writeFileSync(f.tracker, changed);
    assert.notEqual(f.apply().status, 0);
    assert.equal(readFileSync(f.tracker, 'utf8'), changed);
  } finally { f.cleanup(); }
});

test('reviewed verification refuses active batch ownership and preserves the owner', async () => {
  const f = fixture();
  const pidFile = join(f.root, 'batch/batch-runner.pid');
  mkdirSync(join(f.root, 'batch'), { recursive: true });
  const token = await acquireOwnership(pidFile, process.pid, process.pid);
  try {
    const result = spawnSync(process.execPath, [join(systemRoot, 'verify-runner.mjs'), '--user', 'fictional', '--json', '--quiet'],
      { env: f.env, cwd: systemRoot, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'failed');
    assert.match(JSON.parse(result.stdout).error, /lock timeout/);
    assert.equal(inspectOwnership(pidFile).token, token);
    assert.equal(existsSync(join(f.root, 'data/verify-runner.pid')), false);
  } finally { releaseOwnership(pidFile, token); f.cleanup(); }
});

test('shared ownership mutex refuses a batch start while verification owns it', async () => {
  const f = fixture();
  const pidFile = join(f.root, 'batch/batch-runner.pid');
  const lock = await acquirePipelineLock(`${pidFile}.owner`, { staleMs: Infinity });
  try {
    await assert.rejects(acquireOwnership(pidFile, process.pid, process.pid), /lock timeout/);
    assert.equal(existsSync(pidFile), false);
    assert.equal(inspectOwnership(pidFile).pid, process.pid);
  } finally { lock.release(); f.cleanup(); }
});

test('manual or contradictory duplicate subsets hold the whole overlapping component', () => {
  const broad = { level: 'warning', id: 'broad', code: 'possible_duplicate_tracker', details: { tracker_nums: [1, 2, 3] } };
  const subset = { level: 'warning', id: 'subset', code: 'possible_duplicate_tracker', details: { tracker_nums: [2, 3] } };
  for (const classification of ['needs_human_review', 'false_positive', 'legitimate_exception']) {
    const decision = (finding, extra) => ({ finding_level: finding.level, finding_id: finding.id, finding_code: finding.code, rationale: 'Identity evidence.', severity: 'medium', ...extra });
    const hold = decision(subset, { classification, disposition: classification === 'needs_human_review' ? 'manual_review' : 'mark_seen', needs_human_review: classification === 'needs_human_review', duplicate_resolution: null });
    const result = reconcileDuplicateConsistency({ errors: [], warnings: [broad, subset] }, {
      status: 'completed', findings: [decision(broad, { classification: 'confirmed_duplicate', disposition: 'resolve_duplicate', duplicate_resolution: { keeper_tracker_num: 1, duplicate_tracker_nums: [2, 3] } }), hold],
    });
    assert.equal(result.review.findings[0].disposition, 'manual_review');
    assert.equal(result.review.findings[1].classification, classification);
    assert.equal(result.review.findings[1].disposition, hold.disposition);
  }
});

test('field scope follows the finding code and process liveness treats EPERM as alive', () => {
  assert.throws(() => assertTrackerPatchScope({ code: 'bold_score', details: { tracker_num: 1 } }, { tracker_num: 1, score: '3.0/5', company: 'Other' }), /company/);
  const original = process.kill;
  try {
    process.kill = () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); };
    assert.equal(processAlive(123), true);
    process.kill = () => { throw Object.assign(new Error('absent'), { code: 'ESRCH' }); };
    assert.equal(processAlive(123), false);
  } finally { process.kill = original; }
});

test('restoration accepts a reordered canonical TSV header and preserves Closed', () => {
  const f = fixture();
  try {
    const name = '007-restorable-2026-01-02.md';
    writeFileSync(join(f.root, 'reports', name), '# Evaluation: Restorable — Backend Engineer\n\n## Machine Summary\n```yaml\ncompany: Restorable\nrole: Backend Engineer\nscore: 3.8\nstatus: Closed\n```\n');
    mkdirSync(join(f.root, 'batch/tracker-additions/merged'), { recursive: true });
    writeFileSync(join(f.root, 'batch/tracker-additions/merged/7.tsv'), [
      'company\trole\tnum\tdate\tstatus\tscore\treport\tpdf\tnotes',
      `Restorable\tBackend Engineer\t7\t2026-01-02\tClosed\t3.8/5\t[7](reports/${name})\t—\theader fixture`, '',
    ].join('\n'));
    f.verification.warnings = [{ id: 'orphan:7', code: 'orphan_report', details: { report_num: 7, file: `reports/${name}` } }];
    f.review.findings = [{ ...f.review.findings[0], finding_id: 'orphan:7', finding_code: 'orphan_report',
      classification: 'confirmed_orphan', disposition: 'restore_orphan', tracker_patch: null,
      orphan_resolution: { report_file: `reports/${name}`, tracker_tsv: 'batch/tracker-additions/merged/7.tsv' } }];
    const result = f.apply();
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(f.tracker, 'utf8'), /\| 7 \| 2026-01-02 \| Restorable \| Backend Engineer \| 3\.8\/5 \| Closed \|/);
    assert.equal(readdirReservations(f.root).length, 0);
  } finally { f.cleanup(); }
});

test('orphan collision allocation preserves another reservation and canonical restored state', () => {
  const f = fixture();
  try {
    const name = '001-distinct-2026-01-02.md';
    writeFileSync(join(f.root, 'reports', name), '# Evaluation: Distinct — Backend Engineer\n\n**Date:** 2026-01-02\n**Status:** Assessment\n\n## Machine Summary\n```yaml\ncompany: Distinct\nrole: Backend Engineer\nscore: 3.8\n```\n');
    const sentinel = join(f.root, 'reports/002-RESERVED.md');
    writeFileSync(sentinel, 'other worker reservation');
    f.verification.warnings = [{ id: 'orphan:1', code: 'orphan_report', details: { report_num: 1, file: `reports/${name}` } }];
    f.review.findings = [{ ...f.review.findings[0], finding_id: 'orphan:1', finding_code: 'orphan_report',
      classification: 'confirmed_orphan', disposition: 'restore_orphan', tracker_patch: null,
      orphan_resolution: { report_file: `reports/${name}`, tracker_tsv: null } }];
    const result = f.apply();
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(f.tracker, 'utf8'), /\| 3 \| 2026-01-02 \| Distinct \| Backend Engineer \| 3\.8\/5 \| Assessment \|/);
    assert.equal(readFileSync(sentinel, 'utf8'), 'other worker reservation');
    assert.equal(existsSync(join(f.root, 'reports/003-RESERVED.md')), false);
  } finally { f.cleanup(); }
});

function readdirReservations(root) {
  return readdirSync(join(root, 'reports')).filter(name => name.endsWith('-RESERVED.md'));
}

test('individual portal findings have distinct stable typed identities', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'portals.yml'), 'tracked_companies:\n  - name: First Fictional\n    careers_url: https://first.invalid/careers\n    enabled: true\n  - name: Second Fictional\n    careers_url: https://second.invalid/careers\n    enabled: true\n');
    const verify = () => {
      const result = spawnSync(process.execPath, [join(systemRoot, 'verify-pipeline.mjs'), '--user', 'fictional', '--json'], { env: f.env, cwd: systemRoot, encoding: 'utf8' });
      assert.ok([0, 1].includes(result.status), result.stderr);
      return JSON.parse(result.stdout).warnings.filter(item => item.code === 'portal_unclaimed');
    };
    const first = verify();
    assert.equal(first.length, 2);
    assert.equal(new Set(first.map(item => item.id)).size, 2);
    assert.deepEqual(verify().map(item => item.id), first.map(item => item.id));
  } finally { f.cleanup(); }
});

test('verifier and cleanup usage errors are concise and reject empty parallelism', () => {
  const f = fixture();
  try {
    for (const [file, args] of [['verify-runner.mjs', ['--parallel=']], ['verify-runner.mjs', ['--max-passes', '2abc']], ['cleanup-runs.mjs', ['--unknown']]]) {
      const result = spawnSync(process.execPath, [join(systemRoot, file), '--user', 'fictional', ...args], { env: f.env, cwd: systemRoot, encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stderr, /\bat .*\.mjs:\d/);
    }
  } finally { f.cleanup(); }
});
