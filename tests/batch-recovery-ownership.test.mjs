import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, getBash, rmSync } from './helpers.mjs';
import { copyBatchOwnership } from './copy-batch-ownership.mjs';
import { inspectOwnership, ownershipPath, releaseOwnership } from '../batch/runner-ownership.mjs';
import { validateWorkerArtifacts } from '../batch/validate-worker-artifacts.mjs';

const stateHeader = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n';
const posting = id => `https://example.com/jobs/${id}`;
const stateRow = (id, status, retries = 0) => `${id}\t${posting(id)}\t${status}\tstart\tend\t001\t-\t-\t${retries}\n`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture() {
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
`);
  const runner = join(root, 'run.sh');
  writeFileSync(join(root, 'bin/codex'), '#!/usr/bin/env bash\nnode "$CAREER_OPS_ROOT/worker.mjs" "$@"\n', { mode: 0o755 });
  writeFileSync(runner, '#!/usr/bin/env bash\nset -euo pipefail\ncurl() { return 1; }\nexport -f curl\nexec bash "$CAREER_OPS_ROOT/batch/batch-runner.sh" --user fixture --cli codex --model fixture --defer-verification "$@"\n');
  const env = mode => ({ ...process.env, PATH: join(root, 'bin') + delimiter + process.env.PATH, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_USER: 'fixture', FIXTURE_MODE: mode });
  const run = (args = [], mode = 'fail') => spawnSync(getBash(), [runner, ...args], { encoding: 'utf8', timeout: 30000, env: env(mode) });
  const start = (args = [], mode = 'wait') => {
    const child = spawn(getBash(), [runner, ...args], { env: env(mode) });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const completion = new Promise(resolve => child.on('close', code => resolve({ code, output })));
    return { child, completion };
  };
  return { root, batch, run, start, state: join(batch, 'batch-state.tsv'), pid: join(batch, 'batch-runner.pid') };
}

test('native Git Bash ownership survives rejected concurrent runner and token mismatch; dead owner recovers', async () => {
  const f = fixture(); let running;
  try {
    running = f.start(['--limit', '1']);
    for (let i=0; i<200 && !existsSync(join(f.root, 'ready')); i++) await delay(25);
    assert.ok(existsSync(join(f.root, 'ready')), 'first runner launched its fixture worker');
    const owner = inspectOwnership(f.pid);
    assert.equal(owner.status, 'alive'); process.kill(owner.pid, 0);
    const compat = readFileSync(f.pid, 'utf8');
    if (process.platform === 'win32') {
      assert.notEqual(owner.pid, Number(compat));
      const mapped = spawnSync(getBash(), ['-c', 'cat "/proc/$1/winpid"', 'native-owner', compat.trim()], {encoding:'utf8'});
      assert.equal(Number(mapped.stdout), owner.pid);
    }
    const rejected = f.run(['--limit', '1']); assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.equal(inspectOwnership(f.pid).token, owner.token);
    assert.equal(readFileSync(f.pid, 'utf8'), compat);
    assert.equal(releaseOwnership(f.pid, 'wrong-token'), false);
    writeFileSync(join(f.root, 'release'), 'release');
    assert.equal((await running.completion).code, 0);
    assert.equal(inspectOwnership(f.pid).status, 'absent'); assert.equal(existsSync(f.pid), false);
    mkdirSync(ownershipPath(f.pid));
    writeFileSync(join(ownershipPath(f.pid), 'owner.json'), JSON.stringify({pid:2147483000,token:'dead-owner',started_at:'2020-01-01'}));
    writeFileSync(f.pid, '99999999\n');
    writeFileSync(f.state, stateHeader + stateRow(1, 'pending'));
    const recovered = f.run(['--limit', '1']); assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.equal(inspectOwnership(f.pid).status, 'absent');
  } finally {
    if (running && !existsSync(join(f.root, 'release'))) { writeFileSync(join(f.root, 'release'), 'release'); await running.completion; }
    rmSync(f.root, {recursive:true,force:true});
  }
});

test('recovery flags union pending, failed and paused while direct selectors retain narrow behavior', () => {
  const f = fixture();
  try {
    writeFileSync(f.state, stateHeader + stateRow(1,'pending') + stateRow(2,'failed',3) + stateRow(3,'paused_rate_limit',2));
    const run = args => { const result=f.run(['--dry-run',...args]); assert.equal(result.status,0,result.stderr); return result.stdout; };
    assert.match(run(['--include-pending','--retry-failed','--resume-paused']), /Would process 3 offers/);
    assert.match(run(['--retry-failed','--resume-paused']), /Would process 2 offers/);
    assert.match(run(['--retry-failed']), /Would process 1 offers/);
    assert.match(run(['--resume-paused']), /Would process 1 offers/);
    assert.match(run([]), /Would process 1 offers/);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('explicit failed retry grants one dispatch beyond historical cap and ordinary pass cannot renew it', () => {
  const f = fixture();
  try {
    writeFileSync(f.state, stateHeader + stateRow(1,'failed',3));
    const result=f.run(['--retry-failed','--limit','1']); assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(readFileSync(join(f.root,'calls'),'utf8').trim().split('\n').length,1);
    assert.equal(readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t')[8],'4');
    const next=f.run(['--include-pending','--limit','1']); assert.equal(next.status,0,next.stderr);
    // Job 2 is ordinary pending work; failed job 1 receives no renewed credit.
    assert.equal(readFileSync(f.state,'utf8').trim().split('\n').find(line=>line.startsWith('1\t')).split('\t')[8],'4');
    assert.match(next.stdout,/SKIP #1: failed and max retries reached/);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('Codex quota pauses without consuming retry or accepting completed final; stops following dispatch', () => {
  const f = fixture();
  try {
    writeFileSync(f.state,stateHeader+stateRow(1,'pending',2));
    const result=f.run([], 'quota'); assert.equal(result.status,0,result.stdout+result.stderr);
    const row=readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t');
    assert.equal(row[2],'paused_rate_limit'); assert.equal(row[8],'2');
    assert.equal(readFileSync(join(f.root,'calls'),'utf8').trim().split('\n').length,1);
    assert.doesNotMatch(readFileSync(f.state,'utf8'),/\tcompleted\t/);
    assert.equal(existsSync(join(f.batch,'tracker-additions/1.tsv')),false,'paused worker addition cannot reach merge');
    assert.equal(existsSync(join(f.root,'reports/001-acme.md')),false,'partial report is quarantined');
    const next=f.run(['--dry-run']); assert.match(next.stdout,/Would process 2 offers/);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('report 429 completes normally; ordinary report 429 artifact failure consumes a retry without pausing', () => {
  const f=fixture();
  try {
    writeFileSync(join(f.root,'reserve-report-num.mjs'),'if (!process.argv.includes("--release")) console.log("429");\n');
    const completed=f.run(['--limit','1'],'success429'); assert.equal(completed.status,0,completed.stdout+completed.stderr);
    let row=readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t');
    assert.equal(row[2],'completed',completed.stdout); assert.equal(row[5],'429');
    assert.equal(existsSync(join(f.batch,'batch-runner.paused')),false);
    assert.equal(existsSync(join(f.root,'reports/429-acme.md')),true);
    assert.equal(existsSync(join(f.batch,'tracker-additions/1.tsv')),true);
    rmSync(join(f.root,'reports/429-acme.md')); rmSync(join(f.batch,'tracker-additions/1.tsv'));
    writeFileSync(f.state,stateHeader+stateRow(1,'pending'));
    const failed=f.run(['--limit','1'],'failed429'); assert.equal(failed.status,0,failed.stdout+failed.stderr);
    row=readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t');
    assert.equal(row[2],'failed',failed.stdout); assert.equal(row[8],'1');
    assert.doesNotMatch(failed.stdout,/pausing|Batch paused/);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('production batch quarantines reserved 001 / claimed 999 failure; production merger gates persisted additions by job identity', () => {
  const f=fixture();
  try {
    const tracker=join(f.root,'data/applications.md'); mkdirSync(join(f.root,'data'));
    const header='# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n';
    writeFileSync(tracker,header);
    writeFileSync(join(f.root,'merge-tracker.mjs'),`import {spawnSync} from 'node:child_process'; const result=spawnSync(process.execPath,[${JSON.stringify(join(ROOT,'merge-tracker.mjs'))},...process.argv.slice(2)],{stdio:'inherit'}); process.exitCode=result.status ?? 1;\n`);
    const rejected=f.run(['--limit','1'],'wrong999'); assert.equal(rejected.status,0,rejected.stdout+rejected.stderr);
    const row=readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t');
    assert.equal(row[2],'failed'); assert.equal(row[5],'001'); assert.equal(row[8],'1');
    assert.equal(existsSync(join(f.batch,'tracker-additions/1.tsv')),false);
    const quarantines=readdirSync(join(f.batch,'logs/quarantine')).filter(name=>name.startsWith('rejected-001-1.'));
    assert.equal(quarantines.length,1);
    const rejectedAddition=readFileSync(join(f.batch,'logs/quarantine',quarantines[0],'1.tsv'),'utf8');
    assert.match(rejectedAddition,/\n999\t/); assert.doesNotMatch(readFileSync(tracker,'utf8'),/\|\s*999\s*\|/);
    const addition=join(f.batch,'tracker-additions/1.tsv');
    const merge=()=>spawnSync(process.execPath,[join(ROOT,'merge-tracker.mjs'),'--user','fixture'],{encoding:'utf8',timeout:30000,env:{...process.env,CAREER_OPS_ROOT:f.root,CAREER_OPS_DATA_DIR:f.root,CAREER_OPS_USER:'fixture',CAREER_OPS_TRACKER:tracker,CAREER_OPS_ADDITIONS:join(f.batch,'tracker-additions'),CAREER_OPS_BATCH_STATE:f.state}});
    // Existing rejected additions must also be safe during Go's initial merge.
    for(const status of ['failed','needs_confirmation','paused_rate_limit','rate_limited','processing','pending']) {
      writeFileSync(f.state,stateHeader+stateRow(1,status)); writeFileSync(addition,rejectedAddition);
      const result=merge(); assert.equal(result.status,0,result.stdout+result.stderr);
      assert.doesNotMatch(readFileSync(tracker,'utf8'),/\|\s*999\s*\|/);
      assert.equal(existsSync(addition),true,'unaccepted addition stays available for later valid completion');
      assert.match(result.stderr,/batch job #1/);
    }
    writeFileSync(f.state,stateHeader+stateRow(1,'completed')); const mismatched=merge();
    assert.equal(mismatched.status,0,mismatched.stderr); assert.match(mismatched.stderr,/reserved report number/);
    assert.doesNotMatch(readFileSync(tracker,'utf8'),/\|\s*999\s*\|/);
    // A fresh valid completion uses the same job and reserved number and merges.
    writeFileSync(f.state,stateHeader+stateRow(1,'pending'));
    const completed=f.run(['--limit','1'],'success001'); assert.equal(completed.status,0,completed.stdout+completed.stderr);
    assert.equal(readFileSync(f.state,'utf8').trim().split('\n')[1].split('\t')[2],'completed');
    assert.match(readFileSync(tracker,'utf8'),/^\|\s*1\s*\|.*Acme/m);
    assert.equal(existsSync(join(f.batch,'tracker-additions/merged/1.tsv')),true);
    // The same report guard does not invent batch ownership for standalone TSVs.
    writeFileSync(join(f.batch,'tracker-additions/standalone.tsv'),rejectedAddition.replaceAll('Acme','Other').replaceAll('https://example.com/jobs/1','https://example.com/jobs/standalone'));
    const standalone=merge(); assert.equal(standalone.status,0,standalone.stdout+standalone.stderr);
    assert.match(readFileSync(tracker,'utf8'),/^\|\s*999\s*\|.*Other/m);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('strict validator rejects wrong report target and unrelated posting URL; source and explicit alternatives work', () => {
  const f=fixture();
  try {
    const reportPath=join(f.root,'reports/001-acme.md'), trackerPath=join(f.batch,'1.tsv');
    writeFileSync(reportPath,`## Job Description (archived verbatim)\n${'Real substantive JD requirement '.repeat(35)}\n## Machine Summary\n\n\`\`\`yaml\ncompany: Acme\nrole: Engineer\nscore: 4\ncompany_confidential: false\nvia: null\nfinal_decision: Apply\nhard_stops: []\n\`\`\`\n`);
    const tracker = (url=posting(1), link='[001](reports/001-acme.md)') => writeFileSync(trackerPath,`num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\tvia\n001\t2026-10-14\tAcme\tEngineer\tEvaluated\t4.0/5\t❌\t${link}\tnote\t${url}\t\n`);
    const validate=(extra={})=>validateWorkerArtifacts({reportPath,trackerPath,strictWorkflow:true,userRoot:f.root,reportNum:'001',expectedUrl:posting(1),...extra});
    tracker(); assert.equal(validate().valid,true);
    tracker(posting(1),'[999](reports/999-other.md)'); assert.match(validate().errors.join(';'),/report link/);
    tracker(posting(2)); assert.match(validate().errors.join(';'),/posting identity/);
    const local='local:jds/captured.md'; writeFileSync(join(f.root,'jds/captured.md'),`---\nsource_url: ${posting(1)}\napplication_url: ${posting(3)}\n---\nCaptured JD`);
    tracker(posting(1)); assert.equal(validate({expectedUrl:local}).valid,true);
    tracker(posting(3)); assert.equal(validate({expectedUrl:local}).valid,true);
    tracker(posting(2)); assert.equal(validate({expectedUrl:local}).valid,false);
    const answersPath=join(f.root,'answers.json'); writeFileSync(answersPath,JSON.stringify({schema_version:1,user:'fixture',answers:[{url:posting(1),reason:'jd_unavailable',answer:'employer alternative',employer_url:posting(3)}]}));
    tracker(posting(3)); assert.equal(validate({answersPath,user:'fixture'}).valid,true);
    tracker(posting(2)); assert.equal(validate({answersPath,user:'fixture'}).valid,false);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});
