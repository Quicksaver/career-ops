#!/usr/bin/env node
/**
 * reportUrlForNumbers resolves a report number to its file through one cached
 * listing of the reports folder and caches each report's **URL:** value. A
 * closure sweep plans every tracker row again before each write; listing
 * ~18k reports and rereading each one per row made every closure take minutes.
 * The caches must still see a report added or edited after the first lookup.
 *
 * Run: node test-all.mjs --only report-url-index
 */

import { mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync } from './helpers.mjs';
import { reportUrlForNumbers } from '../tracker-parse.mjs';

console.log('\nReport URL lookup by number (cached listing and URL)');

const root = mkdtempSync(join(tmpdir(), 'report-url-index-'));
const any = () => true;
const report = (url) => `# Eval\n\n**Score:** 4/5\n**URL:** ${url}\n`;
// Moves a path's mtime so the change is visible regardless of timestamp resolution.
let tick = Date.now() / 1000 - 1000;
const touch = (path) => { tick += 10; utimesSync(path, tick, tick); };

try {
  writeFileSync(join(root, '064-acme-2026-11-01.md'), report('https://jobs.example.com/64'));
  writeFileSync(join(root, '7-beta-2026-11-01.md'), report('https://jobs.example.com/7'));
  writeFileSync(join(root, 'notes.txt'), 'not a report');
  touch(root);

  const check = (label, actual, expected) => {
    if (actual === expected) pass(label);
    else fail(`${label}: expected ${expected}, got ${actual}`);
  };

  check('a padded file name resolves from its number', reportUrlForNumbers([64], root, any), 'https://jobs.example.com/64');
  check('an unpadded file name resolves', reportUrlForNumbers([7], root, any), 'https://jobs.example.com/7');
  check('a missing number falls through to the next', reportUrlForNumbers([99, 7], root, any), 'https://jobs.example.com/7');
  check('accept rejecting a URL falls through to the next', reportUrlForNumbers([64, 7], root, (url) => url.endsWith('/7')), 'https://jobs.example.com/7');

  writeFileSync(join(root, '0100-gamma-2026-11-09.md'), report('https://jobs.example.com/100'));
  touch(root);
  check('a report added after the first lookup is found', reportUrlForNumbers([100], root, any), 'https://jobs.example.com/100');

  const edited = join(root, '7-beta-2026-11-01.md');
  writeFileSync(edited, report('https://jobs.example.com/7-moved'));
  touch(edited);
  check('an edited report URL is reread', reportUrlForNumbers([7], root, any), 'https://jobs.example.com/7-moved');

  writeFileSync(join(root, '0200-delta-2026-11-09.md'), '# Eval\n\nNo URL line.\n');
  touch(root);
  check('a report without a URL line resolves to nothing', reportUrlForNumbers([200], root, any), null);
} finally {
  rmSync(root, { recursive: true, force: true });
}
