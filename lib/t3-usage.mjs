import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, writeFileSync } from 'node:fs';
import { renameSyncWithRetry } from './rename-retry.mjs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { WebSocket } from 'undici';
import { resolveRunnerCommand } from './runner-command.mjs';
import { tryAcquireDirLockSync } from './dir-lock.mjs';
import { listTree } from './walk-tree.mjs';
import { DEFAULT_CODEX_MODEL } from './codex-config.mjs';

const exec = promisify(execFile);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SESSION_ID = new RegExp(`^${UUID}$`, 'i');
const samePath = (a, b) => {
  const normalize = value => resolve(value).replaceAll('\\', '/').replace(/\/$/, '');
  return process.platform === 'win32'
    ? normalize(a).toLowerCase() === normalize(b).toLowerCase()
    : normalize(a) === normalize(b);
};

export function codexSessionId(header) {
  for (const line of header.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'thread.started' && SESSION_ID.test(event.thread_id)) return event.thread_id.toLowerCase();
    } catch { /* Plain Codex exec output has a session-id banner instead. */ }
    const match = line.match(new RegExp(`^session id:\\s*(${UUID})\\s*$`, 'i'));
    if (match) return match[1].toLowerCase();
  }
  return null;
}

function logSessionId(file) {
  const fd = openSync(file, 'r');
  try {
    // Both exec formats print the identity before the prompt or agent output.
    const buffer = Buffer.alloc(16 * 1024);
    return codexSessionId(buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)).toString('utf8'));
  } finally { closeSync(fd); }
}

const receiptDir = root => join(root, 'batch', 't3-usage');
function saveReceipt(file, receipt) {
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  renameSyncWithRetry(temp, file);
}

/** A receipt survives offline T3, a failed archive, and a later runner invocation. */
export function recordCodexUsage({ root, projectRoot, logFile }) {
  const sessionId = logSessionId(logFile);
  if (!sessionId) return false;
  return recordCodexSession({ root, projectRoot, sessionId });
}

export function recordCodexSession({ root, projectRoot, sessionId, sessionFile }) {
  if (!SESSION_ID.test(sessionId)) throw new Error('Invalid Codex session ID.');
  sessionId = sessionId.toLowerCase();
  const directory = receiptDir(root);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${sessionId}.json`);
  try {
    writeFileSync(file, `${JSON.stringify({ sessionId, projectRoot: resolve(projectRoot), ...(sessionFile ? { sessionFile } : {}), recordedAt: new Date().toISOString() })}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return true;
}

/** Read saved exec rollouts; only an actual batch task can identify its user. */
export async function collectCodexSessions({ root, projectRoot, sessionsDir, user }) {
  let matched = 0;
  for (const file of listTree(sessionsDir, { match: /\.jsonl$/ })) {
    const input = createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024 });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let meta = null, records = 0, bytes = 0;
    try {
      for await (const line of lines) {
        if (++records > 100 || (bytes += line.length) > 8 * 1024 * 1024) break;
        let record; try { record = JSON.parse(line); } catch { continue; }
        if (record.type === 'session_meta' && !meta) {
          meta = record.payload;
          if (meta?.source !== 'exec' || !meta.cwd || !samePath(meta.cwd, projectRoot)) break;
        }
        if (!meta || record.type !== 'response_item' || record.payload?.role !== 'user') continue;
        const task = (record.payload.content || []).map(content => content.text || '').join('\n');
        if (!task.startsWith('# Career-ops batch worker')) continue;
        if (task.match(/Evaluate one posting for `([A-Za-z0-9._-]+)`/i)?.[1] === user) {
          recordCodexSession({ root, projectRoot, sessionId: meta.id, sessionFile: file });
          matched++;
        }
        break;
      }
    } finally { lines.close(); input.destroy(); }
  }
  return matched;
}

export function pendingUsage(root, projectRoot) {
  const directory = receiptDir(root);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => SESSION_ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json')).flatMap(name => {
    const file = join(directory, name);
    const receipt = JSON.parse(readFileSync(file, 'utf8'));
    if (!SESSION_ID.test(receipt.sessionId) || `${receipt.sessionId}.json` !== name) throw new Error('Invalid T3 usage receipt.');
    return !receipt.archivedAt && !receipt.ignoredAt && samePath(receipt.projectRoot, projectRoot) ? [{ file, ...receipt }] : [];
  });
}

/** Resolve T3's generated Windows launcher without passing arguments through cmd.exe. */
export function t3CliLaunch(cli, args, { platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32' && /\.cmd$/i.test(cli) && existsSync(cli)) {
    const wrapper = readFileSync(cli, 'utf8');
    const match = wrapper.match(/^"([^"\r\n]+\.exe)" "([^"\r\n]+[\\/]bin\.mjs)" %\*\s*$/m);
    if (match && wrapper.includes('T3CODE_DESKTOP_CLI_LAUNCHER=1')) {
      return { command: match[1], args: [match[2], ...args], options: { shell: false, windowsHide: true },
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', T3CODE_DESKTOP_CLI_LAUNCHER: '1' } };
    }
  }
  return { ...resolveRunnerCommand(cli, args, { platform, env }), env };
}

async function runT3Cli(cli, args, env) {
  const launch = t3CliLaunch(cli, args, { env });
  try {
    const result = await exec(launch.command, launch.args, { ...launch.options, env: launch.env, timeout: 15_000, maxBuffer: 1024 * 1024 });
    return result.stdout;
  } catch { throw new Error('T3 CLI authentication command failed.'); }
}

/** Minimal unary client for the existing Effect JSON WebSocket RPC protocol. */
export async function connectT3Rpc(origin, token, { timeoutMs = 60_000, WebSocketImpl = WebSocket } = {}) {
  const url = new URL('/ws', origin);
  url.searchParams.set('orchestrationProtocol', '2');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocketImpl(url.href, { headers: { authorization: `Bearer ${token}` } });
  const requests = new Map();
  let nextId = 0;
  const fail = () => {
    for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error('T3 RPC connection closed.')); }
    requests.clear();
  };
  socket.addEventListener('close', fail);
  socket.addEventListener('error', fail);
  socket.addEventListener('message', event => {
    let frames;
    try { const parsed = JSON.parse(event.data); frames = Array.isArray(parsed) ? parsed : [parsed]; }
    catch { fail(); socket.close(); return; }
    for (const frame of frames) {
      if (frame._tag === 'Ping') { socket.send(JSON.stringify({ _tag: 'Pong' })); continue; }
      const request = requests.get(String(frame.requestId));
      if (!request || frame._tag !== 'Exit') continue;
      requests.delete(String(frame.requestId));
      clearTimeout(request.timer);
      if (frame.exit?._tag === 'Success') request.resolve(frame.exit.value);
      else request.reject(new Error(`T3 RPC ${request.tag} failed.`));
    }
  });
  try {
    await new Promise((resolveOpen, reject) => {
      const timer = setTimeout(() => reject(new Error('T3 RPC connection timed out.')), timeoutMs);
      socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('T3 RPC connection failed.')); }, { once: true });
    });
  } catch (error) { socket.close(); throw error; }
  return {
    call(tag, payload) {
      return new Promise((resolveReply, reject) => {
        if (socket.readyState !== 1) { reject(new Error('T3 RPC is disconnected.')); return; }
        const id = String(++nextId);
        const timer = setTimeout(() => { requests.delete(id); reject(new Error(`T3 RPC ${tag} timed out.`)); }, timeoutMs);
        requests.set(id, { resolve: resolveReply, reject, timer, tag });
        socket.send(JSON.stringify({ _tag: 'Request', id, tag, payload, headers: [] }));
      });
    },
    close() { fail(); socket.close(); },
  };
}

export async function withT3Rpc(run, { env = process.env, home = homedir(), cliRun = runT3Cli, connect = connectT3Rpc } = {}) {
  const baseDir = resolve(env.T3CODE_HOME || join(home, '.t3'));
  const statePath = join(baseDir, 'userdata', 'server-runtime.json');
  if (!existsSync(statePath)) return { status: 'offline', archived: 0 };
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (!Number.isInteger(state.pid) || state.pid <= 0) throw new Error('Invalid T3 server runtime state.');
  try { process.kill(state.pid, 0); } catch (error) { if (error.code !== 'EPERM') return { status: 'offline', archived: 0 }; }
  const origin = new URL(state.origin);
  if (!['http:', 'https:'].includes(origin.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
    throw new Error('T3 usage sync requires a local server origin.');
  }
  const defaultCli = join(home, '.t3', 'bin', process.platform === 'win32' ? 't3.cmd' : 't3');
  const cli = env.CAREER_OPS_T3_CLI || env.T3CODE_CLI_PATH || (existsSync(defaultCli) ? defaultCli : 't3');
  const location = ['--base-dir', baseDir];
  let issued, rpc;
  try {
    issued = JSON.parse(await cliRun(cli, ['auth', 'session', 'issue', ...location, '--json', '--ttl', '5m', '--label', 'career-ops usage sync',
      '--scope', 'orchestration:read', '--scope', 'orchestration:operate'], env));
    if (!issued.sessionId || !issued.token) throw new Error('T3 CLI returned no session credentials.');
    rpc = await connect(origin.href, issued.token);
    return await run(rpc);
  } finally {
    rpc?.close();
    if (issued?.sessionId) await cliRun(cli, ['auth', 'session', 'revoke', ...location, issued.sessionId], env);
  }
}

/** Attach native identities without loading history or starting an agent turn. */
export async function archiveBatchUsage({ root, projectRoot, rpc, budgetMs = 120_000 }) {
  const deadline = Date.now() + budgetMs;
  const pending = pendingUsage(root, projectRoot);
  if (!pending.length) return { status: 'empty', archived: 0, remaining: 0 };
  const snapshot = await rpc.call('orchestration.getArchivedShellSnapshot', {});
  const savedProject = snapshot.projects.find(candidate => samePath(candidate.workspaceRoot, projectRoot));
  const project = savedProject && { projectId: savedProject.id, path: savedProject.workspaceRoot, model: savedProject.defaultModelSelection?.model };
  if (!project) throw new Error('Register this checkout as a T3 project before syncing usage.');
  const config = await rpc.call('server.getConfig', {});
  const instanceIds = [...new Set(['codex', ...Object.entries(config.settings.providerInstances || {})
    .filter(([, instance]) => instance.driver === 'codex').map(([id]) => id)])];
  let archived = 0, protectedCount = 0;
  const found = {};
  const allIds = pending.flatMap(receipt => instanceIds.map(instance => `import:${instance}:${receipt.sessionId}`));
  for (let offset = 0; offset < allIds.length; offset += 200) {
    Object.assign(found, await rpc.call('orchestration.getThreadTitles', { threadIds: allIds.slice(offset, offset + 200) }));
  }
  const remaining = [];
  const processReceipt = async receipt => {
    const ids = instanceIds.map(instance => `import:${instance}:${receipt.sessionId}`);
    const existingId = ids.find(id => Object.hasOwn(found, id));
    const threadId = existingId ?? `import:codex:${receipt.sessionId}`;
    let alreadyArchived = false;
    if (existingId) {
      const projection = await rpc.call('orchestration.getThreadProjection', { threadId });
      const thread = projection.thread;
      // Bounded wire projections can omit providerThreads when there are no
      // runs. The thread's active reference still names the native binding.
      const expectedProviderId = `provider-thread:provider:codex:provider-instance:${thread.providerInstanceId}:native-thread:${receipt.sessionId}`;
      const hookBinding = receipt.bindingOnly && (thread.activeProviderThreadId === expectedProviderId ||
        projection.providerThreads.some(providerThread =>
          providerThread.nativeThreadRef?.driver === 'codex' && providerThread.nativeThreadRef?.nativeId === receipt.sessionId));
      if (thread.projectId !== project.projectId || (thread.historyOrigin !== 'v1_import' && !hookBinding) || projection.runs.length) {
        const { file, ...saved } = receipt;
        saveReceipt(file, { ...saved, threadId, ignoredAt: new Date().toISOString(), reason: 'existing-t3-conversation' });
        protectedCount++;
        return;
      }
      alreadyArchived = Boolean(thread.archivedAt);
    } else {
      const { file, ...saved } = receipt;
      // Write ownership before the create so interruption can resume safely.
      receipt.bindingOnly = true;
      saveReceipt(file, { ...saved, threadId, bindingOnly: true });
      await rpc.call('orchestration.dispatchCommand', {
        type: 'thread.create', commandId: randomUUID(), threadId, projectId: project.projectId,
        title: `Career Ops job analysis ${receipt.sessionId.slice(0, 8)}`,
        createdBy: 'user', creationSource: 'web',
        modelSelection: { instanceId: 'codex', model: project.model || DEFAULT_CODEX_MODEL },
        runtimeMode: 'approval-required', interactionMode: 'default', branch: null, worktreePath: null,
        importedNativeThread: { ref: { driver: 'codex', nativeId: receipt.sessionId, strength: 'strong' } },
      });
    }
    if (!alreadyArchived) await rpc.call('orchestration.dispatchCommand', { type: 'thread.archive', commandId: randomUUID(), threadId });
    const { file, ...saved } = receipt;
    saveReceipt(file, { ...saved, threadId, projectId: project.projectId, archivedAt: new Date().toISOString() });
    archived++;
  };
  for (let offset = 0; offset < pending.length; offset += 4) {
    if (Date.now() >= deadline) { remaining.push(...pending.slice(offset)); break; }
    // Each thread's create precedes its archive; a small window keeps one
    // slow command from stopping the other imports without flooding T3.
    const outcomes = await Promise.allSettled(pending.slice(offset, offset + 4).map(processReceipt));
    const failed = outcomes.find(outcome => outcome.status === 'rejected');
    if (failed) throw failed.reason;
  }
  return { status: remaining.length ? 'pending' : 'synced', archived, protected: protectedCount, remaining: remaining.length };
}

export async function syncBatchUsage({ root, projectRoot, logsDir, env = process.env, withRpc = withT3Rpc }) {
  if (env.CAREER_OPS_T3_USAGE === '0') return { status: 'disabled', archived: 0 };
  if (logsDir && existsSync(logsDir)) {
    for (const name of readdirSync(logsDir).filter(name => /^\d+-\d+\.log$/.test(name))) {
      recordCodexUsage({ root, projectRoot, logFile: join(logsDir, name) });
    }
  }
  if (!pendingUsage(root, projectRoot).length) return { status: 'empty', archived: 0, remaining: 0 };
  const lock = tryAcquireDirLockSync(join(receiptDir(root), 'sync.lock'), { staleMs: 10 * 60_000 });
  if (!lock) return { status: 'busy', archived: 0 };
  try { return await withRpc(rpc => archiveBatchUsage({ root, projectRoot, rpc }), { env }); }
  finally { lock.release(); }
}
