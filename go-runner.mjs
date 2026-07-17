#!/usr/bin/env node

import { spawn } from 'child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import {
  getUserContext,
  printUserContextErrorAndExit,
  systemPath,
  userPath,
} from './lib/user-context.mjs';
import { pendingCount } from './lib/pipeline-queue.mjs';
import { codexReasoningConfigArg, resolveCodexSettings } from './lib/codex-config.mjs';
import { resolveParallel } from './lib/parallel-config.mjs';
import {
  cleanupExpiredRuns,
  compactCompletedRun,
  compactPhaseRecords,
  RUN_RETENTION_DAYS,
} from './lib/run-artifacts.mjs';
import { goUnresolvedFindingLines } from './lib/go-summary.mjs';

const HELP = `career-ops deterministic go runner

Usage: ./go-runner.mjs --user <id> [options]

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
  --quiet               Suppress live phase progress
  --json                Emit the complete machine-readable result on stdout
  -h, --help            Show this help

The runner writes detailed phase logs under users/<id>/data/go-runs/. Human
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
const quiet = rawArgs.includes('--quiet');
const jsonOutput = rawArgs.includes('--json');
const valueOptions = new Set([
  '--parallel', '--agent-cli', '--batch-cli', '--codex-model', '--codex-reasoning-effort',
]);
const flagOptions = new Set(['--json', '--no-fallback', '--skip-linkedin', '--quiet', '--throttle']);
const unknown = [];
for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (valueOptions.has(arg)) { i++; continue; }
  if (flagOptions.has(arg) || arg.startsWith('--parallel=') || arg.startsWith('--agent-cli=') ||
      arg.startsWith('--batch-cli=') || arg.startsWith('--codex-model=') ||
      arg.startsWith('--codex-reasoning-effort=') || arg.startsWith('--throttle=')) continue;
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
let codexSettings = null;
let parallelSettings = null;

const startedAt = new Date().toISOString();
const runId = startedAt.replace(/[:.]/g, '-');
const runDir = userPath(context, `data/go-runs/${runId}`);
const pipelinePath = userPath(context, 'data/pipeline.md');
const lockPath = userPath(context, 'data/go-runner.pid');
const phases = [];
let activeChild = null;
let activeProcessGroup = null;
let lockOwned = false;
let terminating = false;
let interruptedSignal = null;

function log(message) {
  if (quiet) return;
  const stream = jsonOutput ? process.stderr : process.stdout;
  stream.write(`[go] ${message}\n`);
}

function readPendingCount() {
  if (!existsSync(pipelinePath)) return 0;
  return pendingCount(readFileSync(pipelinePath, 'utf-8'));
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLock() {
  mkdirSync(join(context.userRoot, 'data'), { recursive: true });
  if (existsSync(lockPath)) {
    const oldPid = Number.parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);
    if (processAlive(oldPid)) throw new Error(`another go runner is active (PID ${oldPid})`);
    rmSync(lockPath, { force: true });
  }
  const temporary = `${lockPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${process.pid}\n`, 'utf-8');
  renameSync(temporary, lockPath);
  lockOwned = true;
}

function releaseLock() {
  if (!lockOwned) return;
  try {
    if (existsSync(lockPath) && readFileSync(lockPath, 'utf-8').trim() === String(process.pid)) {
      rmSync(lockPath, { force: true });
    }
  } finally {
    lockOwned = false;
  }
}

function terminateActiveChild(signal = 'SIGTERM') {
  try {
    if (process.platform !== 'win32' && activeProcessGroup) process.kill(-activeProcessGroup, signal);
    else if (activeChild && processAlive(activeChild.pid)) activeChild.kill(signal);
  } catch {}
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (terminating) return;
    terminating = true;
    interruptedSignal = signal;
    terminateActiveChild('SIGTERM');
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
    stream.write(`[go:${name}] ${normalized}\n`);
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
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

async function runCommand(name, command, args, options = {}) {
  if (interruptedSignal) throw new Error(`interrupted by ${interruptedSignal}`);
  const logPath = join(runDir, `${String(phases.length + 1).padStart(2, '0')}-${name}.log`);
  mkdirSync(runDir, { recursive: true });
  const stdoutOutput = [];
  const errorOutput = [];
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
  const child = spawn(command, args, {
    cwd: context.projectRoot,
    env: { ...process.env, CAREER_OPS_USER: context.userId, ...(options.env || {}) },
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  activeChild = child;
  activeProcessGroup = child.pid;
  child.stdout.on('data', (chunk) => {
    stream.write(chunk);
    progress?.stdout.write(chunk);
    stdoutOutput.push(chunk.toString());
    errorOutput.push(chunk.toString());
    while (stdoutOutput.join('').length > maxStdout && stdoutOutput.length > 1) stdoutOutput.shift();
    while (errorOutput.join('').length > 24000 && errorOutput.length > 1) errorOutput.shift();
  });
  child.stderr.on('data', (chunk) => {
    stream.write(chunk);
    progress?.stderr.write(chunk);
    errorOutput.push(chunk.toString());
    while (errorOutput.join('').length > 24000 && errorOutput.length > 1) errorOutput.shift();
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
  const tail = commandTail(errorOutput);
  if (phase.status === 'failed') {
    const detail = result.error?.message || tail.trim().slice(-1000) || `exit ${result.code ?? result.signal}`;
    throw Object.assign(new Error(`${name} failed: ${detail}`), {
      phase: name, result, logPath, output: stdoutOutput.join(''), tail,
    });
  }
  return { ...result, output: stdoutOutput.join(''), logPath, phase };
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

function handoffPrompt(handoffPath) {
  return `You are the one-off scan-handoff worker for career-ops.

ACTIVE_USER=${context.userId}
USER_ROOT=${context.userRoot}
HANDOFF_FILE=${handoffPath}

Execute exactly the scan-handoff phase, not the full go, scan, scan-auth, pipeline, or batch flow.
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
  };

  try {
    acquireLock();
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

    summary.baseline_pending = readPendingCount();

    const beforeScan = readPendingCount();
    await runCommand('scan', process.execPath, [systemPath('scan.mjs'), '--user', context.userId], {
      progress: scanProgressLine,
      env: { CAREER_OPS_PROGRESS: '1' },
    });
    const afterScan = readPendingCount();
    summary.scan = { status: 'completed', added_pending: Math.max(0, afterScan - beforeScan) };
    log(`scan added ${summary.scan.added_pending} pending job(s); queue now ${afterScan}`);

    const handoff = loadHandoff();
    if (handoff.valid && handoff.items.length) {
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
        '--output-schema', systemPath('schemas/go-handoff-output.schema.json'),
        '--output-last-message', finalPath,
      ];
      if (codexSettings.model) args.push('--model', codexSettings.model);
      if (codexSettings.reasoningEffort) {
        args.push('-c', codexReasoningConfigArg(codexSettings.reasoningEffort));
      }
      args.push('-');
      const beforeHandoff = readPendingCount();
      await runCommand('scan-handoff-agent', agentCli, args, {
        stdin: handoffPrompt(handoff.path),
        progress: handoffProgressLine,
      });
      if (!existsSync(finalPath)) throw new Error('scan-handoff agent did not write its final JSON contract');
      const handoffResult = JSON.parse(readFileSync(finalPath, 'utf-8'));
      summary.handoff = {
        ...handoffResult,
        observed_added_pending: Math.max(0, readPendingCount() - beforeHandoff),
      };
      log(`scan-handoff processed ${handoffResult.processed_items}/${handoff.items.length} task(s), added ${summary.handoff.observed_added_pending} pending job(s); queue now ${readPendingCount()}`);
      if (handoffResult.status === 'blocked' || handoffResult.requires_user_action) {
        summary.status = 'blocked';
        summary.user_action = handoffResult.user_action || 'Scan handoff requires user action.';
        return summary;
      }
    } else {
      summary.handoff = { status: 'skipped', reason: handoff.valid ? 'empty' : 'missing-or-invalid' };
    }

    if (skipLinkedIn) {
      summary.linkedin = { status: 'skipped', reason: 'explicit --skip-linkedin' };
    } else {
      const beforeLinkedIn = readPendingCount();
      try {
        await runCommand('scan-auth-linkedin', process.execPath, [
          systemPath('scan-auth.mjs'), '--user', context.userId, 'linkedin',
        ], { progress: scanAuthProgressLine });
        summary.linkedin = {
          status: 'completed',
          added_pending: Math.max(0, readPendingCount() - beforeLinkedIn),
        };
        log(`LinkedIn added ${summary.linkedin.added_pending} pending job(s); queue now ${readPendingCount()}`);
      } catch (error) {
        const logText = `${error.output || ''}\n${error.tail || ''}\n${error.message}`;
        if (/not logged in|captcha|account verification|login required/i.test(logText)) {
          summary.status = 'blocked';
          summary.linkedin = { status: 'needs-login', added_pending: 0 };
          summary.user_action = `Run node scan-auth.mjs --user ${context.userId} --login linkedin in a separate terminal, then rerun go.`;
          return summary;
        }
        throw error;
      }
    }

    const discoveredPending = readPendingCount();
    if (discoveredPending <= summary.baseline_pending) {
      summary.pipeline = { status: 'skipped', reason: 'no-new-pending', processed: 0 };
    } else {
      await runCommand('cv-sync-check', process.execPath, [systemPath('cv-sync-check.mjs'), '--user', context.userId]);

      const livenessArgs = [systemPath('pipeline-liveness.mjs'), '--user', context.userId, '--json'];
      if (throttle) livenessArgs.push(throttle);
      if (noFallback) livenessArgs.push('--no-fallback');
      summary.liveness = parseJsonOutput(
        await runCommand('pipeline-liveness', process.execPath, livenessArgs, {
          accept: [0, 2], maxStdout: 32 * 1024 * 1024,
        }),
        'pipeline-liveness',
      );

      summary.batch_sync = parseJsonOutput(
        await runCommand('sync-pipeline-batch', process.execPath, [
          systemPath('sync-pipeline-batch.mjs'), '--user', context.userId, '--json',
        ], { maxStdout: 32 * 1024 * 1024 }),
        'sync-pipeline-batch',
      );

      if (readPendingCount() > 0) {
        const batchArgs = [
          '--user', context.userId, '--cli', batchCli,
          '--parallel', String(parallelSettings.parallel),
          '--defer-verification',
        ];
        if (batchCli === 'codex' && codexSettings.model) {
          batchArgs.push('--model', codexSettings.model);
        }
        if (batchCli === 'codex' && codexSettings.reasoningEffort) {
          batchArgs.push('--reasoning-effort', codexSettings.reasoningEffort);
        }
        log(`batch queue ready: ${readPendingCount()} pending job(s)`);
        await runCommand('batch', systemPath('batch/batch-runner.sh'), batchArgs, { progress: true });
      }
      await runCommand('merge-tracker', process.execPath, [systemPath('merge-tracker.mjs'), '--user', context.userId]);
      await runCommand('reconcile-pipeline', process.execPath, [systemPath('reconcile-pipeline.mjs'), '--user', context.userId]);
      summary.pipeline = {
        status: readPendingCount() === 0 ? 'completed' : 'partial',
        processed: Math.max(0, discoveredPending - readPendingCount()),
      };
    }

    const verifyArgs = [systemPath('verify-runner.mjs'), '--user', context.userId, '--agent-cli', agentCli, '--json'];
    verifyArgs.push('--parallel', String(parallelSettings.parallel));
    if (codexSettings.model) verifyArgs.push('--codex-model', codexSettings.model);
    if (codexSettings.reasoningEffort) verifyArgs.push('--codex-reasoning-effort', codexSettings.reasoningEffort);
    if (quiet) verifyArgs.push('--quiet');
    const reviewedVerification = parseJsonOutput(
      await runCommand('verify-reviewed', process.execPath, verifyArgs, { maxStdout: 64 * 1024 * 1024 }),
      'verify-reviewed',
    );
    if (reviewedVerification.status === 'failed') {
      throw new Error(`verify-reviewed failed: ${reviewedVerification.error || 'unknown failure'}`);
    }
    summary.verification_review = reviewedVerification;
    summary.verification = reviewedVerification.final_verification;
    summary.needs_human_review = reviewedVerification.needs_human_review;
    summary.warning_triage = {
      status: reviewedVerification.passes > 0 ? 'completed' : 'skipped',
      needs_human_review: reviewedVerification.needs_human_review,
      warnings: reviewedVerification.unresolved_findings,
      seen: reviewedVerification.seen_findings,
    };
    summary.duplicate_resolution = reviewedVerification.actions;

    const batchPidPath = userPath(context, 'batch/batch-runner.pid');
    if (existsSync(batchPidPath)) {
      const batchPid = Number.parseInt(readFileSync(batchPidPath, 'utf-8').trim(), 10);
      if (processAlive(batchPid)) throw new Error(`batch runner still active after terminal verification (PID ${batchPid})`);
      rmSync(batchPidPath, { force: true });
    }
    summary.final_pending = readPendingCount();
    const queueComplete = summary.final_pending === 0 || summary.pipeline?.status === 'skipped';
    summary.status = queueComplete && !summary.needs_human_review ? 'completed' : 'partial';
    return summary;
  } catch (error) {
    summary.status = interruptedSignal ? 'interrupted' : 'failed';
    summary.error = error.message;
    summary.final_pending = readPendingCount();
    return summary;
  } finally {
    summary.finished_at = new Date().toISOString();
    if (summary.status === 'completed') {
      try {
        summary.compaction = compactCompletedRun({
          runDir,
          summary: compactGoSummary(summary),
        });
        log(`compacted completed run; removed ${summary.compaction.deleted_files} artifact(s), freed ${summary.compaction.deleted_human}`);
      } catch (error) {
        summary.compaction = { status: 'failed', error: error.message };
        log(`completed-run compaction failed: ${error.message}`);
      }
    }
    if (!interruptedSignal) releaseLock();
  }
}

const result = await main();
if (interruptedSignal && activeProcessGroup) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  terminateActiveChild('SIGKILL');
  releaseLock();
}

function compactGoSummary(summary) {
  const compactSection = (section, fields) => {
    if (!section) return null;
    return Object.fromEntries(fields
      .filter(field => section[field] !== undefined)
      .map(field => [field, section[field]]));
  };
  return {
    schema_version: 1,
    runner: 'go',
    artifact_state: 'compacted',
    status: summary.status,
    user: summary.user,
    run_id: summary.run_id,
    started_at: summary.started_at,
    finished_at: summary.finished_at,
    baseline_pending: summary.baseline_pending,
    final_pending: summary.final_pending,
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
  console.log(`[go] summary: ${summary.status}`);
  console.log(`[go] queue ${summary.baseline_pending ?? 0} → ${summary.final_pending ?? 'unknown'} pending; processed ${summary.pipeline?.processed || 0}`);
  console.log(`[go] discovered: scan ${summary.scan?.added_pending || 0}, handoff ${summary.handoff?.observed_added_pending || 0}, LinkedIn ${summary.linkedin?.added_pending || 0}`);
  if (summary.verification_review) {
    const unresolvedFindings = summary.verification_review.unresolved_findings || [];
    console.log(`[go] verification: reviewed ${reviewedCount(summary.verification_review)}, repaired ${repairedCount(summary.verification_review)}, unresolved ${unresolvedFindings.length}`);
    for (const line of goUnresolvedFindingLines(unresolvedFindings)) console.log(line);
  }
  console.log(`[go] logs: ${summary.logs}`);
  if (summary.user_action) console.log(`[go] action required: ${summary.user_action}`);
  if (summary.error) console.log(`[go] error: ${summary.error}`);
}

if (jsonOutput) console.log(JSON.stringify(result));
else printHumanSummary(result);
process.exitCode = interruptedSignal ? 130 : result.status === 'completed' ? 0 : result.status === 'partial' ? 2 : result.status === 'blocked' ? 3 : 1;
