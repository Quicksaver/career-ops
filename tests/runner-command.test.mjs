import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGitBash, resolveRunnerCommand, terminateProcessTree, terminateProcessTreeSync } from '../lib/runner-command.mjs';
import { resolveCodexSettings } from '../lib/codex-config.mjs';
import { acquirePipelineLock } from '../pipeline-lock.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = () => mkdtempSync(join(tmpdir(), 'career-ops-command space-'));
const cleanup = path => rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
const values = ['space inside', '"quoted"', "single'quote", '& | < > ^ %PATH% !', '$(touch NEVER_CREATED)', '`echo no`', '', 'line\nbreak', 'C:\\path with space\\', 'backslash\\"quote'];
const run = launch => spawnSync(launch.command, launch.args, { ...launch.options, encoding: 'utf8', timeout: 10000 });

test('Codex defaults and per-field precedence are explicit', () => {
  const dir = temporary();
  try {
    assert.deepEqual(resolveCodexSettings(), {
      model: 'gpt-6.1-sol', reasoningEffort: 'medium', modelSource: 'default', reasoningEffortSource: 'default',
    });
    const profilePath = join(dir, 'profile.yml');
    writeFileSync(profilePath, 'codex:\n  model: profile-model\n  reasoning_effort: high\n');
    assert.deepEqual(resolveCodexSettings({ profilePath, modelOverride: 'run-model' }), {
      model: 'run-model', reasoningEffort: 'high', modelSource: 'argument', reasoningEffortSource: 'profile',
    });
    assert.equal(resolveCodexSettings({ profilePath, reasoningEffortOverride: 'low' }).reasoningEffort, 'low');
    assert.throws(() => resolveCodexSettings({ reasoningEffortOverride: 'invalid' }));
  } finally { cleanup(dir); }
});

test('Windows npm CLI resolution preserves argv through .cmd, PATH and PowerShell wrappers', { skip: process.platform !== 'win32' }, () => {
  const dir = temporary();
  try {
    const cli = join(dir, 'mock-cli.mjs');
    writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)));');
    const shim = join(dir, 'mock.cmd');
    writeFileSync(shim, '@echo off\r\n"node.exe" "%dp0%\\mock-cli.mjs" %*\r\n');
    const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` };
    for (const command of [shim, 'mock']) {
      const launch = resolveRunnerCommand(command, values, { env });
      assert.equal(launch.command, process.execPath);
      assert.equal(launch.options.shell, false);
      const result = run(launch);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), values);
    }
    writeFileSync(join(dir, 'mock.ps1'), '& "node.exe" "$basedir/mock-cli.mjs" $args\n');
    assert.deepEqual(JSON.parse(run(resolveRunnerCommand(shim, values)).stdout), values);
    writeFileSync(join(dir, 'unsafe.cmd'), '@echo off\necho %*');
    assert.throws(() => resolveRunnerCommand(join(dir, 'unsafe.cmd'), values), /without a shell/);
    assert.equal(existsSync(join(dir, 'NEVER_CREATED')), false);
  } finally { cleanup(dir); }
});

test('Windows .sh launch uses explicit Git Bash and preserves metacharacters and spaces', { skip: process.platform !== 'win32' }, () => {
  const dir = temporary();
  try {
    const bash = resolveGitBash();
    const gitRoot = join(dir, 'custom-git');
    for (const subdir of ['cmd', 'bin', 'usr/bin']) mkdirSync(join(gitRoot, subdir), { recursive: true });
    writeFileSync(join(gitRoot, 'cmd/git.exe'), 'fixture');
    writeFileSync(join(gitRoot, 'bin/bash.exe'), 'fixture');
    writeFileSync(join(gitRoot, 'usr/bin/cygpath.exe'), 'fixture');
    const gitOnPath = resolveGitBash({ env: { PATH: join(gitRoot, 'cmd'), ProgramFiles: join(dir, 'absent') } });
    assert.equal(gitOnPath, join(gitRoot, 'bin/bash.exe'));
    const help = run(resolveRunnerCommand('bash', ['--help']));
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /GNU bash/);
    assert.equal(run(resolveRunnerCommand(bash, ['--help'])).status, 0);
    const script = join(dir, 'arguments with spaces.sh');
    writeFileSync(script, '#!/usr/bin/env bash\nprintf \'%s\\0\' "$@"\n');
    const launch = resolveRunnerCommand(script, values, { bashPath: bash });
    assert.equal(launch.command, bash);
    const result = run(launch);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.split('\0').slice(0, -1), values);
    assert.throws(() => resolveGitBash({ bashPath: 'C:/Windows/System32/bash.exe' }), /Git Bash/);
    const batchHelp = run(resolveRunnerCommand(join(root, 'batch/batch-runner.sh'), ['--help']));
    assert.equal(batchHelp.status, 0, batchHelp.stderr);
    assert.match(batchHelp.stdout, /Usage/);
  } finally { cleanup(dir); }
});

test('Codex resolver isolates user data and safely quotes shell assignments', () => {
  const dir = temporary();
  try {
    const user = join(dir, 'test/config');
    mkdirSync(user, { recursive: true });
    writeFileSync(join(user, 'profile.yml'), 'codex:\n  model: fixture-model\n');
    const env = { ...process.env, CAREER_OPS_USERS_DIR: dir, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '' };
    const script = join(root, 'resolve-codex-config.mjs');
    const result = spawnSync(process.execPath, [script, '--user', 'test'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      model: 'fixture-model', reasoning_effort: 'medium', model_source: 'profile', reasoning_effort_source: 'default',
    });
    const model = "model'$(touch NEVER_CREATED); & quoted";
    const shell = spawnSync(process.execPath, [script, '--user', 'test', '--shell', '--codex-model', model], { env, encoding: 'utf8' });
    assert.equal(shell.status, 0, shell.stderr);
    assert.equal(shell.stdout.split('\n').filter(Boolean).length, 2);
    const reader = join(dir, 'read config.sh');
    writeFileSync(reader, `${shell.stdout}\nprintf '%s\\0%s' "$CODEX_MODEL" "$CODEX_REASONING_EFFORT"\n`);
    const parsed = run(resolveRunnerCommand(reader, []));
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.deepEqual(parsed.stdout.split('\0'), [model, 'medium']);
    assert.equal(existsSync(join(dir, 'NEVER_CREATED')), false);
    const noUser = spawnSync(process.execPath, [script], { env: { ...env, CAREER_OPS_USER: '' }, encoding: 'utf8' });
    assert.equal(noUser.status, 1);
  } finally { cleanup(dir); }
});

test('verify cannot overwrite a competing ownership lock or compatibility PID', async () => {
  const dir = temporary();
  const lockPath = join(dir, 'test/data/verify-runner.pid');
  let lock;
  try {
    mkdirSync(join(dir, 'test/data'), { recursive: true });
    lock = await acquirePipelineLock(lockPath);
    writeFileSync(lockPath, String(process.pid));
    const result = spawnSync(process.execPath, [join(root, 'verify-runner.mjs'), '--user', 'test', '--quiet'], {
      env: { ...process.env, CAREER_OPS_USERS_DIR: dir, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '' },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /lock|LockTimeout/i);
    assert.equal(readFileSync(lockPath, 'utf8'), String(process.pid));
    assert.equal(existsSync(lock.lockDir), true);
  } finally { lock?.release(); cleanup(dir); }
});

for (const launcher of ['node', 'bash']) test(`${launcher} tree termination stops launcher, child and grandchild within the stop budget`, { timeout: 15000 }, async () => {
  const dir = temporary();
  let child;
  let pids = [];
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    const record = join(dir, 'pids.txt');
    const script = join(dir, 'tree.mjs');
    writeFileSync(script, `import { spawn } from 'node:child_process';\nimport { appendFileSync } from 'node:fs';\nappendFileSync(process.argv[2], process.pid + '\\n');\nif (Number(process.argv[3]) < 2) spawn(process.execPath, [process.argv[1], process.argv[2], String(Number(process.argv[3]) + 1)], {stdio: 'inherit'});\nsetInterval(() => {}, 1000);\n`);
    const bashScript = join(dir, 'batch fixture.sh');
    writeFileSync(bashScript, '#!/usr/bin/env bash\n"$@" &\nwait\n');
    const launch = launcher === 'node'
      ? resolveRunnerCommand(process.execPath, [script, record, '0'])
      : resolveRunnerCommand(bashScript, [process.execPath, script, record, '0'].map(value => value.replace(/\\/g, '/')));
    child = spawn(launch.command, launch.args, { ...launch.options, stdio: 'ignore' });
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      pids = existsSync(record) ? readFileSync(record, 'utf8').trim().split('\n').map(Number) : [];
      if (pids.length === 3) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(pids.length, 3);
    pids = [...new Set([child.pid, ...pids])];
    const started = Date.now();
    await terminateProcessTree(child, { timeoutMs: 3000 });
    while (pids.some(alive) && Date.now() - started < 5000) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(pids.every(pid => !alive(pid)), `owned processes still alive: ${pids.filter(alive)}`);
    assert.ok(Date.now() - started < 5000);
    terminateProcessTreeSync(child); // Repeated cleanup is harmless.
    assert.throws(() => terminateProcessTreeSync(process.pid), /Refusing/);
  } finally {
    if (child && alive(child.pid)) terminateProcessTreeSync(child);
    for (const pid of pids) if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    cleanup(dir);
  }
});
