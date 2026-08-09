import assert from "node:assert/strict";
import test from "node:test";

import { parseMachineSummarySignals } from "../../src/lib/machine-summary.mjs";

test("reads populated decision-signal lists from Machine Summary YAML", () => {
  const report = `# Evaluation

## Machine Summary

\`\`\`yaml
company: Acme
hard_stops:
  - Must relocate
soft_gaps:
  - Missing one optional tool
top_strengths:
  - Strong product ownership
  - Relevant platform experience
\`\`\`

## A) Role Summary
Prose.
`;

  assert.deepEqual(parseMachineSummarySignals(report), {
    hardStops: ["Must relocate"],
    softGaps: ["Missing one optional tool"],
    topStrengths: ["Strong product ownership", "Relevant platform experience"],
  });
});

test("omits empty lists while preserving populated lists", () => {
  const report = `#### Machine Summary
\`\`\`yml
hard_stops: []
soft_gaps: []
top_strengths:
  - Evidence-backed fit
\`\`\`
`;

  assert.deepEqual(parseMachineSummarySignals(report), {
    hardStops: [],
    softGaps: [],
    topStrengths: ["Evidence-backed fit"],
  });
});

test("returns null for missing, empty, malformed, or wrong-shaped summaries", () => {
  assert.equal(parseMachineSummarySignals("## A) Role Summary\nNo machine data."), null);
  assert.equal(parseMachineSummarySignals("## Machine Summary\n```yaml\nhard_stops: []\n```"), null);
  assert.equal(parseMachineSummarySignals("## Machine Summary\n```yaml\nhard_stops: [unterminated\n```"), null);
  assert.equal(parseMachineSummarySignals("## Machine Summary\n```yaml\nhard_stops: relocate\n```"), null);
});

test("does not read an unrelated YAML fence before the Machine Summary", () => {
  const report = `\`\`\`yaml
hard_stops:
  - Wrong fence
\`\`\`

## Machine Summary
\`\`\`yaml
top_strengths:
  - Correct fence
\`\`\`
`;

  assert.deepEqual(parseMachineSummarySignals(report), {
    hardStops: [],
    softGaps: [],
    topStrengths: ["Correct fence"],
  });
});
