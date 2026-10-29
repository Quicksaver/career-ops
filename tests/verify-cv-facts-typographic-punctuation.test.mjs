import { pass, fail } from './helpers.mjs';
import { verifyFacts } from '../verify-cv-facts.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\nTypographic quotes and dashes in fact-gate sources');

// generate-pdf.mjs normalizes the HTML for ATS (curly quotes and en/em dashes
// to ASCII) before it runs the fact gate, while cv.md keeps the typographic
// characters. An education entry copied from cv.md then failed the PDF render
// although the standalone gate passed. Both sides fold to ASCII now.
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-typographic-'));
try {
  const source = join(tmp, 'cv.md');
  const config = join(tmp, 'cv-facts.json');
  writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] }));
  writeFileSync(source, [
    '## EDUCATION AND TRAINING',
    '',
    '### Bachelor’s Degree in Biochemistry FCUP – School of Sciences, University of Porto, 2007-2012',
    '',
  ].join('\n'));
  const education = (title, org) => `<section class="education"><div class="edu-item"><div class="edu-title">${title}</div><div class="edu-org">${org}</div><div class="edu-year">2007-2012</div></div></section>`;
  const check = (label, target) => {
    const result = verifyFacts(target, { sourcePaths: [source], configPath: config });
    const facts = result.unsupportedFacts.map(claim => `${claim.kind}=${claim.value}`);
    if (facts.length === 0) pass(label);
    else fail(`${label}: ${facts.join(', ')}`);
  };
  check('typographic wording matches cv.md', education('Bachelor’s Degree in Biochemistry', 'FCUP – School of Sciences, University of Porto'));
  check('ATS-normalized ASCII wording matches the same cv.md', education("Bachelor's Degree in Biochemistry", 'FCUP - School of Sciences, University of Porto'));

  const invented = verifyFacts(education("Master's Degree in Physics", 'FCUP - School of Sciences, University of Porto'), { sourcePaths: [source], configPath: config });
  if (invented.unsupportedFacts.some(claim => /master's degree in physics/.test(claim.value))) pass('an invented degree still fails after folding');
  else fail(`an invented degree passed: ${JSON.stringify(invented.unsupportedFacts)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
