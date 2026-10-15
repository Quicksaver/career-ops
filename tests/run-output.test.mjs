import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { cleanRunText, createRunOutput, runLineTone, supportsRunColor } from '../lib/run-output.mjs';

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
    assert.match(output.format(line), /\x1b\[36m/);
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
  assert.match(colored, /^\x1b\[2m\[run:batch-1\]\x1b\[0m \x1b\[1;31mERROR:/);
  assert.equal(stripVTControlCharacters(colored), line);
  const injected = '\x1b[2J\x1b]52;c;Y2xpcGJvYXJk\x07[run] scan completed\x1b[31m';
  assert.equal(cleanRunText(injected), '[run] scan completed');
  assert.equal(output.format(injected), output.format('[run] scan completed'));
});
