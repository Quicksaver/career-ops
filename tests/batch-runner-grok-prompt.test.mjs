// Grok's batch prompt must stay under the same per-argument cap the dashboard
// already refuses. The scoring manual and the job go in a file. -p only names it.
//
// Fork layout: workers launch through batch/worker-process.mjs (upstream's Bash
// run_worker is retired), so this runs the real dispatch block with the fork's
// ownership helpers, as tests/batch-runner-grok-timeout.test.mjs does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getBash, rmSync, ROOT } from './helpers.mjs';
import { copyBatchOwnership } from './copy-batch-ownership.mjs';

const bash = getBash();
// The cap lives in web/. A checkout without web/ skips this test.
const capModule = join(ROOT, 'web', 'src', 'lib', 'oversized-prompt.mjs');
const POSIX_ARG_LIMIT = existsSync(capModule)
  ? (await import(pathToFileURL(capModule).href)).POSIX_ARG_LIMIT
  : null;
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf8').replace(/\r\n/g, '\n');
const dispatchBlock = SRC.match(/  local full_prompt=""\n  local -a model_args=\(\)\n[\s\S]*?its process tree was stopped before artifact recovery\." >> "\$log_file"\n    fi\n/)?.[0];

test('grok batch -p stays under the dashboard argument cap', { skip: (!bash && 'bash is required') || (POSIX_ARG_LIMIT == null && 'web/ is not in this checkout') }, () => {
  assert.ok(dispatchBlock, 'dispatch block missing');
  const dir = mkdtempSync(join(tmpdir(), 'batch-grok-prompt-'));
  let taskPath = '';
  try {
    copyBatchOwnership(dir);
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const manual = 'M'.repeat(POSIX_ARG_LIMIT + 4096);
    const systemPrompt = join(dir, 'system-prompt.md');
    writeFileSync(systemPrompt, manual);
    const logFile = join(dir, 'worker.log');
    const stub = join(bin, 'grok');
    writeFileSync(stub, '#!/usr/bin/env bash\nprintf \'ARG:%s\\n\' "$@"\n');
    try { execFileSync(bash, ['-c', 'chmod +x bin/grok'], { cwd: dirname(bin) }); } catch {}
    const script = join(dir, 'run.sh');
    writeFileSync(script, [
      'set -euo pipefail',
      'CLI=grok',
      'MODEL=""',
      'WORKER_TIMEOUT_SECONDS=600',
      'prompt="JOB PROMPT"',
      `resolved_prompt=${JSON.stringify(systemPrompt)}`,
      `log_file=${JSON.stringify(logFile)}`,
      `SCRIPT_DIR=${JSON.stringify(join(dir, 'batch'))}`,
      `WORKER_DIR=${JSON.stringify(dir)}`,
      'id=fixture',
      'wrapper() {',
      '  local combined_prompt_file="" original_url=https://jobs.example.test/1 url=""',
      '  local -a claude_args=(-p)',
      dispatchBlock,
      '    break',
      '  done',
      '  if [[ -n "${grok_task:-}" ]]; then printf \'TASK:%s\\n\' "$grok_task"; fi',
      '}',
      'wrapper',
    ].join('\n'));
    execFileSync(bash, [script], {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    const args = readFileSync(logFile, 'utf8').split('\n').filter((line) => line.startsWith('ARG:')).map((line) => line.slice(4));
    const promptArg = args[args.indexOf('-p') + 1];
    assert.equal(args[0], '--always-approve');
    assert.ok(promptArg, 'grok was not given -p');
    assert.ok(Buffer.byteLength(promptArg) <= POSIX_ARG_LIMIT, ` -p is ${Buffer.byteLength(promptArg)} bytes`);
    assert.ok(!promptArg.includes(manual.slice(0, 80)), 'the scoring manual was passed as an argument');
    const quoted = promptArg.match(/"([^"]+)"/);
    assert.ok(quoted, `no prompt file in: ${promptArg}`);
    taskPath = quoted[1];
    const task = readFileSync(taskPath, 'utf8');
    assert.ok(task.startsWith(manual));
    assert.ok(task.endsWith('JOB PROMPT\n') || task.includes('\n\nJOB PROMPT'));
  } finally {
    if (taskPath) rmSync(taskPath, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
