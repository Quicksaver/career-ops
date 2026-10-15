import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixtures/run-workflow.mjs';
import { spawnSync } from 'node:child_process';

const A = 'https://jobs.example.org/alpha', B = 'https://jobs.example.org/beta', C = 'https://jobs.example.org/charlie';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (predicate()) return; await delay(25); }
  assert.fail(message);
}
const actions = f => existsSync(join(f.user, 'data/manual-actions.json')) ? JSON.parse(f.read('data/manual-actions.json')).actions : [];

test('interactive run accepts sequential questions and resumes a job while another worker is busy', async t => {
  const f = fixture(t, { rows: [A, B, C], holds: { [A]: 'agency_confirmation', [B]: 'jd_unavailable' }, waitFor: [C] });
  const run = f.startInteractive(['--skip-scan', '--parallel', '3']);
  await until(() => actions(f).some(item => item.url === A), 'agency question never appeared');
  await until(() => run.output().includes('Agency name + Enter'), 'question was not presented in footer');
  run.send('Fictional Recruiting\r');
  await until(() => f.records('completed.jsonl').some(item => item.url === A), 'answered job did not resume in the current pool');
  assert.ok(!f.records('completed.jsonl').some(item => item.url === C), 'answer must be consumed before the slow independent worker finishes');
  assert.ok(actions(f).some(item => item.url === B), 'the second question remains pending');
  run.send('\x1b[200~Engineer role\r\nBuild and maintain reliable systems for customers throughout Europe.\x1b[201~');
  await delay(50);
  assert.equal(JSON.parse(f.read('data/manual-answers.json')).answers.length, 1, 'paste must wait for explicit submission');
  run.send('\x04');
  writeFileSync(join(f.user, 'release-live-workers'), 'release');
  const result = await run.completion;
  assert.equal(result.code, 0, result.output.slice(-8000));
  assert.equal(result.result.status, 'completed');
  const saved = JSON.parse(f.read('data/manual-answers.json'));
  assert.deepEqual(saved.answers.map(item => [item.url, item.reason]), [[A, 'agency_confirmation'], [B, 'jd_unavailable']]);
  assert.match(saved.answers[1].jd_text, /Engineer role\nBuild/);
  assert.equal(f.calls().filter(item => item.phase === 'batch-mock').length, 1, 'one authoritative batch pool consumes live answers');
});

test('idle run waits for input, defers cleanly, and asks again after restart', async t => {
  const f = fixture(t, { rows: [`- [!] ${A} | JD unavailable`] });
  const first = f.startInteractive();
  await until(() => first.output().includes('Paste JD + Ctrl+D'), 'idle question never appeared');
  await delay(200); assert.equal(first.child.exitCode, null);
  first.send('/later\r');
  const deferred = await first.completion;
  assert.equal(deferred.code, 2, deferred.output.slice(-4000));
  assert.equal(deferred.result.final_blocked, 1);
  const second = f.startInteractive();
  await until(() => second.output().includes('Paste JD + Ctrl+D'), 'deferred question was lost');
  second.send('https://employer.example.org/jobs/original\r');
  const resumed = await second.completion;
  assert.equal(resumed.code, 0, resumed.output.slice(-6000));
  assert.equal(resumed.result.remaining, 0);
});

test('Ctrl+D leaves idle input with holds intact and terminal cleanup emitted', async t => {
  const f = fixture(t, { rows: [`- [!] ${A} | confirm agency`] });
  const run = f.startInteractive();
  await until(() => run.output().includes('Agency name + Enter'), 'question never appeared');
  run.send('\x04');
  const result = await run.completion;
  assert.equal(result.code, 2, result.output.slice(-4000));
  assert.equal(result.result.manual_actions[0].url, A);
  assert.match(result.output, /\x1b\[\?2004l/);
  assert.equal(JSON.parse(f.read('data/manual-answers.json')).answers.length, 0);
});

test('a blocked historical batch row cannot dispatch before its exact answer', async t => {
  const f = fixture(t, { rows: [B, `- [!] ${A} | confirm agency`], waitFor: [B] });
  writeFileSync(join(f.user, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${A}\told\t\n`);
  const run = f.startInteractive(['--skip-scan', '--parallel', '2']);
  await until(() => f.dispatched().includes(B), 'independent job did not start');
  assert.ok(!f.dispatched().includes(A), 'raw blocked row must not enter the live queue');
  run.send('/direct\r');
  await until(() => f.dispatched().includes(A), 'answered historical row did not resume');
  writeFileSync(join(f.user, 'release-live-workers'), 'release');
  const result = await run.completion;
  assert.equal(result.code, 0, result.output.slice(-5000));
});

test('the first answer starts work while a second initially blocked question remains unanswered', async t => {
  const f = fixture(t, { rows: [`- [!] ${A} | confirm agency`, `- [!] ${B} | JD unavailable`] });
  const run = f.startInteractive();
  await until(() => run.output().includes('Agency name + Enter'), 'first idle question never appeared');
  run.send('/direct\r');
  await until(() => f.records('completed.jsonl').some(item => item.url === A), 'first answer waited for every other question');
  assert.ok(!f.dispatched().includes(B));
  run.send('/later\r');
  const result = await run.completion;
  assert.equal(result.code, 2, result.output.slice(-5000));
  assert.equal(result.result.remaining, 1);
});

test('login retry runs alongside independent batch work and clears the resolved action', async t => {
  const f = fixture(t, { login: true, waitFor: [A] });
  const run = f.startInteractive([]);
  await until(() => f.calls().some(item => item.phase === 'batch-mock'), 'independent batch did not start');
  await until(() => run.output().includes('source login'), 'login question never appeared');
  writeFileSync(join(f.user, 'fixture.json'), JSON.stringify({ login: false }));
  run.send('retry\r');
  await until(() => f.calls().filter(item => item.phase === 'scan-auth').length === 2, 'login answer did not rerun the source');
  assert.ok(!f.records('completed.jsonl').length, 'source retry should not wait for the independent job');
  writeFileSync(join(f.user, 'release-live-workers'), 'release');
  const result = await run.completion;
  assert.equal(result.code, 0, result.output.slice(-7000));
  assert.equal(result.result.manual_actions.length, 0);
});

test('verification recheck waits for an explicit correction and reruns the verifier', async t => {
  const f = fixture(t, { rows: [], review: true });
  const run = f.startInteractive();
  await until(() => run.output().includes('integrity review'), 'verification question never appeared');
  writeFileSync(join(f.user, 'fixture.json'), JSON.stringify({ review: false }));
  run.send('retry\r');
  const result = await run.completion;
  assert.equal(result.code, 0, result.output.slice(-5000));
  assert.equal(f.calls().filter(item => item.phase === 'verify-runner').length, 2);
});

test('saved terminal answers are reused on restart without reopening the prompt', async t => {
  const f = fixture(t, { rows: [`- [!] ${A} | confirm agency`] });
  writeFileSync(join(f.user, 'data/manual-answers.json'), JSON.stringify({ schema_version: 1, user: 'fictional', answers: [{ url: A, reason: 'agency_confirmation', answer: 'Fictional agency' }] }));
  const run = f.startInteractive();
  const result = await run.completion;
  assert.equal(result.code, 0, result.output.slice(-4000));
  assert.deepEqual(f.dispatched(), [A]);
  assert.ok(!result.output.includes('Agency name + Enter'), 'already-supplied exact answer should dispatch without a second question');
});

test('Ctrl+C stops active work, restores the terminal and releases coordinator ownership', async t => {
  const f = fixture(t, { waitFor: [A] });
  const run = f.startInteractive();
  await until(() => f.dispatched().includes(A), 'worker never started');
  run.send('\x03');
  const result = await run.completion;
  assert.equal(result.code, 130, result.output.slice(-5000));
  assert.equal(result.result.status, 'interrupted');
  assert.match(result.output, /\x1b\[\?2004l/);
  assert.equal(existsSync(join(f.user, 'data/run-workflow.pid')), false);
  assert.ok(result.result.remaining > 0, 'unfinished job remains durable');
});

test('quota retry submitted before the remaining worker drains is retained and resumes afterwards', async t => {
  const f = fixture(t, { rows: [A, B], quota: true, waitFor: [B] });
  const run = f.startInteractive(['--skip-scan', '--parallel', '2']);
  await until(() => run.output().includes('rate limit') && f.dispatched().includes(B), 'quota prompt did not coexist with independent work');
  writeFileSync(join(f.user, 'quota-resolved'), 'resolved');
  run.send('retry\r');
  await delay(100);
  assert.equal(f.calls().filter(item => item.phase === 'batch-mock').length, 1, 'quota retry must wait for the owning pool to drain');
  writeFileSync(join(f.user, 'release-live-workers'), 'release');
  const result = await run.completion;
  assert.equal(result.code, 0, result.output.slice(-7000));
  assert.equal(f.calls().filter(item => item.phase === 'batch-mock').length, 2);
  assert.equal(f.dispatched().filter(url => url === A).length, 2);
});

test('a verification recheck cannot renew the per-run unique job limit', async t => {
  const f = fixture(t, { rows: [A, B], review: true });
  const run = f.startInteractive(['--skip-scan', '--limit', '1']);
  await until(() => run.output().includes('integrity review'), 'verification question never appeared');
  writeFileSync(join(f.user, 'fixture.json'), JSON.stringify({ review: false }));
  run.send('retry\r');
  const result = await run.completion;
  assert.equal(result.code, 2, result.output.slice(-5000));
  assert.deepEqual(f.dispatched(), [A]);
  assert.equal(result.result.remaining, 1);
});

test('a verification recheck cannot redispatch a deferred hold with an already-consumed answer', async t => {
  const f = fixture(t, { holds: { [A]: 'agency_confirmation' }, stickyHolds: true, review: true });
  const run = f.startInteractive();
  await until(() => run.output().includes('Agency name + Enter'), 'agency question never appeared');
  run.send('Fictional agency\r');
  await until(() => f.dispatched().length === 2 && actions(f).some(item => item.url === A), 'worker did not re-hold the supplied answer');
  await delay(300);
  run.send('/later\r');
  await until(() => run.output().includes('integrity review'), 'verification question never appeared');
  writeFileSync(join(f.user, 'fixture.json'), JSON.stringify({ review: false, holds: { [A]: 'agency_confirmation' }, stickyHolds: true }));
  run.send('retry\r');
  const result = await run.completion;
  assert.equal(result.code, 2, result.output.slice(-6000));
  assert.equal(f.dispatched().length, 2, 'an unrelated recheck cannot renew an already-consumed answer');
});

test('explicit interactive mode rejects non-terminal and JSON invocations', async t => {
  const f = fixture(t, { rows: [] });
  const result = spawnSync(process.execPath, [join(f.root, 'run-workflow.mjs'), '--user', 'fictional', '--interactive'], { cwd: f.root, env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /requires an input\/output terminal/);
});
