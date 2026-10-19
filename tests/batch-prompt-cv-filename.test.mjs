import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const prompt = readFileSync(fileURLToPath(new URL('../batch/batch-prompt.md', import.meta.url)), 'utf8');

// Fork naming (FORK.md "CV Output Naming"): the primary HTML/PDF shares the
// report's `{NNN}-{company}-{date}` basename, so same-day postings at one
// company cannot collide and the CV stays linked to its tracker row.
test('every batch CV path carries the report number, so same-day postings at one company cannot collide', () => {
  assert.match(prompt, /primary flat HTML\/PDF basename is `\{\{REPORT_NUM\}\}-\{company-slug\}-\{\{DATE\}\}`/);
  assert.match(prompt, /`--report=\{\{REPORT_NUM\}\}`/);
  // Upstream's `cv-candidate-{company-slug}` names must not reappear without
  // the report number in front of the company slug.
  const legacy = prompt.match(/cv-candidate-[^\s`]*/g) || [];
  for (const path of legacy) {
    assert.match(path, /^cv-candidate-\{\{REPORT_NUM\}\}-\{company-slug\}/, `path without the report number: ${path}`);
  }
  const unnumbered = prompt.match(/(?<!\{\{REPORT_NUM\}\}-)\{company-slug\}-\{\{DATE\}\}\.(?:html|pdf)/g) || [];
  assert.deepEqual(unnumbered, [], 'a CV path omits the report number');
});
