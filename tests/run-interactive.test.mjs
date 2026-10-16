import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import { RunTerminal } from '../lib/run-terminal.mjs';
import { RunInteractive } from '../lib/run-interactive.mjs';
import { DEFAULT_MAX_RETRIES, nextLiveInput } from '../lib/run-live-inputs.mjs';

function terminal(t, { color = false } = {}) {
  const input = new PassThrough(), output = new PassThrough();
  input.isTTY = output.isTTY = true; output.columns = 100; output.rows = 25;
  input.setRawMode = raw => { input.isRaw = raw; };
  let text = ''; output.on('data', data => text += data);
  const ui = new RunTerminal({ input, output, color });
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

test('colours preserve clipped Unicode text, cursor placement and terminal sanitisation', t => {
  const plain = terminal(t), colored = terminal(t, { color: true });
  for (const f of [plain, colored]) {
    f.output.columns = 40;
    f.ui.log('[run] scan started');
    f.ui.setQuestion({ key: 'colour', title: 'Agency', question: 'Who is hiring?', position: 1, total: 1, url: A });
    f.ui.draft = [...'Olá 👩‍💻']; f.ui.cursor = f.ui.draft.length;
    f.ui.render();
    f.ui.log('[run:batch-1] ERROR: failed job with a long description\x1b[2J');
  }
  assert.equal(stripVTControlCharacters(colored.text()), stripVTControlCharacters(plain.text()));
  assert.match(colored.text(), /\x1b\[36mscan started\x1b\[0m/);
  assert.match(colored.text(), /\x1b\[1;33mQuestion 1\/1: Agency/);
  assert.match(colored.text(), /\x1b\[1;31mERROR:/);
  assert.ok(!colored.text().includes('\x1b[2J'));
  assert.equal(colored.text().match(/\x1b\[\d+;\d+H\x1b\[\?25h$/)?.[0], plain.text().match(/\x1b\[\d+;\d+H\x1b\[\?25h$/)?.[0]);
});

test('without a question the terminal emits only rolling logs and reserves no footer', t => {
  const f = terminal(t);
  assert.equal(f.text(), '');
  assert.equal(f.ui.footerRows, 0);
  assert.equal(f.ui.logBottom, f.output.rows);
  f.ui.setStatus('3 pending | 2 working | 0 questions');
  f.output.emit('resize');
  assert.equal(f.text(), '', 'status updates and resizing must not paint an idle input area');
  f.ui.log('worker started\nworker progress\x1b[2J');
  assert.equal(f.text(), 'worker started\r\nworker progress\r\n');
  f.ui.error('worker failed');
  assert.ok(f.text().endsWith('Error: worker failed\r\n'), 'errors must remain visible without a question');
  const before = f.text();
  f.ui.close();
  assert.equal(f.text(), before, 'closing a plain log view must not erase its last lines');
  assert.equal(f.input.isRaw, false);
});

test('the last resolved question releases the footer and later questions can reopen it', t => {
  const f = terminal(t);
  const question = { key: 'first', title: 'Agency', question: 'Who is hiring?', position: 1, total: 1, hint: 'Agency + Enter' };
  f.ui.log('ordinary output');
  f.ui.setQuestion(question);
  assert.equal(f.ui.footerRows, 7);
  assert.ok(f.text().includes('Question 1/1: Agency'));
  assert.ok(f.text().includes('Enter: answer'));
  const before = f.text().length;
  f.ui.setQuestion(null);
  assert.equal(f.ui.footerRows, 0);
  const cleanup = f.text().slice(before);
  assert.match(cleanup, /\x1b\[r\x1b\[19;1H\x1b\[J/);
  assert.ok(cleanup.includes('\x1b[?2004l'));
  const cleared = f.text().length;
  f.ui.setStatus('1 pending | 1 working | 0 questions');
  f.ui.setQuestion(null);
  f.output.emit('resize');
  f.ui.log('remaining worker continues');
  assert.equal(f.text().slice(cleared), 'remaining worker continues\r\n');
  f.ui.setQuestion({ ...question, key: 'second', title: 'JD' });
  assert.equal(f.ui.footerRows, 7);
  assert.ok(f.text().slice(cleared).includes('Question 1/1: JD'));
});

test('answer completion does not redraw an input area after its question is removed', async t => {
  const f = terminal(t);
  f.ui.setQuestion({ key: 'a', title: 'Agency', question: 'Who?', position: 1, total: 1,
    submit: async () => { f.ui.setQuestion(null); f.ui.log('answer accepted; worker resumed'); } });
  f.ui.draft = ['A']; f.ui.cursor = 1;
  await f.ui.submit();
  const before = f.text().length;
  await new Promise(resolve => setImmediate(resolve));
  f.ui.setStatus('worker running');
  assert.equal(f.ui.footerRows, 0);
  assert.equal(f.text().slice(before), '');
  assert.ok(f.text().endsWith('answer accepted; worker resumed\r\n'));
});

test('leaving input is acknowledged once in rolling output without opening a footer', t => {
  const userRoot = root(t), f = terminal(t);
  const broker = new RunInteractive({ terminal: f.ui, userRoot, user: 'fictional', summary: { run_id: 'fixture', manual_actions: [] } });
  t.after(() => broker.close());
  f.ui.key('', { ctrl: true, name: 'd' });
  assert.equal(f.text(), 'run | finishing without input; active work will drain.\r\n');
  const before = f.text();
  f.ui.key('', { ctrl: true, name: 'd' });
  assert.equal(f.text(), before);
  assert.equal(f.ui.footerRows, 0);
});

test('empty or whitespace Ctrl+D defers other questions without leaving input or saving an answer', async t => {
  const userRoot = root(t), f = terminal(t);
  writeFileSync(join(userRoot, 'data/pipeline.md'), `## Pending\n- [!] ${A} | confirm agency\n- [!] ${B} | confirm agency\n\n## Processed\n`);
  const broker = new RunInteractive({ terminal: f.ui, userRoot, user: 'fictional', summary: { run_id: 'fixture', manual_actions: [] } });
  t.after(() => broker.close());
  assert.equal(f.ui.question.url, A);
  f.input.write('\x04');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.ui.question.url, B);
  assert.equal(broker.active, true);
  assert.equal(broker.questions.length, 1);
  f.input.write('   \x04');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.ui.question, null);
  assert.equal(broker.active, true);
  assert.equal(broker.questions.length, 0);
  assert.equal(JSON.parse(readFileSync(join(userRoot, 'data/manual-answers.json'))).answers.length, 0);
  assert.doesNotMatch(f.text(), /finishing without input/);
});

test('terminal keeps an editable Unicode draft across progress, resize and bracketed multiline paste', async t => {
  const f = terminal(t); const submitted = [];
  f.ui.setQuestion({ key: 'a', title: 'JD', question: 'Paste text', position: 1, total: 2, multiline: true, submit: text => submitted.push(text) });
  f.input.write('\x1b[200~Role: Engenheiro\r\nBuild applications for Portugal and Europe.\x1b[201~');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(submitted.length, 0, 'pasted newlines must not submit early');
  const draft = f.ui.draft.join('');
  assert.match(draft, /Role: Engenheiro\nBuild/);
  assert.ok(f.text().includes('\x1b[25;1H\x1b[2KEnter: answer | Ctrl+D: JD/empty defer | /later: defer | /finish: drain & exit | Ctrl+C: stop'));
  f.ui.log('worker progress\x1b[2J\rhostile title');
  f.output.columns = 35; f.output.rows = 10; f.output.emit('resize');
  assert.equal(f.ui.draft.join(''), draft);
  for (const rows of [10, 8, 6]) {
    f.output.columns = 80; f.output.rows = rows; f.output.emit('resize');
    assert.ok(f.text().includes(`\x1b[${rows};1H\x1b[2KEnter answer | Ctrl+D JD/empty defer | /finish exit | Ctrl+C stop`), 'shortcuts stay at the bottom after resizing');
    assert.match(f.text(), new RegExp(`\\x1b\\[${rows - 1};\\d+H\\x1b\\[\\?25h$`), 'the cursor stays in the input row above the shortcuts');
  }
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

test('pasted JD tabs survive terminal submission and persistence with sanitized display', async t => {
  const userRoot = root(t), f = terminal(t);
  writeFileSync(join(userRoot, 'data/pipeline.md'), `## Pending\n- [!] ${A} | JD unavailable\n\n## Processed\n`);
  const broker = new RunInteractive({ terminal: f.ui, userRoot, user: 'fictional', summary: { run_id: 'fixture', manual_actions: [] }, onAnswer() {}, onRetry() {} });
  t.after(() => broker.close());
  const jd = 'Role:\tEngineer\nSkills:\tPython\tSQL\nBuild and maintain reliable applications for customers throughout Europe.';
  f.input.write(`\x1b[200~${jd}\x1b[201~`);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.ui.draft.join(''), jd);
  assert.ok(!f.text().includes('\t'), 'the terminal displays sanitized whitespace');
  f.input.write('\x04');
  await new Promise(resolve => setImmediate(resolve));
  const saved = JSON.parse(readFileSync(join(userRoot, 'data/manual-answers.json')));
  assert.equal(saved.answers[0].jd_text, jd, 'the stored evaluation input retains original tabs and word boundaries');
});

test('C1 paste controls cannot hide editable characters or displace the cursor', async t => {
  const f = terminal(t);
  f.ui.setQuestion({ key: 'c1', title: 'JD', question: 'Paste text', position: 1, total: 1, multiline: true, submit() {} });
  const cursorColumn = () => Number([...f.text().matchAll(/\x1b\[\d+;(\d+)H\x1b\[\?25h/g)].at(-1)[1]);
  f.input.write('\x1b[200~ab\u009b2Jcd\x1b[201~');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.ui.draft.join(''), 'ab2Jcd');
  assert.match(stripVTControlCharacters(f.text()), /> ab2Jcd/);
  assert.equal(cursorColumn(), 9, 'the cursor follows the six visible characters and prompt');
  f.input.write('\x1b[D\x7f');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.ui.draft.join(''), 'ab2Jd');
  assert.equal(f.ui.cursor, 4); assert.equal(cursorColumn(), 7);
  f.input.write('\x15');
  f.input.write(`\x1b[200~A${String.fromCodePoint(...Array.from({ length: 32 }, (_, i) => 0x80 + i))}\tB\r\nC\x1b[201~`);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.ui.draft.join(''), 'A\tB\nC', 'all C1 controls are removed while tabs and normalized newlines survive');
  assert.equal(cursorColumn(), 4);
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

test('failed-job prompts accept a durable skip and show its command without retrying', async t => {
  const f = terminal(t), userRoot = root(t);
  writeFileSync(join(userRoot, 'data/pipeline.md'), `## Pending\n- [ ] ${A}\n- [ ] ${B}\n\n## Processed\n`);
  writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `1\t${A}\tfailed\t\t\t001\t-\tstale listing\t9\n2\t${B}\tfailed\t\t\t002\t-\tinterrupted\t9\n`);
  const accepted = [];
  const interactive = new RunInteractive({ terminal: f.ui, userRoot, user: 'fictional', summary: { run_id: 'fixture', manual_actions: [] },
    onAnswer: async answer => accepted.push(answer), onRetry: () => assert.fail('skip must not request another evaluation') });
  t.after(() => interactive.close());
  assert.equal(f.ui.question.reason, 'job_failed');
  assert.match(f.text(), /\/skip: discard job/);
  f.input.write('/skip\r');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(accepted, [{ url: A, reason: 'job_failed', answer: '', resolution: 'skip' }]);
  assert.deepEqual(JSON.parse(readFileSync(join(userRoot, 'data/manual-answers.json'))).answers, accepted);
  assert.equal(f.ui.question.url, B);
  interactive.close();
  const restarted = new RunInteractive({ terminal: f.ui, userRoot, user: 'fictional', summary: { run_id: 'next', manual_actions: [] },
    onAnswer: () => {}, onRetry: () => assert.fail('no retry') });
  t.after(() => restarted.close());
  assert.equal(f.ui.question.url, B, 'persisted skip waits for the batch owner without asking again');
});

test('live owner admits a failed-job skip above its retry ceiling exactly once, but never an active or terminal job', t => {
  const userRoot = root(t);
  const controlPath = join(userRoot, 'control.json'), answersPath = join(userRoot, 'answers.json'), queuePath = join(userRoot, 'queue.txt');
  writeFileSync(controlPath, JSON.stringify({ schema_version: 1, user: 'fictional', owner_pid: process.pid, status: 'open', retries: [] }));
  writeFileSync(join(userRoot, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${A}\t\t\n2\t${B}\t\t\n`);
  writeFileSync(queuePath, A + '\n' + B + '\n');
  const state = status => writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `1\t${A}\t${status}\t\t\t001\t-\terror\t9\n2\t${B}\tfailed\t\t\t002\t-\terror\t9\n`);
  writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [{ url: A, reason: 'job_failed', answer: '', resolution: 'skip' }] }));
  const next = () => nextLiveInput({ controlPath, userRoot, user: 'fictional', answersPath, queuePath });
  for (const status of ['processing', 'completed', 'skipped']) { state(status); assert.equal(next().status, 'idle'); }
  state('failed');
  const selected = next().selected;
  assert.equal(selected.url, A); assert.equal(selected.explicitRetry, false);
  assert.match(selected.token, /^answer:/);
  assert.equal(next().status, 'idle', 'neither the same skip nor unrelated failed jobs dispatch again');
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

test('unchanged footer state does not render, but refreshed callbacks and visible changes do', async t => {
  const f = terminal(t), calls = [];
  const question = { key: 'a', title: 'Agency', question: 'Who?', position: 1, total: 1, hint: 'Enter', submit: () => calls.push('old') };
  f.ui.setStatus('waiting'); f.ui.setQuestion(question);
  const before = f.text();
  f.ui.setStatus('waiting');
  f.ui.setQuestion({ ...question, submit: () => calls.push('new') });
  assert.equal(f.text(), before, 'polls with identical visible content must be silent');
  f.ui.key('Agency', {}); await new Promise(resolve => setImmediate(resolve));
  await f.ui.submit(); assert.deepEqual(calls, ['new']);
  let previous = f.text();
  for (const change of [{ total: 2 }, { position: 2 }, { hint: 'Updated instructions' }, { question: 'Updated question' }, { title: 'Updated title' }, { url: A }, { multiline: true }]) {
    Object.assign(question, change); f.ui.setQuestion({ ...question });
    assert.notEqual(f.text(), previous); previous = f.text();
  }
});

test('broker keeps the active multiline question when source or reordered job questions arrive', t => {
  const userRoot = root(t), f = terminal(t);
  writeFileSync(join(userRoot, 'data/pipeline.md'), `## Pending\n- [!] ${A} | JD unavailable\n\n## Processed\n`);
  const summary = { run_id: 'fixture', manual_actions: [] };
  const broker = new RunInteractive({ terminal: f.ui, userRoot, user: 'fictional', summary, onAnswer() {}, onRetry() {} });
  t.after(() => broker.close());
  f.ui.key('Draft job description\nStill editing', {});
  const key = f.ui.question.key, draft = f.ui.draft.join('');
  summary.manual_actions.unshift({ kind: 'source', phase: 'scan', reason: 'source_login', question: 'Log in' });
  broker.refresh();
  assert.equal(f.ui.question.key, key); assert.equal(f.ui.draft.join(''), draft);
  writeFileSync(join(userRoot, 'data/pipeline.md'), `## Pending\n- [!] ${B} | confirm agency\n- [!] ${A} | JD unavailable\n\n## Processed\n`);
  broker.refresh();
  assert.equal(f.ui.question.key, key); assert.equal(f.ui.draft.join(''), draft);
  assert.equal(f.ui.question.total, 3); assert.equal(f.ui.question.position, 3);
});

test('live selection excludes active processes and pins one posting ID across mixed duplicate states', t => {
  const userRoot = root(t), controlPath = join(userRoot, 'control.json'), answersPath = join(userRoot, 'answers.json'), queuePath = join(userRoot, 'queue.txt');
  writeFileSync(controlPath, JSON.stringify({ schema_version: 1, user: 'fictional', owner_pid: process.pid, status: 'open', retries: [] }));
  writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [] }));
  writeFileSync(queuePath, `${A}\n${B}\n`);
  writeFileSync(join(userRoot, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${A}\t\t\n2\t${A}\tduplicate\t\n3\t${B}\t\t\n`);
  const next = options => nextLiveInput({ controlPath, userRoot, user: 'fictional', answersPath, queuePath, ...options });
  assert.equal(next().selected.id, '1');
  writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `1\t${A}\tfailed\t\t\t\t\t\t1\n2\t${A}\tfailed\t\t\t\t\t\t0\n`);
  assert.equal(next({ activeUrls: [A], running: 1, capacity: 2 }).selected.url, B);
  assert.equal(next({ activeUrls: [A] }).status, 'idle');
  assert.equal(next().selected.id, '1', 'reap releases the canonical ID only');
  assert.equal(next().status, 'idle', 'different automatic tokens on a duplicate ID cannot bypass canonical ownership');
  for (const status of ['completed', 'skipped', 'processing']) {
    writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `1\t${A}\tfailed\t\t\t\t\t\t1\n2\t${A}\t${status}\t\t\t\t\t\t0\n`);
    writeFileSync(controlPath, JSON.stringify({ schema_version: 1, user: 'fictional', owner_pid: process.pid, status: 'open', retries: [{ url: A, token: status }] }));
    assert.equal(next().status, 'idle', `${status} on another ID protects the entire posting`);
  }
});

test('broker failure questions use the selector default retry ceiling', t => {
  const userRoot = root(t), f = terminal(t);
  writeFileSync(join(userRoot, 'data/pipeline.md'), `## Pending\n- [ ] ${A}\n- [ ] ${B}\n\n## Processed\n`);
  writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `1\t${A}\tfailed\t\t\t\t\t\t${DEFAULT_MAX_RETRIES - 1}\n2\t${B}\tfailed\t\t\t\t\t\t${DEFAULT_MAX_RETRIES}\n`);
  const broker = new RunInteractive({ terminal: f.ui, userRoot, user: 'fictional', summary: { run_id: 'fixture', manual_actions: [] }, onAnswer() {}, onRetry() {} });
  t.after(() => broker.close());
  assert.deepEqual(broker.questions.map(item => item.url), [B]);
});

test('invalid historical IDs cannot claim canonical ownership before valid duplicate rows', t => {
  const userRoot = root(t), controlPath = join(userRoot, 'control.json'), answersPath = join(userRoot, 'answers.json'), queuePath = join(userRoot, 'queue.txt');
  writeFileSync(controlPath, JSON.stringify({ schema_version: 1, user: 'fictional', owner_pid: process.pid, status: 'open', retries: [] }));
  writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [] }));
  writeFileSync(queuePath, A + '\n');
  const input = join(userRoot, 'batch/batch-input.tsv');
  writeFileSync(input, `id\turl\tsource\tnotes\nold-import\t${A}\t\t\n2\t${A}\tvalid\t\n`);
  const next = () => nextLiveInput({ controlPath, userRoot, user: 'fictional', answersPath, queuePath });
  assert.equal(next().selected.id, '2'); assert.equal(next().status, 'idle');
  writeFileSync(input, `id\turl\tsource\tnotes\n1\t${A}\tnew duplicate\t\n2\t${A}\tvalid\t\n`);
  writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `2\t${A}\tfailed\t\t\t\t\t\t1\n`);
  assert.equal(next().selected.id, '2', 'later input changes cannot override the ledger-pinned valid identity');
  assert.equal(next().status, 'idle');
});

test('a duplicate ID cannot bypass an unanswered hold and exact answers resume the held identity', t => {
  for (const reason of ['agency_confirmation', 'jd_unavailable']) {
    const userRoot = root(t), controlPath = join(userRoot, 'control.json'), answersPath = join(userRoot, 'answers.json'), queuePath = join(userRoot, 'queue.txt');
    const control = { schema_version: 1, user: 'fictional', owner_pid: process.pid, status: 'open', retries: [] };
    writeFileSync(controlPath, JSON.stringify(control)); writeFileSync(queuePath, `${A}\n${B}\n`);
    const writeAnswers = answers => writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers }));
    writeAnswers([]);
    writeFileSync(join(userRoot, 'batch/batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${A}\told\t\n2\t${A}\theld\t\n3\t${B}\tindependent\t\n`);
    const state = (first = 'failed', held = 'needs_confirmation', retries = 1) => writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header +
      `1\t${A}\t${first}\t\t\t\t\t\t1\n2\t${A}\t${held}\t\t\t\t\t\t${retries}\n`);
    state(); hold(userRoot, '2', A, reason);
    const next = options => nextLiveInput({ controlPath, userRoot, user: 'fictional', answersPath, queuePath, ...options });
    assert.equal(next().selected.url, B, 'independent work passes the held duplicate');
    writeFileSync(queuePath, A + '\n');
    assert.equal(next().status, 'idle');
    state('pending'); assert.equal(next().status, 'idle', 'a pending duplicate also cannot bypass the hold');
    control.retries = [{ url: A, token: 'explicit' }]; writeFileSync(controlPath, JSON.stringify(control));
    assert.equal(next({ retryFailed: true, resumePaused: true }).status, 'idle', 'retry flags never answer a hold');
    writeAnswers([{ url: B, reason, answer: 'Wrong posting', ...(reason === 'jd_unavailable' ? { jd_text: 'Wrong posting JD' } : {}) }]);
    assert.equal(next().status, 'idle');
    writeAnswers([{ url: A, reason: reason === 'agency_confirmation' ? 'jd_unavailable' : 'agency_confirmation', answer: 'Wrong reason', jd_text: 'Unrelated JD' }]);
    assert.equal(next().status, 'idle');
    const answer = { url: A, reason, answer: 'Exact answer', ...(reason === 'jd_unavailable' ? { jd_text: 'Build reliable applications for a fictional employer in Europe.' } : {}) };
    writeAnswers([answer]);
    assert.equal(next({ activeUrls: [A] }).status, 'idle', 'the hold publisher must exit first');
    const selected = next().selected;
    assert.equal(selected.id, '2'); assert.equal(selected.resetHold, true);
    assert.equal(next().status, 'idle', 'the same answer cannot be consumed again');
    control.retries = []; writeFileSync(controlPath, JSON.stringify(control));
    state('pending', 'failed', 1);
    assert.equal(next().selected.id, '2', 'follow-up failure retries stay under the held identity');
    state('pending', 'completed'); assert.equal(next().status, 'idle', 'completed held identity protects the whole URL');
  }
});

test('conflicting held identities stop explicitly instead of silently dispatching another ID', t => {
  const userRoot = root(t), controlPath = join(userRoot, 'control.json'), answersPath = join(userRoot, 'answers.json'), queuePath = join(userRoot, 'queue.txt');
  writeFileSync(controlPath, JSON.stringify({ schema_version: 1, user: 'fictional', owner_pid: process.pid, status: 'open', retries: [] }));
  writeFileSync(answersPath, JSON.stringify({ schema_version: 1, user: 'fictional', answers: [] }));
  writeFileSync(queuePath, A + '\n');
  const input = join(userRoot, 'batch/batch-input.tsv');
  writeFileSync(input, `id\turl\tsource\tnotes\n1\t${A}\t\t\n2\t${A}\t\t\n`);
  writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `1\t${A}\tneeds_confirmation\t\t\t\t\t\t0\n2\t${A}\tneeds_confirmation\t\t\t\t\t\t0\n`);
  const next = options => nextLiveInput({ controlPath, userRoot, user: 'fictional', answersPath, queuePath, ...options });
  assert.throws(next, /Conflicting confirmation identities/);
  writeFileSync(join(userRoot, 'batch/batch-state.tsv'), header + `2\t${A}\tneeds_confirmation\t\t\t\t\t\t0\n`);
  writeFileSync(`${controlPath}.dispatch.json`, JSON.stringify([{ id: '1', url: A, token: 'initial', answer_token: null }]));
  assert.throws(next, /Conflicting confirmation identities/, 'already-dispatched identity cannot silently change');
  writeFileSync(`${controlPath}.dispatch.json`, '[]');
  writeFileSync(input, `id\turl\tsource\tnotes\n1\t${A}\t\t\n`);
  assert.throws(next, /Conflicting confirmation identities/, 'held ID must exist in the input');
  assert.equal(next({ activeUrls: [A] }).status, 'idle', 'in-flight publication keeps the posting unavailable');
});
