import { copyBatchOwnership } from './copy-batch-ownership.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getBash, rmSync } from './helpers.mjs';

const source = readFileSync(new URL('../batch/batch-runner.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const functions = source.slice(source.indexOf('is_rate_limit_log() {'), source.indexOf('reserve_report_num_unlocked() {'));
const validation = source.slice(source.indexOf('if ! [[ "$RATE_LIMIT_SLEEP"'), source.indexOf('if ! is_decimal_number "$MIN_SCORE"'));
const loop = source.slice(source.indexOf('  local exit_code=0', source.indexOf('  local full_prompt=""')), source.indexOf('  # Cleanup resolved prompt'));
assert.match(functions, /rate_limit_delay\(\)/);
assert.match(loop, /retry_delay=\$\(rate_limit_delay/);

// Execute the actual shell helper/retry loop, with only external workers,
// sleeping and state I/O stubbed. No real provider calls or wall-clock waits.
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'batch-backoff-'));
  try {
    const invoke = (script, env = {}) => {
      writeFileSync(join(dir, 'run.sh'), `set -euo pipefail\n${script}\n`);
      return execFileSync(getBash(), ['run.sh'], {
        cwd: dir, env: { ...process.env, CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: dir, ...env }, encoding: 'utf8', timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    };
    run({ dir, invoke });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('adaptive delays grow, saturate, honor small caps and remain within jitter bounds', () => fixture(({ invoke }) => {
  const output = invoke(`${functions}
    : > worker.log
    for RATE_LIMIT_SLEEP in 1 8 30 31 300 2147483647; do
      for retry in 0 1 2 3 4 1000000; do
        for sample in 1 2 3 4 5; do
          # Called in place, not captured: a $(...) per sample is a process per
          # sample, and 180 of those alone outlasted this fixture's timeout on a
          # Windows machine where a process start costs tens of milliseconds.
          printf '%s %s ' "$RATE_LIMIT_SLEEP" "$retry"
          rate_limit_delay worker.log "$retry"
        done
      done
    done`);
  for (const line of output.split('\n')) {
    const [cap, retry, delay] = line.split(' ').map(Number);
    const nominal = Math.min(cap, Math.min(30, cap) * 2 ** retry);
    assert.ok(delay >= nominal && delay <= Math.min(cap, Math.floor(nominal * 1.2)), line);
  }
}));

test('Retry-After accepts only complete integer headers and never evaluates log text', () => fixture(({ dir, invoke }) => {
  for (const [log, low, high] of [
    ['Retry-After: 1', 30, 36],
    ['Retry-After: 0', 30, 36],
    [' \trEtRy-AfTeR: 00080\r\n', 80, 96],
    ['Retry-After: 80\nRetry-After: 40', 80, 96],
    ['Retry-After: 300', 300, 300],
    ['Retry-After: 301', 'pause', 'pause'],
    [`Retry-After: ${'9'.repeat(400)}`, 'pause', 'pause'],
    ['Retry-After: 301\nRetry-After: 1', 'pause', 'pause'],
    ...['-1', '+2', '1.5', '1e2', 'Wed, 21 Oct 2015 07:28:00 GMT', '8 seconds',
      '$(touch injected)', '`touch injected`', 'x[$(touch injected)]', '80; touch injected', ''].map(value => [`Retry-After: ${value}`, 120, 144]),
    ['text Retry-After: 80', 120, 144],
    ['{"Retry-After":80}', 120, 144],
    ['', 120, 144],
  ]) {
    writeFileSync(join(dir, 'worker.log'), log);
    const result = invoke(`${functions}\nRATE_LIMIT_SLEEP=300\nrate_limit_delay worker.log 2`);
    if (low === 'pause') assert.equal(result, 'pause', log);
    else assert.ok(Number(result) >= low && Number(result) <= high, `${log}: ${result}`);
    assert.equal(existsSync(join(dir, 'injected')), false);
  }
}));

test('ceiling validation normalizes decimal zeros and rejects unsafe or overflowing values', () => fixture(({ invoke }) => {
  for (const [value, expected] of [['000', '0'], ['008', '8'], ['0300', '300'], ['2147483647', '2147483647']]) {
    assert.equal(invoke(`${validation}\nprintf '%s' "$RATE_LIMIT_SLEEP"`, { RATE_LIMIT_SLEEP: value }), expected);
  }
  for (const value of ['2147483648', '999999999999999999999999', '-1', '1.5', '1+2', '$(touch injected)']) {
    assert.throws(() => invoke(validation, { RATE_LIMIT_SLEEP: value }), /Command failed/);
  }
}));

function runLoop({ invoke, dir }, { cap = 300, retries = 0, max = 2, log = 'API Error: 429 Too Many Requests', successAfter = 99, cli = 'claude', secondLog = log, successLog = '' } = {}) {
  writeFileSync(join(dir, 'first.log'), log);
  writeFileSync(join(dir, 'second.log'), secondLog);
  writeFileSync(join(dir, 'success.log'), successLog);
  return invoke(`${functions}
    RATE_LIMIT_SLEEP=${cap}
    MAX_RETRIES=${max}
    CLI=${cli}
    PAUSE_FILE=pause.tsv
    BATCH_PAUSED=false
    calls=0
    echo 0 > calls.count
    claude() {
      calls=$(( $(cat calls.count) + 1 ))
      echo "$calls" > calls.count
      if (( calls > ${successAfter} )); then cat success.log; return 0; fi
      if (( calls == 1 )); then cat first.log; else cat second.log; fi
      return 1
    }
    qwen() { claude; }
    codex() { claude; }
    sleep() { [[ "$1" == 1 ]] || printf 'SLEEP:%s\n' "$1"; }
    update_state_retrying() { printf 'STATE:%s:%s:%s\n' "$3" "$8" "$9"; }
    worker() {
      local retries=${retries} id=1 url=https://example.com started_at=start report_num=001 log_file=worker.log
      local original_url=https://example.com explicit_failed_retry=false
      local -a claude_args=(-p) model_args=()
      local full_prompt=fixture stdin_file=/dev/null combined_prompt_file=/dev/null
      local -a worker_args=(-p)
      WORKER_TIMEOUT_SECONDS=10000
      terminal_failure_recorded=false
      timed_out=false
      ${loop}
      calls=$(cat calls.count)
      printf 'END:%s:%s:%s:%s\n' "$calls" "$retries" "$terminal_failure_recorded" "$exit_code"
    }
    worker`);
}

test('retry loop records actual waits, enforces retry budget, and ignores stale headers', () => fixture(ctx => {
  const out = runLoop(ctx, { log: 'API Error: 429 Too Many Requests\nRetry-After: 80', secondLog: 'API Error: 429 Too Many Requests' });
  const sleeps = [...out.matchAll(/SLEEP:(\d+)/g)].map(m => Number(m[1]));
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 80 && sleeps[0] <= 96);
  assert.ok(sleeps[1] >= 60 && sleeps[1] <= 72);
  sleeps.forEach((delay, i) => assert.ok(out.includes(`STATE:rate_limited:rate-limit; retrying after ${delay}s:${i + 1}`)));
  assert.match(out, /END:3:2:false:1/);
  assert.match(runLoop(ctx, { retries: 1, successAfter: 1 }), /END:2:2:false:0/);
  const exhausted = runLoop(ctx, { max: 0 });
  assert.doesNotMatch(exhausted, /SLEEP:/);
  assert.match(exhausted, /END:1:0:false:1/);
}));

test('zero, over-cap and session pauses preserve retries and use the existing pause marker', () => fixture(ctx => {
  for (const options of [{ cap: 0 }, { log: 'API Error: 429 Too Many Requests\nRetry-After: 301' }, { log: 'session limit' }]) {
    const out = runLoop(ctx, { ...options, retries: 1 });
    assert.doesNotMatch(out, /SLEEP:/);
    assert.match(out, /STATE:paused_rate_limit:.*:1/);
    assert.match(out, /END:1:1:true:1/);
    assert.match(readFileSync(join(ctx.dir, 'pause.tsv'), 'utf8'), /^1\t001\t/);
  }
}));

test('successful, non-rate-limit and non-Claude workers do not back off', () => fixture(ctx => {
  for (const options of [{ successAfter: 0 }, { log: 'unrelated failure' }, { cli: 'qwen' }]) {
    const out = runLoop(ctx, options);
    assert.doesNotMatch(out, /SLEEP:|STATE:/);
    assert.match(out, /END:1:0:false:/);
  }
}));

test('Codex report 429, quoted job text and ordinary artifact errors never pause the retry loop', () => fixture(ctx => {
  for (const log of [
    '429',
    '{"status":"completed","report_num":"429","report":"reports/429-acme.md","error":null}',
    '{"status":"failed","report_num":"429","error":"missing artifact reports/429-acme.md"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"The JD says rate limit reached and 429 Too Many Requests"}}',
    'Job text: rate limit reached for a client API returning 429',
    'Error: missing artifact reports/429-acme.md',
    '{"type":"error","message":"missing artifact reports/429-acme.md"}',
  ]) {
    const failed = runLoop(ctx, {cli:'codex', log});
    assert.match(failed,/END:1:0:false:1/); assert.doesNotMatch(failed,/STATE:paused_rate_limit/);
    const succeeded = runLoop(ctx,{cli:'codex',successAfter:0,successLog:log});
    assert.match(succeeded,/END:1:0:false:0/); assert.doesNotMatch(succeeded,/STATE:paused_rate_limit/);
  }
}));

test('Codex quota and session provider errors pause only on a failed worker exit', () => fixture(ctx => {
  for (const log of [
    'ERROR: Rate limit reached for this model',
    'API Error: 429 Too Many Requests',
    'ERROR: unexpected status 429 Too Many Requests: quota exhausted',
    '{"type":"error","message":"stream disconnected before completion: You exceeded your current quota, please check your plan and billing details."}',
    "You've hit your usage limit. Try again later.",
    'You have hit your session limit. Resets 5pm.',
    '{"type":"error","error":{"type":"rate_limit_error","message":"provider limit"}}',
    '{"error":{"code":"insufficient_quota","message":"quota exhausted"}}',
    '{"type":"turn.failed","error":{"code":"usage_limit_reached","message":"usage exhausted"}}',
    '{"type":"error","message":"You have hit your usage limit"}',
  ]) {
    const failed=runLoop(ctx,{cli:'codex',log,retries:1});
    assert.match(failed,/STATE:paused_rate_limit:.*:1/); assert.match(failed,/END:1:1:true:1/);
    const succeeded=runLoop(ctx,{cli:'codex',successAfter:0,successLog:log,retries:1});
    assert.match(succeeded,/END:1:1:false:0/); assert.doesNotMatch(succeeded,/STATE:paused_rate_limit/);
  }
}));

test('full runner resumes persisted retries and schedules paused rows only with --resume-paused', () => fixture(({ dir, invoke }) => {
  mkdirSync(join(dir, 'batch'));
  writeFileSync(join(dir, 'batch/batch-runner.sh'), source);
  copyBatchOwnership(dir);
  writeFileSync(join(dir, 'batch/batch-prompt.md'), 'Fixture prompt');
  writeFileSync(join(dir, 'batch/batch-input.tsv'), 'id\turl\tsource\tnotes\n1\thttps://example.com/job\ttest\tfixture\n');
  // Isolate report allocation and post-run integrations; use the real runner's
  // argument parsing, scheduling, state reads/writes, process_offer and backoff.
  writeFileSync(join(dir, 'reserve-report-num.mjs'), 'if (!process.argv.includes("--release")) console.log("001");\n');
  for (const script of ['merge-tracker', 'reconcile-pipeline', 'verify-pipeline']) {
    writeFileSync(join(dir, `${script}.mjs`), '// No external integrations in this fixture.\n');
  }
  const stateFile = join(dir, 'batch/batch-state.tsv');
  for (const [status, resume, scheduled] of [
    ['rate_limited', false, true],
    ['paused_rate_limit', false, false],
    ['paused_rate_limit', true, true],
  ]) {
    const state = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
      + `1\thttps://example.com/job\t${status}\tstart\tend\t001\t-\t429\t1\n`;
    writeFileSync(stateFile, state);
    const output = invoke(`
      : > calls.log
      claude() { echo called >> calls.log; echo 'API Error: 429 Too Many Requests'; return 1; }
      curl() { return 1; }
      sleep() {
        [[ "$1" != 1 ]] || return 0
        printf 'SLEEP:%s\n' "$1"
        cp batch/batch-state.tsv sleeping-state.tsv
      }
      source batch/batch-runner.sh --cli claude --model fixture ${resume ? '--resume-paused' : ''}`);
    const calls = readFileSync(join(dir, 'calls.log'), 'utf8').trim();
    if (!scheduled) {
      assert.equal(calls, '');
      assert.doesNotMatch(output, /SLEEP:/);
      assert.equal(readFileSync(stateFile, 'utf8'), state);
      continue;
    }
    assert.equal(calls.split('\n').length, 2, status);
    const delays = [...output.matchAll(/SLEEP:(\d+)/g)].map(m => Number(m[1]));
    assert.equal(delays.length, 1, output);
    assert.ok(delays[0] >= 60 && delays[0] <= 72, output);
    const sleeping = readFileSync(join(dir, 'sleeping-state.tsv'), 'utf8').trim().split('\n')[1].split('\t');
    assert.equal(sleeping[2], 'rate_limited');
    assert.equal(sleeping[7], `rate-limit; retrying after ${delays[0]}s`);
    assert.equal(sleeping[8], '2');
    const final = readFileSync(stateFile, 'utf8').trim().split('\n')[1].split('\t');
    assert.equal(final[2], 'failed');
    assert.equal(final[8], '2');
  }
}));
