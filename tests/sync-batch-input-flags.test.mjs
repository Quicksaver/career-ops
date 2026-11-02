// sync-batch-input.mjs parsed argv by hand: a mistyped --dryrun was ignored, so
// the run wrote for real.
//
// Fork: batch input and state belong to the selected user (users/{USER}/batch/),
// so the upstream --pipeline/--input/--state path flags are refused with an
// explanation rather than read; CAREER_OPS_PIPELINE selects an inbox lane. The
// fork forwards to sync-pipeline-batch.mjs, which rejects unknown flags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function withPipeline(fn) {
  const root = mkdtempSync(join(tmpdir(), 'sync-batch-flags-'));
  try {
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'pipeline.md'), '# Pipeline\n\n## Pending\n\n- [ ] https://jobs.example.com/acme/1 | Acme | Engineer\n');
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
    Object.assign(env, { CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: root });
    const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'sync-batch-input.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 30000, env });
    fn({ root, run });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a mistyped --dry-run is refused and writes nothing', () => {
  withPipeline(({ root, run }) => {
    const result = run('--dryrun');
    assert.ok(exitedNonZero(result), describeSpawn(result, 'expected a non-zero exit'));
    assert.match(result.stderr + result.stdout, /--dryrun/);
    assert.equal(existsSync(join(root, 'batch', 'batch-input.tsv')), false, 'a mistyped --dry-run wrote the input file');
  });
});

test('--dry-run reads the selected user\'s pipeline and writes nothing', () => {
  withPipeline(({ root, run }) => {
    const result = run('--dry-run');
    assert.equal(result.status, 0, describeSpawn(result));
    assert.match(result.stdout, /Batch rows added: 1 \(dry run\)/);
    assert.equal(existsSync(join(root, 'batch', 'batch-input.tsv')), false);
  });
});

test('path flags are refused in both spellings, before anything is written', () => {
  withPipeline(({ root, run }) => {
    for (const args of [['--input', 'x.tsv'], ['--input=x.tsv'], ['--state', 'x.tsv'], ['--pipeline=x.md']]) {
      const result = run('--dry-run', ...args);
      assert.ok(exitedNonZero(result), describeSpawn(result, args.join(' ')));
      assert.match(result.stderr, /is not supported: batch input and state belong to the selected user/);
    }
    assert.equal(existsSync(join(root, 'batch')), false);
  });
});

test('--help prints usage and exits 0', () => {
  withPipeline(({ run }) => {
    const result = run('--help');
    assert.equal(result.status, 0, describeSpawn(result));
    assert.match(result.stdout, /Usage: node sync-batch-input\.mjs/);
  });
});
