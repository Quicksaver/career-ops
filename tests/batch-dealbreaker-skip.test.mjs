// A batch worker that hits one of the candidate's hard rules writes a SKIP
// tracker row and hands back status "skipped". The runner records a finished
// skip, keeps the row (and its reserved number) for the merge, and lists it in
// the summary. Fork layout: the runner's real result handling runs from
// `local completed_at` to the end of the worker function, for both the Codex
// schema-constrained final JSON and the fenced JSON other CLIs print. Upstream's
// separate `rule`/`jd_line` payload fields do not exist here: the fork records
// the full quoted `Dealbreaker:` note from the validated SKIP row instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT, getBash, toBashPath } from './helpers.mjs';
import { listTree } from '../lib/walk-tree.mjs';

const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const runner = read('batch/batch-runner.sh');
const prompt = read('batch/batch-prompt.md');
const schema = JSON.parse(read('batch/batch-output-schema.json'));
const resultStart = runner.indexOf('  local completed_at\n  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)\n  local report_file tracker_file\n');
const resultEnd = runner.indexOf('\n}\n\n# Merge tracker additions', resultStart);
const resultCode = runner.slice(resultStart, resultEnd);
const functionCode = (name) => {
  // Embedded `node -e` programs also close braces at column 0, so a function
  // ends at a column-0 brace followed by a blank line or a comment.
  const match = runner.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}(?=\\n(?:\\n|#))`, 'm'));
  assert(match, `runner function ${name}`);
  return match[0];
};
const sh = (path) => toBashPath ? toBashPath(path) : path;

const USER = 'fixture';
const URL = 'https://jobs.example.test/1';
const RULE = 'No fully on-site roles';
const JD_LINE = 'This role is on site in Springfield five days a week.';
const NOTE = `"${RULE}" vs "${JD_LINE}"`;
const HEADER = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl';
const skipRow = (over = {}) => {
  const f = { num: '042', date: '2026-01-31', company: 'Fabrikam', role: 'Product Designer', status: 'SKIP', score: 'N/A', pdf: '❌', report: '-', notes: `Dealbreaker: ${NOTE}`, url: URL, ...over };
  return `${HEADER}\n${[f.num, f.date, f.company, f.role, f.status, f.score, f.pdf, f.report, f.notes, f.url].join('\t')}\n`;
};
const skipPayload = (over = {}) => ({
  status: 'skipped', id: '1', report_num: '042', company: 'Fabrikam', role: 'Product Designer',
  score: null, legitimacy: null, via: null, company_confidential: null, pdf: null, report: null,
  tracker: 'batch/tracker-additions/1.tsv', error: null, question: null, reason: 'dealbreaker', url: URL, ...over,
});

// The subset of JSON Schema batch-output-schema.json uses, so a payload that
// Codex's --output-schema would reject cannot pass here unnoticed.
function schemaErrors(value, node = schema, path = '$') {
  const errors = [];
  const types = [node.type].flat().filter(Boolean);
  const typeOf = (v) => v === null ? 'null' : typeof v === 'number' ? 'number' : typeof v;
  if (types.length && !types.includes(typeOf(value))) errors.push(`${path}: type ${typeOf(value)}`);
  if (node.enum && !node.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (node.type === 'object' && value && typeof value === 'object') {
    for (const key of node.required || []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    for (const key of Object.keys(value)) {
      if (!(key in (node.properties || {}))) { if (node.additionalProperties === false) errors.push(`${path}.${key}: additional`); continue; }
      errors.push(...schemaErrors(value[key], node.properties[key], `${path}.${key}`));
    }
  }
  return errors;
}

let work;
test.before(() => {
  assert.ok(resultStart >= 0 && resultEnd > resultStart, 'runner result-handling boundaries');
  assert.match(resultCode, /# A dealbreaker hit is a finished skip/);
  work = mkdtempSync(join(tmpdir(), 'career-dealbreaker-batch-'));
  const userRoot = join(work, 'users', USER);
  for (const dir of ['reports', 'output', 'jds', 'batch/tracker-additions', 'batch/logs']) mkdirSync(join(userRoot, dir), { recursive: true });
  writeFileSync(join(work, 'result.sh'), `set -euo pipefail
cd "$(dirname "$0")"
SCRIPT_DIR=${JSON.stringify(sh(join(ROOT, 'batch')))}
PROJECT_DIR="$PWD/project"
USER_ID=${USER}
USER_ROOT="$PWD/users/${USER}"
REPORTS_DIR="$USER_ROOT/reports"
TRACKER_DIR="$USER_ROOT/batch/tracker-additions"
LOGS_DIR="$USER_ROOT/batch/logs"
ANSWERS_FILE=""
CLI="$1"
MAX_RETRIES=2
MIN_SCORE=0
update_state_retrying() { printf '%s\\n' "$@" > "$PWD/state"; }
release_report_num() { printf '%s\\n' "$1" >> "$PWD/released"; }
${functionCode('is_decimal_number')}
${functionCode('find_report_for_num')}
${functionCode('find_tracker_for_id')}
${functionCode('validate_worker_json')}
${functionCode('worker_json_field')}
${functionCode('build_contract_error')}
${functionCode('extract_score_from_artifacts')}
handle_result() {
  local id=1 url=${URL} original_url=${URL} started_at=start report_num=042 retries=0
  local exit_code=0 timed_out=false explicit_failed_retry=false terminal_failure_recorded=false
  local log_file="$LOGS_DIR/1.log" final_file="$LOGS_DIR/042-1.final.json"
${resultCode}
}
handle_result
`);
});
test.after(() => { if (work) rmSync(work, { recursive: true, force: true }); });

const userRoot = () => join(work, 'users', USER);
const additions = () => join(userRoot(), 'batch', 'tracker-additions');
const logs = () => join(userRoot(), 'batch', 'logs');
function reset() {
  for (const name of ['state', 'released']) rmSync(join(work, name), { force: true });
  for (const dir of ['reports', 'output', 'jds', 'batch/tracker-additions', 'batch/logs']) {
    rmSync(join(userRoot(), dir), { recursive: true, force: true });
    mkdirSync(join(userRoot(), dir), { recursive: true });
  }
}
function handle(payload, { tsv, report, cli = 'codex' } = {}) {
  reset();
  if (tsv !== undefined) writeFileSync(join(additions(), '1.tsv'), tsv);
  if (report) writeFileSync(join(userRoot(), 'reports', '042-fabrikam-2026-01-31.md'), '# Fictional report\n');
  if (cli === 'codex') {
    writeFileSync(join(logs(), '042-1.final.json'), JSON.stringify(payload));
    writeFileSync(join(logs(), '1.log'), 'codex worker log\n');
  } else {
    writeFileSync(join(logs(), '1.log'), `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`);
  }
  const res = spawnSync(getBash(), [join(work, 'result.sh'), cli], { encoding: 'utf8', timeout: 60000 });
  return {
    status: res.status,
    output: res.stdout + res.stderr,
    fields: existsSync(join(work, 'state')) ? readFileSync(join(work, 'state'), 'utf8').replace(/\n$/, '').split('\n') : [],
    released: existsSync(join(work, 'released')) ? readFileSync(join(work, 'released'), 'utf8').trim().split('\n') : [],
  };
}
const quarantined = () => {
  const dir = join(logs(), 'quarantine');
  if (!existsSync(dir)) return [];
  return listTree(dir).map(p => relative(dir, p).replaceAll('\\', '/')).sort();
};

test('the Codex dealbreaker payload the prompt describes satisfies the --output-schema', () => {
  assert.deepEqual(schemaErrors(skipPayload()), []);
  assert.ok(schemaErrors(skipPayload({ rule: RULE })).length > 0, 'the schema stays closed to undeclared fields');
  assert.ok(schemaErrors(skipPayload({ reason: 'other' })).length > 0);
});

for (const cli of ['codex', 'claude']) {
  test(`${cli}: a dealbreaker skip with its SKIP row is a finished skip, not a hold or a failure`, () => {
    const { status, fields, output, released } = handle(skipPayload(), { tsv: skipRow(), cli });
    assert.equal(status, 0, output);
    assert.equal(fields.length, 9, output);
    assert.equal(fields[2], 'skipped');
    assert.equal(fields[5], '042');
    assert.equal(fields[6], '-');
    assert.equal(fields[7], `dealbreaker: ${NOTE}`);
    assert.equal(fields[8], '0');
    assert.deepEqual(released, [], 'the SKIP row holds its number until the merge');
    assert.equal(readFileSync(join(additions(), '1.tsv'), 'utf8'), skipRow(), 'the SKIP row stays for the merge');
    assert.deepEqual(quarantined(), []);
    assert.match(output, /Skipped \(dealbreaker\)/);
    assert.doesNotMatch(output, /Needs confirmation|Failed/);
  });
}

test('control characters in the quoted note cannot split the state row', () => {
  const { fields, output } = handle(skipPayload(), { tsv: skipRow({ notes: `Dealbreaker: "No\x1fon-site\x0broles" vs "${JD_LINE}"` }) });
  assert.equal(fields.length, 9, output);
  assert.equal(fields[2], 'skipped');
  assert.equal(fields[7], `dealbreaker: "No on-site roles" vs "${JD_LINE}"`);
});

test('the reserved number matches the SKIP row with or without zero padding', () => {
  const { fields } = handle(skipPayload(), { tsv: skipRow({ num: '42' }) });
  assert.equal(fields[2], 'skipped');
});

test('a dealbreaker skip without a tracker row fails and can be retried', () => {
  const { fields } = handle(skipPayload());
  assert.equal(fields[2], 'failed');
  assert.match(fields[7], /invalid dealbreaker skip: dealbreaker skip has no tracker addition/);
  assert.equal(fields[8], '1');
});

for (const [name, tsv] of [
  ['a row that is not SKIP', skipRow({ status: 'Evaluated' })],
  ['a row for another URL', skipRow({ url: 'https://jobs.example.test/other' })],
  ['a row without the quoted rule', skipRow({ notes: 'on-site' })],
  ['a row with another number than the reserved one', skipRow({ num: '041' })],
  ['a row for another company', skipRow({ company: 'Litware' })],
  ['a headerless row', skipRow().split('\n').slice(1).join('\n')],
]) {
  test(`${name} is quarantined and the job fails`, () => {
    const { fields } = handle(skipPayload(), { tsv });
    assert.equal(fields[2], 'failed');
    assert.match(fields[7], /invalid dealbreaker skip/);
    assert.equal(existsSync(join(additions(), '1.tsv')), false);
    const rejected = quarantined().find(p => /^rejected-042-1\.[^/]+\/1\.tsv$/.test(p));
    assert.ok(rejected, quarantined().join(', '));
    assert.equal(readFileSync(join(logs(), 'quarantine', rejected), 'utf8'), tsv);
  });
}

for (const mismatch of [{ id: '2' }, { url: 'https://jobs.example.test/other' }, { report_num: '041' }, { score: 3.1 }, { tracker: null }, { company: '' }]) {
  test(`a skip handoff with a wrong ${Object.keys(mismatch)[0]} fails and quarantines its row`, () => {
    const { fields } = handle(skipPayload(mismatch), { tsv: skipRow() });
    assert.equal(fields[2], 'failed');
    assert.equal(existsSync(join(additions(), '1.tsv')), false);
  });
}

test('a Codex final JSON outside the schema is a failed attempt before the skip path', () => {
  const { fields } = handle(skipPayload({ status: 'dealbreaker' }), { tsv: skipRow() });
  assert.equal(fields[2], 'failed');
  assert.match(fields[7], /invalid-final-json/);
});

test('a dealbreaker skip that also wrote a report quarantines both', () => {
  const { fields } = handle(skipPayload(), { tsv: skipRow(), report: true });
  assert.equal(fields[2], 'failed');
  assert.match(fields[7], /must not write a report, CV or JD artifact/);
  assert.deepEqual(readdirSync(join(userRoot(), 'reports')), []);
  const files = quarantined();
  assert.ok(files.some(p => /^rejected-042-1\.[^/]+\/042-fabrikam-2026-01-31\.md$/.test(p)), files.join(', '));
  assert.ok(files.some(p => /^rejected-042-1\.[^/]+\/1\.tsv$/.test(p)), files.join(', '));
});

test('agency handoffs still hold and still quarantine any tracker row', () => {
  const hold = skipPayload({ status: 'needs_confirmation', reason: 'agency_confirmation', company: '', role: '', tracker: null, question: 'Which agency?' });
  assert.deepEqual(schemaErrors(hold), []);
  const { status, fields } = handle(hold, { tsv: skipRow() });
  assert.equal(status, 2);
  assert.equal(fields[2], 'needs_confirmation');
  assert.ok(quarantined().includes('1-tracker.tsv'));
});

test('after the merge, the runner releases the numbers its dealbreaker SKIP rows held', () => {
  const state = join(work, 'state.tsv');
  writeFileSync(state, 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
    + `1\t${URL}\tskipped\ts\te\t042\t-\tdealbreaker: ${NOTE}\t0\n`
    + '2\thttps://jobs.example.test/2\tcompleted\ts\te\t043\t4.1\t-\t0\n'
    + '3\thttps://jobs.example.test/3\tskipped\ts\te\t044\t2.0\tbelow-min-score\t0\n');
  const project = join(work, 'project');
  mkdirSync(project, { recursive: true });
  for (const name of ['merge-tracker', 'reconcile-pipeline', 'verify-pipeline']) {
    writeFileSync(join(project, `${name}.mjs`), `console.log('RAN ${name}', process.argv.slice(2).join(' '));\n`);
  }
  const script = join(work, 'merge.sh');
  writeFileSync(script, `set -euo pipefail
STATE_FILE=${JSON.stringify(sh(state))}
PROJECT_DIR=${JSON.stringify(sh(project))}
USER_ID=${USER}
DEFER_VERIFICATION=false
VERIFICATION_FAILED=false
release_report_num() { echo "RELEASED:$1"; }
${functionCode('merge_tracker')}
merge_tracker
`);
  const output = execFileSync(getBash(), [script], { encoding: 'utf8', timeout: 30000 });
  assert.deepEqual(output.match(/RELEASED:\d+/g), ['RELEASED:042']);
  assert.match(output, /RAN merge-tracker --user fixture/);
  assert.ok(output.indexOf('RAN merge-tracker') < output.indexOf('RELEASED:042'), 'release waits for the merge');
});

test('the summary counts dealbreaker skips and lists each with its full note', () => {
  const state = join(work, 'state.tsv');
  writeFileSync(state, 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
    + `1\t${URL}\tskipped\ts\te\t042\t-\tdealbreaker: ${NOTE}\t0\n`
    + '2\thttps://jobs.example.test/2\tcompleted\ts\te\t043\t4.1\t-\t0\n'
    + '3\thttps://jobs.example.test/3\tskipped\ts\te\t044\t2.0\tbelow-min-score\t0\n');
  const script = join(work, 'summary.sh');
  writeFileSync(script, `set -euo pipefail
STATE_FILE=${JSON.stringify(sh(state))}
PROJECT_DIR=${JSON.stringify(sh(join(work, 'no-project')))}
USER_ID=${USER}
${functionCode('is_decimal_number')}
${functionCode('print_summary')}
print_summary
`);
  const output = execFileSync(getBash(), [script], { encoding: 'utf8', timeout: 30000 });
  assert.match(output, /Skipped: 2/);
  assert.match(output, /Dealbreaker skips: 1/);
  assert.ok(output.includes(`#1 ${URL} — dealbreaker: ${NOTE}`), output);
  assert.match(output, /evaluate anyway/);
});

const gateStart = prompt.indexOf('Apply the `oferta` **Dealbreaker gate**');
const gate = prompt.slice(gateStart, prompt.indexOf('\n## ', gateStart));

test('the worker prompt runs the dealbreaker gate after the agency gate and before evaluating', () => {
  assert.ok(gateStart > 0);
  assert.ok(gateStart > prompt.indexOf('agency'), 'agency gate first');
  assert.ok(gateStart < prompt.indexOf('## Evaluation and artifacts'));
  assert.match(gate, /hard rule/i);
  assert.match(gate, /compensation\.minimum/);
  assert.match(gate, /inferred fact is not a hit/i);
  assert.match(gate, /write no report/i);
  assert.match(gate, /evaluate anyway/);
  assert.match(gate, /tab or line break[^.]*with a space/i);
});

test('the worker prompt hands back the exact skip payload the runner accepts', () => {
  const contract = prompt.match(/For a dealbreaker hit, use status `skipped`, reason `dealbreaker`[^\n]*/)?.[0];
  assert.ok(contract, 'final-result contract for dealbreaker skips');
  assert.match(contract, /exact ID and reserved report_num/);
  assert.match(contract, /Internal batch locator\*\* verbatim as `url`/);
  assert.match(contract, /actual tracker addition path as `tracker`/);
  for (const field of ['score', 'legitimacy', 'via', 'company_confidential', 'pdf', 'report', 'error', 'question']) assert.match(contract, new RegExp(`\\b${field}\\b`));
});

test('the SKIP row the prompt shows merges into the selected user tracker with the rule and the JD line', () => {
  const tsv = gate.match(/```text\n([\s\S]*?)```/)?.[1]?.replace(/^ {3}/gm, '');
  assert.ok(tsv, 'gate has no TSV example');
  const dir = mkdtempSync(join(tmpdir(), 'co-batch-dealbreaker-'));
  try {
    const root = join(dir, USER);
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'batch', 'tracker-additions'), { recursive: true });
    writeFileSync(join(root, 'data', 'applications.md'), '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n');
    const row = tsv.replaceAll('{{REPORT_NUM}}', '7').replaceAll('{{DATE}}', '2026-01-31').replace('{company}', 'Fabrikam')
      .replace('{role}', 'Product Designer').replace('{rule}', RULE).replace('{jd_line}', JD_LINE)
      .replaceAll('{{URL}}', URL);
    writeFileSync(join(root, 'batch', 'tracker-additions', '1.tsv'), row);
    const env = { ...process.env, CAREER_OPS_USERS_DIR: dir, CAREER_OPS_USER: USER };
    for (const k of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PROFILE', 'CAREER_OPS_TRACKER']) delete env[k];
    const res = spawnSync(process.execPath, [join(ROOT, 'merge-tracker.mjs'), '--user', USER], { cwd: dir, encoding: 'utf8', env });
    assert.equal(res.status, 0, res.stderr + res.stdout);
    const merged = readFileSync(join(root, 'data', 'applications.md'), 'utf8').trim().split('\n').at(-1);
    assert.match(merged, /\| Fabrikam \| Product Designer \| N\/A \| SKIP \|/);
    assert.ok(merged.includes(`"${RULE}"`) && merged.includes(`"${JD_LINE}"`), merged);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pipeline reconcile moves a dealbreaker skip to Processed without a report link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-batch-dealbreaker-reconcile-'));
  try {
    const root = join(dir, USER);
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'reports'));
    mkdirSync(join(root, 'batch'));
    const other = 'https://jobs.example.test/3';
    writeFileSync(join(root, 'data', 'pipeline.md'),
      `# Pipeline\n\n## Pending\n\n- [ ] ${URL} | Fabrikam | Product Designer\n- [ ] ${other} | Litware | Designer\n\n## Processed\n`);
    writeFileSync(join(root, 'batch', 'batch-state.tsv'), 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
      + `1\t${URL}\tskipped\ts\te\t042\t-\tdealbreaker: ${NOTE}\t0\n`
      + `3\t${other}\tskipped\ts\te\t044\t2.0\tbelow-min-score\t0\n`);
    const env = { ...process.env, CAREER_OPS_USERS_DIR: dir, CAREER_OPS_USER: USER };
    for (const k of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PIPELINE']) delete env[k];
    const res = spawnSync(process.execPath, [join(ROOT, 'reconcile-pipeline.mjs'), '--user', USER], { cwd: dir, encoding: 'utf8', env });
    assert.equal(res.status, 0, res.stderr + res.stdout);
    const text = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
    const [pending, processed] = text.split('## Processed');
    const pendingLines = pending.split('\n');
    assert.ok(!pendingLines.some((line) => line === `- [ ] ${URL} | Fabrikam | Product Designer`), text);
    assert.ok(processed.includes(`- [x] SKIP | ${URL} | Fabrikam | Product Designer | N/A | PDF ❌`), text);
    assert.ok(pendingLines.some((line) => line === `- [ ] ${other} | Litware | Designer`), 'a below-min-score skip without its report still stays pending');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
