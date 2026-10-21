import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBatch } from './helpers/batch-runner-fixture.mjs';

test('an explicit 3-worker Claude batch drops to 1 after a rate limit', () => {
  const { stdout, starts } = runBatch({ offers: 6, args: ['--parallel', '3'] });
  assert.match(stdout, /Parallel: 3 \(argument\) \|/);
  assert.match(stdout, /Rate limited: running the remaining offers on 1 worker/);
  assert.equal(Math.max(starts['2'], starts['3']), 2, 'offers 2 and 3 ran next to each other');
  assert.deepEqual([starts['4'], starts['5'], starts['6']], [1, 1, 1]);
});

test('the fork defaults to one worker without an argument or profile override', () => {
  const { stdout } = runBatch({ offers: 2 });
  assert.match(stdout, /Parallel: 1 \(default\) \|/);
});
