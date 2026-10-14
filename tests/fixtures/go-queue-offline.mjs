// Offline subprocess fixture. Never import this from production code.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseBatchInput, parseBatchState, parsePendingRows } from './lib/pipeline-queue.mjs';
import { loadAnswers, loadQueue } from './batch/manual-inputs.mjs';

const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const root = process.env.CAREER_OPS_ROOT;
if (!root || !root.includes('go-queue-test-')) throw new Error('fixture refuses non-test data root');
const config = JSON.parse(readFileSync(join(root, 'fixture.json')));
const phase = basename(process.argv[1], '.mjs');
const pipeline = process.env.CAREER_OPS_PIPELINE || join(root, 'data/pipeline.md');
const read = path => existsSync(path) ? readFileSync(path, 'utf8') : '';
const emit = data => console.log(JSON.stringify(data));
appendFileSync(join(root, 'calls.jsonl'), JSON.stringify({ phase, args }) + '\n');

if (phase === 'doctor') emit({ onboardingNeeded: false });
else if (phase === 'scan') {
  if (config.handoff) writeFileSync(join(root, 'data/scan-handoff.json'), JSON.stringify({ count: 1, items: [{ company: 'Fictional', method: 'websearch', query: 'fictional jobs' }] }));
  emit({ version: 'careerops.scan.receipt@1', added: 0, errors: config.scanError ? [{ company: 'Fictional', error: 'offline provider failure' }] : [] });
  process.exitCode = config.scanError ? 2 : 0;
} else if (phase === 'scan-auth') {
  if (config.login) { console.error('login required: not logged in'); process.exitCode = 1; }
  else emit({ added: 0, errors: [] });
} else if (phase === 'pipeline-liveness') {
  emit({ status: config.livenessFailure ? 'failed' : 'completed', checked: 0, expired: 0 });
  if (config.livenessFailure) process.exitCode = 1;
}
else if (phase === 'verify-runner') {
  if (config.finalBatchOwner) {
    mkdirSync(join(root, 'batch/batch-runner.pid.owner.lock'));
    writeFileSync(join(root, 'batch/batch-runner.pid.owner.lock/owner.json'), JSON.stringify({ pid: config.finalBatchOwner, token: 'final-fixture-owner' }));
    writeFileSync(join(root, 'batch/batch-runner.pid'), '987654\n');
  }
  emit({ status: config.verification || 'completed', needs_human_review: Boolean(config.review), unresolved_findings: config.review ? [{ message: 'fixture review required' }] : [], final_verification: { status: 'completed' }, passes: 0, actions: {} });
}
else if (phase === 'codex-mock') {
  await new Promise(resolve => { process.stdin.resume(); process.stdin.on('end', resolve); });
  emit({ offline: true });
  writeFileSync(value('--output-last-message'), JSON.stringify({ status: config.handoffPartial ? 'partial' : 'completed', processed_items: 1, added: config.malformedHandoff ? 1 : 0, duplicates: config.handoffPartial ? 0 : 1, expired: 0, errors: config.handoffPartial ? [{ item: 'Fictional', message: 'offline source unavailable', recoverable: true }] : [], requires_user_action: false, user_action: null }));
} else if (phase === 'batch-mock') {
  if (!args.includes('--queue-file')) throw new Error('go must provide a queue-file');
  const queue = loadQueue(value('--queue-file'), root);
  const answers = loadAnswers(args.includes('--answers-file') ? value('--answers-file') : null, 'fictional', root);
  const input = parseBatchInput(read(join(root, 'batch/batch-input.tsv')));
  const states = parseBatchState(read(join(root, 'batch/batch-state.tsv')));
  let count = 0;
  for (const row of input) {
    if (!queue.has(row.url)) continue;
    if (args.includes('--limit') && count >= Number(value('--limit'))) break;
    count++;
    appendFileSync(join(root, 'dispatched.jsonl'), JSON.stringify(row) + '\n');
    const reason = config.holds?.[row.url];
    const answered = answers.some(a => a.url === row.url && a.reason === reason);
    let status = config.quota ? 'paused_rate_limit' : reason && !answered ? 'needs_confirmation' : config.retry || config.stall ? 'failed' : 'completed';
    const old = states.find(s => s.url === row.url);
    const state = { ...row, status, retries: String(config.retry ? Number(old?.retries || 0) + 1 : 0) };
    if (old) states.splice(states.indexOf(old), 1, state); else states.push(state);
    if (status === 'needs_confirmation') {
      writeFileSync(join(root, `batch/logs/${row.id}.hold.json`), JSON.stringify({ schema_version: 1, user: 'fictional', id: row.id, url: row.url, status, reason, question: 'Please provide the exact posting answer.', company: '', role: '', score: null, legitimacy: null, via: null, company_confidential: null, pdf: null, report: null, tracker: null, error: null }));
    } else if (status === 'completed') {
      const text = read(pipeline);
      const parsed = parsePendingRows(text);
      const index = parsed.rows.find(r => r.url === row.url)?.lineIndex;
      if (index !== undefined) { parsed.lines.splice(index, 1); writeFileSync(pipeline, parsed.lines.join('\n')); }
      mkdirSync(join(root, 'output'), { recursive: true });
      writeFileSync(join(root, `output/${row.id}.done`), row.url);
    }
    if (config.quota) { writeFileSync(join(root, 'batch/batch-runner.paused'), 'fixture quota'); break; }
  }
  writeFileSync(join(root, 'batch/batch-state.tsv'), 'id\turl\tstatus\tstarted\tcompleted\treport\tscore\terror\tretries\n' + states.map(s => [s.id, s.url, s.status, '', '', '', '', '', s.retries].join('\t')).join('\n') + '\n');
  if (config.concurrent && !existsSync(join(root, 'added-once'))) {
    writeFileSync(join(root, 'added-once'), '1');
    writeFileSync(pipeline, read(pipeline).replace('## Pending', `## Pending\n- [ ] ${config.concurrent}`));
  }
} else if (phase === 'check-liveness') {
  const urls = read(value('--file')).trim().split(/\r?\n/);
  writeFileSync(join(root, 'checked.json'), JSON.stringify(urls));
  writeFileSync(pipeline, read(pipeline).replace('## Pending', '## Pending\n- [ ] https://jobs.example.org/concurrent'));
  emit({ status: 'completed', active: 0, expired: urls.length, uncertain: 0, results: urls.map(url => ({ url, result: 'expired' })) });
}
