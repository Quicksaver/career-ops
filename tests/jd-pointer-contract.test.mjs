import './user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkJdArchive } from '../check-jd-archive.mjs';

test('repository-style and user-relative archive pointers require a resolvable capture', t => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-jd-pointer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const reports = join(root, 'reports'), jds = join(root, 'jds');
  mkdirSync(reports); mkdirSync(jds);
  for (const prefix of ['jds/', 'users/fixture/jds/']) {
    writeFileSync(join(reports, '001-fixture-2026-10-14.md'), `# Evaluation\n\n## Job Description (archived verbatim)\nPosted: not visible in source\nSee ${prefix}001-fixture.md for the full archive (archive-posting.mjs --report=1).\n`);
    assert.equal(checkJdArchive(reports, jds).findings.length, 1, prefix);
    writeFileSync(join(jds, '001-fixture.md'), 'Build and maintain software systems. Work with the team on reliable services and clear documentation.\n');
    assert.equal(checkJdArchive(reports, jds).findings.length, 0, prefix);
    rmSync(join(jds, '001-fixture.md'));
  }
});
