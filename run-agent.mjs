#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getUserContext, printUserContextErrorAndExit } from './lib/user-context.mjs';
import { channelPaths, readChannelState, readJson, sendRequest, touchAgent } from './lib/run-agent-channel.mjs';
import { inspectOwnership } from './batch/runner-ownership.mjs';
import { preflight } from './lib/run-agent-preflight.mjs';

const HELP = `Agent control for run-workflow.mjs --agent

Usage:
  node run-agent.mjs preflight --user <id> [--terminate]
  node run-agent.mjs wait   --user <id> [--timeout SECONDS] [--fresh]
  node run-agent.mjs status --user <id>
  node run-agent.mjs answer --user <id> --id QUESTION (--text TEXT | --text-file PATH)
  node run-agent.mjs finish --user <id>
  node run-agent.mjs stop   --user <id>

Start the run itself in the background with:
  node run-workflow.mjs --user <id> --agent [run options]

preflight Clears what an earlier run left behind: locks and worker records
          whose owner is dead. --terminate also ends a leftover agent run, a
          batch runner without its coordinator, and orphaned workers. A run
          started at a terminal is reported as blocking, never ended. Prints
          ready, terminated, released, blocking and notes.
wait      Blocks until a question the agent has not seen appears, the run
          exits, or the timeout passes (default 7000s), then prints one JSON
          event: questions, exited, error, not_started or heartbeat. Use
          --fresh on the first wait after starting a run, so the previous
          run's final state is not reported as this run's exit.
status    Prints the current state and every open question without marking
          any of them seen.
answer    Submits one answer exactly as typed in the interactive run: an
          agency name, /direct, a JD or employer URL, retry, /skip or /later.
          --text-file reads the answer (for example a pasted JD) from a file.
finish    Stops asking: active work drains and the run exits (like /finish).
stop      Interrupts the run safely (like Ctrl+C).`;

let context;
try {
  context = getUserContext(process.argv.slice(2));
} catch (error) {
  if (process.argv.includes('-h') || process.argv.includes('--help')) { console.log(HELP); process.exit(0); }
  printUserContextErrorAndExit(error);
}
const args = context.args;
if (args.includes('-h') || args.includes('--help') || !args.length) { console.log(HELP); process.exit(args.length ? 0 : 1); }

function option(name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const prefixed = args.find(arg => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : null;
}
const print = value => console.log(JSON.stringify(value, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** What an agent needs from a finished run, without the full summary. */
function summaryDigest(path) {
  const summary = path ? readJson(path) : null;
  if (!summary) return null;
  const review = summary.verification_review;
  return {
    status: summary.status,
    error: summary.error || null,
    final_pending: summary.final_pending,
    final_blocked: summary.final_blocked,
    discovered: { scan: summary.scan?.added_pending || 0, handoff: summary.handoff?.observed_added_pending || 0, linkedin: summary.linkedin?.added_pending || 0 },
    batch_counts: summary.batch_counts,
    processed: summary.pipeline?.processed || 0,
    tracker_liveness: summary.tracker_liveness ? { status: summary.tracker_liveness.status, checked: summary.tracker_liveness.checked, closed: summary.tracker_liveness.closed, uncertain: summary.tracker_liveness.uncertain, closed_rows: summary.tracker_liveness.closed_rows, error: summary.tracker_liveness.error } : null,
    verification: review ? {
      status: review.status,
      reviewed: review.reviews?.length || 0,
      actions: review.actions || null,
      unresolved: (review.unresolved_findings || []).map(item => ({ code: item.finding_code || item.code, message: item.message })),
    } : null,
    manual_actions: (summary.manual_actions || []).map(item => ({ kind: item.kind, reason: item.reason, url: item.url || null, question: item.question })),
    issues: summary.issues || [],
    user_action: summary.user_action || null,
    logs: summary.logs || null,
    summary_path: path,
  };
}

function runLockOwnerAlive() {
  const verdict = inspectOwnership(join(context.userRoot, 'data/run-workflow.pid'));
  return verdict.status === 'alive';
}

async function wait() {
  const timeoutMs = Math.max(5, Number(option('--timeout') || 7000)) * 1000;
  const startedAt = Date.now();
  const paths = channelPaths(context.userRoot);
  // With --fresh, a run that had already finished when this wait began is the
  // previous run, not the one just started.
  const initial = readChannelState(context.userRoot);
  const staleRunId = args.includes('--fresh') && initial?.finished ? initial.run_id : null;
  let agent = touchAgent(context.userRoot);
  let lastTouch = Date.now();
  while (true) {
    const state = readChannelState(context.userRoot);
    const current = state && state.run_id !== staleRunId ? state : null;
    if (current && agent.run_id && current.run_id !== agent.run_id) agent = touchAgent(context.userRoot, { run_id: current.run_id, acknowledged: [], errors_seen: 0 });
    if (current?.finished) {
      return { event: 'exited', run_id: current.run_id, crashed: current.phase !== 'finished', summary: summaryDigest(current.summary_path) };
    }
    if (current) {
      const seen = new Set(agent.acknowledged || []);
      const unseen = current.questions.filter(question => !seen.has(question.id));
      if (unseen.length) {
        touchAgent(context.userRoot, { acknowledged: [...seen, ...unseen.map(question => question.id)] });
        return { event: 'questions', run_id: current.run_id, status: current.status, accepting_answers: current.accepting_answers,
          questions: current.questions.map(question => ({ ...question, new: !seen.has(question.id) })) };
      }
      const errorsSeen = agent.errors_seen || 0;
      if (current.errors.length > errorsSeen) {
        touchAgent(context.userRoot, { errors_seen: current.errors.length });
        return { event: 'error', run_id: current.run_id, status: current.status, errors: current.errors.slice(errorsSeen) };
      }
    } else if (Date.now() - startedAt > 60_000 && !runLockOwnerAlive()) {
      return { event: 'not_started', detail: 'No agent run published state and no live run-workflow owner holds the lock; check the background command output.' };
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return { event: 'heartbeat', run_id: current?.run_id || null, status: current?.status || 'starting', open_questions: current?.questions.length || 0 };
    }
    if (Date.now() - lastTouch > 60_000) { agent = touchAgent(context.userRoot); lastTouch = Date.now(); }
    else agent = readJson(paths.agent, agent);
    await sleep(2000);
  }
}

const command = args[0];
try {
  if (command === 'preflight') {
    const report = preflight({ userRoot: context.userRoot, terminate: args.includes('--terminate') });
    print(report);
    if (!report.ready) process.exitCode = 1;
  } else if (command === 'wait') print(await wait());
  else if (command === 'status') {
    const state = readChannelState(context.userRoot);
    if (state) touchAgent(context.userRoot);
    print(state ? { ...state, summary: state.finished ? summaryDigest(state.summary_path) : null } : { phase: 'none' });
  } else if (command === 'answer') {
    const id = option('--id');
    const textFile = option('--text-file');
    const text = textFile ? readFileSync(textFile, 'utf8') : option('--text');
    if (!id || typeof text !== 'string') throw new Error('answer requires --id and --text or --text-file');
    const response = await sendRequest(context.userRoot, context.userId, { command: 'answer', question_id: id, text });
    print(response);
    if (!response.ok) process.exitCode = 1;
  } else if (command === 'finish' || command === 'stop') {
    const response = await sendRequest(context.userRoot, context.userId, { command });
    print(response);
    if (!response.ok) process.exitCode = 1;
  } else {
    console.error(`Unknown command: ${command}\n\n${HELP}`);
    process.exitCode = 1;
  }
} catch (error) {
  print({ ok: false, error: error.message });
  process.exitCode = 1;
}
