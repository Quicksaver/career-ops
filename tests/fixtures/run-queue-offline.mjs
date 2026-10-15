// Offline subprocess fixture. Never import this from production code.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseBatchInput, parseBatchState, parsePendingRows } from './lib/pipeline-queue.mjs';
import { loadAnswers, loadQueue } from './batch/manual-inputs.mjs';
import { nextLiveInput } from './lib/run-live-inputs.mjs';

const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const root = process.env.CAREER_OPS_ROOT;
if (!root || !root.includes('run-queue-test-')) throw new Error('fixture refuses non-test data root');
const config = JSON.parse(readFileSync(join(root, 'fixture.json')));
const phase = basename(process.argv[1], '.mjs');
const pipeline = process.env.CAREER_OPS_PIPELINE || join(root, 'data/pipeline.md');
const read = path => existsSync(path) ? readFileSync(path, 'utf8') : '';
const emit = data => console.log(JSON.stringify(data));
appendFileSync(join(root, 'calls.jsonl'), JSON.stringify({ phase, args }) + '\n');

if (phase === 'doctor') emit({ onboardingNeeded: false });
else if (phase === 'scan') {
  if(config.diagnosticBurst) {
    console.error('offline provider diagnostic retained');
    await new Promise(r=>setTimeout(r,20));
    process.stdout.write('x'.repeat(100000)); process.exit(1);
  }
  if (config.handoff) writeFileSync(join(root, 'data/scan-handoff.json'), JSON.stringify({ count: 1, items: [{ company: 'Fictional', method: 'websearch', query: 'fictional jobs' }] }));
  emit({ version: 'careerops.scan.receipt@1', added: 0, errors: config.scanError ? [{ company: 'Fictional', error: 'offline provider failure' }] : [] });
  process.exitCode = config.scanError ? 2 : 0;
} else if (phase === 'scan-auth') {
  if (config.login) { console.error('login required: not logged in'); process.exitCode = 1; }
  else emit({ added: 0, errors: [] });
} else if (phase === 'pipeline-liveness') {
  if (config.waitForLiveness) {
    writeFileSync(join(root, 'liveness-waiting'), 'waiting');
    while (!existsSync(join(root, 'release-liveness'))) await new Promise(resolve => setTimeout(resolve, 25));
  }
  emit({ status: config.livenessFailure ? 'failed' : 'completed', checked: 0, expired: 0 });
  if (config.livenessFailure) process.exitCode = 1;
}
else if (phase === 'verify-runner') {
  if (config.finalBatchOwner) {
    mkdirSync(join(root, 'batch/batch-runner.pid.owner.lock'));
    writeFileSync(join(root, 'batch/batch-runner.pid.owner.lock/owner.json'), JSON.stringify({ pid: config.finalBatchOwner, token: 'final-fixture-owner' }));
    writeFileSync(join(root, 'batch/batch-runner.pid'), '987654\n');
  }
  emit({ status: config.verification || 'completed', error: config.verificationError || null, needs_human_review: Boolean(config.review), unresolved_findings: config.review ? [{ message: 'fixture review required' }] : [], final_verification: { status: 'completed' }, passes: 0, actions: {} });
  if (config.verification === 'failed') process.exitCode = 1;
}
else if (phase === 'merge-tracker' && config.blockedAddition) {
  if(config.diagnosticBurst) {console.error('merge diagnostic retained');await new Promise(r=>setTimeout(r,20));process.stdout.write('x'.repeat(100000));}
  console.log('Summary: 1 addition NOT merged; retained for correction');
  process.exitCode = 1;
}
else if (phase === 'codex-mock') {
  await new Promise(resolve => { process.stdin.resume(); process.stdin.on('end', resolve); });
  if (config.progressDiagnostics) console.error('[handoff-progress] 1/1: Fictional (websearch) — fictional jobs');
  emit({ offline: true });
  writeFileSync(value('--output-last-message'), JSON.stringify({ status: config.handoffPartial ? 'partial' : 'completed', processed_items: 1, added: config.malformedHandoff ? 1 : 0, duplicates: config.handoffPartial ? 0 : 1, expired: 0, errors: config.handoffPartial ? [{ item: 'Fictional', message: 'offline source unavailable', recoverable: true }] : [], requires_user_action: false, user_action: null }));
} else if (phase === 'batch-mock' && args.includes('--live-inputs')) {
  if (config.progressDiagnostics) console.log('WARN: fixture progress warning');
  const controlPath = value('--live-inputs'), active = new Map();
  const pausePath = join(root, 'batch/batch-runner.paused'); rmSync(pausePath, { force: true });
  const statePath = join(root, 'batch/batch-state.tsv');
  const setState = (row, status) => {
    const states = parseBatchState(read(statePath)).filter(item => item.id !== row.id);
    states.push({ ...row, status });
    writeFileSync(statePath, 'id\turl\tstatus\tstarted\tcompleted\treport\tscore\terror\tretries\n' + states.map(item => [item.id, item.url, item.status, '', '', '', '', '', 0].join('\t')).join('\n') + '\n');
  };
  while (true) {
    if (existsSync(pausePath)) break;
    if (active.size < Number(value('--parallel'))) {
      const next = nextLiveInput({ controlPath, userRoot: root, user: 'fictional', answersPath: value('--answers-file'), queuePath: value('--queue-file'), running: active.size, activeUrls: [...active.values()], resumePaused: args.includes('--resume-paused'), limit: args.includes('--limit') ? Number(value('--limit')) : 0 });
      if (next.selected) {
        const row = next.selected; setState(row, 'processing');
        const task = (async () => {
          appendFileSync(join(root, 'dispatched.jsonl'), JSON.stringify({ ...row, at: Date.now() }) + '\n');
          if (config.waitFor?.includes(row.url)) {
            const deadline = Date.now() + 15000;
            while (!existsSync(join(root, 'release-live-workers')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
          }
          await new Promise(resolve => setTimeout(resolve, config.delays?.[row.url] || 30));
          const reason = config.holds?.[row.url];
          const answers = loadAnswers(value('--answers-file'), 'fictional', root);
          const held = reason && (config.stickyHolds || !answers.some(answer => answer.url === row.url && answer.reason === reason));
          if (config.quota && !existsSync(join(root, 'quota-resolved'))) {
            writeFileSync(pausePath, 'fixture quota'); setState(row, 'paused_rate_limit');
          } else if (held) {
            writeFileSync(join(root, `batch/logs/${row.id}.hold.json`), JSON.stringify({ schema_version: 1, user: 'fictional', id: row.id, url: row.url, status: 'needs_confirmation', reason, question: 'Please provide the exact posting answer.', company: '', role: '', score: null, legitimacy: null, via: null, company_confidential: null, pdf: null, report: null, tracker: null, error: null }));
            setState(row, 'needs_confirmation');
          } else {
            setState(row, 'completed');
            const parsed = parsePendingRows(read(pipeline));
            const index = parsed.rows.find(item => item.url === row.url)?.lineIndex;
            if (index !== undefined) { parsed.lines.splice(index, 1); writeFileSync(pipeline, parsed.lines.join('\n')); }
            appendFileSync(join(root, 'completed.jsonl'), JSON.stringify({ url: row.url, at: Date.now() }) + '\n');
          }
        })();
        active.set(task, row.url); task.finally(() => active.delete(task));
        continue;
      }
      if (next.status === 'done') break;
    }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  await Promise.all(active.keys());
} else if (phase === 'batch-mock') {
  if (!args.includes('--queue-file')) throw new Error('run must provide a queue-file');
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
