import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import { RunTerminal } from '../lib/run-terminal.mjs';
import { RunInteractive } from '../lib/run-interactive.mjs';
import { nextLiveInput } from '../lib/run-live-inputs.mjs';

function terminal(t) {
  const input = new PassThrough(), output = new PassThrough();
  input.isTTY = output.isTTY = true; output.columns = 100; output.rows = 25;
  input.setRawMode = raw => { input.isRaw = raw; };
  let text = ''; output.on('data', data => text += data);
  const ui = new RunTerminal({ input, output });
  t.after(() => ui.close());
  return { ui, input, output, text: () => text };
}
function root(t) {
  const path = mkdtempSync(join(tmpdir(), 'run-interactive-test-'));
  for (const dir of ['data', 'batch/logs']) mkdirSync(join(path, dir), { recursive: true });
  writeFileSync(join(path, 'data/pipeline.md'), '## Pending\n\n## Processed\n');
  t.after(() => rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return path;
}
const A = 'https://example.org/jobs/a', B = 'https://example.org/jobs/b';
const header = 'id\turl\tstatus\tstarted\tcompleted\treport\tscore\terror\tretries\n';
function hold(path, id, url, reason = 'agency_confirmation') {
  writeFileSync(join(path, `batch/logs/${id}.hold.json`), JSON.stringify({ schema_version: 1, user: 'fictional', id, url, status: 'needs_confirmation', reason, question: 'Please provide the employer.', company: '', role: '', score: null, legitimacy: null, via: null, company_confidential: null, pdf: null, report: null, tracker: null, error: null }));
}

test('terminal keeps an editable Unicode draft across progress, resize and bracketed multiline paste', async t => {
  const f = terminal(t); const submitted = [];
  f.ui.setQuestion({ key: 'a', title: 'JD', question: 'Paste text', position: 1, total: 2, multiline: true, submit: text => submitted.push(text) });
  f.input.write('\x1b[200~Role: Engenheiro\r\nBuild applications for Portugal and Europe.\x1b[201~');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(submitted.length, 0, 'pasted newlines must not submit early');
  const draft = f.ui.draft.join('');
  assert.match(draft, /Role: Engenheiro\nBuild/);
  f.ui.log('worker progress\x1b[2J\rhostile title');
  f.output.columns = 35; f.output.rows = 10; f.output.emit('resize');
  assert.equal(f.ui.draft.join(''), draft);
  f.input.write('\x04');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(submitted, [draft]);
  assert.match(stripVTControlCharacters(f.text()), /worker progress/);
  f.ui.close();
  assert.equal(f.input.isRaw, false);
  assert.match(f.text(), /\x1b\[\?2004l/);
});

test('broker persists exact answers and defers one question without losing the next', async t => {
  const userRoot = root(t), f = terminal(t);
  writeFileSync(join(userRoot, 'data/pipeline.md'), `## Pending\n- [!] ${A} | confirm agency\n- [!] ${B} | JD unavailable\n\n## Processed\n`);
  const summary = { run_id: 'fixture', manual_actions: [] }; const restored = [];
  const broker = new RunInteractive({ terminal: f.ui, userRoot, user: 'fictional', summary, onAnswer: answer => restored.push(answer.url), onRetry() {} });
  t.after(() => broker.close());
  const first = broker.questions[0];
  await broker.submit(first, '/direct');
  assert.equal(broker.questions.length, 1);
  assert.equal(broker.questions[0].url, B);
  await assert.rejects(broker.submit(broker.questions[0], 'yes'), /Paste the job description/);
  await broker.submit(broker.questions[0], '/later');
  assert.equal(broker.questions.length, 0);
  const saved = JSON.parse(readFileSync(join(userRoot, 'data/manual-answers.json')));
  assert.equal(saved.user, 'fictional'); assert.equal(saved.answers[0].url, A);
  assert.equal(saved.answers[0].direct_employer, true); assert.deepEqual(restored, [A]);
  broker.close();
  const next = new RunInteractive({ terminal: f.ui, userRoot, user: 'fictional', summary: { ...summary, manual_actions: [] }, onAnswer() {}, onRetry() {} });
  t.after(() => next.close());
  assert.deepEqual(next.questions.map(item => item.url), [B], 'deferred input is asked again after restart');
});

test('live scheduling uses exact queue/answer identity, bounded retries, terminal states and owner liveness', t => {
  const userRoot = root(t);
  const controlPath = join(userRoot, 'control.json'), answersPath = join(userRoot, 'answers.json'), queuePath = join(userRoot, 'queue.txt');
  const writeControl = retries => writeFileSync(controlPath, JSON.stringify({ schema_version: 1, user: 'fictional', owner_pid: process.pid, status: 'open', retries }));
  const writeAnswers = answers => writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers }));
  writeControl([]); writeAnswers([]); writeFileSync(queuePath, A + '\n');
  writeFileSync(join(userRoot, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${A}\t\t\n2\t${B}\told\t\n`);
  writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `1\t${A}\tneeds_confirmation\t\t\t\t\t\t0\n`);
  hold(userRoot, '1', A);
  const next = () => nextLiveInput({ controlPath, userRoot, user: 'fictional', answersPath, queuePath });
  assert.equal(next().status, 'idle');
  writeAnswers([{ url: B, reason: 'agency_confirmation', answer: 'Agency B' }]); assert.equal(next().status, 'idle');
  writeAnswers([{ url: A, reason: 'jd_unavailable', answer: 'JD', jd_text: 'Some JD' }]); assert.equal(next().status, 'idle');
  writeAnswers([{ url: A, reason: 'agency_confirmation', answer: 'Agency A' }]);
  assert.equal(next().selected.url, A); assert.equal(next().status, 'idle', 'identical answer cannot repeatedly release a hold');
  writeAnswers([{ url: A, reason: 'agency_confirmation', answer: 'Corrected agency' }]); assert.equal(next().selected.url, A);
  writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `1\t${A}\tfailed\t\t\t\t\t\t9\n`);
  assert.equal(next().status, 'idle'); writeControl([{ url: A, token: 'explicit-1' }]);
  assert.equal(next().selected.explicitRetry, true); assert.equal(next().status, 'idle');
  writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `1\t${A}\tcompleted\t\t\t\t\t\t9\n`);
  writeControl([{ url: A, token: 'explicit-2' }]); assert.equal(next().status, 'idle');
  const invalid = JSON.parse(readFileSync(controlPath)); invalid.owner_pid = 2147483000; writeFileSync(controlPath, JSON.stringify(invalid));
  assert.throws(next, /coordinator exited/);
});

test('live retries stop at the ceiling, scope explicit requests, and count limits by unique posting', t => {
  const userRoot = root(t);
  const controlPath = join(userRoot, 'control.json'), answersPath = join(userRoot, 'answers.json'), queuePath = join(userRoot, 'queue.txt');
  const control = { schema_version: 1, user: 'fictional', owner_pid: process.pid, status: 'open', retries: [] };
  writeFileSync(controlPath, JSON.stringify(control));
  writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [] }));
  writeFileSync(queuePath, A + '\n' + B + '\n');
  writeFileSync(join(userRoot, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${A}\t\t\n2\t${B}\t\t\n`);
  const state = (a, b) => writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `1\t${A}\tfailed\t\t\t\t\t\t${a}\n2\t${B}\tfailed\t\t\t\t\t\t${b}\n`);
  const next = options => nextLiveInput({ controlPath, userRoot, user: 'fictional', answersPath, queuePath, limit: 1, ...options });
  state(1, 9); assert.equal(next().selected.url, A);
  state(2, 9); assert.equal(next().status, 'idle', 'automatic attempts stop at the retry ceiling');
  control.retries = [{ url: A, token: 'requested' }]; writeFileSync(controlPath, JSON.stringify(control));
  assert.equal(next().selected.url, A); assert.equal(next().status, 'idle', 'a retry token authorizes one attempt');
  state(3, 1); assert.equal(next().status, 'idle', 'retrying A did not consume a new posting or admit B beyond the unique-job limit');
  control.status = 'finish'; writeFileSync(controlPath, JSON.stringify(control));
  assert.equal(next().status, 'done');
  assert.equal(next({ running: 1, capacity: 1 }).status, 'busy', 'finish drains running workers');
});

test('duplicate historical input IDs cannot dispatch the same posting twice in the live pool', t => {
  const userRoot = root(t);
  const controlPath = join(userRoot, 'control.json'), answersPath = join(userRoot, 'answers.json'), queuePath = join(userRoot, 'queue.txt');
  writeFileSync(controlPath, JSON.stringify({ schema_version: 1, user: 'fictional', owner_pid: process.pid, status: 'open', retries: [] }));
  writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [] }));
  writeFileSync(queuePath, A + '\n');
  writeFileSync(join(userRoot, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${A}\t\t\n2\t${A}\told\t\n`);
  const next = () => nextLiveInput({ controlPath, userRoot, user: 'fictional', answersPath, queuePath });
  assert.equal(next().selected.id, '1');
  assert.equal(next().status, 'idle');
});
