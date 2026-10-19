// batch-runner.sh: --cli grok, a per-worker time limit, and workers that never
// read the runner's stdin.
//
// Fork layout: every worker launches through batch/worker-process.mjs, which
// owns the timeout (a wall-clock deadline, so no Bash arithmetic can wrap) and
// the process-tree ownership record. Upstream's Bash `run_worker` watchdog is
// retired here. Like tests/batch-runner-cli-dispatch.test.mjs, this extracts
// the real dispatch block from batch/batch-runner.sh and runs it with a stub
// CLI on PATH, so the test cannot drift from the script.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, getBash } from './helpers.mjs';
import { copyBatchOwnership } from './copy-batch-ownership.mjs';

const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');
const dispatchBlock = SRC.match(/  local full_prompt=""\n  local -a model_args=\(\)\n[\s\S]*?its process tree was stopped before artifact recovery\." >> "\$log_file"\n    fi\n/)?.[0];

test('usage and prerequisites accept --cli grok and document --worker-timeout', () => {
  assert.match(SRC, /Supported: claude, codex, opencode, gemini, qwen, grok/);
  assert.match(SRC, /--worker-timeout N/);
  assert.match(SRC, /grok\) node "\$SCRIPT_DIR\/worker-process\.mjs" run "\$WORKER_TIMEOUT_SECONDS"/);
});

function stub(bin, name, body) {
  const path = join(bin, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  if (process.platform === 'win32') {
    try { execFileSync(getBash(), ['-c', `chmod +x bin/${name}`], { cwd: dirname(bin) }); } catch {}
  } else {
    chmodSync(path, 0o755);
  }
}

test('grok launches through worker-process.mjs with one prompt argument, closed stdin and a timeout', () => {
  assert.ok(dispatchBlock, 'dispatch block through the timeout handling in batch/batch-runner.sh');
  const work = mkdtempSync(join(tmpdir(), 'batch-grok-'));
  try {
    copyBatchOwnership(work);
    const bin = join(work, 'bin');
    mkdirSync(bin);
    const systemPrompt = join(work, 'system-prompt.md');
    writeFileSync(systemPrompt, 'SYSTEM PROMPT');
    const logFile = join(work, 'worker.log');
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };

    const run = (timeout) => {
      const script = join(work, `grok-${timeout}.sh`);
      writeFileSync(script, [
        'set -euo pipefail',
        'CLI=grok',
        'MODEL=""',
        `WORKER_TIMEOUT_SECONDS=${timeout}`,
        'prompt="JOB PROMPT"',
        `resolved_prompt=${JSON.stringify(systemPrompt)}`,
        `log_file=${JSON.stringify(logFile)}`,
        `SCRIPT_DIR=${JSON.stringify(join(work, 'batch'))}`,
        `WORKER_DIR=${JSON.stringify(work)}`,
        'id=fixture',
        'wrapper() {',
        '  local combined_prompt_file="" original_url=https://jobs.example.test/1 url=""',
        '  local -a claude_args=(-p)',
        dispatchBlock,
        '    break',
        '  done',
        '  printf \'EXIT:%s TIMED_OUT:%s\\n\' "$exit_code" "$timed_out"',
        '}',
        'wrapper',
      ].join('\n'));
      const started = Date.now();
      const out = execFileSync(getBash(), [script], { encoding: 'utf-8', timeout: 60_000, env, input: 'RUNNER STDIN\n' });
      return { out, seconds: (Date.now() - started) / 1000, log: existsSync(logFile) ? readFileSync(logFile, 'utf-8') : '' };
    };

    stub(bin, 'grok', [
      'printf \'ARG:%s\\n\' "$@"',
      'if IFS= read -r line; then echo "STDIN:$line"; else echo "STDIN:eof"; fi',
    ].join('\n'));
    const grok = run(600);
    const args = grok.log.split('\n').filter(l => l.startsWith('ARG:')).map(l => l.slice(4));
    assert.match(grok.out, /EXIT:0 TIMED_OUT:false/, grok.log);
    assert.deepEqual(args.slice(0, 4), ['--always-approve', '--output-format', 'plain', '-p']);
    assert.ok(grok.log.includes('ARG:SYSTEM PROMPT\n\nJOB PROMPT'), `grok prompt drifted: ${JSON.stringify(grok.log.slice(0, 160))}`);
    assert.match(grok.log, /STDIN:eof/, 'the worker reads EOF, not the runner\'s stdin');
    assert.equal(existsSync(join(work, 'fixture.json')), false, 'the drained worker leaves no ownership record');

    stub(bin, 'grok', 'sleep 30');
    const slow = run(2);
    assert.match(slow.out, /EXIT:124 TIMED_OUT:true/, slow.log);
    assert.ok(slow.seconds < 20, `slow worker took ${slow.seconds}s`);
    assert.match(slow.log, /timed out after 2s; its process tree was stopped/, 'the timeout is written to the worker log, where the failure message is read from');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// The fork validates the timeout once in Node and enforces it as a wall-clock
// deadline in worker-process.mjs, so huge values cannot wrap into "disabled" or
// "expire now"; only non-numeric or negative values are rejected.
test('--worker-timeout accepts 0, leading zeroes and huge values, and rejects invalid ones', () => {
  const work = mkdtempSync(join(tmpdir(), 'batch-worker-timeout-flag-'));
  try {
    const batch = join(work, 'batch');
    mkdirSync(batch);
    copyFileSync(join(ROOT, 'batch/batch-runner.sh'), join(batch, 'batch-runner.sh'));
    const fakeBin = join(work, 'bin');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'claude'), '#!/usr/bin/env bash\nexit 99\n', { mode: 0o755 });
    const env = { ...process.env, PATH: fakeBin + delimiter + process.env.PATH };
    const flag = (value) => spawnSync(getBash(), [join(batch, 'batch-runner.sh'), '--help', '--worker-timeout', value], { encoding: 'utf8', timeout: 10000, env });
    const parse = (value) => spawnSync(getBash(), [join(batch, 'batch-runner.sh'), '--worker-timeout', value, '--user', 'no/such'], { encoding: 'utf8', timeout: 10000, env });
    for (const value of ['0', '0009', '9223372036854775807', '99999999999999999999']) {
      const res = parse(value);
      assert.doesNotMatch(res.stdout + res.stderr, /worker timeout must be/, value);
    }
    for (const value of ['-1', 'abc', ' ']) {
      const res = parse(value);
      assert.equal(res.status, 1, value);
      assert.match(res.stdout + res.stderr, /worker timeout must be a finite nonnegative number/, value);
    }
    assert.equal(flag('5').status, 0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('worker-process.mjs enforces a huge timeout as a far deadline, not an immediate kill', async () => {
  const { runWorker } = await import('../batch/worker-process.mjs');
  const work = mkdtempSync(join(tmpdir(), 'batch-worker-huge-timeout-'));
  try {
    const code = await runWorker(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], {
      timeoutSeconds: '99999999999999999999', registrationPath: join(work, 'w.json'),
    });
    assert.equal(code, 0);
    assert.equal(existsSync(join(work, 'w.json.timeout')), false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
