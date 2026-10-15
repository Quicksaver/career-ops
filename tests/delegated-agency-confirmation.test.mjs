// #4359: exercise the runner's real result-handling and scheduling code with
// worker stdout fixtures. Prompt assertions cover the agent-side write gate;
// these are contract tests, not proof that an arbitrary LLM obeys its prompt.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { ROOT, pass, fail, rmSync, getBash } from './helpers.mjs';

console.log('\nDelegated agency confirmation (#4359)');
const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const runner = read('batch/batch-runner.sh');
const resultStart = runner.indexOf('  local final_json_valid=false\n');
const resultEnd = runner.indexOf('\n  return 0\n}\n\n# Merge tracker', resultStart);
const schedulingStart = runner.indexOf('    local status\n    status=$(get_status "$id")');
const schedulingEnd = runner.indexOf('\n    pending_ids+=', schedulingStart);
assert(resultStart >= 0 && resultEnd > resultStart, 'runner result-handling boundaries');
assert(schedulingStart >= 0 && schedulingEnd > schedulingStart, 'runner scheduling boundaries');
const resultCode = runner.slice(resultStart, resultEnd);
const schedulingCode = runner.slice(schedulingStart, schedulingEnd);
const functionCode = (name) => {
  const match = runner.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert(match, `runner function ${name}`);
  return match[0];
};
const work = mkdtempSync(join(tmpdir(), 'career-agency-gate-'));
const check = (name, fn) => {
  try { fn(); pass(name); } catch (error) { fail(`${name}: ${error.message}`); }
};

try {
  for (const dir of ['reports', 'batch', 'lib', 'output', 'jds']) mkdirSync(join(work, dir));
  copyFileSync(join(ROOT, 'batch/manual-inputs.mjs'), join(work, 'batch/manual-inputs.mjs'));
  copyFileSync(join(ROOT, 'lib/is-main-module.mjs'), join(work, 'lib/is-main-module.mjs'));
  writeFileSync(join(work, 'batch/validate-worker-artifacts.mjs'), '// Validator independently tested.\n');
  writeFileSync(join(work, 'validate-worker-artifacts.mjs'), '// Artifact validity is covered by the artifact contract suite.\n');
  const harness = join(work, 'result.sh');
  writeFileSync(harness, `set -euo pipefail
cd "$(dirname "$0")"
REPORTS_DIR="$PWD/reports"
TRACKER_DIR="$PWD/tracker-additions"
LOGS_DIR="$PWD/logs"
mkdir -p "$TRACKER_DIR" "$LOGS_DIR"
log_file="$PWD/worker.log"
CLI=claude
report_file=
tracker_file=
MAX_RETRIES=2
MIN_SCORE=0
exit_code=0
timed_out=false
terminal_failure_recorded=false
final_file="$PWD/absent-final.json"
SCRIPT_DIR="$PWD/batch"
USER_ROOT="$PWD"
USER_ID=fixture
ANSWERS_FILE=""
export CAREER_OPS_ROOT="$PWD"
RECOVERY_DIR="$PWD/recovery"
update_state() {
  [[ "\${TEST_STATE_FAILURE:-0}" == 0 ]] || return 1
  printf '%s\\n' "$@" > state
}
append_recovery_record() {
  [[ "\${TEST_RECOVERY_FAILURE:-0}" == 0 ]] || return 1
  printf '%s\\n' "$@" > recovery
}
sleep() { :; }
${functionCode('update_state_retrying')}
find_tracker_for_id() { [[ ! -f "$REPORTS_DIR/042-example.md" ]] || printf '%s' "$REPORTS_DIR/042-example.md"; }
find_report_for_num() { [[ ! -f "$REPORTS_DIR/042-example.md" ]] || printf '%s' "$REPORTS_DIR/042-example.md"; }
worker_json_field() { return 0; }
build_contract_error() { printf 'no report file'; }
extract_score_from_artifacts() { printf 4.2; }
release_report_num() { printf '%s' "$1" > released; }
is_decimal_number() { [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]; }
handle_result() {
  local id=1 url=https://jobs.example.test/1 started_at=start completed_at=end report_num=042 retries=0
  local original_url="$url" explicit_failed_retry=false
  report_file=$(find_report_for_num 042)
  tracker_file=$(find_tracker_for_id 1)
${resultCode}
}
handle_result
`);
  const handle = (payload, prefix = '', env = {}) => {
    for (const name of ['state', 'recovery', 'released']) rmSync(join(work, name), { force: true });
    payload = { reason: 'agency_confirmation', id: '1', url: 'https://jobs.example.test/1', report_num: '042', company: '', role: '', score: null, legitimacy: null, via: null, company_confidential: null, pdf: null, report: null, tracker: null, error: null, ...payload };
    writeFileSync(join(work, 'worker.log'), `${prefix}\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`);
    const output = execFileSync(getBash(), [harness], { encoding: 'utf8', timeout: 30000, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const path = existsSync(join(work, 'state')) ? 'state' : 'recovery';
    return { output, fields: readFileSync(join(work, path), 'utf8').trimEnd().split('\n') };
  };
  check('needs_confirmation holds without artifacts, score, report ID, or retry consumption', () => {
    const { fields, output } = handle({ status: 'needs_confirmation', question: 'Which agency?' });
    assert.equal(fields[2], 'needs_confirmation');
    assert.deepEqual(fields.slice(5), ['-', '-', 'Which agency?', '0']);
    assert.deepEqual(readdirSync(join(work, 'reports')), []);
    assert.equal(readFileSync(join(work, 'released'), 'utf8'), '042');
    assert.match(output, /https:\/\/jobs.example.test\/1.*Which agency/);
    assert.doesNotMatch(output, /Completed|Failed/);
  });
  check('the reservation sentinel alone is not a worker artifact', () => {
    writeFileSync(join(work, 'reports', '042-RESERVED.md'), '{"pid":1}\n');
    const { fields, output } = handle({ status: 'needs_confirmation', question: 'Which agency?' });
    assert.equal(fields[2], 'needs_confirmation');
    assert.equal(readFileSync(join(work, 'released'), 'utf8'), '042');
    assert.equal(existsSync(join(work, 'logs/quarantine/1-042-RESERVED.md')), false);
    assert.match(output, /Needs confirmation:.*Which agency/);
    rmSync(join(work, 'reports', '042-RESERVED.md'), { force: true });
  });
  check('confirmation artifacts fail closed, keep the reservation, and quarantine tracker data', () => {
    writeFileSync(join(work, 'tracker-additions/1.tsv'), 'unconfirmed tracker row\n');
    assert.throws(() => handle({ status: 'needs_confirmation', question: 'Which agency?' }), (error) => {
      assert.equal(error.status, 2, error.stderr);
      assert.match(error.stderr, /reservation kept and tracker merge skipped/);
      return true;
    });
    assert.equal(existsSync(join(work, 'released')), false);
    assert.equal(existsSync(join(work, 'tracker-additions/1.tsv')), false);
    assert.equal(readFileSync(join(work, 'logs/quarantine/1-tracker.tsv'), 'utf8'), 'unconfirmed tracker row\n');
    rmSync(join(work, 'logs/quarantine/1-tracker.tsv'), { force: true });
  });
  check('confirmation artifacts quarantine every report before holding the job', () => {
    for (const name of ['042-first.md', '042-second.md']) {
      writeFileSync(join(work, 'reports', name), `unconfirmed ${name}\n`);
    }
    assert.throws(() => handle({ status: 'needs_confirmation', question: 'Which agency?' }), (error) => {
      assert.equal(error.status, 2, error.stderr);
      assert.match(error.stderr, /reservation kept and tracker merge skipped/);
      return true;
    });
    assert.equal(existsSync(join(work, 'released')), false);
    assert.deepEqual(readdirSync(join(work, 'reports')), []);
    for (const name of ['042-first.md', '042-second.md']) {
      const quarantined = join(work, 'logs/quarantine', `1-${name}`);
      assert.equal(readFileSync(quarantined, 'utf8'), `unconfirmed ${name}\n`);
      rmSync(quarantined, { force: true });
    }
  });
  check('confirmation holds quarantine CV and archived JD artifacts before refusing merge', () => {
    for (const path of ['output/042-example.pdf', 'jds/042-example.md']) writeFileSync(join(work, path), 'unconfirmed artifact');
    assert.throws(() => handle({ status: 'needs_confirmation', question: 'Which agency?' }), error => error.status === 2);
    for (const path of ['output/042-example.pdf', 'jds/042-example.md']) {
      assert.equal(existsSync(join(work, path)), false);
      const quarantined = join(work, 'logs/quarantine', `1-${path.split('/').at(-1)}`);
      assert.equal(readFileSync(quarantined, 'utf8'), 'unconfirmed artifact');
      rmSync(quarantined, { force: true });
    }
    assert.equal(existsSync(join(work, 'released')), false);
    const fields = readFileSync(join(work, 'state'), 'utf8').trimEnd().split('\n');
    assert.equal(fields[2], 'needs_confirmation');
    assert.equal(fields[8], '0');
  });
  check('handoff question control characters cannot split batch state fields', () => {
    const { fields } = handle({ status: 'needs_confirmation', question: 'Agency?\tConfirm\nplease\u001fnow' });
    assert.equal(fields.length, 9);
    assert.equal(fields[7], 'Agency? Confirm please now');
  });
  check('durable recovery fallback still releases the reservation and surfaces the question under set -e', () => {
    const { fields, output } = handle({ status: 'needs_confirmation', question: 'Which agency?' }, '', { TEST_STATE_FAILURE: '1' });
    assert.equal(fields[2], 'needs_confirmation');
    assert.equal(fields[8], '0');
    assert.equal(existsSync(join(work, 'state')), false);
    assert.equal(readFileSync(join(work, 'released'), 'utf8'), '042');
    assert.match(output, /Needs confirmation:.*Which agency/);
  });
  check('failure to persist either state or recovery is explicit, after release and question', () => {
    assert.throws(() => handle({ status: 'needs_confirmation', question: 'Which agency?' }, '', {
      TEST_STATE_FAILURE: '1', TEST_RECOVERY_FAILURE: '1',
    }), (error) => {
      assert.equal(error.status, 2, error.stderr);
      assert.match(error.stdout, /Needs confirmation:.*Which agency/);
      assert.match(error.stderr, /hold could not be persisted/);
      return true;
    });
    assert.equal(readFileSync(join(work, 'released'), 'utf8'), '042');
  });
  check('stale recovery transitions cannot overwrite a held row', () => {
    const script = join(work, 'recover.sh');
    writeFileSync(script, `set -euo pipefail
get_status() { printf needs_confirmation; }
update_state_unlocked() { echo OVERWRITTEN; }
${functionCode('recovery_record_is_superseded')}
${functionCode('reconcile_one_unlocked')}
for stale in failed processing rate_limited pending completed; do
  rc=0
  reconcile_one_unlocked 1 https://jobs.example.test/1 "$stale" start end 042 - stale 1 || rc=$?
  [[ "$rc" == 3 ]] || exit 1
done
`);
    const output = execFileSync(getBash(), [script], { encoding: 'utf8', timeout: 30000 });
    assert.doesNotMatch(output, /OVERWRITTEN/);
    assert.equal((output.match(/Superseded:/g) || []).length, 5);
  });
  check('missing handoff question fails closed and stays held without retry consumption', () => {
    assert.throws(() => handle({ status: 'needs_confirmation' }), error => error.status === 2);
    const fields = readFileSync(join(work, 'state'), 'utf8').trimEnd().split('\n');
    assert.equal(fields[2], 'needs_confirmation');
    assert.equal(fields[8], '0');
    assert.equal(existsSync(join(work, 'released')), false);
  });
  check('only the final fenced payload controls the result', () => {
    const { fields } = handle({ status: 'needs_confirmation', question: 'Which agency?' }, '```json\n{"status":"completed","score":5}\n```');
    assert.equal(fields[2], 'needs_confirmation');
  });
  for (const mismatch of [{ url: 'https://jobs.example.test/other' }, { id: '2' }, { reason: 'other' }, { score: 4.8 }]) {
    check(`invalid handoff ${Object.keys(mismatch)[0]} stays held for inspection`, () => {
      assert.throws(() => handle({ status: 'needs_confirmation', question: 'Wrong posting?', ...mismatch }), error => error.status === 2);
      const fields = readFileSync(join(work, 'state'), 'utf8').trimEnd().split('\n');
      assert.equal(fields[2], 'needs_confirmation');
      assert.match(fields[7], /invalid manual handoff/);
      assert.equal(fields[8], '0');
      assert.equal(existsSync(join(work, 'released')), false);
    });
  }
  check('unavailable JD uses its own durable reason without evaluation artifacts', () => {
    const { fields } = handle({ status: 'needs_confirmation', reason: 'jd_unavailable', question: 'Paste JD text' });
    assert.equal(fields[2], 'needs_confirmation');
    assert.equal(fields[8], '0');
    assert.equal(JSON.parse(readFileSync(join(work, 'logs/1.hold.json'), 'utf8')).reason, 'jd_unavailable');
  });
  check('real worker failures retain retry accounting', () => {
    const { fields } = handle({ status: 'failed', error: 'No JD' });
    assert.equal(fields[2], 'failed');
    assert.equal(fields[8], '1');
  });
  check('claiming completion without a report still fails closed', () => {
    const { fields } = handle({ status: 'completed', score: 4.2 });
    assert.equal(fields[2], 'failed');
    assert.match(fields[7], /no report file/);
  });
  check('normal completed reports still retain score and report number', () => {
    writeFileSync(join(work, 'reports/042-example.md'), '# Fictional completed evaluation\n');
    const { fields } = handle({ status: 'completed', score: 4.2, error: null });
    assert.equal(fields[2], 'completed');
    assert.deepEqual(fields.slice(5), ['042', '4.2', '-', '0']);
  });
  for (const [name, retry, resume] of [['ordinary rerun', false, false], ['retry-failed', true, false], ['resume-paused', false, true]]) {
    check(`${name} cannot resume a held posting`, () => {
      const script = join(work, 'schedule.sh');
      writeFileSync(script, `set -euo pipefail
RESUME_PAUSED=${resume}
RETRY_FAILED=${retry}
CLI=claude
report_file=
tracker_file=
MAX_RETRIES=2
ANSWERS_FILE=""
QUEUE_FILE=""
DRY_RUN=false
USER_ID=fixture
SCRIPT_DIR="$(dirname "$0")/batch"
LOGS_DIR="$(dirname "$0")/logs"
get_status() { printf '%s' needs_confirmation; }
get_retries() { printf '0'; }
schedule() {
  local id url=https://jobs.example.test/1
  for id in 1; do
${schedulingCode}
    echo DISPATCHED
  done
}
schedule
`);
      const output = execFileSync(getBash(), [script], { encoding: 'utf8', timeout: 30000 });
      assert.match(output, /HOLD #1/);
      assert.doesNotMatch(output, /DISPATCHED/);
    });
  }
  check('all worker entrypoints require the confirmation handoff before artifact steps', () => {
    for (const [path, later] of [
      ['modes/auto-pipeline.md', '## Step 2 — Save Report'],
      ['modes/oferta.md', '## Block A'],
      ['batch/batch-prompt.md', '## Evaluation and artifacts'],
    ]) {
      const source = read(path);
      const gate = source.indexOf('needs_confirmation');
      assert(gate >= 0 && gate < source.indexOf(later), path);
      assert.match(source.slice(0, source.indexOf(later)), /explicit answer/);
      assert.match(source.slice(0, source.indexOf(later)), /(?:tracker.*report.*CV|report.*tracker.*CV)/);
    }
  });
  check('parent modes retain pending items and require an explicit answer', () => {
    for (const path of ['modes/_shared.md', 'modes/pipeline.md', 'modes/batch.md']) {
      const source = read(path);
      assert.match(source, /needs_confirmation/);
      assert.match(source, /explicit answer/);
      assert.match(source, /[Pp]ending|held/);
      assert.match(source, /[Rr]elease/);
    }
  });
  check('status display treats a held question as confirmation, not failure', () => {
    const batch = join(work, 'batch');
    mkdirSync(batch, { recursive: true });
    writeFileSync(join(batch, 'batch-runner.sh'), runner);
    const url = 'https://jobs.example.test/a-long-posting-path-that-must-remain-visible/12345';
    const question = 'Which agency did this specific posting come through? Please identify the intermediary for this URL.';
    writeFileSync(join(batch, 'batch-state.tsv'),
      'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n' +
      `1\t${url}\tneeds_confirmation\tstart\tend\t-\t-\t${question}\t0\n`);
    const output = execFileSync(getBash(), [join(batch, 'batch-runner.sh'), '--status'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: work } });
    assert.match(output, /Needs confirmation: 1/);
    assert.match(output, /Needs confirmation: Which agency/);
    const heldLine = output.split('\n').find((line) => /^1\s*\|/.test(line));
    assert(heldLine, 'held row is visible');
    assert.equal(heldLine.split('|')[4].trim(), `${url} — Needs confirmation: ${question}`,
      'status cell preserves the full URL and question');
    assert.doesNotMatch(output, /Error: Which agency/);
  });
  for (const [name, count] of [['capacity wait', 3], ['final drain', 2]]) {
    check(`parallel ${name} propagates fatal worker status without merging`, () => {
      const start = runner.indexOf('  # Process offers\n');
      const end = runner.indexOf('\n}\n\nmain "$@"', start);
      assert(start >= 0 && end > start, 'real scheduler boundaries');
      const script = join(work, 'parallel.sh');
      writeFileSync(script, `set -euo pipefail
cd "$(dirname "$0")"
process_offer() {
  echo "LAUNCHED:$1"
  if [[ "$1" == 1 ]]; then return 2; fi
  sleep 0.1
  echo "DRAINED:$1"
}
merge_tracker() { echo MERGED; }
print_summary() { echo SUMMARY; }
run() {
  local VERIFICATION_FAILED=false pending_count=3 PARALLEL=2 BATCH_PAUSED=false LIVE_INPUTS="" PAUSE_FILE="$PWD/no-pause"
  local pending_ids=(1 2${count === 3 ? ' 3' : ''})
  local pending_urls=(one two three) pending_sources=(test test test) pending_notes=(note note note)
${runner.slice(start, end)}
}
run
`);
      assert.throws(() => execFileSync(getBash(), [script], {
        encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      }), (error) => {
        assert.equal(error.status, 2, error.stderr);
        assert.match(error.stdout, /DRAINED:2/, 'in-flight workers are drained');
        assert.doesNotMatch(error.stdout, /MERGED|SUMMARY|LAUNCHED:3/);
        assert.match(error.stderr, /tracker merge skipped/);
        return true;
      });
    });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
