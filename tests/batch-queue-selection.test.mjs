import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, rmSync } from './helpers.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'batch-queue-select-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'jds'));
  const answers = join(root, 'answers.json'), queue = join(root, 'queue.txt'), input = join(root, 'input.tsv');
  writeFileSync(answers, JSON.stringify({ schema_version: 1, user: 'fixture', answers: [] }));
  const run = () => spawnSync(process.execPath, [join(ROOT, 'batch/manual-inputs.mjs'), 'select', 'fixture', answers, queue, input], {
    encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root },
  });
  return { root, answers, queue, input, run };
}

test('large historical input is selected once by exact normalized URLs without modifying either input', t => {
  const f = fixture(t);
  const url = 'https://example.com/job?literal=$foo&tag=[x]';
  const text = 'id\turl\tsource\tnotes\r\n' + Array.from({ length: 6000 }, (_, id) => `${id}\thttps://example.com/${id}\tfixture\thistorical\r\n`).join('') + `6000\t${url}\tfixture\tquoted role\r\n6001\tlocal:jds/captured.md\tfixture\tlocal\r\n`;
  const queue = `  ${url}  \r\nlocal:jds/captured.md\r\n\r\n`;
  writeFileSync(f.input, text); writeFileSync(f.queue, queue); writeFileSync(join(f.root, 'jds/captured.md'), 'Fictional JD');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trimEnd().split('\n'), ['id\turl\tsource\tnotes', `6000\t${url}\tfixture\tquoted role`, '6001\tlocal:jds/captured.md\tfixture\tlocal']);
  assert.equal(readFileSync(f.input, 'utf8'), text);
  assert.equal(readFileSync(f.queue, 'utf8'), queue);
});

test('invalid queue and wrong-user answers fail instead of becoming an empty successful selection', t => {
  const f = fixture(t);
  writeFileSync(f.input, 'id\turl\tsource\tnotes\n1\thttps://example.com/1\tx\tx\n');
  writeFileSync(f.queue, 'local:jds/../outside.md\n');
  assert.equal(f.run().status, 2);
  writeFileSync(f.queue, 'https://example.com/1\n');
  writeFileSync(f.answers, JSON.stringify({ schema_version: 1, user: 'other', answers: [] }));
  assert.equal(f.run().status, 2);
});

test('selection retains local-capture symlink containment checks', t => {
  const f = fixture(t), outside = mkdtempSync(join(tmpdir(), 'batch-queue-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'jd.md'), 'Outside fictional JD');
  try { symlinkSync(outside, join(f.root, 'jds/escape'), 'junction'); }
  catch (error) { t.skip(error.message); return; }
  writeFileSync(f.queue, 'local:jds/escape/jd.md\n');
  writeFileSync(f.input, 'id\turl\tsource\tnotes\n1\tlocal:jds/escape/jd.md\tx\tx\n');
  assert.equal(f.run().status, 2);
});
