import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../resolve-verify-warnings.mjs', import.meta.url));

function runFixture(mode) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-duplicate-revalidation-'));
  try {
    mkdirSync(join(root, 'data'));
    const tracker = join(root, 'data', 'applications.md');
    const original = '# Applications\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      '| 1 | 2026-01-01 | Fixture Corp | Engineer | 4.0/5 | Applied | — | — | keeper |\n' +
      '| 2 | 2026-01-01 | Fixture Corp | Engineer | 4.0/5 | Evaluated | — | — | duplicate |\n';
    writeFileSync(tracker, original);
    const finding = {
      id: 'possible-duplicate-tracker:1:2', code: 'possible_duplicate_tracker',
      details: {
        tracker_nums: [1, 2],
        entries: [1, 2].map(tracker_num => ({ tracker_num, company: 'Fixture Corp', role: 'Engineer', url: 'https://example.com/jobs/1' })),
      },
    };
    const verification = { user: 'fixture', root, tracker, warnings: [finding] };
    writeFileSync(join(root, 'verification.json'), JSON.stringify(verification));
    const fresh = structuredClone(verification);
    if (mode === 'stale') fresh.warnings[0].details.entries[1].url = 'https://example.com/jobs/other';
    writeFileSync(join(root, 'fresh.json'), JSON.stringify(fresh));
    writeFileSync(join(root, 'triage.json'), JSON.stringify({ warnings: [{
      warning_id: finding.id, warning_code: finding.code, classification: 'confirmed_duplicate',
      duplicate_resolution: { keeper_tracker_num: 1, duplicate_tracker_nums: [2], keeper_report_file: null, duplicate_report_files: [] },
      rationale: 'Fixture rows describe the same posting.', evidence: [],
    }] }));
    // Simulate a 77-second deterministic scan without a slow wall-clock test.
    // Only replace the nested verifier; locking, identity checks and repair run normally.
    const preload = join(root, 'preload.mjs');
    writeFileSync(preload, `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { readFileSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      const original = childProcess.spawnSync;
      childProcess.spawnSync = (command, args, options) => {
        if (!args[0]?.endsWith('verify-pipeline.mjs')) return original(command, args, options);
        const root = process.env.CAREER_OPS_ROOT;
        writeFileSync(join(root, 'launch.json'), JSON.stringify({ args, timeout: options.timeout, env: {
          CAREER_OPS_USER: options.env.CAREER_OPS_USER,
          CAREER_OPS_ROOT: options.env.CAREER_OPS_ROOT,
          CAREER_OPS_TRACKER: options.env.CAREER_OPS_TRACKER,
        } }));
        if (options.timeout < 77000 || process.env.FIXTURE_TIMEOUT === '1') {
          return { status: null, stderr: '', error: Object.assign(new Error('fixture scan timed out'), { code: 'ETIMEDOUT' }) };
        }
        return { status: 1, stdout: readFileSync(join(root, 'fresh.json'), 'utf8'), stderr: '' };
      };
      syncBuiltinESMExports();
    `);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_') && key !== 'NODE_OPTIONS'));
    Object.assign(env, { CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker, FIXTURE_TIMEOUT: mode === 'timeout' ? '1' : '0' });
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, script,
      '--user', 'fixture', '--verification', join(root, 'verification.json'), '--triage', join(root, 'triage.json'), '--json'],
    { env, encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error);
    const launch = JSON.parse(readFileSync(join(root, 'launch.json'), 'utf8'));
    assert.deepEqual(launch.args.slice(1), ['--user', 'fixture', '--json']);
    assert.deepEqual(launch.env, { CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker });
    assert.ok(launch.timeout >= 77000 && launch.timeout <= 600000, 'allow large scans within a finite ten-minute budget');
    const current = readFileSync(tracker, 'utf8');
    if (mode === 'valid') {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).tracker_rows_removed, 1);
      assert.match(current, /\| 1 \|.*Applied/);
      assert.doesNotMatch(current, /\| 2 \|/);
      assert.ok(existsSync(join(root, 'data', 'duplicate-resolutions.jsonl')));
    } else {
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, mode === 'stale' ? /duplicate identity changed/ : /verification exceeded 600 seconds; no duplicate repairs applied/);
      assert.equal(current, original);
      assert.equal(existsSync(join(root, 'data', 'warning-triage-backups')), false);
      assert.equal(existsSync(join(root, 'data', 'duplicate-resolutions.jsonl')), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('duplicate repair accepts a fresh scan exceeding the old one-minute budget', () => runFixture('valid'));
test('slower duplicate revalidation still rejects changed posting identity before mutations', () => runFixture('stale'));
test('duplicate revalidation timeout preserves tracker and saved decisions without mutations', () => runFixture('timeout'));
