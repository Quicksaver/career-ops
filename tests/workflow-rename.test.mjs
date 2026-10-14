import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquirePipelineLock } from '../pipeline-lock.mjs';
import { workflowRunnerPidPaths } from '../lib/run-artifacts.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const ownership of ['pid', 'directory', 'ambiguous']) {
  test(`renamed workflow refuses legacy ${ownership} ownership before starting phases`, async t => {
    const root = mkdtempSync(join(tmpdir(), 'career-ops-workflow-rename-'));
    t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    mkdirSync(join(root, 'data'));
    const [currentPath, legacyPath] = workflowRunnerPidPaths(root);
    let owner;
    if (ownership === 'directory') owner = await acquirePipelineLock(legacyPath);
    else writeFileSync(legacyPath, ownership === 'pid' ? `${process.pid}\n` : 'unknown owner\n');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CAREER_OPS_/i.test(key)));
    env.CAREER_OPS_ROOT = root;
    env.CAREER_OPS_USERS_DIR = join(root, 'users');
    try {
      const child = spawnSync(process.execPath, [join(repo, 'run-workflow.mjs'), '--user', 'fictional', '--skip-scan', '--json'], {
        cwd: repo, env, encoding: 'utf8', windowsHide: true, timeout: 10000,
      });
      assert.equal(child.status, 1, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.status, 'failed');
      assert.match(result.error, /another workflow runner is active|pipeline lock timeout|ambiguous workflow runner ownership/);
      assert.deepEqual(result.phases, []);
      assert.ok(!existsSync(currentPath));
      assert.ok(!existsSync(`${currentPath}.lock`), 'failed acquisition releases new-name ownership');
      if (ownership !== 'directory') {
        assert.equal(readFileSync(legacyPath, 'utf8'), ownership === 'pid' ? `${process.pid}\n` : 'unknown owner\n');
      } else {
        assert.equal(JSON.parse(readFileSync(`${legacyPath}.lock/owner.json`, 'utf8')).pid, process.pid);
      }
    } finally { owner?.release(); }
  });
}
