// A Codex worker that times out after writing its report has no final JSON, so
// the runner recovers the score from the artifacts. The worker log echoes the
// prompt, whose result-contract example carries "score": 4.0; reading the log
// recorded that example instead of the report's real score.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, getBash, toBashPath } from './helpers.mjs';

const runner = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf8').replace(/\r\n/g, '\n');
const functionCode = (name) => {
  const match = runner.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}(?=\\n(?:\\n|#))`, 'm'));
  assert(match, `runner function ${name}`);
  return match[0];
};
const sh = (path) => toBashPath ? toBashPath(path) : path;

function recover({ report, tracker }) {
  const dir = mkdtempSync(join(tmpdir(), 'career-score-recovery-'));
  try {
    const files = { final: join(dir, 'missing.final.json'), report: join(dir, 'report.md'), tracker: join(dir, 'row.tsv'), log: join(dir, 'worker.log') };
    writeFileSync(files.log, 'user\n```json\n{\n  "status": "completed",\n  "score": 4.0,\n```\ncodex\nThe evaluation is 2.0/5, Skip.\n');
    if (report) writeFileSync(files.report, report);
    if (tracker) writeFileSync(files.tracker, tracker);
    writeFileSync(join(dir, 'run.sh'), `set -euo pipefail
SCRIPT_DIR=${JSON.stringify(sh(join(ROOT, 'batch')))}
${functionCode('worker_json_field')}
${functionCode('extract_score_from_artifacts')}
extract_score_from_artifacts "$@"
`);
    const args = [files.final, report ? files.report : '', tracker ? files.tracker : '', files.log].map(sh);
    const res = spawnSync(getBash(), [sh(join(dir, 'run.sh')), ...args], { encoding: 'utf8', timeout: 30000 });
    assert.equal(res.status, 0, res.stderr);
    return res.stdout.trim();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a timed-out worker keeps its report score, not the prompt example in its log', () => {
  const report = '# Evaluation\n\n**Score:** 2.0/5\n**PDF:** Not generated. Score below the configured 4.0 threshold.\n';
  assert.equal(recover({ report }), '2.0');
});

test('without a report score the tracker row supplies it, never the log', () => {
  const tracker = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n042\t2026-01-31\tFabrikam\tDesigner\tSKIP\t2.0/5\t❌\t-\tnote\n';
  assert.equal(recover({ tracker }), '2.0');
  assert.equal(recover({}), '-');
});
