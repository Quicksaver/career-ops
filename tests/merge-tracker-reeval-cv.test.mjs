// tests/merge-tracker-reeval-cv.test.mjs — a re-evaluated job links its newest CV.
//
// A re-evaluation writes a new report and CV under a new report number, and the
// merge keeps the row's primary report. Without moving the CV, every tool that
// looks a job up by its number (the dashboard, cv2mac) kept the older CV.
//
// Run:  node --test tests/merge-tracker-reeval-cv.test.mjs

import './user-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { mergeTracker } = await import(pathToFileURL(join(ROOT, 'merge-tracker.mjs')).href);
const { MANIFEST_HEADER } = await import(pathToFileURL(join(ROOT, 'lib/promote-duplicate-cv.mjs')).href);

const OLD = new Date('2026-11-20T10:00:00');
const NEW = new Date('2026-11-24T11:00:00');
const quiet = { log() {}, warn() {}, error() {} };

function workspace({ newCv = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-reeval-cv-'));
  for (const dir of ['data', 'reports', 'output', 'batch/tracker-additions']) mkdirSync(join(root, dir), { recursive: true });
  const write = (rel, content, when) => {
    writeFileSync(join(root, rel), content);
    if (when) utimesSync(join(root, rel), when, when);
  };
  const report = (num, date, pdf) => ['# Evaluation: Vekta', '', '**URL:** https://joinvekta.com/careers/se', `**PDF:** [Tailored CV](../${pdf})`, '', 'body', ''].join('\n');
  write('reports/100-vekta-2026-11-20.md', report(100, '2026-11-20', 'output/100-vekta-2026-11-20.pdf'));
  write('reports/200-vekta-gmbh-2026-11-24.md', report(200, '2026-11-24', 'output/200-vekta-gmbh-2026-11-24.pdf'));
  write('output/100-vekta-2026-11-20.pdf', 'old pdf', OLD);
  write('output/100-vekta-2026-11-20.html', 'old html', OLD);
  const rows = ['100\toutput/100-vekta-2026-11-20.pdf\toutput/100-vekta-2026-11-20.html\ta4\t2026-11-20\tcv'];
  if (newCv) {
    write('output/200-vekta-gmbh-2026-11-24.pdf', 'new pdf', NEW);
    write('output/200-vekta-gmbh-2026-11-24.html', 'new html', NEW);
    rows.push('200\toutput/200-vekta-gmbh-2026-11-24.pdf\toutput/200-vekta-gmbh-2026-11-24.html\ta4\t2026-11-24\tcv');
  }
  write('data/pdf-index.tsv', `${MANIFEST_HEADER}\n${rows.join('\n')}\n`);
  write('data/applications.md', [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 100 | 2026-11-20 | Vekta | Software Engineer | 4.4/5 | Evaluated | ✅ | [100](../reports/100-vekta-2026-11-20.md) | first pass |', '',
  ].join('\n'));
  write('batch/tracker-additions/200-vekta.tsv', [
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl',
    `200\t2026-11-24\tVekta\tSoftware Engineer\tEvaluated\t4.5/5\t${newCv ? '✅' : '❌'}\t[200](reports/200-vekta-gmbh-2026-11-24.md)\tre-eval\thttps://joinvekta.com/careers/se`, '',
  ].join('\n'));
  return root;
}

const merge = (root) => mergeTracker({
  appsFile: join(root, 'data', 'applications.md'),
  batchStateFile: join(root, 'batch', 'batch-state.tsv'),
  lock: { timeoutMs: 5000, retryMs: 20 },
  logger: quiet,
});
const cvRows = (root) => readFileSync(join(root, 'data', 'pdf-index.tsv'), 'utf-8').split('\n').filter((l) => l && !l.startsWith('#'));

test('a re-evaluation CV is filed under the row\'s primary report number', async () => {
  const root = workspace();
  try {
    assert.equal(await merge(root), 0);
    const row = readFileSync(join(root, 'data', 'applications.md'), 'utf-8').split('\n').find((l) => l.startsWith('| 100 '));
    assert.match(row, /\[100\]\(\.\.\/reports\/100-vekta-2026-11-20\.md\)/, 'the row keeps its primary report');
    assert.match(row, /Re-eval report \[200\]/);

    assert.equal(readFileSync(join(root, 'output', '100-vekta-2026-11-24.pdf'), 'utf-8'), 'new pdf');
    assert.equal(readFileSync(join(root, 'output', '100-vekta-2026-11-24.html'), 'utf-8'), 'new html');
    assert.equal(existsSync(join(root, 'output', '200-vekta-gmbh-2026-11-24.pdf')), false, 'the CV takes the primary report number and slug');
    assert.equal(readFileSync(join(root, 'data', 'superseded-cvs', '100-vekta-2026-11-20.pdf'), 'utf-8'), 'old pdf', 'the replaced CV is kept aside');
    assert.deepEqual(cvRows(root), ['100\toutput/100-vekta-2026-11-24.pdf\toutput/100-vekta-2026-11-24.html\ta4\t2026-11-24\tcv']);

    assert.match(readFileSync(join(root, 'reports', '100-vekta-2026-11-20.md'), 'utf-8'), /^\*\*PDF:\*\* output\/100-vekta-2026-11-24\.pdf$/m);
    assert.match(readFileSync(join(root, 'reports', '200-vekta-gmbh-2026-11-24.md'), 'utf-8'), /^\*\*PDF:\*\* output\/100-vekta-2026-11-24\.pdf$/m,
      'the re-evaluation report links the moved CV');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a re-evaluation without a CV leaves the primary CV in place', async () => {
  const root = workspace({ newCv: false });
  try {
    assert.equal(await merge(root), 0);
    assert.equal(readFileSync(join(root, 'output', '100-vekta-2026-11-20.pdf'), 'utf-8'), 'old pdf');
    assert.deepEqual(cvRows(root), ['100\toutput/100-vekta-2026-11-20.pdf\toutput/100-vekta-2026-11-20.html\ta4\t2026-11-20\tcv']);
    assert.equal(existsSync(join(root, 'data', 'superseded-cvs')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
