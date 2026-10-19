import { copyBatchOwnership } from './copy-batch-ownership.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, getBash, toBashPath, rmSync } from './helpers.mjs';
import { loadAnswers, loadQueue, validLocal, validateHold, canResume, writeHold, JD_SKIP_REASON, JOB_SKIP_REASON } from '../batch/manual-inputs.mjs';
import { validateWorkerArtifacts, parseTrackerAddition } from '../batch/validate-worker-artifacts.mjs';
import { savePostingContext } from '../lib/posting-context.mjs';
import { url, hold, fixture } from './fixtures/batch-workflow-parity.mjs';

test('the HTTP prefetch reaches the worker without being erased by the local branch', () => {
  const f = fixture();
  try {
    const posting = 'https://example.com/posting';
    const queue = join(f.root, 'queue.txt'); writeFileSync(queue, posting + '\n');
    writeFileSync(join(f.batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${posting}\tfixture\t\n`);
    const jd = 'Real employer JD responsibilities and qualifications '.repeat(30).trim();
    const content = join(f.root, 'curl-content'); writeFileSync(content, jd);
    writeFileSync(join(f.root, 'curl-stub.mjs'), `import {writeFileSync} from 'node:fs'; const args=process.argv.slice(2); writeFileSync(args[args.indexOf('--output')+1], ${JSON.stringify(jd)});\n`);
    writeFileSync(join(f.root, 'bin/curl'), '#!/usr/bin/env bash\nnode "$FIXTURE_CURL_JS" "$@"\n', { mode: 0o755 });
    const result = f.run(['--queue-file', queue]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(`${f.calls}.jd`, 'utf8'), jd, result.stdout + result.stderr);
    assert.equal(existsSync(`${f.calls}.browser`), false, 'HTTP success must not launch a browser');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('browser fallback supplies rendered JD bytes to the real worker launch after HTTP/API miss', () => {
  const f = fixture();
  try {
    const posting = 'https://board.example/job/123?source=fixture&role=Angular';
    const queue = join(f.root, 'queue.txt'); writeFileSync(queue, posting + '\n');
    writeFileSync(join(f.batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${posting}\tfixture\t\n`);
    writeFileSync(join(f.root, 'fetch-jd.mjs'), 'process.exitCode=1;\n');
    const jd = 'Angular Engineer\n\n' + 'Build accessible interfaces with TypeScript and test production code. '.repeat(20) + '\nOriginal formatting retained.\n';
    writeFileSync(join(f.root, 'browser-result.json'), JSON.stringify({ url: posting, title: 'Angular Engineer', text: jd }));
    const result = f.run(['--queue-file', queue]);
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /words from browser extraction/);
    assert.equal(readFileSync(`${f.calls}.jd`, 'utf8'), jd);
    assert.match(readFileSync(`${f.calls}.worker`, 'utf8'), /Internal batch locator: https:\/\/board.example\/job\/123\?source=fixture&role=Angular/);
    const calls = readFileSync(`${f.calls}.browser`, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls, [['--user', 'fixture', posting, '--mode', 'jd', '--timeout', '15000', '--max-chars', '100000']]);
    assert.ok(existsSync(join(f.batch, 'logs/1.jd-browser.log')));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('the real batch forwards original source/notes and saved HN text before requesting any JD fetch', async () => {
  const f = fixture();
  try {
    for (const name of ['lib/posting-context.mjs', 'lib/scan-history-columns.mjs', 'lib/tsv-formula-escape.mjs', 'providers/hackernews.mjs', 'providers/_html-entities.mjs', 'path-resolver.mjs', 'url-key.mjs', 'lib/linkedin-url.mjs']) {
      mkdirSync(join(f.root, name, '..'), { recursive: true });
      copyFileSync(join(ROOT, name), join(f.root, name));
    }
    const posting = 'https://news.ycombinator.com/item?id=123';
    const text = 'Example | Engineer | Remote\n\n' + 'Build production services in Rust. Apply by email to jobs@example.org. '.repeat(20);
    await savePostingContext(f.root, { url: posting, title: 'Example | Engineer | Remote', source: 'hackernews-api', description: text });
    const notes = 'Example | Engineer | Remote | posted: 2026-10-02';
    const queue = join(f.root, 'queue.txt'); writeFileSync(queue, posting + '\n');
    writeFileSync(join(f.batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${posting}\tpipeline\t${notes}\n`);
    const result = f.run(['--queue-file', queue]);
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(existsSync(f.calls), false, 'saved original JD bypasses HTTP retrieval');
    assert.equal(existsSync(`${f.calls}.browser`), false);
    assert.ok(readFileSync(`${f.calls}.jd`, 'utf8').endsWith(text));
    const prompt = readFileSync(`${f.calls}.worker`, 'utf8');
    assert.ok(prompt.includes(JSON.stringify({ source: 'pipeline', notes })));
    assert.match(prompt, /Posting context file:/);
    const context = JSON.parse(readFileSync(join(f.batch, 'logs/1.source.json'), 'utf8'));
    assert.equal(context.snapshot.description, text);
    assert.equal(context.recovery, 'scanner_snapshot');
    assert.equal(context.url, posting);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('browser failures, invalid JSON, thin text and truncated text leave the worker fallback available', async t => {
  for (const [name, output] of [
    ['unavailable browser', null], ['malformed JSON', '{'],
    ['thin text', JSON.stringify({ text: 'Loading, please wait.' })],
    ['error payload', JSON.stringify({ error: 'navigation failed', text: 'invalid '.repeat(100) })],
    ['truncated JD', JSON.stringify({ text: 'partial '.repeat(100) + '…' })],
  ]) await t.test(name, () => {
    const f = fixture();
    try {
      const posting = 'https://board.example/job/456';
      const queue = join(f.root, 'queue.txt'); writeFileSync(queue, posting + '\n');
      writeFileSync(join(f.batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${posting}\tfixture\t\n`);
      if (output !== null) writeFileSync(join(f.root, 'browser-result.json'), output);
      const result = f.run(['--queue-file', queue]);
      assert.ifError(result.error); assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /browser extraction unavailable/);
      assert.equal(readFileSync(`${f.calls}.jd`, 'utf8'), '');
      assert.equal(readFileSync(`${f.calls}.browser`, 'utf8').trim().split('\n').length, 1);
      assert.equal(JSON.parse(readFileSync(join(f.batch, 'logs/1.hold.json'), 'utf8')).reason, 'agency_confirmation', 'worker still runs with its own retrieval/hold gates');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});

test('an ATS API hit or a local JD bypasses browser fallback', async t => {
  for (const local of [false, true]) await t.test(local ? 'local JD' : 'API JD', () => {
    const f = fixture();
    try {
      const posting = local ? 'local:jds/role.md' : 'https://board.example/job/789';
      const jd = 'Verbatim requirements and role responsibilities. '.repeat(25);
      const queue = join(f.root, 'queue.txt'); writeFileSync(queue, posting + '\n');
      writeFileSync(join(f.batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${posting}\tfixture\t\n`);
      if (local) writeFileSync(join(f.root, 'jds/role.md'), jd);
      else writeFileSync(join(f.root, 'fetch-jd.mjs'), `process.stdout.write(${JSON.stringify(jd)});\n`);
      const result = f.run(['--queue-file', queue]);
      assert.ifError(result.error); assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.equal(readFileSync(`${f.calls}.jd`, 'utf8'), jd);
      assert.equal(existsSync(`${f.calls}.browser`), false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
