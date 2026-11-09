import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const CHANNEL = pathToFileURL(join(ROOT, 'lib/run-agent-channel.mjs')).href;

// A stand-in coordinator: the real AgentTerminal with a stub question engine
// in place of RunInteractive, so the test exercises the file channel and the
// run-agent.mjs CLI without a pipeline. Each accepted answer is logged.
const HOST = `
import { AgentTerminal } from ${JSON.stringify(CHANNEL)};
const [userRoot, runDir, idleMs] = process.argv.slice(2);
const terminal = new AgentTerminal({ userRoot, user: 'fixture', runId: 'run-1', runDir, idleMs: Number(idleMs), pollMs: 50,
  write: line => process.stdout.write(line + '\\n') });
const interactive = {
  active: true,
  questions: [
    { key: 'job:a', kind: 'job', phase: 'batch', reason: 'jd_unavailable', url: 'https://example.com/jobs/1', question: 'JD missing' },
    { key: 'verify:b', kind: 'verification', phase: 'verification', reason: 'possible_duplicate_tracker', question: 'Possible duplicates: #1, #2' },
  ],
  async submit(question, text) {
    if (text === 'bad') throw new Error('Type retry after correcting the issue, or /later to defer.');
    process.stdout.write('ANSWER ' + question.key + ' ' + JSON.stringify(text) + '\\n');
    this.questions = this.questions.filter(item => item !== question);
    terminal.setQuestion();
  },
};
terminal.on('leave', () => {
  interactive.active = false;
  process.stdout.write('LEAVE\\n');
  clearInterval(statusTimer);
  terminal.close();
});
terminal.attach(interactive);
const statusTimer = setInterval(() => terminal.setStatus('1 pending | 0 working | ' + interactive.questions.length + ' questions'), 50);
`;

function cli(userRoot, ...args) {
  const result = spawnSync(process.execPath, [join(ROOT, 'run-agent.mjs'), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    env: { ...process.env, CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: userRoot, CAREER_OPS_DATA_DIR: '' },
  });
  return { status: result.status, json: JSON.parse(result.stdout || 'null'), stderr: result.stderr };
}

function startHost(tmp, idleMs = 600_000) {
  const hostPath = join(tmp, 'host.mjs');
  writeFileSync(hostPath, HOST);
  const child = spawn(process.execPath, [hostPath, join(tmp, 'user'), join(tmp, 'run'), String(idleMs)], { windowsHide: true });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(done => child.on('exit', code => done(code)));
  const until = async (pattern, ms = 5000) => {
    for (const end = Date.now() + ms; Date.now() < end && !pattern.test(output);) await new Promise(done => setTimeout(done, 50));
    assert.match(output, pattern);
  };
  return { child, exited, until, output: () => output };
}

test('agent waits, answers and finishes through the file channel', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'run-agent-'));
  const host = startHost(tmp);
  try {
    const userRoot = join(tmp, 'user');
    const first = cli(userRoot, 'wait', '--timeout', '20');
    assert.equal(first.json.event, 'questions', JSON.stringify(first.json));
    assert.equal(first.json.questions.length, 2);
    assert.ok(first.json.questions.every(question => question.new && question.hint));

    // Questions already reported do not wake the agent again.
    const quiet = cli(userRoot, 'wait', '--timeout', '5');
    assert.equal(quiet.json.event, 'heartbeat', JSON.stringify(quiet.json));
    assert.equal(quiet.json.open_questions, 2);

    const verify = first.json.questions.find(question => question.reason === 'possible_duplicate_tracker');
    const rejected = cli(userRoot, 'answer', '--id', verify.id, '--text', 'bad');
    assert.equal(rejected.status, 1);
    assert.match(rejected.json.error, /Type retry/);

    const jdFile = join(tmp, 'jd.txt');
    writeFileSync(jdFile, 'Senior Engineer\nBuild and run the platform team services in Porto.');
    const job = first.json.questions.find(question => question.reason === 'jd_unavailable');
    const accepted = cli(userRoot, 'answer', '--id', job.id, '--text-file', jdFile);
    assert.equal(accepted.json.ok, true, JSON.stringify(accepted.json));
    await host.until(/ANSWER job:a "Senior Engineer\\nBuild/);

    const status = cli(userRoot, 'status');
    assert.deepEqual(status.json.questions.map(question => question.id), [verify.id]);
    assert.equal(cli(userRoot, 'answer', '--id', job.id, '--text', 'retry').json.ok, false);

    assert.equal(cli(userRoot, 'finish').json.ok, true);
    assert.equal(await host.exited, 0);
    const exited = cli(userRoot, 'wait', '--timeout', '10');
    assert.equal(exited.json.event, 'exited');
    assert.equal(exited.json.crashed, false);
    // A later run's first wait must not take this finished run for its exit.
    const fresh = cli(userRoot, 'wait', '--timeout', '5', '--fresh');
    assert.equal(fresh.json.event, 'heartbeat');
  } finally {
    host.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('a coordinator with open questions and no agent contact finishes without input', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'run-agent-idle-'));
  const host = startHost(tmp, 300);
  try {
    assert.equal(await host.exited, 0);
    assert.match(host.output(), /no agent contact[\s\S]*LEAVE/);
  } finally {
    host.child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the real coordinator in --agent mode is driven to completion through run-agent.mjs', async t => {
  const { fixture, copyGraph } = await import('./fixtures/run-workflow.mjs');
  const { terminateProcessTreeSync } = await import('../lib/runner-command.mjs');
  const A = 'https://jobs.example.org/alpha', B = 'https://jobs.example.org/beta';
  const f = fixture(t, { rows: [A, B], holds: { [A]: 'agency_confirmation', [B]: 'jd_unavailable' } });
  copyGraph(f.root, 'run-agent.mjs');
  const agent = (...args) => {
    const result = spawnSync(process.execPath, [join(f.root, 'run-agent.mjs'), '--user', 'fictional', ...args],
      { cwd: f.root, env: f.env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
    return JSON.parse(result.stdout || 'null');
  };
  // No TTY: the agent channel, not a terminal, owns the questions.
  const child = spawn(process.execPath, [join(f.root, 'run-workflow.mjs'), '--user', 'fictional', '--agent', '--json', '--skip-scan', '--parallel', '2'],
    { cwd: f.root, env: f.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const closed = new Promise(done => child.once('close', done));
  t.after(() => { if (child.exitCode === null) terminateProcessTreeSync(child); });

  const answered = new Set();
  let exited = null;
  for (let round = 0; round < 10 && !exited; round++) {
    const event = agent('wait', '--timeout', '20', ...(round === 0 ? ['--fresh'] : []));
    if (event.event === 'exited') { exited = event; break; }
    if (event.event !== 'questions') continue;
    for (const question of event.questions.filter(item => item.new)) {
      const text = question.reason === 'agency_confirmation' ? 'Fictional Recruiting'
        : 'Engineer role\nBuild and maintain reliable systems for customers throughout Europe.';
      const response = agent('answer', '--id', question.id, '--text', text);
      assert.equal(response.ok, true, JSON.stringify(response));
      answered.add(question.url);
    }
  }
  const code = await closed;
  assert.deepEqual([...answered].sort(), [A, B]);
  assert.equal(code, 0, stderr.slice(-6000));
  assert.equal(JSON.parse(stdout.trim()).status, 'completed');
  assert.equal(exited?.summary?.status ?? agent('wait', '--timeout', '10').summary.status, 'completed');
});
