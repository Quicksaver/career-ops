import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

// Resolve only sources the worker explicitly loads and executes. The checks
// prevent tests from passing on canonical text after the prompt drops linkage.
export function batchCanonicalContext() {
  const prompt = readFileSync(join(ROOT, 'batch/batch-prompt.md'), 'utf8');
  assert.match(prompt, /Read `AGENTS.md`, `modes\/_shared.md`[^\n]*`modes\/oferta.md`/);
  assert.match(prompt, /Execute the canonical A-G evaluation from `oferta`/);
  assert.match(prompt, /only the primary evaluation mode/);
  assert.match(prompt, /Use the report headings and their order from the loaded `oferta` mode/);
  assert.match(prompt, /sole batch Machine Summary schema/);
  const oferta = readFileSync(join(ROOT, 'modes/oferta.md'), 'utf8');
  const shared = readFileSync(join(ROOT, 'modes/_shared.md'), 'utf8');
  return { prompt, oferta, shared };
}
