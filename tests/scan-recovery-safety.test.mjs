import './user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTrackerTransaction } from '../tracker-utils.mjs';
import { parseBlockedRows, parsePendingRows } from '../lib/pipeline-queue.mjs';
import { loadScanHistory, saveJd } from '../scan-auth.mjs';
import { randomDelay } from '../scan-auth/linkedin.mjs';
import { configureScanUserPaths, reopenClosedDuplicateApplications, appendToPipeline } from '../scan.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-scan-recovery-'));
  const saved = new Map(Object.keys(process.env).filter(key => key.startsWith('CAREER_OPS_')).map(key => [key, process.env[key]]));
  for (const key of saved.keys()) delete process.env[key];
  process.env.CAREER_OPS_DATA_DIR = root;
  process.env.CAREER_OPS_USER = 'fictional';
  mkdirSync(join(root, 'data'), { recursive: true });
  configureScanUserPaths({ userRoot: root });
  const tracker = join(root, 'data/applications.md');
  const history = join(root, 'data/scan-history.tsv');
  const head = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
  writeFileSync(tracker, head);
  configureScanUserPaths({ userRoot: root });
  const row = (num, company, status, notes = '') => `| ${num} | 2026-01-01 | ${company} | Engineer | 3.0/5 | ${status} | — | — | ${notes} |\n`;
  return { root, tracker, history, head, row, cleanup() {
    rmSync(root, { recursive: true, force: true });
    for (const key of Object.keys(process.env).filter(key => key.startsWith('CAREER_OPS_'))) delete process.env[key];
    for (const [key, value] of saved) process.env[key] = value;
  } };
}

test('rediscovery preserves advanced states, previously reopened dates and exact already-recorded URLs', async () => {
  const f = fixture();
  try {
    const prior = 'Reopened 2026-01-01: duplicate live posting found at https://example.com/old';
    writeFileSync(f.tracker, f.head + f.row(1, 'Closed Fictional', 'Closed') + f.row(2, 'Interview Fictional', 'Interview', prior) + f.row(3, 'Evaluated Fictional', 'Evaluated', prior) + f.row(4, 'Skipped Fictional', 'SKIP', prior));
    const offer = company => ({ company, title: 'Engineer', url: `https://example.com/${company.replaceAll(' ', '-')}` });
    const offers = ['Closed Fictional', 'Interview Fictional', 'Evaluated Fictional', 'Skipped Fictional'].map(offer);
    const applied = [];
    assert.equal(await reopenClosedDuplicateApplications(offers, '2026-10-14', undefined, { onReopened: job => applied.push(job) }), 2);
    const tracker = readFileSync(f.tracker, 'utf8');
    assert.match(tracker, /\| 1 \| 2026-10-14 \| Closed Fictional \| Engineer \| 3\.0\/5 \| Evaluated/);
    assert.match(tracker, /\| 2 \| 2026-01-01 \| Interview Fictional \| Engineer \| 3\.0\/5 \| Interview/);
    assert.match(tracker, /\| 3 \| 2026-01-01 \| Evaluated Fictional \| Engineer \| 3\.0\/5 \| Evaluated/);
    assert.match(tracker, /\| 4 \| 2026-01-01 \| Skipped Fictional \| Engineer \| 3\.0\/5 \| SKIP/);
    assert.equal(await reopenClosedDuplicateApplications(offers, '2026-10-15'), 0);
    assert.equal(readFileSync(f.tracker, 'utf8'), tracker);
    assert.equal(applied.length, 2);
    assert.match(readFileSync(join(f.root, 'data/status-log.tsv'), 'utf8'), /^1\t2026-10-14\tClosed\tEvaluated\tcorrection\tscan:/);
  } finally { f.cleanup(); }
});

test('reopening waits for the shared transaction and rechecks a concurrent status change', async () => {
  const f = fixture();
  try {
    writeFileSync(f.tracker, f.head + f.row(1, 'Fictional', 'Closed'));
    const owner = await openTrackerTransaction(f.tracker);
    try {
      const reopening = reopenClosedDuplicateApplications([{ company: 'Fictional', title: 'Engineer', url: 'https://example.com/new' }], '2026-10-14');
      owner.replace(f.head + f.row(1, 'Fictional', 'Interview', 'concurrent update'));
      owner.close();
      assert.equal(await reopening, 0);
      assert.match(readFileSync(f.tracker, 'utf8'), /\| Interview \|.*concurrent update/);
    } finally { owner.close(); }
  } finally { f.cleanup(); }
});

test('an expired URL cannot reopen a Closed tracker row', async () => {
  const f = fixture();
  try {
    const original = f.head + f.row(1, 'Fictional', 'Closed');
    writeFileSync(f.tracker, original);
    writeFileSync(f.history, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nhttps://example.com/dead\t2026-01-01\tfixture\tEngineer\tFictional\tskipped_expired\n');
    assert.equal(await reopenClosedDuplicateApplications([{ company: 'Fictional', title: 'Engineer', url: 'https://example.com/dead' }], '2026-10-14'), 0);
    assert.equal(readFileSync(f.tracker, 'utf8'), original);
  } finally { f.cleanup(); }
});

test('authenticated history ignores observational rows and expires added company/title pins with their URLs', () => {
  const f = fixture();
  try {
    writeFileSync(f.history, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n' + [
      ['101', 'Old Fictional', 'added'], ['102', 'Location Fictional', 'skipped_location'],
      ['103', 'Age Fictional', 'skipped_age'], ['104', 'Viewed Fictional', 'skipped_viewed'],
    ].map(([id, company, status]) => `https://www.linkedin.com/jobs/view/${id}/\t2026-01-01\tlinkedin\tEngineer\t${company}\t${status}`).join('\n') + '\n');
    const history = loadScanHistory({ historyPath: f.history, policy: { today: '2026-10-14', recheckAfterDays: 30 } });
    for (const id of ['101', '102', '103']) assert.equal(history.has(id), false);
    assert.equal(history.has('old fictional::engineer'), false);
    assert.equal(history.has('viewed fictional::engineer'), false);
    assert.equal(history.has('104'), true);
  } finally { f.cleanup(); }
});

test('capture names retain complete posting IDs and unavailable JDs stay blocked in a fresh canonical inbox', async () => {
  const f = fixture();
  try {
    const detail = { title: 'A'.repeat(100), company: 'B'.repeat(100), jdText: 'User-owned captured text.' };
    const first = saveJd({ ...detail, url: 'https://www.linkedin.com/jobs/view/100000001/' }, 'linkedin', { jdsDir: join(f.root, 'jds') });
    const second = saveJd({ ...detail, url: 'https://www.linkedin.com/jobs/view/100000002/' }, 'linkedin', { jdsDir: join(f.root, 'jds') });
    assert.notEqual(first, second);
    assert.match(first, /100000001\.md$/);
    const url = 'https://www.linkedin.com/jobs/view/100000003/';
    const pipeline = join(f.root, 'data/pipeline.md');
    await appendToPipeline([{ url, title: 'Engineer', company: 'Fictional', blocked: true, note: 'JD unavailable. Paste JD text or provide employer URL.' }], { pipelinePath: pipeline });
    const text = readFileSync(pipeline, 'utf8');
    assert.equal(parsePendingRows(text).rows.length, 0);
    assert.deepEqual(parseBlockedRows(text).rows.map(row => [row.url, row.reason]), [[url, 'jd_unavailable']]);
    assert.match(text, /## Processed/);
  } finally { f.cleanup(); }
});

test('malformed or reversed page delays fall back to the configured default range', () => {
  for (const range of [[10], ['10', 20], [20, 10], [NaN, 20], [0, Infinity], [-1, 20]]) {
    const value = randomDelay(range);
    assert.ok(value >= 3000 && value < 8000, JSON.stringify(range));
  }
  assert.equal(randomDelay([0, 0]), 0);
});
