import './user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoleFirstHeading, parseCompanyHeading, normalizePandocLine } from '../lib/cv-markdown.mjs';
import { parseCvExperience, checkTitles } from '../cv-title-check.mjs';
import { parseCvMdExperience, verifyStructure } from '../verify-cv-structure.mjs';

const source = `# Candidate
## Professional Experience
### Application Engineer (Freelance), 2024-present
- Built systems.
### Head of Engineering, Northwind, 2023-2024
- Led delivery.
### Developer / Technical Lead, Example, Inc., 2017-2022
- Built tools.
### Programmer (Freelance), Browser Extensions, 2011-2017
- Maintained extensions.
## Education
### Researcher, Example University, 2010-2011
`;

test('inline experience headings preserve literal titles, employers and dates', () => {
  assert.deepEqual(parseCvExperience(source), [
    {company:'Freelance',title:'Application Engineer (Freelance)',dates:'2024-present'},
    {company:'Northwind',title:'Head of Engineering',dates:'2023-2024'},
    {company:'Example, Inc.',title:'Developer / Technical Lead',dates:'2017-2022'},
    {company:'Browser Extensions',title:'Programmer (Freelance)',dates:'2011-2017'},
  ]);
  assert.deepEqual(parseCvMdExperience(source), [
    {company:'Freelance',location:''},{company:'Northwind',location:''},
    {company:'Example, Inc.',location:''},{company:'Browser Extensions',location:''},
  ]);
});

test('title checks detect a changed title instead of making an empty comparison', () => {
  const canonical=parseCvExperience(source);
  const tailored=canonical.map(entry=>({...entry}));
  tailored[1].title='Chief Technology Officer';
  const result=checkTitles(canonical,tailored);
  assert.equal(result.matched.length+result.mismatches.length,4);
  assert.equal(result.mismatches.length,1);
});

test('structure checks detect swapped inline experience entries', () => {
  const experience=parseCvExperience(source).map(entry=>({company:entry.company,role:entry.title,dates:entry.dates}));
  assert.equal(verifyStructure({experience},source).verdict,'pass');
  [experience[0],experience[1]]=[experience[1],experience[0]];
  const result=verifyStructure({experience},source);
  assert.equal(result.verdict,'warn');
  assert.ok(result.orderViolations.length);
});

test('ambiguous headings and absent employer labels are not guessed', () => {
  for(const heading of ['### Engineer, 2024-present','### Engineer, Example, not dates','### Notes, Example, 2024','### , Example, 2020-2024','### Engineer, , 2020-2024']) {
    assert.equal(parseRoleFirstHeading(heading),null,heading);
  }
});

test('inline Pandoc headings and legacy company/location headings coexist', () => {
  assert.deepEqual(parseRoleFirstHeading(normalizePandocLine('### **Engineer, Example, 2020 -- Present**')),
    {company:'Example',title:'Engineer',dates:'2020 – Present'});
  const mixed=source.replace('## Education', '### Legacy Co — Lisbon · Research\n\n**Engineer**\n2010-2011\n\n## Education');
  assert.equal(parseCvExperience(mixed).length,5);
  assert.deepEqual(parseCompanyHeading('### Legacy Co — Lisbon · Research'),{company:'Legacy Co',location:'Lisbon · Research'});
});
