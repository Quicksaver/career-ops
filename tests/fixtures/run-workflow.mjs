import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkNodeModules } from '../helpers.mjs';
import { terminateProcessTreeSync } from '../../lib/runner-command.mjs';
export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const offline = readFileSync(join(repo, 'tests/fixtures/run-queue-offline.mjs'), 'utf8');
const A = 'https://jobs.example.org/alpha';
export function copyGraph(root, file, copied = new Set()) {
  const source = resolve(repo, file);
  if (copied.has(source)) return;
  copied.add(source);
  const target = join(root, relative(repo, source));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
  const text = readFileSync(source, 'utf8');
  for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
    const dependency = resolve(dirname(source), match[1]);
    if (existsSync(dependency)) copyGraph(root, relative(repo, dependency), copied);
  }
}

export function fixture(t, { rows = [A], ...config } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'run-queue-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  for (const file of ['run-workflow.mjs', 'sync-pipeline-batch.mjs', 'pipeline-liveness.mjs', 'lib/run-live-inputs.mjs']) copyGraph(root, file);
  cpSync(join(repo, 'tracker-aliases.json'), join(root, 'tracker-aliases.json'));
  assert.equal(linkNodeModules(root), null, 'offline fixture must resolve the checkout dependencies');
  mkdirSync(join(root, 'schemas'), { recursive: true });
  mkdirSync(join(root, 'templates'), { recursive: true });
  cpSync(join(repo, 'templates/states.yml'), join(root, 'templates/states.yml'));
  cpSync(join(repo, 'schemas/run-handoff-output.schema.json'), join(root, 'schemas/run-handoff-output.schema.json'));
  const user = join(root, 'users/fictional');
  for (const directory of ['data', 'config', 'batch/logs', 'jds']) mkdirSync(join(user, directory), { recursive: true });
  writeFileSync(join(user, 'config/profile.yml'), '{}\n');
  writeFileSync(join(user, 'fixture.json'), JSON.stringify(config));
  writeFileSync(join(user, 'data/pipeline.md'), '# Fictional test inbox\n\n## Pending\n' + rows.map(row => row.startsWith('- ') ? row : `- [ ] ${row}`).join('\n') + '\n\n## Processed\n');
  for (const phase of ['doctor', 'scan', 'scan-auth', 'pipeline-liveness', 'merge-tracker', 'reconcile-pipeline', 'cv-sync-check', 'verify-runner', 'codex-mock', 'batch-mock', 'check-liveness']) writeFileSync(join(root, `${phase}.mjs`), offline);
  writeFileSync(join(root, 'batch/batch-runner.sh'), '#!/usr/bin/env bash\nset -e\nexec node ./batch-mock.mjs "$@"\n');
  const bin = join(root, 'mock-bin');
  mkdirSync(bin);
  // Keep the mock entrypoint at checkout root so its relative imports stay real.
  writeFileSync(join(bin, 'codex.cmd'), '@ECHO OFF\r\nSET dp0=%~dp0\r\nnode "%dp0%/../codex-mock.mjs" %*\r\n');
  writeFileSync(join(bin, 'codex'), `#!/usr/bin/env node\nimport '../codex-mock.mjs';\n`, { mode: 0o755 });
  if (process.platform === 'win32') rmSync(join(bin, 'codex'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CAREER_OPS_/i.test(key) && !/^PATH$/i.test(key)));
  Object.assign(env, { PATH: bin + delimiter + process.env.PATH, CAREER_OPS_ROOT: user, CAREER_OPS_USERS_DIR: join(root, 'users'), CAREER_OPS_TRACKER: join(user, 'data/applications.md'), CAREER_OPS_USER: 'fictional' });
  const read = path => readFileSync(join(user, path), 'utf8');
  const records = path => existsSync(join(user, path)) ? read(path).trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const run = async (args = ['--skip-linkedin'], script = 'run-workflow.mjs') => {
    const child = spawn(process.execPath, [join(root, script), '--user', 'fictional', '--json', ...args], { cwd: root, env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);
    const timer = setTimeout(() => child.kill(), 30000);
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    clearTimeout(timer);
    assert.ok(stdout.trim(), `runner emitted no JSON: ${stderr}`);
    let result;
    try { result = JSON.parse(stdout.trim()); } catch { assert.fail(`invalid stdout: ${stdout}\n${stderr}`); }
    return { code, result, stderr };
  };
  const startInteractive = (args = ['--skip-scan'], { color = false } = {}) => {
    const preload = join(root, 'fixture-tty.mjs');
    writeFileSync(preload, `for(const stream of [process.stdin,process.stdout]) Object.defineProperty(stream,'isTTY',{value:true}); process.stdin.setRawMode=raw=>{process.stdin.isRaw=raw;}; Object.defineProperty(process.stdout,'columns',{value:120});Object.defineProperty(process.stdout,'rows',{value:30});`);
    const ttyEnv = { ...env };
    delete ttyEnv.FORCE_COLOR;
    if (color) { delete ttyEnv.NO_COLOR; ttyEnv.TERM = 'xterm-256color'; }
    else ttyEnv.NO_COLOR = '1';
    const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, join(root, 'run-workflow.mjs'), '--user', 'fictional', '--interactive', ...args], { cwd: root, env: ttyEnv, windowsHide: true });
    let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    const timer = setTimeout(() => terminateProcessTreeSync(child), 30000);
    const completion = new Promise((done, reject) => { child.once('error', reject); child.once('close', code => {
      clearTimeout(timer);
      const runs = readdirSync(join(user, 'data/workflow-runs')).sort();
      const summaryPath = join(user, 'data/workflow-runs', runs.at(-1) || '', 'summary.json');
      done({ code, output, result: existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath)) : null });
    }); });
    t.after(() => { clearTimeout(timer); if (child.exitCode === null) terminateProcessTreeSync(child); });
    return { child, completion, output: () => output, send: text => child.stdin.write(text) };
  };
  return { root, user, env, run, read, records, startInteractive, calls: () => records('calls.jsonl'), dispatched: () => records('dispatched.jsonl').map(row => row.url) };
}

