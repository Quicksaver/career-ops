import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, getBash, rmSync, linkNodeModules } from './helpers.mjs';
import { copyBatchOwnership } from './copy-batch-ownership.mjs';
import { inspectOwnership, ownershipPath, releaseOwnership } from '../batch/runner-ownership.mjs';
import { validateWorkerArtifacts, postingIdentity } from '../batch/validate-worker-artifacts.mjs';
import { pathToFileURL } from 'node:url';
import { processAlive } from '../lib/run-artifacts.mjs';
import { terminateProcessTreeSync } from '../lib/runner-command.mjs';
import { copyGraph } from './fixtures/run-workflow.mjs';
import { queueActions, actionableQueue } from '../lib/run-queue.mjs';
import { nextLiveInput } from '../lib/run-live-inputs.mjs';
import { stateHeader, posting, stateRow, delay, fixture } from './fixtures/batch-recovery-ownership.mjs';

test('required sequential preparation and quarantine errors prevent dispatch or merge', () => {
  for(const failure of ['preparation','quarantine']) {
    const f=fixture();
    try {
      writeFileSync(join(f.root,'merge-tracker.mjs'),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(join(f.root,'merged'))},'unexpected');\n`);
      if(failure==='preparation')writeFileSync(join(f.batch,'tmp'),'not a directory');
      else {mkdirSync(join(f.batch,'logs'));writeFileSync(join(f.batch,'logs/quarantine'),'not a directory');}
      const result=f.run(['--limit','2'],'wrong999');
      assert.notEqual(result.status,0,result.stdout+result.stderr);
      assert.equal(existsSync(join(f.root,'merged')),false);
      const calls=existsSync(join(f.root,'calls'))?readFileSync(join(f.root,'calls'),'utf8').trim().split('\n').length:0;
      assert.equal(calls,failure==='preparation'?0:1);
    } finally {rmSync(f.root,{recursive:true,force:true});}
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

test('the real batch defaults to three failed attempts and retains the ceiling across invocations', () => {
  const f = fixture();
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = f.run(['--limit', '1']);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Max retries: 3/);
      const state = readFileSync(f.state, 'utf8').trim().split('\n').find(line => line.startsWith('1\t')).split('\t');
      assert.equal(state[2], 'failed');
      assert.equal(Number(state[8]), attempt);
      assert.equal(readFileSync(join(f.root, 'calls'), 'utf8').trim().split('\n').length, attempt);
    }
    const next = f.run(['--dry-run', '--limit', '1']);
    assert.equal(next.status, 0, next.stdout + next.stderr);
    assert.match(next.stdout, /SKIP #1: failed and max retries reached/);
    assert.equal(readFileSync(join(f.root, 'calls'), 'utf8').trim().split('\n').length, 3);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
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
    for(const status of ['failed','needs_confirmation','paused_rate_limit','rate_limited','processing','pending','closed']) {
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
    const spaced='https://tracking.example/jobs/123?title=Tech Lead, Android Core Product - Bologna, Italy&source=linkedin';
    writeFileSync(join(f.root,'jds/captured.md'),`---\nsource_url: ${posting(1)}\napplication_url: "${spaced}"\n---\nCaptured JD`);
    for(const value of [spaced,spaced.replaceAll(' ','%20'),new URL(spaced).href]) {
      tracker(value);assert.equal(validate({expectedUrl:local}).valid,true,value);
    }
    tracker(spaced.replace('/123?','/999?'));assert.equal(validate({expectedUrl:local}).valid,false);
    tracker(spaced.replace('Tech Lead','Another role'));assert.equal(validate({expectedUrl:local}).valid,false);
    const answersPath=join(f.root,'answers.json'); writeFileSync(answersPath,JSON.stringify({schema_version:1,user:'fixture',answers:[{url:posting(1),reason:'jd_unavailable',answer:'employer alternative',employer_url:posting(3)}]}));
    tracker(posting(3)); assert.equal(validate({answersPath,user:'fixture'}).valid,true);
    const env={...process.env,CAREER_OPS_ROOT:f.root,CAREER_OPS_DATA_DIR:f.root}; delete env.CAREER_OPS_USER;
    const cli=spawnSync(process.execPath,[join(ROOT,'batch/validate-worker-artifacts.mjs'),'--user','fixture','--report',reportPath,'--tracker',trackerPath,'--strict-workflow','--user-root',f.root,'--report-num','001','--expected-url',posting(1),'--answers-file',answersPath],{env,encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);
    tracker(posting(2)); assert.equal(validate({answersPath,user:'fixture'}).valid,false);
  } finally { rmSync(f.root,{recursive:true,force:true}); }
});

test('posting identity encodes literal spaces without loosening public URL or control-byte checks', () => {
  const raw='https://jobs.example.com/Android Core?title=Tech Lead&source=linkedin';
  assert.equal(postingIdentity(raw),postingIdentity(raw.replaceAll(' ','%20')));
  assert.equal(postingIdentity(raw),postingIdentity('https://jobs.example.com/Android%20Core?source=linkedin&title=Tech+Lead'));
  for(const value of ['https://localhost/job title','https://127.0.0.1/job title','https://10.0.0.1/job title',
    'https://user:password@example.com/job title','https://exa mple.com/job','https://example.com/job\ttitle',
    'https://example.com/job\ntitle','https://example.com/job\rtitle','file:///job title',null]) assert.equal(postingIdentity(value),null,String(value));
});
