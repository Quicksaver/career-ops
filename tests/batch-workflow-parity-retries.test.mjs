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

for (const cli of ['codex', 'claude']) test(`${cli} local/source confirmation mismatch spends three attempts instead of becoming an unanswerable hold`, () => {
  const source = 'https://www.linkedin.com/jobs/view/123';
  const f = fixture({ handoffUrl: source, workerResult: { reason: 'jd_unavailable', question: 'Paste the full description.' } });
  try {
    const posting = 'local:jds/partial.md';
    writeFileSync(join(f.root, 'jds/partial.md'), `---\nsource_url: ${source}\napplication_url: ${source}\n---\nCompany introduction only. More...\n`);
    writeFileSync(join(f.batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${posting}\tfixture\t\n`);
    if (cli === 'codex') writeFileSync(join(f.root, 'bin/codex'), '#!/usr/bin/env bash\nnode "$FIXTURE_WORKER" "$@"\n', { mode: 0o755 });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = f.run([], cli);
      assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
      const state = readFileSync(join(f.batch, 'batch-state.tsv'), 'utf8').trim().split('\n')[1].split('\t');
      assert.equal(state[2], 'failed', result.stdout);
      assert.equal(Number(state[8]), attempt);
      assert.match(state[7], /invalid manual handoff: manual hold identity mismatch/);
      assert.equal(existsSync(join(f.batch, 'logs/1.hold.json')), false, 'misattributed holds are never accepted or rewritten');
      assert.equal(existsSync(join(f.batch, 'tracker-additions/1.tsv')), false);
    }
    const exhausted = f.run(['--dry-run'], cli);
    assert.match(exhausted.stdout, /failed and max retries reached/);
    assert.equal(existsSync(`${f.calls}.browser`), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
