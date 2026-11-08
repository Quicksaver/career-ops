import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from '../tracker-utils.mjs';
import { processAlive } from './run-artifacts.mjs';

// The agent-facing side of `run-workflow.mjs --agent`. RunInteractive keeps
// owning every question and answer rule; this channel only replaces the TTY:
// the coordinator publishes its open questions to state.json, and an agent
// answers through request files that go through the same submit() a typed
// answer would. run-agent.mjs is the agent's CLI over these files.

export const AGENT_IDLE_MS = 60 * 60 * 1000;
const POLL_MS = 500;

export function channelPaths(userRoot) {
  const dir = join(userRoot, 'data/run-agent');
  return {
    dir,
    state: join(dir, 'state.json'),
    agent: join(dir, 'agent.json'),
    inbox: join(dir, 'inbox'),
    responses: join(dir, 'responses'),
  };
}

/** Short stable handle for a RunInteractive question key. */
export const questionId = key => createHash('sha256').update(String(key)).digest('hex').slice(0, 10);

const HINTS = {
  agency_confirmation: 'Answer with the agency name, "/direct" for a direct employer, or "/later".',
  jd_unavailable: 'Answer with a public non-LinkedIn employer posting URL or the full JD text, "/skip" when it cannot be provided, or "/later".',
  job_failed: 'Fix the cause, then answer "retry"; "/skip" discards this posting; "/later" defers.',
};
const hintFor = reason => HINTS[reason] || 'Fix the cause outside the run, then answer "retry"; "/later" defers.';

export function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

/** Marks agent contact, so a coordinator waiting on input knows someone is answering. */
export function touchAgent(userRoot, patch = {}) {
  const paths = channelPaths(userRoot);
  mkdirSync(paths.dir, { recursive: true });
  const current = readJson(paths.agent, {});
  const next = { ...current, ...patch, last_seen: new Date().toISOString() };
  writeFileAtomic(paths.agent, JSON.stringify(next, null, 2) + '\n');
  return next;
}

export class AgentTerminal extends EventEmitter {
  constructor({ userRoot, user, runId, runDir, write = () => {}, idleMs = AGENT_IDLE_MS, pollMs = POLL_MS }) {
    super();
    Object.assign(this, { userRoot, user, runId, runDir, write, idleMs });
    this.paths = channelPaths(userRoot);
    mkdirSync(this.paths.inbox, { recursive: true });
    mkdirSync(this.paths.responses, { recursive: true });
    // A request or response from an earlier run never applies to this one.
    for (const dir of [this.paths.inbox, this.paths.responses]) {
      for (const name of readdirSync(dir)) rmSync(join(dir, name), { force: true });
    }
    touchAgent(userRoot, { run_id: runId, acknowledged: [] });
    this.interactive = null; this.status = 'Starting workflow'; this.errors = [];
    this.closed = false; this.busy = false; this.signature = null; this.startedAt = Date.now();
    this.publish(true);
    this.timer = setInterval(() => { this.drainInbox().catch(error => this.error(error.message)); }, pollMs);
  }
  attach(interactive) { this.interactive = interactive; this.publish(true); }
  setStatus(text) { this.status = text; this.publish(); }
  setQuestion() { this.publish(); }
  error(message) {
    this.errors = [...this.errors, { at: new Date().toISOString(), message: String(message) }].slice(-20);
    this.write(`[run] agent channel error: ${message}`);
    this.publish(true);
  }
  log(message) { this.write(message); }

  questions() {
    return (this.interactive?.questions || []).map(action => ({
      id: questionId(action.key), kind: action.kind, phase: action.phase, reason: action.reason,
      url: action.url || null, job_id: action.id || null, question: action.question, hint: hintFor(action.reason),
    }));
  }
  publish(force = false) {
    if (this.closed) return;
    const questions = this.questions();
    const active = this.interactive ? this.interactive.active : true;
    const signature = JSON.stringify([this.status, active, questions.map(q => q.id), this.errors.length]);
    if (!force && signature === this.signature) { this.checkIdle(questions); return; }
    this.signature = signature;
    writeFileAtomic(this.paths.state, JSON.stringify({
      schema_version: 1, user: this.user, run_id: this.runId, run_dir: this.runDir, pid: process.pid,
      phase: 'running', accepting_answers: active, status: this.status, questions, errors: this.errors,
      updated_at: new Date().toISOString(),
    }, null, 2) + '\n');
    this.checkIdle(questions);
  }
  // A coordinator waiting on answers nobody is reading would hold its locks
  // forever. Without agent contact for idleMs, finish like /finish: active work
  // drains and the run exits partial, keeping every saved answer for the rerun.
  checkIdle(questions) {
    if (!questions.length || !this.interactive?.active) return;
    const lastSeen = Date.parse(readJson(this.paths.agent, {})?.last_seen || '') || this.startedAt;
    if (Date.now() - Math.max(lastSeen, this.startedAt) < this.idleMs) return;
    this.write('[run] no agent contact while questions are open; finishing without input.');
    this.emit('leave');
  }
  respond(requestId, body) {
    writeFileAtomic(join(this.paths.responses, `${requestId}.json`), JSON.stringify({ request_id: requestId, ...body }) + '\n');
  }
  async drainInbox() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      const names = readdirSync(this.paths.inbox).filter(name => name.endsWith('.json'))
        .sort((a, b) => statSync(join(this.paths.inbox, a)).mtimeMs - statSync(join(this.paths.inbox, b)).mtimeMs);
      for (const name of names) {
        const path = join(this.paths.inbox, name);
        const request = readJson(path);
        rmSync(path, { force: true });
        const requestId = request?.request_id || name.replace(/\.json$/, '');
        try {
          this.respond(requestId, { ok: true, ...(await this.handle(request)) });
        } catch (error) {
          this.respond(requestId, { ok: false, error: error.message });
        }
        this.publish(true);
      }
    } finally { this.busy = false; }
  }
  async handle(request) {
    if (!request || request.schema_version !== 1 || request.user !== this.user) throw new Error('Invalid agent request');
    // Reply first: the response is written before the run starts winding down.
    if (request.command === 'finish') { setImmediate(() => this.emit('leave')); return { result: 'finishing' }; }
    if (request.command === 'stop') { setImmediate(() => this.emit('interrupt')); return { result: 'stopping' }; }
    if (request.command !== 'answer') throw new Error(`Unknown command ${request.command}`);
    if (!this.interactive?.active) throw new Error('The run is finishing and no longer accepts answers');
    const question = this.interactive.questions.find(action => questionId(action.key) === request.question_id);
    if (!question) throw new Error(`No open question ${request.question_id}; run "run-agent.mjs status" for the current list`);
    if (typeof request.text !== 'string') throw new Error('Answer text is required');
    await this.interactive.submit(question, request.text);
    return { result: 'accepted', question_id: request.question_id };
  }
  close() {
    if (this.closed) return;
    clearInterval(this.timer);
    this.closed = true;
    writeFileAtomic(this.paths.state, JSON.stringify({
      schema_version: 1, user: this.user, run_id: this.runId, run_dir: this.runDir, pid: process.pid,
      phase: 'finished', accepting_answers: false, status: this.status, questions: [], errors: this.errors,
      updated_at: new Date().toISOString(),
    }, null, 2) + '\n');
  }
}

/** The coordinator's published state, with liveness resolved for the reader. */
export function readChannelState(userRoot) {
  const state = readJson(channelPaths(userRoot).state);
  if (!state) return null;
  let alive = false;
  try { alive = processAlive(state.pid); } catch { alive = false; }
  const summaryPath = state.run_dir ? join(state.run_dir, 'summary.json') : null;
  const finished = state.phase === 'finished' || !alive;
  return { ...state, alive, finished, summary_path: summaryPath && existsSync(summaryPath) ? summaryPath : null };
}

/** Queue one request for the running coordinator and wait for its response. */
export async function sendRequest(userRoot, user, body, { timeoutMs = 60_000, pollMs = 250 } = {}) {
  const paths = channelPaths(userRoot);
  const state = readChannelState(userRoot);
  if (!state || state.finished) throw new Error('No active agent run for this user');
  const requestId = randomUUID();
  mkdirSync(paths.inbox, { recursive: true });
  writeFileAtomic(join(paths.inbox, `${requestId}.json`), JSON.stringify({ schema_version: 1, user, request_id: requestId, ...body }) + '\n');
  touchAgent(userRoot);
  const responsePath = join(paths.responses, `${requestId}.json`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = readJson(responsePath);
    if (response) { rmSync(responsePath, { force: true }); return response; }
    const current = readChannelState(userRoot);
    if (!current || current.finished) throw new Error('The run exited before answering the request');
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error(`No response within ${Math.round(timeoutMs / 1000)}s; the request stays queued`);
}
