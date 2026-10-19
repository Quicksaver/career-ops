import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, getBash, rmSync } from './helpers.mjs';
import { acquireStateLease, updateStateRow, recoverProcessing } from '../batch/state-store.mjs';
import { releaseOwnership, inspectOwnership } from '../batch/runner-ownership.mjs';

const header = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n';
const source = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf8').replace(/\r\n/g, '\n');
const locking = source.slice(source.indexOf('acquire_state_lock() {'), source.indexOf('# Get status of an offer'));
const updating = source.slice(source.indexOf('update_state_unlocked() {'), source.indexOf('# Durable last-resort records'));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'batch-state-native-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('ten real Bash writers keep a large state file exclusive despite MSYS liveness false negatives', async t => {
  const root = fixture(t), file = join(root, 'state.tsv');
  const history = Array.from({ length: 6000 }, (_, id) => `${id}\thttps://example.com/${id}\tcompleted\tstart\tend\t${id}\t3\t-\t0\n`).join('');
  writeFileSync(file, header + history);
  const script = join(root, 'write.sh');
  writeFileSync(script, `set -euo pipefail
SCRIPT_DIR="$1"
STATE_FILE="$2"
STATE_LOCK_DIR="$STATE_FILE.legacy.lock"
STATE_LOCK_PID_FILE="$STATE_LOCK_DIR/pid"
STATE_LOCK_TIMEOUT_SECONDS=30
PARALLEL=10
kill() { return 1; }
${locking}
${updating}
critical() {
  mkdir "$STATE_FILE.critical"
  sleep 0.03
  update_state_unlocked "$3" "https://example.com/$3" completed start end "$3" 4 "error with tab" 0
  rmdir "$STATE_FILE.critical"
}
run_with_state_lock critical "$@"
`);
  await Promise.all(Array.from({ length: 10 }, (_, i) => new Promise((resolve, reject) => {
    const child = spawn(getBash(), [script, join(ROOT, 'batch'), file, String(10000 + i)], { windowsHide: true });
    let output = '';
    child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`writer ${i}: ${output}`)));
  })));
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 6011);
  assert.equal(lines.slice(1, 6001).join('\n') + '\n', history);
  const added = lines.slice(6001).map(line => line.split('\t'));
  assert.equal(new Set(added.map(row => row[0])).size, 10);
  assert.ok(added.every(row => row.length === 9 && row[2] === 'completed'));
});

test('native ownership tokens protect a live successor and exclude a second owner', async t => {
  const path = join(fixture(t), 'state-owner.pid');
  const token = await acquireStateLease(path, process.pid, 1000);
  assert.equal(inspectOwnership(path).pid, process.pid);
  await assert.rejects(acquireStateLease(path, process.pid, 30), /timeout/);
  assert.equal(releaseOwnership(path, 'wrong-token'), false);
  assert.equal(inspectOwnership(path).status, 'alive');
  assert.equal(releaseOwnership(path, token), true);
  const successor = await acquireStateLease(path, process.pid, 1000);
  assert.equal(releaseOwnership(path, token), false);
  assert.equal(releaseOwnership(path, successor), true);
});

test('updates replace only the exact ID, collapse duplicate copies and sanitise error delimiters', t => {
  const path = join(fixture(t), 'state.tsv');
  writeFileSync(path, header + '1\thttps://example.com/1\tfailed\t\t\t\t\told\t1\n2\thttps://example.com/2\tcompleted\t\t\t002\t4\t\t0\n1\thttps://example.com/1\tfailed\t\t\t\t\told\t1\n');
  updateStateRow(path, ['1', 'https://example.com/1', 'completed', '', '', '001', '4', 'line\nwith\ttabs\r', '1']);
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[2].split('\t')[0], '2');
  assert.equal(lines[1].split('\t')[7], 'line with tabs ');
  const before = readFileSync(path, 'utf8');
  assert.throws(() => updateStateRow(path, ['1']), /Invalid state row/);
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('stale processing recovery preserves terminal rows and increments only interrupted retries', t => {
  const path = join(fixture(t), 'state.tsv');
  const completed = '2\thttps://example.com/2\tcompleted\tstart\tend\t002\t4\t\t';
  writeFileSync(path, header + '1\thttps://example.com/1\tprocessing\tstart\t\t001\t\t\t1\n' + completed + '\n');
  assert.equal(recoverProcessing(path, 'now'), 1);
  const lines = readFileSync(path, 'utf8').split('\n');
  assert.deepEqual(lines[1].split('\t'), ['1', 'https://example.com/1', 'failed', 'start', 'now', '001', '', 'stale-processing-state', '2']);
  assert.equal(lines[2], completed);
  assert.equal(recoverProcessing(path), 0);
});
