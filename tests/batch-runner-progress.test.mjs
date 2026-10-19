import test from 'node:test';
import assert from 'node:assert/strict';
import { getBash } from './helpers.mjs';
import { copyBatchOwnership } from './copy-batch-ownership.mjs';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8');

// The fixture is its own data root (CAREER_OPS_ROOT) for the test user the
// helpers select, so the runner's per-user batch layout lands inside it.
function runFixtureBatch({ offers, parallel, workerSeconds = 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'batch-progress-'));
  try {
    const batchDir = join(dir, 'batch');
    const binDir = join(dir, 'bin');
    for (const d of [batchDir, binDir, join(dir, 'reports'), join(dir, 'data')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(batchDir, 'batch-runner.sh'), SRC);
    copyBatchOwnership(dir);
    writeFileSync(join(batchDir, 'batch-prompt.md'), 'Fixture prompt for {{URL}} {{ID}}\n');
    writeFileSync(join(batchDir, 'batch-input.tsv'), ['id\turl\tsource\tnotes',
      ...Array.from({ length: offers }, (_, i) => `${i + 1}\thttps://jobs.example.com/acme/${i + 1}\tfixture\t-`)].join('\n') + '\n');
    writeFileSync(join(dir, 'reserve-report-num.mjs'), [
      "import { readFileSync, writeFileSync, existsSync } from 'node:fs';",
      "if (!process.argv.includes('--release')) {",
      "  const n = (existsSync('counter.txt') ? parseInt(readFileSync('counter.txt', 'utf8'), 10) : 0) + 1;",
      "  writeFileSync('counter.txt', String(n));",
      "  console.log(String(n).padStart(3, '0'));",
      '}',
    ].join('\n') + '\n');
    for (const script of ['merge-tracker', 'reconcile-pipeline', 'verify-pipeline']) writeFileSync(join(dir, `${script}.mjs`), '\n');
    writeFileSync(join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
    writeFileSync(join(binDir, 'claude'), `#!/usr/bin/env bash\nsleep ${workerSeconds}\nexit 1\n`);
    for (const f of ['batch/batch-runner.sh', 'bin/curl', 'bin/claude']) chmodSync(join(dir, f), 0o755);
    const res = spawnSync(getBash(), [join(batchDir, 'batch-runner.sh'), '--cli', 'claude', '--parallel', String(parallel), '--max-retries', '0', '--rate-limit-sleep', '0'], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}`, CAREER_OPS_ROOT: dir },
      timeout: 120000,
    });
    return { stdout: res.stdout, stderr: res.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const progressLines = (stdout) => stdout.split('\n').filter((l) => l.startsWith('=== Progress:')).map((l) => l.replace(/, \d+s elapsed/, ''));

for (const parallel of [1, 2]) {
  test(`--parallel ${parallel} prints one progress line per finished offer and labels each offer with its position`, () => {
    const { stdout, stderr } = runFixtureBatch({ offers: 3, parallel });
    assert.deepEqual(progressLines(stdout), ['=== Progress: 1/3 offers finished ===', '=== Progress: 2/3 offers finished ===', '=== Progress: 3/3 offers finished ==='], stdout + stderr);
    assert.ok(stdout.includes('--- Processing offer #3 (3/3): https://jobs.example.com/acme/3'), stdout + stderr);
  });
}
