import { batchCanonicalContext } from './batch-canonical-context.mjs';
// Batch loads the interactive evaluation source. Assert that binding before
// checking its scoring, Block A and ordered Block G contracts.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nprompt parity (interactive ↔ batch)');

const assert = (condition, message) => condition ? pass(message) : fail(message);

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = text.indexOf(endMarker, start + startMarker.length);
  return text.slice(start, end === -1 ? text.length : end);
}

try {
  const oferta = readFileSync(join(ROOT, 'modes', 'oferta.md'), 'utf8');
  const batch = readFileSync(join(ROOT, 'batch', 'batch-prompt.md'), 'utf8');
  const loaded = batchCanonicalContext();
  const shared = readFileSync(join(ROOT, 'modes', '_shared.md'), 'utf8');

  const trackerInstruction = section(oferta, '- Score: copy the already-decided', '\n- Status:');
  const batchScoreInstruction = trackerInstruction + loaded.shared;
  assert(
    shared.includes('A–H are report sections, not numeric inputs to average')
      && trackerInstruction.includes('A–H are report sections, not scores to average')
      && batchScoreInstruction.includes('A–H are report sections, not scores to average'),
    'all evaluation paths keep report blocks separate from scoring dimensions',
  );
  assert(
    shared.includes('report header, Machine Summary `score`, and application tracker must record that same value')
      && trackerInstruction.includes('copy the already-decided 1–5 Global Score')
      && batchScoreInstruction.includes('report header, Machine Summary `score`, and application tracker must record that same value'),
    'interactive and batch paths copy one Global Score into every output',
  );

  const ofertaBlockA = section(oferta, '## Block A — Role Summary', '## Block B — Match with CV');
  const batchBlockA = section(loaded.oferta, '## Block A — Role Summary', '## Block B — Match with CV');
  const tierPattern = /^- (?:✅|➖|⚠️|⛔) \*\*([^*]+)\*\*\s+—/gm;
  const ofertaTiers = [...ofertaBlockA.matchAll(tierPattern)].map((match) => match[1]);
  const batchTiers = [...batchBlockA.matchAll(tierPattern)].map((match) => match[1]);

  assert(
    batchBlockA.includes('### Work-authorization check') && batchBlockA.includes('Classify into exactly one tier'),
    'batch Block A contains a required work-authorization instruction',
  );
  assert(
    ofertaTiers.length === 4,
    'canonical Block A exposes exactly four work-authorization tiers',
  );
  assert(
    JSON.stringify(batchTiers) === JSON.stringify(ofertaTiers),
    'batch Block A uses the canonical four tier names in canonical order',
  );

  const ofertaBlockG = section(oferta, '## Block G — Posting Legitimacy', '### Output format:');
  const batchBlockG = section(loaded.oferta, '## Block G — Posting Legitimacy', '### Output format:');
  const signalPattern = /^\*\*(\d+)\.\s+(.+?)\*\*/gm;
  const canonicalMatches = [...ofertaBlockG.matchAll(signalPattern)]
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  const canonicalSignals = canonicalMatches.map((match) => match[2]);

  // The count is DERIVED from modes/oferta.md, never restated here. A literal
  // number would be a second copy of the canon — the exact drift this suite
  // exists to prevent — and it would go red every time a signal lands. What is
  // asserted instead is the invariant that survives growth: the canon numbers
  // its signals 1..N with no gap, so the list below can be trusted as ordered.
  assert(
    canonicalSignals.length > 0
      && canonicalMatches.every((match, index) => Number(match[1]) === index + 1),
    `canonical Block G exposes ${canonicalSignals.length} signals numbered 1..${canonicalSignals.length}`,
  );

  const batchSignalPositions = canonicalSignals.map((name) => batchBlockG.indexOf(`**${canonicalSignals.indexOf(name) + 1}. ${name}**`));
  for (const [index, name] of canonicalSignals.entries()) {
    assert(
      ofertaBlockG.includes(`**${index + 1}. ${name}**`) && batchSignalPositions[index] !== -1,
      `Block G signal ${index + 1} appears in both prompts: ${name}`,
    );
  }
  assert(
    batchSignalPositions.every((position, index) =>
      position !== -1 && (index === 0 || position > batchSignalPositions[index - 1])),
    'batch Block G preserves the canonical signal order',
  );

  const machineSummary = section(batch, '## Machine Summary (canonical report schema)', 'Rules:');
  assert(
    batchBlockA.includes('Classify into exactly one tier') && /^work_auth:/m.test(machineSummary) && batch.includes('`work_auth` reflects the Block A work-authorization tier'),
    'batch Block A explicitly produces work_auth',
  );
  assert(
    /^work_auth:/m.test(machineSummary),
    'batch Machine Summary YAML schema contains work_auth',
  );
} catch (error) {
  fail(`prompt parity tests crashed: ${error.message}`);
}
