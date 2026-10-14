import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
test('real liveness CLI accepts JSON and file flags in either order without browser work', t => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-liveness-json-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const user = join(root, 'users/fictional');
  mkdirSync(user, { recursive: true });
  const file = join(root, 'empty posting list.txt');
  writeFileSync(file, '# No fictional postings\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CAREER_OPS_/i.test(key)));
  Object.assign(env, { CAREER_OPS_USERS_DIR: join(root, 'users') });
  const run = args => spawnSync(process.execPath, [join(repo, 'check-liveness.mjs'), '--user', 'fictional', ...args], {
    cwd: repo, env, encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  for (const args of [['--json', '--no-fallback', '--no-record', '--file', file], ['--file', file, '--no-record', '--json']]) {
    const child = run(args);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { status: 'completed', active: 0, expired: 0, uncertain: 0, via_api: 0, results: [] });
  }
  const failed = run(['--json', '--file', join(root, 'missing.txt')]);
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).status, 'failed');
  assert.match(JSON.parse(failed.stdout).error, /ENOENT/);
});
