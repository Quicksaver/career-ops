import './user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { throttleProviderRequest } from '../liveness-api.mjs';

const ROOT = resolve(import.meta.dirname, '..');

// check-liveness --concurrency runs API checks at once; LinkedIn's guest
// endpoint stays spaced only because each call reserves its slot before it
// waits. Concurrent callers must therefore queue, not fire together.
test('provider spacing holds for concurrent callers', async () => {
  const provider = `test-provider-${process.pid}`;
  const waits = await Promise.all([1, 2, 3].map(() => throttleProviderRequest(provider, 200)));
  waits.sort((a, b) => a - b);
  assert.ok(waits[0] < 50, `first call waits ${waits[0]}ms`);
  assert.ok(waits[1] >= 150 && waits[1] <= 250, `second call waits ${waits[1]}ms`);
  assert.ok(waits[2] >= 350 && waits[2] <= 450, `third call waits ${waits[2]}ms`);
});

test('--concurrency needs a positive integer', () => {
  for (const value of ['0', 'abc', '-2']) {
    const result = spawnSync(process.execPath, [join(ROOT, 'check-liveness.mjs'), '--concurrency', value, 'https://example.com/jobs/1'],
      { cwd: ROOT, encoding: 'utf8', timeout: 30_000, windowsHide: true, env: { ...process.env } });
    assert.equal(result.status, 1, `${value}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /--concurrency needs a positive integer/);
  }
});
