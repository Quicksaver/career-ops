// Shared fixture for tests/batch-recovery-ownership*.test.mjs. The suite is split
// across files so each stays inside test-all's per-file node:test budget.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, getBash } from '../helpers.mjs';
import { copyBatchOwnership } from '../copy-batch-ownership.mjs';
export const stateHeader = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n';
export const posting = id => `https://example.com/jobs/${id}`;
export const stateRow = (id, status, retries = 0) => `${id}\t${posting(id)}\t${status}\tstart\tend\t001\t-\t-\t${retries}\n`;
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'batch-owner-recovery-'));
  const batch = join(root, 'batch');
  mkdirSync(batch); mkdirSync(join(root, 'bin')); mkdirSync(join(root, 'reports')); mkdirSync(join(root, 'config')); mkdirSync(join(root, 'jds'));
  copyBatchOwnership(root);
  for (const file of ['batch-runner.sh', 'manual-inputs.mjs', 'batch-output-schema.json']) copyFileSync(join(ROOT, 'batch', file), join(batch, file));
  // Use the production validator against fixture artifacts, including its CLI.
  writeFileSync(join(batch,'validate-worker-artifacts.mjs'), `import {spawnSync} from 'node:child_process'; const result=spawnSync(process.execPath,[${JSON.stringify(join(ROOT,'batch/validate-worker-artifacts.mjs'))},...process.argv.slice(2)],{stdio:'inherit'}); process.exitCode=result.status ?? 1;\n`);
  writeFileSync(join(batch, 'batch-prompt.md'), 'Offline fixture prompt');
  writeFileSync(join(batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n${[1,2,3].map(id => `${id}\t${posting(id)}\tfixture\t\n`).join('')}`);
  writeFileSync(join(root, 'reserve-report-num.mjs'), 'if (!process.argv.includes("--release")) console.log("001");\n');
  for (const file of ['merge-tracker', 'reconcile-pipeline']) writeFileSync(join(root, `${file}.mjs`), '// offline fixture\n');
  writeFileSync(join(root, 'worker.mjs'), `import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2), root=process.env.CAREER_OPS_ROOT;
appendFileSync(root+'/calls','called\\n');
if(process.env.FIXTURE_MODE.startsWith('closed')) {
  const final=args[args.indexOf('--output-last-message')+1];
  const result={status:'closed',id:'1',report_num:'001',url:'https://example.com/jobs/1',reason:'posting_closed',company:'',role:'',score:null,legitimacy:null,via:null,company_confidential:null,pdf:null,report:null,tracker:null,error:null,question:null};
  if(process.env.FIXTURE_MODE==='closed-wrong-url') result.url='https://example.com/jobs/another';
  if(process.env.FIXTURE_MODE==='closed-failed-exit') process.exitCode=1;
  if(process.env.FIXTURE_MODE==='closed-artifacts') {
    writeFileSync(root+'/reports/001-partial.md','unaccepted partial report');
    writeFileSync(root+'/batch/tracker-additions/1.tsv','unaccepted partial tracker');
  }
  console.log('Current employer application form explicitly states the position is filled.');
  writeFileSync(final,JSON.stringify(result)); console.log(JSON.stringify(result));
} else {
if(process.env.FIXTURE_MODE==='wait') {
  writeFileSync(root+'/ready','ready');
  const deadline=Date.now()+15000;
  while(!existsSync(root+'/release') && Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
}

if(['success429','failed429','wrong999','success001'].includes(process.env.FIXTURE_MODE)) {
  const final=args[args.indexOf('--output-last-message')+1];
  const num=['success429','failed429'].includes(process.env.FIXTURE_MODE)?'429':'001';
  const claimed=process.env.FIXTURE_MODE==='wrong999'?'999':num;
  const result={status:'completed',id:'1',report_num:num,company:'Acme',role:'Engineer',score:4,legitimacy:'Verified',via:null,company_confidential:false,pdf:null,report:root+'/reports/'+num+'-acme.md',tracker:root+'/batch/tracker-additions/1.tsv',error:null,question:null,reason:null,url:null};
  if(process.env.FIXTURE_MODE!=='failed429') {
    const fence=String.fromCharCode(96).repeat(3);
    writeFileSync(result.report,'## Job Description (archived verbatim)\\n'+'Job data discussing HTTP 429 and rate limit reached in a client API. '.repeat(20)+'\\n## Machine Summary\\n\\n'+fence+'yaml\\ncompany: Acme\\nrole: Engineer\\nscore: 4\\ncompany_confidential: false\\nvia: null\\nfinal_decision: Apply\\nhard_stops: []\\n'+fence+'\\n');
    writeFileSync(result.tracker,'num\\tdate\\tcompany\\trole\\tstatus\\tscore\\tpdf\\treport\\tnotes\\turl\\tvia\\n'+claimed+'\\t2026-10-14\\tAcme\\tEngineer\\tEvaluated\\t4.0/5\\t❌\\t['+claimed+'](reports/'+claimed+'-acme.md)\\tHTTP 429 experience\\thttps://example.com/jobs/1\\t\\n');
  } else {
    result.status='failed'; result.error='missing artifact reports/429-acme.md'; process.exitCode=1;
  }
  writeFileSync(final,JSON.stringify(result)); console.log(JSON.stringify(result));
} else if(process.env.FIXTURE_MODE==='quota') {
  // Even completed-looking artifacts cannot reach the tracker merge on quota.
  const final=args[args.indexOf('--output-last-message')+1];
  writeFileSync(root+'/reports/001-acme.md','## Machine Summary\\n'+String.fromCharCode(96).repeat(3)+'yaml\\ncompany: Acme\\nrole: Engineer\\nscore: 4\\ncompany_confidential: false\\nvia: null\\n'+String.fromCharCode(96).repeat(3)+'\\n');
  writeFileSync(root+'/batch/tracker-additions/1.tsv','001\\t2026-10-14\\tAcme\\tEngineer\\tEvaluated\\t4.0/5\\t❌\\t[001](reports/001-acme.md)\\tpartial artifact\\n');
  writeFileSync(final,JSON.stringify({status:'completed',id:'1',report_num:'001',company:'Acme',role:'Engineer',score:4,via:null,company_confidential:false,pdf:null,report:root+'/reports/001-acme.md',tracker:root+'/batch/tracker-additions/1.tsv'}));
  console.error('You have hit your usage limit. usage_limit_reached');
  process.exitCode=1;
} else { console.error('fixture ordinary failure'); process.exitCode=1; }
}
`);
  const runner = join(root, 'run.sh');
  writeFileSync(join(root, 'bin/codex'), '#!/usr/bin/env bash\nnode "$CAREER_OPS_ROOT/worker.mjs" "$@"\n', { mode: 0o755 });
  writeFileSync(runner, '#!/usr/bin/env bash\nset -euo pipefail\ncurl() { return 1; }\nexport -f curl\nexec bash "$CAREER_OPS_ROOT/batch/batch-runner.sh" --user fixture --cli codex --model fixture --defer-verification "$@"\n');
  const env = mode => ({ ...process.env, PATH: join(root, 'bin') + delimiter + process.env.PATH, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_USER: 'fixture', FIXTURE_MODE: mode });
  const run = (args = [], mode = 'fail') => spawnSync(getBash(), [runner, ...args], { encoding: 'utf8', timeout: 30000, env: env(mode) });
  const start = (args = [], mode = 'wait', extraEnv = {}) => {
    const child = spawn(getBash(), [runner, ...args], { env: {...env(mode),...extraEnv} });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const completion = new Promise(resolve => child.on('close', code => resolve({ code, output })));
    return { child, completion };
  };
  return { root, batch, run, start, state: join(batch, 'batch-state.tsv'), pid: join(batch, 'batch-runner.pid') };
}
