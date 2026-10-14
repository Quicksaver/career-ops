import '../helpers/web-ts-alias-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

test('production web lock and PDF-index bridges load system modules for an independent selected user root', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-web-boundaries-'));
  const code = join(dir, 'engine');
  const data = join(dir, 'selected');
  const saved = { ...process.env };
  try {
    mkdirSync(code);
    mkdirSync(join(data, 'data'), { recursive: true });
    for (const key of Object.keys(process.env).filter(key => key.startsWith('CAREER_OPS_'))) delete process.env[key];
    Object.assign(process.env, { CAREER_OPS_CODE_ROOT: code, CAREER_OPS_ROOT: code, CAREER_OPS_DATA_DIR: data, CAREER_OPS_USER: 'fictional' });
    const coreSeed = resolve(import.meta.dirname, '../../..', 'followup-seed.mjs');
    writeFileSync(join(code, 'followup-seed.mjs'), `export {withFollowupsLock} from ${JSON.stringify(pathToFileURL(coreSeed).href)};\n`);
    writeFileSync(join(code, 'tracker-utils.mjs'), `import {join,dirname} from 'node:path';
export const resolveTrackerPath=root=>join(root,'data','custom-tracker.md');
export const resolvePdfIndexPath=tracker=>join(dirname(tracker),'pdf-index.tsv');\n`);
    for (const file of ['followup-seed.mjs', 'tracker-utils.mjs']) writeFileSync(join(data, file), 'throw new Error("Attempted to load code from user data");\n');
    const { withFollowupsLock } = await import('../../src/lib/core/followups-lock.ts');
    const { resolvePdfIndexPath } = await import('../../src/lib/core/pdf-index.ts');
    const file = join(data, 'data/follow-ups.md');
    writeFileSync(file, 'initial\n');
    const append = label => withFollowupsLock(file, async () => {
      const snapshot = readFileSync(file, 'utf8');
      await new Promise(resolve => setTimeout(resolve, 25));
      writeFileSync(file, snapshot + label + '\n');
    });
    await Promise.all([append('first'), append('second')]);
    assert.equal(readFileSync(file, 'utf8'), 'initial\nfirst\nsecond\n');
    assert.equal(await resolvePdfIndexPath(), join(data, 'data/pdf-index.tsv'));
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(dir, { recursive: true, force: true });
  }
});
