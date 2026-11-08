// verify-pipeline: two tracker rows of one company whose reports name the same
// posting URL are a possible duplicate even when their titles differ (a role the
// employer renamed between evaluations). Rows of different companies sharing a
// URL (a generic careers or agency page) are not.
import './user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const report = (company, role, url) => `# Evaluation: ${company} — ${role}\n\n**Score:** 4.2/5\n**URL:** ${url}\n**PDF:** pending\n\n## Machine Summary\n\n\`\`\`yaml\ncompany: "${company}"\nrole: "${role}"\nscore: 4.2\n\`\`\`\n`;

function findings(rows) {
  const root = mkdtempSync(join(tmpdir(), 'co-vp-url-titles-'));
  try {
    mkdirSync(join(root, 'reports'), { recursive: true });
    mkdirSync(join(root, 'data'), { recursive: true });
    const lines = rows.map(([num, company, role, url]) => {
      const file = `${String(num).padStart(3, '0')}-${company.toLowerCase()}-2026-11-0${num}.md`;
      writeFileSync(join(root, 'reports', file), report(company, role, url));
      return `| ${num} | 2026-11-0${num} | ${company} | ${role} | 4.2/5 | Evaluated | ❌ | [${num}](../reports/${file}) | ok |`;
    });
    writeFileSync(join(root, 'data', 'applications.md'), '# Applications Tracker\n\n'
      + '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
      + '|---|------|---------|------|-------|--------|-----|--------|-------|\n' + lines.join('\n') + '\n');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_')));
    const child = spawnSync(process.execPath, [join(ROOT, 'verify-pipeline.mjs'), '--json'], {
      cwd: ROOT, encoding: 'utf8', timeout: 60_000, windowsHide: true,
      env: { ...env, CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: root },
    });
    return JSON.parse(child.stdout).warnings.filter(w => w.details?.match_basis === 'canonical_url_across_titles');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('one company, one posting URL, renamed title: a typed tracker duplicate', () => {
  const found = findings([
    [1, 'Acme', 'Senior Software Engineer - Pricing', 'https://jobs.ashbyhq.com/acme/1dbe845c-a1ec-4005-92c6-44dec63b2e44'],
    [2, 'Acme', 'Senior Backend Engineer - Pricing', 'https://jobs.ashbyhq.com/acme/1dbe845c-a1ec-4005-92c6-44dec63b2e44'],
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'possible_duplicate_tracker');
  assert.equal(found[0].id, 'possible-duplicate-tracker:1:2');
  assert.deepEqual(found[0].details.tracker_nums, [1, 2]);
});

test('different companies sharing one URL are not flagged', () => {
  const found = findings([
    [1, 'Acme', 'Rust Developer', 'https://agency.example.com/careers'],
    [2, 'Globex', 'Go Developer', 'https://agency.example.com/careers'],
  ]);
  assert.deepEqual(found, []);
});
