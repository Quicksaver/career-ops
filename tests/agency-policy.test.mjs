import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAgencyPolicy, prepareAgencyAnswers, AGENCY_POLICY_ANSWER } from '../lib/agency-policy.mjs';
import { fixture } from './fixtures/run-workflow.mjs';

const A = 'https://jobs.example.org/alpha', B = 'https://jobs.example.org/beta';
const enable = f => writeFileSync(join(f.user, 'config/profile.yml'), 'batch:\n  agency_confirmation: posting_evidence\n');
const saved = f => JSON.parse(f.read('data/manual-answers.json'));

test('the default keeps the per-posting agency gate without creating answers', t => {
  const f = fixture(t, { rows: [`- [!] ${A} | confirm agency`] });
  assert.equal(readAgencyPolicy(f.user), 'required');
  assert.equal(prepareAgencyAnswers({ userRoot: f.user, user: 'fictional' }), undefined);
  assert.equal(existsSync(join(f.user, 'data/manual-answers.json')), false);
  writeFileSync(join(f.user, 'config/profile.yml'), 'batch:\n  agency_confirmation: false\n');
  assert.throws(() => readAgencyPolicy(f.user), /must be required or posting_evidence/);
});

test('standing authorization applies to agency holds, preserves explicit answers and leaves JD questions unanswered', t => {
  const f = fixture(t, { rows: [`- [!] ${A} | confirm agency`, `- [!] ${B} | JD unavailable`] });
  enable(f);
  const input = join(f.root, 'explicit.json');
  const explicit = JSON.stringify({ schema_version: 1, user: 'fictional', answers: [{ url: B, reason: 'agency_confirmation', answer: 'An explicitly named agency.' }] });
  writeFileSync(input, explicit);
  const path = prepareAgencyAnswers({ userRoot: f.user, user: 'fictional', answersFile: input });
  assert.equal(path, join(f.user, 'data/manual-answers.json'));
  assert.equal(readFileSync(input, 'utf8'), explicit, 'automation input is read-only');
  assert.deepEqual(saved(f).answers.find(a => a.url === A), { url: A, reason: 'agency_confirmation', answer: AGENCY_POLICY_ANSWER, source: 'standing_policy' });
  assert.equal(saved(f).answers.find(a => a.url === B).answer, 'An explicitly named agency.');
  assert.ok(!saved(f).answers.some(a => a.reason === 'jd_unavailable'));
  prepareAgencyAnswers({ userRoot: f.user, user: 'fictional' });
  assert.equal(saved(f).answers.length, 2, 'restart is idempotent');
});

test('explicit corrections win and terminal jobs never acquire policy answers', t => {
  const f = fixture(t, { rows: [`- [!] ${A} | confirm agency`, `- [!] ${B} | confirm agency`] });
  enable(f);
  writeFileSync(join(f.user, 'data/manual-answers.json'), JSON.stringify({ schema_version: 1, user: 'fictional', answers: [{ url: A, reason: 'agency_confirmation', answer: 'This is direct.', direct_employer: true }] }));
  writeFileSync(join(f.user, 'batch/batch-state.tsv'), `id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n2\t${B}\tcompleted\t-\t-\t002\t4\t-\t0\n`);
  prepareAgencyAnswers({ userRoot: f.user, user: 'fictional' });
  assert.equal(saved(f).answers.length, 1);
  assert.equal(saved(f).answers[0].direct_employer, true);
});

test('another user\'s hold cannot be authorized and no answer file is written', t => {
  const f = fixture(t, { rows: [A] });
  enable(f);
  writeFileSync(join(f.user, 'batch/batch-state.tsv'), `id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n1\t${A}\tneeds_confirmation\t-\t-\t-\t-\t-\t0\n`);
  writeFileSync(join(f.user, 'batch/logs/1.hold.json'), JSON.stringify({ schema_version: 1, user: 'someone-else', id: '1', url: A, status: 'needs_confirmation', reason: 'agency_confirmation', question: 'Which agency?', score: null, legitimacy: null, via: null, company_confidential: null, pdf: null, report: null, tracker: null, error: null }));
  assert.throws(() => prepareAgencyAnswers({ userRoot: f.user, user: 'fictional' }), /Invalid confirmation hold identity/);
  assert.equal(existsSync(join(f.user, 'data/manual-answers.json')), false);
});

test('headless restart resumes a persisted exact-identity agency hold but retains a missing-JD hold', async t => {
  const f = fixture(t, { rows: [A, `- [!] ${B} | JD unavailable`], holds: { [A]: 'agency_confirmation' } });
  const first = await f.run(['--skip-scan']);
  assert.ok(first.result.manual_actions.some(a => a.url === A && a.reason === 'agency_confirmation'));
  enable(f);
  const result = await f.run(['--skip-scan']);
  assert.equal(result.code, 2);
  assert.ok(!result.result.manual_actions.some(a => a.url === A));
  assert.ok(result.result.manual_actions.some(a => a.url === B && a.reason === 'jd_unavailable'));
  assert.deepEqual(f.dispatched(), [A, A]);
  assert.equal(saved(f).answers[0].source, 'standing_policy');
});

test('interactive restart restores an agency-blocked row without showing its confirmation question', async t => {
  const f = fixture(t, { rows: [`- [!] ${A} | confirm agency`], holds: { [A]: 'agency_confirmation' } });
  enable(f);
  const result = await f.startInteractive().completion;
  assert.equal(result.code, 0, result.output.slice(-5000));
  assert.deepEqual(f.dispatched(), [A]);
  assert.ok(!result.output.includes('Agency name + Enter'));
  assert.equal(saved(f).answers[0].source, 'standing_policy');
});
