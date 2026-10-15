import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { ROOT, rmSync } from './helpers.mjs';

const systemRoot = ROOT;

test('web evaluation persists through real system scripts into the selected external user root', async t => {
  if (!existsSync(join(ROOT, 'web', 'src'))) { t.skip('web/ is not present in this checkout'); return; }
  const { persistEvaluation } = await import('../web/src/lib/report-persist.mjs');
  const root = mkdtempSync(join(tmpdir(), 'web-report-user-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data/applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | Via |\n|---|---|---|---|---|---|---|---|---|---|\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CAREER_OPS_/i.test(key)));
  Object.assign(env, { CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: root });
  const calls = [];
  const result = await persistEvaluation({
    spawnFn: (command, args, options) => {
      calls.push({ args, options });
      return spawn(command, args, options);
    },
    execPath: process.execPath, root, systemRoot, env,
    url: 'https://example.org/jobs/fictional', today: '2026-10-15',
    markdown: '# Evaluation: Fictional Company -- Engineer\n\n## Machine Summary\n```yaml\ncompany: Fictional Company\nrole: Engineer\nscore: 4.2\nvia: null\n```\n\n## Job Description (archived verbatim)\nBuild fictional applications for this offline test.\n',
  });
  assert.equal(result.ok, true, result.error);
  assert.match(readFileSync(join(root, 'reports', result.reportFile), 'utf8'), /Fictional Company/);
  assert.match(readFileSync(join(root, 'data/applications.md'), 'utf8'), /Fictional Company.*Engineer/);
  assert.deepEqual(calls.map(({ args }) => basename(args[0])), [
    'reserve-report-num.mjs', 'persist-evaluation-report.mjs', 'merge-tracker.mjs', 'reserve-report-num.mjs',
  ]);
  for (const { args, options } of calls) {
    assert.equal(dirname(args[0]), systemRoot);
    assert.equal(options.cwd, root);
    assert.equal(options.env.CAREER_OPS_USER, 'fixture');
    assert.equal(options.env.CAREER_OPS_ROOT, root);
    assert.equal(options.windowsHide, true);
  }
});
