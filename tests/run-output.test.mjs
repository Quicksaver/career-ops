import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { cleanRunText, createRunOutput, finishesRunStep, runLineTone, supportsRunColor } from '../lib/run-output.mjs';

test('colours require a terminal and respect NO_COLOR, FORCE_COLOR=0 and TERM=dumb', () => {
  assert.equal(supportsRunColor({ isTTY: true }, {}), true);
  for (const env of [{ NO_COLOR: '' }, { NO_COLOR: '1', FORCE_COLOR: '1' }, { FORCE_COLOR: '0' }, { TERM: 'dumb' }]) {
    assert.equal(supportsRunColor({ isTTY: true }, env), false);
    assert.equal(createRunOutput({ stream: { isTTY: true }, env }).format('[run] scan completed'), '[run] scan completed');
  }
  assert.equal(supportsRunColor({ isTTY: false }, { FORCE_COLOR: '1' }), false, 'redirected output stays plain');
  assert.equal(supportsRunColor({}, {}), false);
});

test('coordinator and accessory diagnostics use consistent semantic colours', () => {
  for (const [line, tone] of [
    ['[run] scan started', 'progress'], ['[run] scan completed', 'success'],
    ['[run] scan-auth failed', 'error'], ['[run] summary: completed', 'success'],
    ['[run] child cleanup failed: no response', 'error'],
    ['[run] summary: partial', 'warning'], ['[run] summary: interrupted', 'error'],
    ['[run] action required: log in', 'warning'], ['[run] logs: C:/logs', 'muted'],
    ['[run:scan] [scan-progress] started 1/12: Sample', 'progress'],
    ['[run:scan] [scan-progress] error 1/12: Sample', 'error'],
    ['[run:scan-auth] [scan-auth] WARN: session expired', 'warning'],
    ['[run:scan-auth] [scan-auth] Session active - logged in', 'success'],
    ['[run:batch-1] === Rate limited: one worker ===', 'warning'],
    ['[run:batch-1] HOLD #1: needs confirmation', 'warning'],
    ['[run:batch-1]     ✅ Recovered #1', 'success'],
    ['[run:batch-1]     ❌ Invalid worker artifacts', 'error'],
    ['[run:batch-1] SKIP #1: retries exhausted', 'muted'],
    ['[run:scan-auth] Errors: 0', 'muted'], ['[run:scan-auth] Errors: 2', 'error'],
    ['[run:scan] Total jobs found: 120', 'progress'],
    ['[run] unresolved error, broken_link: report missing', 'error'],
    ['[run:batch-1] Company role: error handling engineer', 'progress'],
    ['https://example.org/jobs/failed-role-429', 'normal'],
  ]) assert.equal(runLineTone(line), tone, line);
});

test('handoff queue, numbered tasks, agent progress and completion all receive colours', () => {
  const output = createRunOutput({ stream: { isTTY: true }, env: {} });
  for (const line of [
    '[run] scan-handoff queued 12 task(s)',
    '[run] scan-handoff task 1/12: Fictional (websearch)',
    '[handoff-progress] 1/12: Fictional (websearch) — fictional jobs',
    '[run:scan-handoff-agent] [handoff-progress] 1/12: Fictional (websearch) — fictional jobs',
    '[run:scan-handoff-agent] Agent output: [handoff-progress] 1/12: Fictional',
  ]) {
    assert.equal(runLineTone(line), 'progress', line);
    assert.match(output.format(line), /\x1b\[(?:1;)?36m/);
    assert.equal(stripVTControlCharacters(output.format(line)), line);
  }
  const done = '[run] scan-handoff processed 12/12 task(s), added 3 pending job(s)';
  assert.equal(runLineTone(done), 'success');
  assert.match(output.format(done), /\x1b\[32m/);
});

test('every child phase has a progress fallback and recognises nested severity tags', () => {
  const output = createRunOutput({ stream: { isTTY: true }, env: {} });
  for (const phase of ['doctor', 'scan', 'scan-handoff-agent', 'scan-auth-linkedin', 'scan-full', 'scan-hn',
    'scan-dayforce', 'scan-interamt', 'merge-tracker-initial', 'reconcile-pipeline-2', 'cv-sync-check',
    'pipeline-liveness', 'sync-pipeline-batch-2', 'batch-2', 'verify-reviewed', 'future-script']) {
    for (const [message, tone, code] of [
      ['source-specific activity', 'progress', '36'],
      ['[new-script-version] source-specific activity', 'progress', '36'],
      ['[new-script-version] WARN: source unavailable', 'warning', '33'],
      ['[new-script-version] [ERROR] request failed', 'error', '1;31'],
      ['[new-script-version] completed 1/1', 'success', '32'],
    ]) {
      const line = `[run:${phase}] ${message}`;
      assert.equal(runLineTone(line), tone, line);
      assert.ok(output.format(line).includes(`\x1b[${code}m`), line);
      assert.equal(stripVTControlCharacters(output.format(line)), line);
    }
  }
});

test('formatting adds only trusted SGR without changing visible text or source identity', () => {
  const output = createRunOutput({ stream: { isTTY: true }, env: {} });
  const line = '[run:batch-1] ERROR: worker failed';
  const colored = output.format(line);
  assert.ok(colored.includes('\x1b[36mbatch-1\x1b[0m'));
  assert.ok(colored.includes('\x1b[1;31mERROR\x1b[0m: worker failed'));
  assert.equal(stripVTControlCharacters(colored), line);
  const injected = '\x1b[2J\x1b]52;c;Y2xpcGJvYXJk\x07[run] scan completed\x1b[31m';
  assert.equal(cleanRunText(injected), '[run] scan completed');
  assert.equal(output.format(injected), output.format('[run] scan completed'));
});

test('mixed counters keep independent meanings, with zero errors muted and explanations neutral', () => {
  const output = createRunOutput({ color: true });
  const line = '[run:batch-1] Total: 12 | Completed: 8 | Failed: 0 | Pending: 2 | Needs confirmation: 2';
  const colored = output.format(line);
  for (const fragment of ['\x1b[1;36m12\x1b[0m', '\x1b[32m8\x1b[0m',
    '\x1b[2m0\x1b[0m', '\x1b[1;36m2\x1b[0m', '\x1b[33m2\x1b[0m']) assert.ok(colored.includes(fragment), fragment);
  assert.ok(!colored.includes('\x1b[1;31m'), 'zero failed jobs must not be painted as an error');
  assert.equal(stripVTControlCharacters(colored), line);
  assert.ok(output.format('[run] discovered: scan 0').endsWith('scan \x1b[2m0\x1b[0m'));
  const failure = output.format('[run:batch] Job #14001 failed after 3 attempts: missing-report,missing-tracker');
  assert.ok(failure.includes('\x1b[1;35m#14001\x1b[0m'));
  assert.ok(failure.includes('\x1b[1;31mfailed\x1b[0m after '));
  assert.ok(failure.includes('\x1b[1;31mmissing-report\x1b[0m'));
});

test('handoff subjects, metadata, links, paths and durations are distinct fields', () => {
  const output = createRunOutput({ color: true });
  const handoff = output.format('[handoff-progress] 1/12: SoSafe (websearch) — checking employer in 4.2s');
  assert.ok(handoff.includes('\x1b[1;36m1/12\x1b[0m: \x1b[1mSoSafe\x1b[0m (websearch)'));
  assert.ok(handoff.includes('\x1b[2m4.2s\x1b[0m'));
  const metadata = output.format('Company: SoSafe | Role: Product Engineer | Model: gpt-6.1-sol');
  for (const value of ['SoSafe', 'Product Engineer', 'gpt-6.1-sol']) assert.ok(metadata.includes(`\x1b[1m${value}\x1b[0m`));
  const url = 'https://example.org/jobs/failed-role-429';
  assert.equal(output.format(url), `\x1b[4;36m${url}\x1b[0m`);
  const path = 'C:/Career Ops/batch/failed-429.log';
  assert.ok(output.format(`[run] logs: ${path}`).endsWith(`\x1b[2m${path}\x1b[0m`));
  assert.equal(output.format('reports/11854-sosafe-2026-10-16.md'), '\x1b[2mreports/11854-sosafe-2026-10-16.md\x1b[0m');
  assert.ok(output.format('Total: 1,940').includes('\x1b[1;36m1,940\x1b[0m'));
  const error = output.format('[run] ERROR: the server returned no response');
  assert.ok(error.endsWith('\x1b[1;31mERROR\x1b[0m: the server returned no response'));
});

test('styling never inserts controls inside emoji or combining-character graphemes', () => {
  const output = createRunOutput({ color: true });
  const line = '[run:scan] 1️⃣ task: Cafe\u0301 👩‍💻 | 2 pending';
  const colored = output.format(line);
  for (const grapheme of ['1️⃣', 'e\u0301', '👩‍💻']) assert.ok(colored.includes(grapheme));
  assert.equal(stripVTControlCharacters(colored), line);
});

test('footer highlights shortcuts and counters while leaving pasted input unstyled', () => {
  const output = createRunOutput({ color: true });
  const shortcuts = 'Enter: answer | Ctrl+D: JD | /skip: discard | /later: defer';
  const colored = output.format(shortcuts, 'muted', { kind: 'shortcuts' });
  for (const key of ['Enter', 'Ctrl+D', '/skip', '/later']) assert.ok(colored.includes(`\x1b[1;36m${key}\x1b[0m`));
  assert.equal(stripVTControlCharacters(colored), shortcuts);
  assert.equal(output.format('> ERROR: https://example.org/jobs/123', 'input', { kind: 'input' }), '\x1b[1;32m>\x1b[0m ERROR: https://example.org/jobs/123');
});

test('a step outcome matches only its own started line', () => {
  const scan = '[run:scan] [scan-progress] started 115/117: Python.org Jobs via pythonorg';
  for (const [previous, line, expected] of [
    ['[run] scan started', '[run] scan completed', true],
    ['[run] scan started', '[run] scan failed', true],
    ['[run:verify] [verify] review started', '[run:verify] [verify] review completed', true],
    [scan, '[run:scan] [scan-progress] completed 106/117: Python.org Jobs via pythonorg — 20 found, 0 candidate(s)', true],
    [scan, '[run:scan] [scan-progress] failed 106/117: Python.org Jobs via pythonorg — 0 found, 0 candidate(s)', true],
    ['[run] scan started', '[run] scan-auth completed', false],
    ['[run] scan started', '[run:scan] scan completed', false],
    [scan, '[run:scan] [scan-progress] completed 107/117: Startup Jobs via startup-jobs — 34 found, 1 candidate(s)', false],
    [scan, '[run:scan] [scan-progress] completed 106/118: Python.org Jobs via pythonorg — 20 found, 0 candidate(s)', false],
    [scan, '[run:scan] [scan-progress] completed 106/117: Python.org Jobs via pythonorg2 — 20 found', false],
    ['[run] scan completed', '[run] scan completed', false],
    [null, '[run] scan completed', false],
  ]) assert.equal(finishesRunStep(previous, line), expected, `${previous} -> ${line}`);
});
