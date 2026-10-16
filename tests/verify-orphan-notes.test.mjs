import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

for (const primary of ['[1](../reports/001-primary-2026-01-01.md)', '—']) {
  test(`orphan check preserves Notes-linked re-evaluations with primary ${primary === '—' ? 'absent' : 'linked'}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'career-ops-orphan-notes-'));
    try {
      mkdirSync(join(root, 'data'));
      mkdirSync(join(root, 'reports'));
      const names = ['001-primary-2026-01-01.md', '002-history-2026-01-01.md', '003-orphan-2026-01-01.md'];
      names.forEach((name, i) => writeFileSync(join(root, 'reports', name), `# Evaluation: Fixture ${i} — Engineer\n\n**URL:** https://example.com/jobs/${i}\n\n## Job Description (archived verbatim)\nDevelop reliable software, collaborate with engineers and maintain production services.\n\n## Machine Summary\n\`\`\`yaml\ncompany: Fixture ${i}\nrole: Engineer\nscore: 4.0\n\`\`\`\n`));
      writeFileSync(join(root, 'data/applications.md'), [
        '| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |',
        '|---|---|---|---|---|---|---|---|---|---|',
        `| 1 | 2026-01-01 | Fixture 0 | — | Engineer | 4.0/5 | Closed | — | ${primary} | Re-evaluation [2](../reports/${names[1]}) |`, '',
      ].join('\n'));
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_') && key !== 'NODE_OPTIONS'));
      Object.assign(env, { CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: join(root, 'data/applications.md') });
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../verify-pipeline.mjs', import.meta.url)), '--user', 'fixture', '--json'], { env, encoding: 'utf8', timeout: 15000 });
      assert.ifError(result.error);
      assert.ok([0, 1].includes(result.status), result.stderr);
      const orphans = JSON.parse(result.stdout).warnings.filter(item => item.code === 'orphan_report');
      assert.deepEqual(orphans.map(item => item.details.file), [`reports/${names[2]}`]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
