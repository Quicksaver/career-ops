#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';
import * as yaml from 'js-yaml';
import {
  getUserContext,
  printUserContextErrorAndExit,
  systemPath,
  userPath,
} from './lib/user-context.mjs';
import { pendingCount } from './lib/pipeline-queue.mjs';
import { acquirePipelineLock, withPipelineLock } from './pipeline-lock.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import { assertOpenAIStructuredOutputSchema } from './lib/openai-output-schema.mjs';
import { resolveRunnerCommand, terminateProcessTree, terminateProcessTreeSync } from './lib/runner-command.mjs';
import { actionableQueue, runPipelinePath, queueActions, queueFingerprint, readRunAnswers, readRunBatchState, readRunQueue, validateHandoff } from './lib/run-queue.mjs';
import { codexReasoningConfigArg, resolveCodexSettings } from './lib/codex-config.mjs';
import { resolveParallel } from './lib/parallel-config.mjs';
import {
  cleanupExpiredRuns,
  compactCompletedRun,
  compactPhaseRecords,
  RUN_RETENTION_DAYS,
  workflowRunnerPidPaths,
  processAlive,
} from './lib/run-artifacts.mjs';
import { runUnresolvedFindingLines } from './lib/run-summary.mjs';
import { inspectOwnership } from './batch/runner-ownership.mjs';

const HELP = `career-ops deterministic workflow runner

Usage: ./run-workflow.mjs --user <id> [options]

Options:
  --parallel N          Batch worker override (profile batch.parallel, then 1)
  --agent-cli codex     CLI for schema-constrained handoff work (default: codex)
  --batch-cli NAME      Batch worker CLI: codex or claude (default: codex)
  --codex-model NAME    Codex model override for every Codex call
  --codex-reasoning-effort LEVEL
                        Codex reasoning override: minimal|low|medium|high|xhigh
  --throttle[=MS]       Throttle bulk liveness browser checks
  --no-fallback         Disable headed liveness fallback
  --skip-linkedin       Skip authenticated LinkedIn scan explicitly
  --skip-scan           Process the inbox without starting discovery
  --scan-full           Include the broad full-ATS sweep (opt-in)
  --scan-hn             Include the deterministic Hacker News scanner
  --scan-dayforce       Include configured Dayforce boards
  --scan-interamt       Include configured Interamt searches
  --answers-file PATH   Explicit per-posting answers for held jobs
  --limit N            Process at most N jobs; omit to drain the inbox
  --retry-failed        Retry jobs at their previous retry ceiling once
  --resume-paused       Explicitly resume rate/session-paused jobs
  --max-queue-passes N  Bound queue recovery passes (default: 3)
  --resume-verify RUN   Resume validated verification checkpoints
  --quiet               Suppress live phase progress
  --json                Emit the complete machine-readable result on stdout
  -h, --help            Show this help

The runner writes detailed phase logs under users/<id>/data/workflow-runs/. Human
invocations stream progress and end with a compact summary. --json reserves
stdout for one machine-readable result and sends progress to stderr.`;

let context;
try {
  context = getUserContext(process.argv.slice(2));
} catch (error) {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    console.log(HELP);
    process.exit(0);
  }
  printUserContextErrorAndExit(error);
}

const rawArgs = context.args;
if (rawArgs.includes('-h') || rawArgs.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}

function optionValue(name, fallback = null) {
  const exact = rawArgs.indexOf(name);
  if (exact >= 0) {
    const value = rawArgs[exact + 1];
    if (!value || value.startsWith('--')) {
      console.error(`${name} requires a value`);
      process.exit(1);
    }
    return value;
  }
  const prefixed = rawArgs.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed) {
    const value = prefixed.slice(name.length + 1);
    if (!value) {
      console.error(`${name} requires a value`);
      process.exit(1);
    }
    return value;
  }
  return fallback;
}

const parallelOverride = optionValue('--parallel');
const agentCli = optionValue('--agent-cli', 'codex');
const batchCli = optionValue('--batch-cli', 'codex');
const codexModel = optionValue('--codex-model');
const codexReasoningEffort = optionValue('--codex-reasoning-effort');
const throttle = rawArgs.find((arg) => arg === '--throttle' || arg.startsWith('--throttle='));
const noFallback = rawArgs.includes('--no-fallback');
const skipLinkedIn = rawArgs.includes('--skip-linkedin');
const skipScan = rawArgs.includes('--skip-scan');
const answersFile = optionValue('--answers-file');
const batchLimit = optionValue('--limit');
const maxQueuePasses = Number(optionValue('--max-queue-passes', '3'));
const resumeVerify = optionValue('--resume-verify');
const quiet = rawArgs.includes('--quiet');
const jsonOutput = rawArgs.includes('--json');
const valueOptions = new Set([
  '--parallel', '--agent-cli', '--batch-cli', '--codex-model', '--codex-reasoning-effort',
  '--answers-file', '--limit', '--max-queue-passes', '--resume-verify',
]);
const flagOptions = new Set(['--json', '--no-fallback', '--skip-linkedin', '--skip-scan', '--quiet', '--throttle',
  '--scan-full', '--scan-hn', '--scan-dayforce', '--scan-interamt', '--retry-failed', '--resume-paused']);
const unknown = [];
for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (valueOptions.has(arg)) { i++; continue; }
  if (flagOptions.has(arg) || [...valueOptions].some(name => arg.startsWith(`${name}=`)) || arg.startsWith('--throttle=')) continue;
  unknown.push(arg);
}
if (unknown.length) {
  console.error(`Unknown option: ${unknown[0]}`);
  process.exit(1);
}
if (agentCli !== 'codex') {
  console.error('The deterministic handoff contract currently requires --agent-cli codex.');
  process.exit(1);
}
if (!['codex', 'claude'].includes(batchCli)) {
  console.error('--batch-cli must be codex or claude');
  process.exit(1);
}
if (!Number.isInteger(maxQueuePasses) || maxQueuePasses < 1 || maxQueuePasses > 10) {
  console.error('--max-queue-passes must be an integer from 1 to 10'); process.exit(1);
}
if (batchLimit && (!/^[1-9]\d*$/.test(batchLimit) || !Number.isSafeInteger(Number(batchLimit)))) {
  console.error('--limit must be a positive safe integer'); process.exit(1);
}
if (resumeVerify && !/^[A-Za-z0-9._-]+$/.test(resumeVerify)) {
  console.error('--resume-verify is not a valid run ID'); process.exit(1);
}
if (throttle?.includes('=') && !/^--throttle=\d+$/.test(throttle)) {
  console.error('--throttle must be a non-negative integer in milliseconds'); process.exit(1);
}
let codexSettings = null;
let parallelSettings = null;

const startedAt = new Date().toISOString();
const runId = startedAt.replace(/[:.]/g, '-');
const runDir = userPath(context, `data/workflow-runs/${runId}`);
const pipelinePath = runPipelinePath(context.userRoot);
const lockPath = userPath(context, 'data/run-workflow.pid');
const phases = [];
let activeChild = null;
let activeProcessGroup = null;
let lockOwned = false;
const runnerLocks = [];
let terminating = false;
let interruptedSignal = null;
let stoppingChildren = null;

function log(message) {
  if (quiet) return;
  const stream = jsonOutput ? process.stderr : process.stdout;
  stream.write(`[run] ${message}\n`);
}

function readPendingCount() {
  if (!existsSync(pipelinePath)) return 0;
  return pendingCount(readFileSync(pipelinePath, 'utf-8'));
}

async function acquireLock() {
  mkdirSync(join(context.userRoot, 'data'), { recursive: true });
  for (const ownerPath of workflowRunnerPidPaths(context.userRoot)) {
    runnerLocks.push(await acquirePipelineLock(ownerPath, { timeoutMs: 1000, maxWaitMs: 1000 }));
    if (!existsSync(ownerPath)) continue;
    const stamp = readFileSync(ownerPath, 'utf-8').trim();
    const oldPid = Number(stamp);
    if (!/^[1-9]\d*$/.test(stamp) || !Number.isSafeInteger(oldPid)) {
      throw new Error(`ambiguous workflow runner ownership: ${ownerPath}`);
    }
    if (processAlive(oldPid)) throw new Error(`another workflow runner is active (PID ${oldPid})`);
  }
  const temporary = `${lockPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${process.pid}\n`, 'utf-8');
  renameSync(temporary, lockPath);
  lockOwned = true;
}

function releaseLock() {
  try {
    if (lockOwned && existsSync(lockPath) && readFileSync(lockPath, 'utf-8').trim() === String(process.pid)) {
      rmSync(lockPath, { force: true });
    }
  } finally {
    lockOwned = false;
    while (runnerLocks.length) runnerLocks.pop().release();
  }
}

function addAction(summary, action) {
  const item = { status: 'pending', ...action };
  const key = `${item.phase}:${item.reason}:${item.url || item.id || ''}`;
  if (!summary.manual_actions.some(existing => `${existing.phase}:${existing.reason}:${existing.url || existing.id || ''}` === key)) {
    summary.manual_actions.push(item);
    log(`action required${item.url ? ` for ${compactProgressValue(item.url)}` : ''}: ${compactProgressValue(item.question)}`);
  }
}

function addPhaseIssue(summary, phase, error) {
  const detail = compactProgressValue(error.message || error, 1000);
  summary.issues.push({ phase, message: detail });
  log(`${phase} incomplete: ${detail}; continuing independent work`);
}

async function restoreAnsweredRows(answers) {
  if (!answers.length || !existsSync(pipelinePath)) return;
  await withPipelineLock(pipelinePath, () => {
    const queue = readRunQueue(context.userRoot);
    const lines = queue.text.replace(/\r\n/g, '\n').split('\n');
    let changed = false;
    for (const row of queue.blocked) {
      if (!answers.some(answer => answer.url === row.url && answer.reason === row.reason)) continue;
      // Keep the original posting identity; batch receives the exact user answer.
      lines[row.lineIndex] = `- [ ] ${row.url}`;
      changed = true;
    }
    if (changed) writeFileAtomic(pipelinePath, lines.join('\n'));
  });
}

function checkBatchOwner() {
  const path = userPath(context, 'batch/batch-runner.pid');
  const owner = inspectOwnership(path);
  if (owner.status === 'alive') throw new Error(`another batch runner is active (native PID ${owner.pid}); wait for its workers to exit`);
  if (owner.status === 'ambiguous') throw new Error('batch ownership is ambiguous; inspect its owner metadata before resuming');
  if (owner.status === 'dead') return; // Atomic batch acquisition recovers dead ownership.
  if (!existsSync(path)) return;
  const value = readFileSync(path, 'utf8').trim();
  const pid = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('legacy batch ownership is malformed; inspect its PID file before resuming');
  let alive;
  if (process.platform === 'win32') {
    // Compatibility stamps contain an MSYS PID, never a native Windows PID.
    const launch = resolveRunnerCommand('bash', ['-c', 'if kill -0 "$1" 2>/dev/null; then exit 0; else exit 3; fi', 'batch-owner-check', value]);
    const result = spawnSync(launch.command, launch.args, { ...launch.options, timeout: 5000, stdio: 'pipe' });
    if (result.error || ![0, 3].includes(result.status)) throw new Error('legacy batch ownership could not be checked through Git Bash; refusing to resume');
    alive = result.status === 0;
  } else alive = processAlive(pid);
  if (alive) throw new Error(`another batch runner is active (legacy PID ${pid}); wait for its workers to exit`);
  // Leave stale compatibility metadata to the atomic batch ownership protocol.
}

function terminateActiveChild(signal = 'SIGTERM') {
  try {
    if (activeChild || activeProcessGroup) terminateProcessTreeSync(activeChild || activeProcessGroup, { signal });
  } catch {}
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (terminating) return;
    terminating = true;
    interruptedSignal = signal;
    if (activeChild) stoppingChildren = terminateProcessTree(activeChild).catch(error => log(`child cleanup failed: ${error.message}`));
  });
}
process.on('exit', releaseLock);

function commandTail(chunks, limit = 12000) {
  const joined = chunks.join('');
  return joined.length > limit ? joined.slice(-limit) : joined;
}

function createProgressForwarder(name, predicate) {
  let buffered = '';

  function emit(line) {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!normalized.trim()) return;
    if (predicate !== true && !predicate(normalized)) return;
    const stream = jsonOutput ? process.stderr : process.stdout;
    stream.write(`[run:${name}] ${normalized}\n`);
  }

  return {
    write(chunk) {
      buffered += chunk.toString();
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        emit(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf('\n');
      }
    },
    flush() {
      if (buffered) emit(buffered);
      buffered = '';
    },
  };
}

function scanProgressLine(line) {
  const text = line.trim();
  return text.startsWith('[scan-progress]') ||
    /^(Scanning |Portal Scan|Companies scanned:|Job boards scanned:|Total jobs found:|New offers added:|Agent\/WebSearch handoff:|Network errors \(|Errors \(|Results saved to )/.test(text);
}

function scanAuthProgressLine(line) {
  const text = line.trim();
  return /^\[scan-auth\] (Starting|Launching|Checking|Session active|Added|Wrote|WARN:|ERROR:)/.test(text) ||
    /^\[linkedin\] (── Search|Page |Found |Reached max|Navigating|Waiting|Search .* failed|⚠)/.test(text) ||
    /^── Search /.test(text) ||
    /^(LinkedIn Scan Summary|Searches run:|Listings found:|Extracted:|Filtered out:|Already seen:|Viewed skipped:|JDs saved:|Errors:|No new listings found this run\.)/.test(text);
}

function handoffProgressLine(line) {
  return line.includes('[handoff-progress]');
}

function compactProgressValue(value, maxLength = 180) {
  const text = String(value ?? '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

async function runCommand(name, command, args, options = {}) {
  if (interruptedSignal) throw new Error(`interrupted by ${interruptedSignal}`);
  const logPath = join(runDir, `${String(phases.length + 1).padStart(2, '0')}-${name}.log`);
  mkdirSync(runDir, { recursive: true });
  const stdoutOutput = [];
  const errorOutput = [];
  let stdoutBytes = 0;
  let errorBytes = 0;
  function capture(chunks, chunk, bytes, limit) {
    chunks.push(chunk);
    bytes += chunk.length;
    while (bytes > limit && chunks.length > 1) bytes -= chunks.shift().length;
    if (bytes > limit) {
      chunks[0] = chunks[0].subarray(bytes - limit);
      bytes = limit;
    }
    return bytes;
  }
  const maxStdout = options.maxStdout ?? 24000;
  const stream = createWriteStream(logPath, { flags: 'a' });
  const progress = quiet || !options.progress
    ? null
    : {
        stdout: createProgressForwarder(name, options.progress),
        stderr: createProgressForwarder(name, options.progress),
      };
  const started = new Date().toISOString();
  log(`${name} started`);
  const env = { ...process.env, CAREER_OPS_USER: context.userId,
    CAREER_OPS_ROOT: context.userRoot, CAREER_OPS_USERS_DIR: context.usersDir,
    ...(options.env || {}) };
  const launch = resolveRunnerCommand(command, args, { cwd: context.projectRoot, env });
  const child = spawn(launch.command, launch.args, {
    ...launch.options,
    cwd: context.projectRoot,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  activeChild = child;
  activeProcessGroup = child.pid;
  child.stdout.on('data', (chunk) => {
    stream.write(chunk);
    progress?.stdout.write(chunk);
    stdoutBytes = capture(stdoutOutput, chunk, stdoutBytes, maxStdout);
    errorBytes = capture(errorOutput, chunk, errorBytes, 24000);
  });
  child.stderr.on('data', (chunk) => {
    stream.write(chunk);
    progress?.stderr.write(chunk);
    errorBytes = capture(errorOutput, chunk, errorBytes, 24000);
  });
  if (options.stdin) child.stdin.end(options.stdin);
  else child.stdin.end();
  let spawnError = null;
  child.once('error', (error) => { spawnError = error; });
  const result = await new Promise((resolve) => {
    // `close` fires only after stdout/stderr have closed. Waiting for `exit`
    // could return while the final JSON was still being drained.
    child.once('close', (code, signal) => resolve({ code, signal, error: spawnError }));
  });
  activeChild = null;
  activeProcessGroup = null;
  progress?.stdout.flush();
  progress?.stderr.flush();
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
  const accepted = options.accept ? options.accept.includes(result.code) : result.code === 0;
  const phase = {
    name,
    status: accepted ? 'completed' : 'failed',
    exit_code: result.code,
    signal: result.signal,
    started_at: started,
    finished_at: new Date().toISOString(),
    log: logPath,
  };
  phases.push(phase);
  log(`${name} ${phase.status}`);
  const tail = commandTail([Buffer.concat(errorOutput).toString('utf8')]);
  if (phase.status === 'failed') {
    const detail = result.error?.message || tail.trim().slice(-1000) || `exit ${result.code ?? result.signal}`;
    throw Object.assign(new Error(`${name} failed: ${detail}`), {
      phase: name, result, logPath, output: Buffer.concat(stdoutOutput).toString('utf8'), tail,
    });
  }
  return { ...result, output: Buffer.concat(stdoutOutput).toString('utf8'), tail, logPath, phase };
}

function parseJsonOutput(result, label) {
  const text = result.output.trim();
  try { return JSON.parse(text); } catch {
    throw new Error(`${label} returned invalid JSON; see ${result.logPath}`);
  }
}

function loadHandoff() {
  const path = userPath(context, 'data/scan-handoff.json');
  if (!existsSync(path)) return { path, count: 0, items: [], valid: false };
  try {
    const payload = JSON.parse(readFileSync(path, 'utf-8'));
    const items = Array.isArray(payload.items) ? payload.items : [];
    return { path, count: Number(payload.count) || items.length, items, valid: true };
  } catch {
    return { path, count: 0, items: [], valid: false };
  }
}

async function mergeTracker(summary, name) {
  const result = await runCommand(name, process.execPath, [systemPath('merge-tracker.mjs'), '--user', context.userId], { accept: [0, 1] });
  if (result.code === 0) {
    summary.manual_actions = summary.manual_actions.filter(action => action.reason !== 'addition_blocked');
    summary.issues = summary.issues.filter(issue => issue.phase !== 'tracker-merge');
    return;
  }
  if (!/NOT merged/i.test(result.output + result.tail)) throw new Error(`${name} failed: ${result.tail || 'see phase log'}`);
  addAction(summary, { kind: 'tracker', phase: 'tracker', reason: 'addition_blocked',
    question: `Repair the tracker additions retained by merge-tracker, then rerun. ${compactProgressValue(result.tail || result.output, 1000)}` });
  addPhaseIssue(summary, 'tracker-merge', 'Some tracker additions remain unmerged; independent queue processing continues.');
}

function handoffPrompt(handoffPath) {
  return `You are the one-off scan-handoff worker for career-ops.

ACTIVE_USER=${context.userId}
USER_ROOT=${context.userRoot}
HANDOFF_FILE=${handoffPath}

Execute exactly the scan-handoff phase, not the full run, scan, scan-auth, pipeline, or batch flow.
Read AGENTS.md, modes/scan.md, modes/scan-handoff.md, users/${context.userId}/portals.yml, and the handoff file before acting. All user-layer relative paths resolve inside USER_ROOT. Do not spawn subagents. Process every handoff item once. Before starting each item, emit exactly one commentary line in this format: [handoff-progress] {index}/{total}: {company} ({method}) — {search query or careers URL}. Use the available browser/Playwright tools for careers URLs and liveness verification; use web search only for search-query items. Apply title, location, company, blacklist, deduplication, and liveness rules. Deduplicate against this user's scan-history.tsv, pipeline.md, and applications.md. Never add a WebSearch-derived URL without browser verification. Write accepted rows and scan-history statuses through the documented user-layer formats. Continue past company-specific failures; set status=partial and record each error. Use status=blocked only when explicit user action is required or safe progress is impossible. Do not edit system files or candidate fact sources.

Your final response must contain only the JSON object required by the supplied output schema. Counts must describe this invocation only. Set user_action to null unless requires_user_action is true.`;
}

async function main() {
  mkdirSync(runDir, { recursive: true });
  const summary = {
    status: 'running', user: context.userId, run_id: runId, started_at: startedAt,
    finished_at: null, baseline_pending: 0, final_pending: null,
    scan: null, handoff: null, linkedin: null, liveness: null, batch_sync: null,
    pipeline: null, verification: null, verification_review: null,
    warning_triage: null, duplicate_resolution: null,
    needs_human_review: false, phases, logs: runDir, error: null, user_action: null,
    codex: null, parallel: null, parallel_source: null, cleanup: null,
    manual_actions: [], issues: [], final_blocked: 0, remaining: null,
    batch_counts: null, queue_passes: 0,
  };

  try {
    await acquireLock();
    checkBatchOwner();
    summary.cleanup = cleanupExpiredRuns({
      userRoot: context.userRoot,
      ignoreActivePids: [process.pid],
    });
    if (summary.cleanup.status === 'skipped') {
      const owners = summary.cleanup.active_runners
        .map(item => `${item.lock} PID ${item.pid}`)
        .join(', ');
      log(`cleanup-runs skipped: active runner (${owners})`);
    } else {
      log(`cleanup-runs deleted ${summary.cleanup.deleted_runs} run(s) older than ${RUN_RETENTION_DAYS} days; freed ${summary.cleanup.deleted_human}`);
    }

    const doctor = parseJsonOutput(
      await runCommand('doctor', process.execPath, [systemPath('doctor.mjs'), '--user', context.userId, '--json']),
      'doctor',
    );
    if (doctor.onboardingNeeded) {
      summary.status = 'blocked';
      summary.user_action = `Complete onboarding: missing ${doctor.missing.join(', ')}`;
      return summary;
    }

    codexSettings = resolveCodexSettings({
      profilePath: userPath(context, 'config/profile.yml'),
      modelOverride: codexModel,
      reasoningEffortOverride: codexReasoningEffort,
    });
    summary.codex = {
      model: codexSettings.model,
      reasoning_effort: codexSettings.reasoningEffort,
      model_source: codexSettings.modelSource,
      reasoning_effort_source: codexSettings.reasoningEffortSource,
    };
    parallelSettings = resolveParallel({
      profilePath: userPath(context, 'config/profile.yml'),
      override: parallelOverride,
    });
    summary.parallel = parallelSettings.parallel;
    summary.parallel_source = parallelSettings.source;
    const answerPath = answersFile ? resolve(context.projectRoot, answersFile) : null;
    const answers = readRunAnswers(answerPath, context.userId, context.userRoot);
    await restoreAnsweredRows(answers);

    summary.baseline_pending = readPendingCount();

    if (skipScan) summary.scan = { status: 'skipped', reason: 'explicit --skip-scan', added_pending: 0 };
    else {
      const beforeScan = readPendingCount();
      try {
        const scanResult = parseJsonOutput(await runCommand('scan', process.execPath,
          [systemPath('scan.mjs'), '--user', context.userId, '--json'], {
            progress: scanProgressLine, accept: [0, 2], maxStdout: 32 * 1024 * 1024,
            env: { CAREER_OPS_PROGRESS: '1' },
          }), 'scan');
        if (scanResult.version !== 'careerops.scan.receipt@1' || !Array.isArray(scanResult.errors) ||
            !Number.isSafeInteger(scanResult.added) || scanResult.added < 0) {
          throw new Error('Scanner returned an invalid scan receipt');
        }
        summary.scan = { ...scanResult, status: scanResult.errors.length || scanResult.unverified_zero?.length ? 'partial' : 'completed',
          added_pending: Math.max(0, readPendingCount() - beforeScan) };
        for (const item of scanResult.errors) addPhaseIssue(summary, 'scan', `${item.company}: ${item.error}`);
        for (const target of scanResult.unverified_zero || []) addPhaseIssue(summary, 'scan', `${target}: zero jobs without a successful response`);
      } catch (error) {
        if (interruptedSignal) throw error;
        summary.scan = { status: 'failed', added_pending: Math.max(0, readPendingCount() - beforeScan), error: error.message };
        addPhaseIssue(summary, 'scan', error);
      }
      log(`scan added ${summary.scan.added_pending} pending job(s); queue now ${readPendingCount()}`);
    }

    const handoff = loadHandoff();
    if (!skipScan && summary.scan?.status !== 'failed' && handoff.valid && handoff.items.length) {
      log(`scan-handoff queued ${handoff.items.length} task(s)`);
      handoff.items.forEach((item, index) => {
        const detail = item.query || item.careers_url || item.url || '';
        const suffix = detail ? ` — ${compactProgressValue(detail)}` : '';
        log(`scan-handoff task ${index + 1}/${handoff.items.length}: ${compactProgressValue(item.company)} (${compactProgressValue(item.method)})${suffix}`);
      });
      const finalPath = join(runDir, 'handoff.final.json');
      const args = [
        'exec', '--dangerously-bypass-approvals-and-sandbox', '--ephemeral',
        '-C', context.projectRoot,
        '--output-schema', systemPath('schemas/run-handoff-output.schema.json'),
        '--output-last-message', finalPath,
      ];
      if (codexSettings.model) args.push('--model', codexSettings.model);
      if (codexSettings.reasoningEffort) {
        args.push('-c', codexReasoningConfigArg(codexSettings.reasoningEffort));
      }
      args.push('-');
      const beforeHandoff = readPendingCount();
      try {
        assertOpenAIStructuredOutputSchema(JSON.parse(readFileSync(systemPath('schemas/run-handoff-output.schema.json'), 'utf8')));
        await runCommand('scan-handoff-agent', agentCli, args, {
          stdin: handoffPrompt(handoff.path), progress: handoffProgressLine,
        });
        if (!existsSync(finalPath)) throw new Error('scan-handoff agent did not write its final JSON contract');
        const observed = Math.max(0, readPendingCount() - beforeHandoff);
        const handoffResult = validateHandoff(JSON.parse(readFileSync(finalPath, 'utf8')), handoff.items.length, observed);
        summary.handoff = { ...handoffResult, observed_added_pending: observed };
        log(`scan-handoff processed ${handoffResult.processed_items}/${handoff.items.length} task(s), added ${observed} pending job(s)`);
        for (const item of handoffResult.errors) addPhaseIssue(summary, 'handoff', `${item.item}: ${item.message}`);
        if (handoffResult.status !== 'completed' && !handoffResult.errors.length) {
          addPhaseIssue(summary, 'handoff', `handoff is ${handoffResult.status}`);
        }
        if (handoffResult.requires_user_action || handoffResult.status === 'blocked') {
          addAction(summary, { kind: 'source', phase: 'handoff', reason: 'source_input',
            question: handoffResult.user_action || 'Review the scan-handoff log and resolve its blocked sources.' });
        }
      } catch (error) {
        if (interruptedSignal) throw error;
        summary.handoff = { status: 'partial', error: error.message,
          observed_added_pending: Math.max(0, readPendingCount() - beforeHandoff) };
        addPhaseIssue(summary, 'handoff', error);
      }
    } else {
      summary.handoff = { status: 'skipped', reason: handoff.valid ? 'empty' : 'missing-or-invalid' };
    }

    const portalsPath = process.env.CAREER_OPS_PORTALS || userPath(context, 'portals.yml');
    let portals = {};
    try { if (existsSync(portalsPath)) portals = yaml.load(readFileSync(portalsPath, 'utf8')) || {}; }
    catch (error) { addPhaseIssue(summary, 'scan-config', error); }
    const extraSources = [
      ['scan-full', rawArgs.includes('--scan-full'), 'scan-ats-full.mjs'],
      ['scan-hn', rawArgs.includes('--scan-hn') || portals.hn_hiring?.enabled === true, 'scan-hn.mjs'],
      ['scan-dayforce', rawArgs.includes('--scan-dayforce') || portals.dayforce_boards?.some(board => board.enabled !== false), 'scan-dayforce.mjs'],
      ['scan-interamt', rawArgs.includes('--scan-interamt') || portals.interamt_searches?.length > 0, 'scan-interamt.mjs'],
    ];
    summary.sources = [];
    if (!skipScan) for (const [name, enabled, script] of extraSources) {
      if (!enabled) continue;
      const before = readPendingCount();
      try {
        const result = await runCommand(name, process.execPath, [systemPath(script), '--user', context.userId], {
          progress: true, env: { GEMINI_API_KEY: '' },
        });
        const errors = /(?:Errors|Network errors)\s*\(([1-9]\d*)\)/i.exec(result.output);
        summary.sources.push({ name, status: errors ? 'partial' : 'completed',
          added_pending: Math.max(0, readPendingCount() - before), errors: Number(errors?.[1] || 0) });
        if (errors) addPhaseIssue(summary, name, `${errors[1]} source errors; see phase log`);
      } catch (error) {
        if (interruptedSignal) throw error;
        summary.sources.push({ name, status: 'failed', added_pending: Math.max(0, readPendingCount() - before), error: error.message });
        addPhaseIssue(summary, name, error);
        if (/captcha|challenge|login required|account verification/i.test(`${error.tail || ''} ${error.message}`)) {
          addAction(summary, { kind: 'source', phase: name, reason: 'source_login', question: `Resolve ${name}'s browser/login challenge and rerun run.` });
        }
      }
    }

    if (skipLinkedIn || skipScan) {
      summary.linkedin = { status: 'skipped', reason: skipScan ? 'explicit --skip-scan' : 'explicit --skip-linkedin' };
    } else {
      const beforeLinkedIn = readPendingCount();
      try {
        const linkedinResult = await runCommand('scan-auth-linkedin', process.execPath, [
          systemPath('scan-auth.mjs'), '--user', context.userId, 'linkedin',
        ], { progress: scanAuthProgressLine });
        const errorCount = Number(/Errors:\s*(\d+)/i.exec(linkedinResult.output)?.[1] || 0);
        summary.linkedin = {
          status: errorCount ? 'partial' : 'completed', errors: errorCount,
          added_pending: Math.max(0, readPendingCount() - beforeLinkedIn),
        };
        if (errorCount) addPhaseIssue(summary, 'linkedin', `${errorCount} listing/search errors; see phase log`);
        log(`LinkedIn added ${summary.linkedin.added_pending} pending job(s); queue now ${readPendingCount()}`);
      } catch (error) {
        const logText = `${error.output || ''}\n${error.tail || ''}\n${error.message}`;
        if (/not logged in|captcha|account verification|login required/i.test(logText)) {
          summary.linkedin = { status: 'needs-login', added_pending: 0 };
          addAction(summary, { kind: 'source', phase: 'linkedin', reason: 'source_login',
            question: `Run node scan-auth.mjs --user ${context.userId} --login linkedin in a separate terminal, then rerun the workflow.` });
        } else {
          if (interruptedSignal) throw error;
          summary.linkedin = { status: 'failed', added_pending: Math.max(0, readPendingCount() - beforeLinkedIn), error: error.message };
          addPhaseIssue(summary, 'linkedin', error);
        }
      }
    }

    const discoveredPending = readPendingCount();
    const initialBatchState = readRunBatchState(context.userRoot);
    // Finish durable output from interrupted runs before dispatching anything.
    await mergeTracker(summary, 'merge-tracker-initial');
    await runCommand('reconcile-pipeline-initial', process.execPath, [systemPath('reconcile-pipeline.mjs'), '--user', context.userId]);
    if (readPendingCount() > 0) {
      await runCommand('cv-sync-check', process.execPath, [systemPath('cv-sync-check.mjs'), '--user', context.userId]);

      const livenessArgs = [systemPath('pipeline-liveness.mjs'), '--user', context.userId, '--json'];
      if (throttle) livenessArgs.push(throttle);
      if (noFallback) livenessArgs.push('--no-fallback');
      try {
        summary.liveness = parseJsonOutput(await runCommand('pipeline-liveness', process.execPath, livenessArgs, {
          accept: [0, 2], maxStdout: 32 * 1024 * 1024,
        }), 'pipeline-liveness');
        if (summary.liveness.status !== 'completed') throw new Error('bulk liveness did not complete');
        for (const warning of summary.liveness.tracker_warnings || []) addPhaseIssue(summary, 'liveness', warning.message);
      } catch (error) {
        if (interruptedSignal) throw error;
        summary.liveness = { status: 'partial', error: error.message };
        addPhaseIssue(summary, 'liveness', error);
        // No verdict is inferred from a failed sweep. Workers still execute
        // their canonical per-posting liveness/JD gate, including local jobs.
      }

      const priorBatchPause = existsSync(userPath(context, 'batch/batch-runner.paused')) || readRunBatchState(context.userRoot).some(row => row.status === 'paused_rate_limit');
      if (priorBatchPause && !rawArgs.includes('--resume-paused')) addAction(summary, {
        kind: 'batch', phase: 'batch', reason: 'rate_limit',
        question: 'The batch is paused for a quota/session limit. Resolve it, then rerun the workflow with --resume-paused.',
      });
      for (let pass = 1; pass <= maxQueuePasses && (!priorBatchPause || rawArgs.includes('--resume-paused')); pass++) {
        const queue = actionableQueue(context.userRoot, context.userId, answers, { resumePaused: rawArgs.includes('--resume-paused') });
        if (queue.length === 0) break;
        checkBatchOwner();
        const before = queueFingerprint(queue, readRunBatchState(context.userRoot));
        summary.batch_sync = parseJsonOutput(await runCommand(`sync-pipeline-batch-${pass}`, process.execPath, [
          systemPath('sync-pipeline-batch.mjs'), '--user', context.userId, '--json',
        ], { maxStdout: 32 * 1024 * 1024 }), 'sync-pipeline-batch');
        const queueFile = join(runDir, `queue-${pass}.txt`);
        writeFileAtomic(queueFile, `${queue.map(row => row.url).join('\n')}\n`);
        const batchArgs = [
          '--user', context.userId, '--cli', batchCli,
          '--parallel', String(parallelSettings.parallel),
          '--defer-verification', '--include-pending', '--queue-file', queueFile,
        ];
        if (answerPath) batchArgs.push('--answers-file', answerPath);
        if (batchLimit) batchArgs.push('--limit', batchLimit);
        if (pass === 1 && rawArgs.includes('--retry-failed')) batchArgs.push('--retry-failed');
        if (rawArgs.includes('--resume-paused')) batchArgs.push('--resume-paused');
        if (batchCli === 'codex' && codexSettings.model) {
          batchArgs.push('--model', codexSettings.model);
        }
        if (batchCli === 'codex' && codexSettings.reasoningEffort) {
          batchArgs.push('--reasoning-effort', codexSettings.reasoningEffort);
        }
        log(`batch queue pass ${pass}: ${queue.length} runnable job(s)`);
        summary.queue_passes = pass;
        try {
          await runCommand(`batch-${pass}`, systemPath('batch/batch-runner.sh'), batchArgs, { progress: true });
        } catch (error) {
          if (interruptedSignal) throw error;
          addPhaseIssue(summary, 'batch', error);
        }
        checkBatchOwner();
        await mergeTracker(summary, `merge-tracker-${pass}`);
        await runCommand(`reconcile-pipeline-${pass}`, process.execPath, [systemPath('reconcile-pipeline.mjs'), '--user', context.userId]);
        for (const action of queueActions(context.userRoot, context.userId)) addAction(summary, action);
        // A quota pause applies to this CLI/session, including following jobs
        // and an explicit resume that immediately encounters the limit again.
        if (existsSync(userPath(context, 'batch/batch-runner.paused'))) break;
        const afterQueue = actionableQueue(context.userRoot, context.userId, answers, { resumePaused: rawArgs.includes('--resume-paused') });
        if (batchLimit || queueFingerprint(afterQueue, readRunBatchState(context.userRoot)) === before) break;
      }
    }
    const finalQueue = readRunQueue(context.userRoot);
    const currentJobs = queueActions(context.userRoot, context.userId);
    summary.manual_actions = summary.manual_actions.filter(action => action.kind !== 'job');
    for (const action of currentJobs) addAction(summary, action);
    const finalStates = readRunBatchState(context.userRoot);
    const pendingUrls = new Set(finalQueue.pending.map(row => row.url));
    for (const state of finalStates) {
      if (!pendingUrls.has(state.url)) continue;
      if (state.status === 'paused_rate_limit') addAction(summary, { kind: 'job', phase: 'batch', id: state.id,
        url: state.url, reason: 'rate_limit', question: `Wait for the CLI quota/session reset, then rerun the workflow with --resume-paused. ${state.error || ''}` });
      if (state.status === 'failed') addAction(summary, { kind: 'job', phase: 'batch', id: state.id,
        url: state.url, reason: 'job_failed', question: `Inspect batch job #${state.id} and retry after correcting its failure: ${state.error || 'see worker log'}` });
    }
    const changedStates = finalStates.filter(row => {
      const before = initialBatchState.find(old => old.id === row.id && old.url === row.url);
      return !before || row.status !== before.status || row.retries !== before.retries || row.startedAt !== before.startedAt;
    });
    summary.batch_counts = Object.fromEntries(['completed', 'skipped', 'failed', 'needs_confirmation', 'paused_rate_limit', 'processing']
      .map(status => [status, changedStates.filter(row => row.status === status).length]));
    summary.pipeline = { status: finalQueue.pending.length || finalQueue.blocked.length ? 'partial' : 'completed',
      processed: Math.max(0, discoveredPending - finalQueue.pending.length), limit: batchLimit ? Number(batchLimit) : null };

    const verifyArgs = [systemPath('verify-runner.mjs'), '--user', context.userId, '--agent-cli', agentCli, '--json'];
    verifyArgs.push('--parallel', String(parallelSettings.parallel));
    if (codexSettings.model) verifyArgs.push('--codex-model', codexSettings.model);
    if (codexSettings.reasoningEffort) verifyArgs.push('--codex-reasoning-effort', codexSettings.reasoningEffort);
    if (quiet) verifyArgs.push('--quiet');
    if (resumeVerify) verifyArgs.push('--resume-run', resumeVerify);
    const reviewedVerification = parseJsonOutput(
      await runCommand('verify-reviewed', process.execPath, verifyArgs, { accept: [0, 1], maxStdout: 64 * 1024 * 1024 }),
      'verify-reviewed',
    );
    if (!['completed', 'partial', 'failed'].includes(reviewedVerification.status) ||
        typeof reviewedVerification.needs_human_review !== 'boolean' ||
        !Array.isArray(reviewedVerification.unresolved_findings)) {
      throw new Error('verify-reviewed returned an invalid completion contract');
    }
    if (reviewedVerification.status === 'failed') {
      summary.verification_review = reviewedVerification;
      throw new Error(`verify-reviewed failed: ${reviewedVerification.error || 'unknown failure'}`);
    }
    if (reviewedVerification.status === 'partial' && !reviewedVerification.needs_human_review) {
      addPhaseIssue(summary, 'verification', 'reviewed verification is partial');
    }
    summary.verification_review = reviewedVerification;
    summary.verification = reviewedVerification.final_verification;
    if (reviewedVerification.needs_human_review) for (const finding of reviewedVerification.unresolved_findings) {
      addAction(summary, { kind: 'verification', phase: 'verification',
        id: finding.finding_id || finding.id || `finding-${summary.manual_actions.length}`,
        reason: finding.finding_code || finding.code || 'integrity_review',
        question: finding.message || 'Review the unresolved verifier finding in the run artifacts.' });
    }
    summary.needs_human_review = reviewedVerification.needs_human_review || summary.manual_actions.length > 0;
    summary.warning_triage = {
      status: reviewedVerification.passes > 0 ? 'completed' : 'skipped',
      needs_human_review: reviewedVerification.needs_human_review,
      warnings: reviewedVerification.unresolved_findings,
      seen: reviewedVerification.seen_findings,
    };
    summary.duplicate_resolution = reviewedVerification.actions;

    checkBatchOwner();
    const remainingQueue = readRunQueue(context.userRoot);
    summary.final_pending = remainingQueue.pending.length;
    summary.final_blocked = remainingQueue.blocked.length;
    summary.remaining = summary.final_pending + summary.final_blocked;
    summary.user_action = summary.manual_actions.length ? 'Resolve the listed manual actions and rerun with exact per-posting answers where needed.' : null;
    summary.status = summary.remaining === 0 && !summary.needs_human_review && summary.issues.length === 0 ? 'completed' : 'partial';
    return summary;
  } catch (error) {
    summary.status = interruptedSignal ? 'interrupted' : 'failed';
    summary.error = error.message;
    try { summary.final_pending = readPendingCount(); } catch { /* retain the original failure */ }
    return summary;
  } finally {
    if (stoppingChildren) await stoppingChildren;
    summary.finished_at = new Date().toISOString();
    if (lockOwned) {
      try {
        const queue = readRunQueue(context.userRoot);
        summary.final_pending = queue.pending.length;
        summary.final_blocked = queue.blocked.length;
        summary.remaining = queue.pending.length + queue.blocked.length;
        const sourceActions = summary.manual_actions.filter(action => action.kind !== 'job' || action.phase === 'batch');
        summary.manual_actions = sourceActions;
        for (const action of queueActions(context.userRoot, context.userId)) addAction(summary, action);
        summary.needs_human_review ||= summary.manual_actions.length > 0;
        if (summary.status === 'completed' && (summary.remaining > 0 || summary.needs_human_review || summary.issues.length > 0)) {
          summary.status = 'partial';
        }
        if (summary.manual_actions.length) summary.user_action ||= 'Resolve the listed actions; other jobs have continued independently.';
        writeFileAtomic(userPath(context, 'data/manual-actions.json'), JSON.stringify({
          schema_version: 1, user: context.userId, updated_at: summary.finished_at,
          run_id: runId, actions: summary.manual_actions,
        }, null, 2) + '\n');
      } catch (error) {
        summary.status = 'failed';
        summary.error = `${summary.error ? summary.error + '; ' : ''}Cannot persist final queue/actions: ${error.message}`;
      }
      try { writeFileAtomic(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n'); }
      catch (error) {
        summary.status = 'failed';
        summary.error = `${summary.error ? summary.error + '; ' : ''}Cannot persist run summary: ${error.message}`;
      }
    }
    if (summary.status === 'completed') {
      try {
        summary.compaction = compactCompletedRun({
          runDir,
          summary: compactRunSummary(summary),
        });
        log(`compacted completed run; removed ${summary.compaction.deleted_files} artifact(s), freed ${summary.compaction.deleted_human}`);
      } catch (error) {
        summary.compaction = { status: 'failed', error: error.message };
        log(`completed-run compaction failed: ${error.message}`);
      }
    }
    releaseLock();
  }
}

const result = await main();

function compactRunSummary(summary) {
  const compactSection = (section, fields) => {
    if (!section) return null;
    return Object.fromEntries(fields
      .filter(field => section[field] !== undefined)
      .map(field => [field, section[field]]));
  };
  return {
    schema_version: 1,
    runner: 'run',
    artifact_state: 'compacted',
    status: summary.status,
    user: summary.user,
    run_id: summary.run_id,
    started_at: summary.started_at,
    finished_at: summary.finished_at,
    baseline_pending: summary.baseline_pending,
    final_pending: summary.final_pending,
    final_blocked: summary.final_blocked,
    remaining: summary.remaining,
    batch_counts: summary.batch_counts,
    queue_passes: summary.queue_passes,
    manual_actions: summary.manual_actions,
    issues: summary.issues,
    sources: summary.sources,
    scan: compactSection(summary.scan, ['status', 'added_pending', 'reason']),
    handoff: compactSection(summary.handoff, [
      'status', 'processed_items', 'observed_added_pending', 'added', 'duplicates',
      'expired', 'requires_user_action', 'reason',
    ]),
    linkedin: compactSection(summary.linkedin, ['status', 'added_pending', 'reason']),
    liveness: compactSection(summary.liveness, [
      'status', 'checked', 'active', 'expired', 'uncertain', 'local', 'unsupported', 'moved',
    ]),
    batch_sync: compactSection(summary.batch_sync, ['status', 'pending', 'existing', 'added', 'dry_run']),
    pipeline: compactSection(summary.pipeline, ['status', 'processed', 'reason']),
    verification: summary.verification_review ? {
      status: summary.verification_review.status,
      passes: summary.verification_review.passes,
      counts: summary.verification_review.counts,
      actions: summary.verification_review.actions,
      review_resilience: summary.verification_review.review_resilience,
    } : null,
    needs_human_review: summary.needs_human_review,
    codex: summary.codex,
    parallel: summary.parallel,
    parallel_source: summary.parallel_source,
    cleanup: compactSection(summary.cleanup, [
      'status', 'retention_days', 'cutoff', 'deleted_runs', 'deleted_bytes', 'deleted_human',
    ]),
    phases: compactPhaseRecords(summary.phases),
  };
}

function reviewedCount(review) {
  return review?.reviews?.length || 0;
}

function repairedCount(review) {
  const actions = review?.actions || {};
  return [
    'duplicate_groups', 'tracker_rows_removed', 'reports_archived', 'artifacts_archived',
    'tracker_rows_restored', 'tracker_rows_patched', 'orphans_archived',
  ].reduce((total, key) => total + (Number(actions[key]) || 0), 0);
}

function printHumanSummary(summary) {
  console.log(`[run] summary: ${summary.status}`);
  console.log(`[run] queue ${summary.baseline_pending ?? 0} → ${summary.final_pending ?? 'unknown'} runnable/pending, ${summary.final_blocked} blocked; processed ${summary.pipeline?.processed || 0}`);
  console.log(`[run] discovered: scan ${summary.scan?.added_pending || 0}, handoff ${summary.handoff?.observed_added_pending || 0}, LinkedIn ${summary.linkedin?.added_pending || 0}`);
  if (summary.verification_review) {
    const unresolvedFindings = summary.verification_review.unresolved_findings || [];
    console.log(`[run] verification: reviewed ${reviewedCount(summary.verification_review)}, repaired ${repairedCount(summary.verification_review)}, unresolved ${unresolvedFindings.length}`);
    for (const line of runUnresolvedFindingLines(unresolvedFindings)) console.log(line);
  }
  console.log(`[run] logs: ${summary.logs}`);
  for (const issue of summary.issues) console.log(`[run] incomplete ${issue.phase}: ${compactProgressValue(issue.message, 1000)}`);
  for (const action of summary.manual_actions) console.log(`[run] manual ${action.reason}${action.url ? `, ${compactProgressValue(action.url)}` : ''}: ${compactProgressValue(action.question, 1000)}`);
  if (summary.user_action) console.log(`[run] action required: ${summary.user_action}`);
  if (summary.error) console.log(`[run] error: ${summary.error}`);
}

if (jsonOutput) console.log(JSON.stringify(result));
else printHumanSummary(result);
process.exitCode = interruptedSignal ? 130 : result.status === 'completed' ? 0 : result.status === 'partial' ? 2 : result.status === 'blocked' ? 3 : 1;
