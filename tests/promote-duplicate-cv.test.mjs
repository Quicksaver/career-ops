// tests/promote-duplicate-cv.test.mjs — a job keeps linking its most recent CV
// when a duplicate report folds into it.
//
// A re-evaluation's CV is named after the re-evaluation's report number. When
// verification archived that report as a duplicate of the job's original, the
// CV went with it and the job kept linking the older one.
//
// Run:  node --test tests/promote-duplicate-cv.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { promoteNewerCv, MANIFEST_HEADER } = await import(pathToFileURL(join(ROOT, 'lib/promote-duplicate-cv.mjs')).href);

const OLD = new Date('2026-10-29T14:00:00');
const NEW = new Date('2026-11-08T12:00:00');

function fixture({ pdfLine = '**PDF:** output/8567-recare-2026-07-26.pdf', keeperCv = true } = {}) {
  const userRoot = mkdtempSync(join(tmpdir(), 'career-ops-promote-cv-'));
  const output = join(userRoot, 'output');
  const dupDir = join(output, 'duplicates', 'stamp');
  mkdirSync(join(userRoot, 'reports'), { recursive: true });
  mkdirSync(join(userRoot, 'data'), { recursive: true });
  mkdirSync(dupDir, { recursive: true });
  const report = join(userRoot, 'reports', '8567-recare-2026-07-26.md');
  writeFileSync(report, ['# Evaluation: Recare', '', '**URL:** https://example.com/jobs/1', ...(pdfLine ? [pdfLine] : []), '', 'body', ''].join('\n'));
  const write = (path, content, when) => { writeFileSync(path, content); utimesSync(path, when, when); };
  const rows = [];
  if (keeperCv) {
    write(join(output, '8567-recare-2026-07-26.pdf'), 'old pdf', OLD);
    write(join(output, '8567-recare-2026-07-26.html'), 'old html', OLD);
    rows.push('8567\toutput/8567-recare-2026-07-26.pdf\toutput/8567-recare-2026-07-26.html\ta4\t2026-10-29\tcv');
    rows.push('8567\toutput/recare-engineer-cover.pdf\toutput/recare-engineer-cover.html\ta4\t2026-10-29\tcover');
  }
  const candidatePdf = join(dupDir, '18262-recare-2026-11-08.pdf');
  write(candidatePdf, 'new pdf', NEW);
  write(join(dupDir, '18262-recare-2026-11-08.html'), 'new html', NEW);
  rows.push('18262\toutput/18262-recare-2026-11-08.pdf\toutput/18262-recare-2026-11-08.html\tletter\t2026-11-08\tcv');
  const indexPath = join(userRoot, 'data', 'pdf-index.tsv');
  writeFileSync(indexPath, `${MANIFEST_HEADER}\n${rows.join('\n')}\n`);
  return { userRoot, output, report, candidatePdf, indexPath };
}

const manifest = (indexPath) => readFileSync(indexPath, 'utf-8').split('\n').filter((line) => line && !line.startsWith('#'));

test('a newer duplicate CV replaces the keeper CV under the keeper number', async () => {
  const f = fixture();
  try {
    const result = await promoteNewerCv({ userRoot: f.userRoot, indexPath: f.indexPath, keeperReport: f.report, candidatePdf: f.candidatePdf });
    assert.equal(result.promoted, true);
    assert.equal(result.pdf, 'output/8567-recare-2026-11-08.pdf');
    assert.equal(readFileSync(join(f.output, '8567-recare-2026-11-08.pdf'), 'utf-8'), 'new pdf');
    assert.equal(readFileSync(join(f.output, '8567-recare-2026-11-08.html'), 'utf-8'), 'new html');
    assert.equal(existsSync(join(f.output, '8567-recare-2026-07-26.pdf')), false, 'the older CV is retired');
    assert.equal(existsSync(join(f.output, '8567-recare-2026-07-26.html')), false);
    assert.equal(existsSync(f.candidatePdf), false);
    assert.match(readFileSync(f.report, 'utf-8'), /^\*\*PDF:\*\* output\/8567-recare-2026-11-08\.pdf$/m);
    assert.deepEqual(manifest(f.indexPath), [
      '8567\toutput/recare-engineer-cover.pdf\toutput/recare-engineer-cover.html\ta4\t2026-10-29\tcover',
      '8567\toutput/8567-recare-2026-11-08.pdf\toutput/8567-recare-2026-11-08.html\tletter\t2026-11-08\tcv',
    ]);
  } finally {
    rmSync(f.userRoot, { recursive: true, force: true });
  }
});

test('an older duplicate CV leaves the keeper alone', async () => {
  const f = fixture();
  try {
    utimesSync(f.candidatePdf, new Date('2026-06-01'), new Date('2026-06-01'));
    const before = readFileSync(f.report, 'utf-8');
    const result = await promoteNewerCv({ userRoot: f.userRoot, indexPath: f.indexPath, keeperReport: f.report, candidatePdf: f.candidatePdf });
    assert.equal(result.promoted, false);
    assert.equal(readFileSync(f.report, 'utf-8'), before);
    assert.equal(existsSync(join(f.output, '8567-recare-2026-07-26.pdf')), true);
    assert.equal(existsSync(f.candidatePdf), true);
  } finally {
    rmSync(f.userRoot, { recursive: true, force: true });
  }
});

test('a keeper without a CV gets the duplicate CV and a PDF line', async () => {
  const f = fixture({ pdfLine: null, keeperCv: false });
  try {
    const result = await promoteNewerCv({ userRoot: f.userRoot, indexPath: f.indexPath, keeperReport: f.report, candidatePdf: f.candidatePdf });
    assert.equal(result.promoted, true);
    assert.match(readFileSync(f.report, 'utf-8'), /\*\*URL:\*\* https:\/\/example\.com\/jobs\/1\n\*\*PDF:\*\* output\/8567-recare-2026-11-08\.pdf\n/);
  } finally {
    rmSync(f.userRoot, { recursive: true, force: true });
  }
});

test('with a backup folder the change can be undone', async () => {
  const f = fixture();
  try {
    const before = { report: readFileSync(f.report, 'utf-8'), index: readFileSync(f.indexPath, 'utf-8') };
    const backupDir = join(f.userRoot, 'backup');
    const result = await promoteNewerCv({ userRoot: f.userRoot, indexPath: f.indexPath, keeperReport: f.report, candidatePdf: f.candidatePdf, backupDir });
    assert.equal(readFileSync(join(backupDir, '8567-recare-2026-07-26.pdf'), 'utf-8'), 'old pdf');
    for (const { from, to } of result.moves.reverse()) renameSync(to, from);
    for (const { path, content } of result.restores.reverse()) writeFileSync(path, content);
    assert.equal(readFileSync(f.report, 'utf-8'), before.report);
    assert.equal(readFileSync(f.indexPath, 'utf-8'), before.index);
    assert.equal(readFileSync(join(f.output, '8567-recare-2026-07-26.pdf'), 'utf-8'), 'old pdf');
    assert.equal(readFileSync(f.candidatePdf, 'utf-8'), 'new pdf');
    assert.equal(existsSync(join(f.output, '8567-recare-2026-11-08.pdf')), false);
  } finally {
    rmSync(f.userRoot, { recursive: true, force: true });
  }
});
