import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pass, fail, rmSync, ROOT, getBash } from './helpers.mjs';
import { archiveBatchUsage, codexSessionId, collectCodexSessions, connectT3Rpc, pendingUsage, recordCodexUsage, syncBatchUsage, t3CliLaunch, withT3Rpc } from '../lib/t3-usage.mjs';

const A = '019a0000-0000-7000-8000-000000000001';
const B = '019a0000-0000-7000-8000-000000000002';
const C = '019a0000-0000-7000-8000-000000000003';
const projectRoot = ROOT;
async function check(name, run) {
  try { await run(); pass(name); } catch (error) { fail(`${name}: ${error.stack || error}`); }
}
async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'career-t3-usage-'));
  try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
function record(root, sessionId = A, sourceRoot = projectRoot) {
  const logFile = join(root, `${sessionId}.log`);
  writeFileSync(logFile, `OpenAI Codex\nsession id: ${sessionId}\nuser\nfixture prompt\n`);
  recordCodexUsage({ root, projectRoot: sourceRoot, logFile });
}
function fakeRpc({ root, instanceId = 'codex', failArchive = false, continued = false, alreadyArchived = false, missing = false, wrongProject = false } = {}) {
  const calls = [], imported = new Set(), archived = new Set();
  for (const receipt of pendingUsage(root, projectRoot)) {
    if (instanceId !== 'codex' || continued || alreadyArchived || wrongProject || receipt.bindingOnly) imported.add(receipt.sessionId);
  }
  return { calls, archived, async call(tag, payload) {
    calls.push({ tag, payload });
    if (tag === 'orchestration.getArchivedShellSnapshot') return { projects: [{ workspaceRoot: projectRoot, id: 'career' }] };
    if (tag === 'server.getConfig') return { settings: { providerInstances: { [instanceId]: { driver: 'codex' } } } };
    if (tag === 'orchestration.getThreadTitles') return Object.fromEntries(payload.threadIds
      .filter(id => [...imported].some(sessionId => id === `import:${instanceId}:${sessionId}`)).map(id => [id, 'Batch fixture']));
    if (tag === 'orchestration.getThreadProjection') return {
      thread: { projectId: wrongProject ? 'another-project' : 'career', historyOrigin: 'v1_import', archivedAt: alreadyArchived ? '2026-01-01T00:00:00Z' : null },
      runs: continued ? [{ id: 'real-t3-run' }] : [],
      providerThreads: [{ nativeThreadRef: { driver: 'codex', nativeId: payload.threadId.slice(-36) } }],
    };
    if (tag === 'orchestration.dispatchCommand') {
      if (payload.type === 'thread.create') {
        if (missing) throw new Error('fixture binding failure');
        assert.equal(payload.initialMessage, undefined);
        assert.equal(payload.importedNativeThread.ref.driver, 'codex');
        imported.add(payload.importedNativeThread.ref.nativeId);
        return { sequence: 1 };
      }
      assert.equal(payload.type, 'thread.archive');
      if (failArchive) throw new Error('fixture archive failure');
      archived.add(payload.threadId);
      return { sequence: 1 };
    }
    throw new Error(`Unexpected RPC ${tag}`);
  } };
}

console.log('\nT3 usage import and archive');
await check('reads plain and JSON Codex session identities without trusting arbitrary UUIDs', () => {
  assert.equal(codexSessionId(`session id: ${A}\r\n`), A);
  assert.equal(codexSessionId(JSON.stringify({ type: 'thread.started', thread_id: A })), A);
  assert.equal(codexSessionId(`job mentions ${A}\n{"type":"message","thread_id":"${A}"}`), null);
});
await check('receipts survive retries, remain user-scoped, and ignore a different checkout', () => fixture(async root => {
  record(root); record(root); record(root, B, join(root, 'another-checkout'));
  assert.equal(pendingUsage(root, projectRoot).length, 1);
  assert.equal(readdirSync(join(root, 'batch/t3-usage')).length, 2);
  assert.equal(pendingUsage(join(root, 'other-user'), projectRoot).length, 0);
}));
await check('saved rollouts select the actual batch task and user, excluding instructions, other users, and interactive sessions', () => fixture(async root => {
  const sessions = join(root, 'sessions'); mkdirSync(sessions);
  for (const [id, source, user] of [[A, 'exec', 'fixture'], [B, 'exec', 'other'], [C, 'vscode', 'fixture']]) {
    writeFileSync(join(sessions, `${id}.jsonl`), [
      { type: 'session_meta', payload: { id, source, cwd: projectRoot } },
      { type: 'response_item', payload: { role: 'user', content: [{ text: '# AGENTS.md\nEvaluate one posting for `fixture`' }] } },
      { type: 'response_item', payload: { role: 'user', content: [{ text: `# Career-ops batch worker\nEvaluate one posting for \`${user}\`.` }] } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  assert.equal(await collectCodexSessions({ root, projectRoot, sessionsDir: sessions, user: 'fixture' }), 1);
  assert.equal(pendingUsage(root, projectRoot)[0].sessionId, A);
}));
await check('archives only recorded batch threads, including an existing custom Codex instance', () => fixture(async root => {
  record(root); record(root, B);
  const rpc = fakeRpc({ root, instanceId: 'codex-jobs' });
  const result = await archiveBatchUsage({ root, projectRoot, rpc });
  assert.equal(result.archived, 2);
  assert.equal(result.remaining, 0);
  assert.equal(rpc.calls.filter(call => call.tag === 'agentSessions.import').length, 0);
  assert.deepEqual([...rpc.archived], [`import:codex-jobs:${A}`, `import:codex-jobs:${B}`]);
  assert.equal(pendingUsage(root, projectRoot).length, 0);
  const before = rpc.calls.length;
  assert.equal((await archiveBatchUsage({ root, projectRoot, rpc })).status, 'empty');
  assert.equal(rpc.calls.length, before);
}));
await check('failed archival stays pending and succeeds on the next sync', () => fixture(async root => {
  record(root);
  await assert.rejects(archiveBatchUsage({ root, projectRoot, rpc: fakeRpc({ root, failArchive: true }) }));
  assert.equal(pendingUsage(root, projectRoot).length, 1);
  assert.equal((await archiveBatchUsage({ root, projectRoot, rpc: fakeRpc({ root }) })).archived, 1);
}));
await check('a failed archive waits for the other in-flight bindings and preserves their completed receipts', () => fixture(async root => {
  for (const id of [A, B, C]) record(root, id);
  const rpc = fakeRpc({ root });
  const call = rpc.call.bind(rpc);
  rpc.call = async (tag, payload) => {
    if (payload.type === 'thread.archive' && payload.threadId.endsWith(A)) throw new Error('one failed archive');
    return call(tag, payload);
  };
  await assert.rejects(archiveBatchUsage({ root, projectRoot, rpc }), /one failed archive/);
  assert.deepEqual(pendingUsage(root, projectRoot).map(receipt => receipt.sessionId), [A]);
  assert.equal(rpc.archived.size, 2);
}));
await check('leaves subsequent T3 conversations and other projects unchanged', () => fixture(async root => {
  record(root);
  const rpc = fakeRpc({ root, continued: true });
  assert.equal((await archiveBatchUsage({ root, projectRoot, rpc })).protected, 1);
  assert.equal(rpc.archived.size, 0);
  assert.equal(pendingUsage(root, projectRoot).length, 0);
  record(root, B);
  const other = fakeRpc({ root, wrongProject: true });
  assert.equal((await archiveBatchUsage({ root, projectRoot, rpc: other })).protected, 1);
  assert.equal(other.archived.size, 0);
}));
await check('an archive completed before a crash is recognized without another archive command', () => fixture(async root => {
  record(root);
  const rpc = fakeRpc({ root, alreadyArchived: true });
  assert.equal((await archiveBatchUsage({ root, projectRoot, rpc })).archived, 1);
  assert.equal(rpc.archived.size, 0);
}));
await check('an interrupted native binding resumes when the bounded projection omits provider rows', () => fixture(async root => {
  record(root);
  const receipt = pendingUsage(root, projectRoot)[0];
  writeFileSync(receipt.file, JSON.stringify({ ...receipt, bindingOnly: true }));
  const rpc = fakeRpc({ root });
  const call = rpc.call.bind(rpc);
  rpc.call = async (tag, payload) => {
    const result = await call(tag, payload);
    if (tag === 'orchestration.getThreadProjection') {
      result.thread.historyOrigin = 'native';
      result.thread.providerInstanceId = 'codex';
      result.thread.activeProviderThreadId = `provider-thread:provider:codex:provider-instance:codex:native-thread:${A}`;
      result.providerThreads = [];
    }
    return result;
  };
  assert.equal((await archiveBatchUsage({ root, projectRoot, rpc })).archived, 1);
  assert.equal(pendingUsage(root, projectRoot).length, 0);
}));
await check('failed native binding stays pending without falling back to a provider run or a folder import', () => fixture(async root => {
  record(root);
  const rpc = fakeRpc({ root, missing: true });
  await assert.rejects(archiveBatchUsage({ root, projectRoot, rpc }), /binding failure/);
  assert.equal(pendingUsage(root, projectRoot).length, 1);
  assert.equal(rpc.calls.filter(call => call.tag === 'agentSessions.import').length, 0);
}));
await check('new bindings have the original native identity, no initial message, and an immediate archive', () => fixture(async root => {
  record(root);
  const rpc = fakeRpc({ root });
  assert.equal((await archiveBatchUsage({ root, projectRoot, rpc })).archived, 1);
  const commands = rpc.calls.filter(call => call.tag === 'orchestration.dispatchCommand').map(call => call.payload);
  assert.deepEqual(commands.map(command => command.type), ['thread.create', 'thread.archive']);
  assert.equal(commands[0].importedNativeThread.ref.nativeId, A);
  assert.equal(commands[0].initialMessage, undefined);
  assert.equal(commands[0].threadId, commands[1].threadId);
}));
await check('offline and disabled syncs never connect or lose receipts', () => fixture(async root => {
  record(root);
  assert.equal((await syncBatchUsage({ root, projectRoot, env: { T3CODE_HOME: join(root, 'absent-t3') } })).status, 'offline');
  assert.equal(pendingUsage(root, projectRoot).length, 1);
  assert.equal((await syncBatchUsage({ root, projectRoot, env: { CAREER_OPS_T3_USAGE: '0' }, withRpc: () => { throw new Error('must not connect'); } })).status, 'disabled');
}));
await check('recovering an interrupted run records the last worker log before syncing', () => fixture(async root => {
  const logsDir = join(root, 'logs'); mkdirSync(logsDir);
  writeFileSync(join(logsDir, '001-1.log'), `session id: ${C}\n`);
  writeFileSync(join(logsDir, 'discard.log'), `session id: ${A}\n`);
  writeFileSync(join(logsDir, '1.jd-browser.log'), `session id: ${B}\n`);
  const result = await syncBatchUsage({ root, projectRoot, logsDir, env: {}, withRpc: run => run(fakeRpc({ root })) });
  assert.equal(result.archived, 1);
  assert.equal(pendingUsage(root, projectRoot).length, 0);
  assert.equal(readdirSync(join(root, 'batch/t3-usage')).filter(name => name.endsWith('.json')).length, 1);
}));
await check('local auth is scoped, revoked on failure, and never sends the token to a remote origin', () => fixture(async root => {
  const stateDir = join(root, 'userdata'); mkdirSync(stateDir);
  const stateFile = join(stateDir, 'server-runtime.json');
  writeFileSync(stateFile, JSON.stringify({ pid: process.pid, origin: 'http://127.0.0.1:12345' }));
  const commands = [];
  const cliRun = async (cli, args) => {
    commands.push(args);
    return args.includes('issue') ? JSON.stringify({ sessionId: 'fixture-auth', token: 'fixture-secret' }) : '';
  };
  let closed = false;
  await assert.rejects(withT3Rpc(() => { throw new Error('fixture failure'); }, {
    env: { T3CODE_HOME: root }, cliRun, connect: async (origin, token) => {
      assert.equal(token, 'fixture-secret'); return { close() { closed = true; } };
    },
  }), /fixture failure/);
  assert.equal(closed, true);
  assert.equal(commands[0].filter(arg => arg === '--scope').length, 2);
  assert.ok(commands[1].includes('revoke'));
  writeFileSync(stateFile, JSON.stringify({ pid: process.pid, origin: 'https://outside.example' }));
  await assert.rejects(withT3Rpc(() => {}, { env: { T3CODE_HOME: root }, cliRun }), /local server origin/);
  assert.equal(commands.length, 2);
}));
await check('Windows T3 launcher runs the bundled CLI directly with argument boundaries intact', () => fixture(async root => {
  const cli = join(root, 't3.cmd');
  writeFileSync(cli, '@echo off\r\nset "T3CODE_DESKTOP_CLI_LAUNCHER=1"\r\n"C:\\App & Co\\T3.exe" "C:\\App & Co\\resources\\bin.mjs" %*\r\n');
  const launch = t3CliLaunch(cli, ['auth', '--base-dir', 'C:\\User data & Co'], { platform: 'win32', env: {} });
  assert.equal(launch.command, 'C:\\App & Co\\T3.exe');
  assert.equal(launch.args.at(-1), 'C:\\User data & Co');
  assert.equal(launch.options.shell, false);
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, '1');
}));

// A real local WebSocket handshake exercises Undici headers and Effect frames.
await check('authenticated RPC transport handles success, failure, ping, and timeout against an isolated server', async () => {
  const sockets = new Set();
  let authorization;
  const server = createServer();
  server.on('upgrade', (request, socket) => {
    assert.equal(new URL(request.url, 'http://localhost').searchParams.get('orchestrationProtocol'), '2');
    sockets.add(socket); authorization = request.headers.authorization;
    const key = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
    const send = message => { const body = Buffer.from(JSON.stringify(message)); socket.write(Buffer.concat([Buffer.from([0x81, body.length]), body])); };
    let buffered = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 6) {
        const opcode = buffered[0] & 15;
        let length = buffered[1] & 127, start = 2;
        if (length === 126) { if (buffered.length < 8) return; length = buffered.readUInt16BE(2); start = 4; }
        if (buffered.length < start + 4 + length) return;
        const mask = buffered.subarray(start, start + 4), body = Buffer.from(buffered.subarray(start + 4, start + 4 + length));
        buffered = buffered.subarray(start + 4 + length);
        if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
        const message = JSON.parse(body.toString());
        if (message._tag !== 'Request' || message.tag === 'timeout') continue;
        send({ _tag: 'Ping' });
        send({ _tag: 'Exit', requestId: message.id, exit: message.tag === 'bad'
          ? { _tag: 'Failure', cause: [] } : { _tag: 'Success', value: { ok: true } } });
      }
    });
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  let rpc;
  try {
    rpc = await connectT3Rpc(`http://127.0.0.1:${server.address().port}`, 'fixture-secret', { timeoutMs: 500 });
    assert.deepEqual(await rpc.call('ok', {}), { ok: true });
    assert.equal(authorization, 'Bearer fixture-secret');
    await assert.rejects(rpc.call('bad', {}), /RPC bad failed/);
    await assert.rejects(rpc.call('timeout', {}), /timed out/);
  } finally {
    rpc?.close(); for (const socket of sockets) socket.destroy();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});

await check('CLI writes only the explicitly selected fixture user and rejects missing users', () => fixture(async root => {
  const log = join(root, 'worker.log'); writeFileSync(log, `session id: ${A}\n`);
  const script = join(ROOT, 'batch/t3-usage.mjs');
  const env = { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '', CAREER_OPS_USERS_DIR: root, CAREER_OPS_USER: 'other', CAREER_OPS_T3_USAGE: '1' };
  execFileSync(process.execPath, [script, 'record', '--user', 'fixture', '--log', log], { env, timeout: 15_000 });
  assert.equal(pendingUsage(join(root, 'fixture'), projectRoot).length, 1);
  assert.equal(pendingUsage(join(root, 'other'), projectRoot).length, 0);
  assert.throws(() => execFileSync(process.execPath, [script, 'sync'], { env, stdio: 'pipe', timeout: 15_000 }));
}));

await check('runner cleanup drains workers before sync and preserves the batch exit status if T3 fails', () => fixture(async root => {
  const source = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf8').replaceAll('\r\n', '\n');
  const release = source.match(/release_lock\(\) \{[\s\S]*?\n\}/)[0];
  const scriptDir = join(root, 'batch'); mkdirSync(scriptDir);
  writeFileSync(join(scriptDir, 't3-usage.mjs'), 'process.exitCode = 1;\n');
  writeFileSync(join(scriptDir, 'runner-ownership.mjs'), '');
  const shell = join(root, 'check.sh');
  writeFileSync(shell, [
    'set -euo pipefail', 'MAIN_PID=$$', 'OWNER_TOKEN=fixture', 'CLI=codex', 'USER_ID=fixture',
    'SCRIPT_DIR="$PWD/batch"', 'LOGS_DIR="$PWD/logs"', 'LOCK_FILE="$PWD/owner"',
    'stop_owned_workers() { echo drained; }', release, "trap 'release_lock || exit 125' EXIT", 'exit 7',
  ].join('\n'));
  try { execFileSync(getBash(), [shell], { cwd: root, env: { ...process.env, CAREER_OPS_T3_USAGE: '1' }, encoding: 'utf8', timeout: 15_000 }); assert.fail('must exit 7'); }
  catch (error) { assert.equal(error.status, 7); assert.match(error.stdout, /drained/); }
}));
