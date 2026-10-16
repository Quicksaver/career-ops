import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, rmSync } from './helpers.mjs';
import { validateClosedResult } from '../batch/manual-inputs.mjs';
import { runLineTone } from '../lib/run-output.mjs';

const closed = { status:'closed', id:'1', report_num:'001', url:'local:jds/posting.md', reason:'posting_closed',
  company:'', role:'', score:null, legitimacy:null, via:null, company_confidential:null, pdf:null, report:null,
  tracker:null, error:null, question:null };
const identity = {id:'1',url:closed.url,reportNum:'001'};

test('closure requires typed terminal result with exact posting/reservation and null artifacts', () => {
  assert.deepEqual(validateClosedResult(closed,identity),[]);
  for (const change of [{status:'failed'},{status:'skipped'},{reason:'jd_unavailable'}, {id:'2'},
    {url:'https://example.com/jobs/1'},{report_num:'002'},{company:'invented'}, {role:'Engineer'},
    ...['score','legitimacy','via','company_confidential','pdf','report','tracker','error','question'].map(key=>({[key]:'not-null'}))]) {
    assert.ok(validateClosedResult({...closed,...change},identity).length,JSON.stringify(change));
  }
  assert.equal(runLineTone('Closed: https://example.com/jobs/1'), 'muted');
});

test('reconciliation closes only uniquely identified Evaluated rows, preserves lifecycle and logs transitions', () => {
  const root=mkdtempSync(join(tmpdir(),'closed-posting-tracker-'));
  try {
    for(const dir of ['data','batch','reports','jds']) mkdirSync(join(root,dir));
    const statuses=['Evaluated','Applied','Interview','Responded','Rejected','Contact','SKIP','Closed'];
    const urls=statuses.map((_,i)=>`https://example.com/jobs/${i+1}`);
    const local='local:jds/captured.md';
    const duplicate='https://example.com/jobs/duplicate';
    const header='| # | Date | Company | Role | Status | Score | PDF | Report | Notes | URL | Via |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
    const tracker=header+statuses.map((status,i)=>`| ${i+1} | 2026-10-16 | Company ${i+1} | Engineer | ${status} | 4/5 | ❌ | — | original | ${urls[i]} | |`).join('\n')+
      `\n| 9 | 2026-10-16 | Local | Engineer | Evaluated | 4/5 | ❌ | — | original | https://example.com/jobs/captured | |`+
      `\n| 10 | 2026-10-16 | Duplicate A | Engineer | Evaluated | 4/5 | ❌ | — | original | ${duplicate} | |`+
      `\n| 11 | 2026-10-16 | Duplicate B | Engineer | Interview | 4/5 | ❌ | — | original | ${duplicate} | |\n`;
    const trackerPath=join(root,'data/applications.md'); writeFileSync(trackerPath,tracker);
    writeFileSync(join(root,'jds/captured.md'),'---\nsource_url: https://example.com/jobs/captured\n---\nSaved original job description');
    const queue=[...urls,local,duplicate,'https://example.com/jobs/never-evaluated'];
    const pipeline='## Pending\n'+queue.map((url,i)=>`- [${i%2?'!':' '}] ${url} | Company | Engineer`).join('\n')+'\n\n## Processed\n';
    const pipelinePath=join(root,'data/pipeline.md');writeFileSync(pipelinePath,pipeline);
    writeFileSync(join(root,'batch/batch-state.tsv'),'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'+queue.map((url,i)=>`${i+1}\t${url}\tclosed\tstart\tend\t-\t-\tposting-closed\t0`).join('\n')+'\n');
    const run=(...args)=>spawnSync(process.execPath,[join(ROOT,'reconcile-pipeline.mjs'),'--user','fixture',...args],{
      encoding:'utf8',timeout:30000,env:{...process.env,CAREER_OPS_ROOT:root,CAREER_OPS_DATA_DIR:root,CAREER_OPS_TRACKER:'',CAREER_OPS_PIPELINE:''}});
    const dry=run('--dry-run'); assert.equal(dry.status,0,dry.stdout+dry.stderr);
    assert.equal(readFileSync(trackerPath,'utf8'),tracker);assert.equal(readFileSync(pipelinePath,'utf8'),pipeline);
    assert.equal(existsSync(join(root,'data/status-log.tsv')),false);
    // Standalone batch can close an existing tracker row without a pipeline.
    unlinkSync(pipelinePath);
    const noPipeline=run();assert.equal(noPipeline.status,0,noPipeline.stdout+noPipeline.stderr);
    assert.match(readFileSync(trackerPath,'utf8'),/Company 1 \| Engineer \| Closed/);
    writeFileSync(pipelinePath,pipeline);
    const live=run();assert.equal(live.status,0,live.stdout+live.stderr);
    const updated=readFileSync(trackerPath,'utf8');
    assert.match(updated,/Company 1 \| Engineer \| Closed/); assert.match(updated,/Local \| Engineer \| Closed/);
    for(let i=1;i<statuses.length;i++) assert.ok(updated.includes(`Company ${i+1} | Engineer | ${statuses[i]} |`));
    assert.match(updated,/Duplicate A \| Engineer \| Evaluated/);assert.match(updated,/Duplicate B \| Engineer \| Interview/);
    assert.match(live.stderr,/multiple tracker rows/);
    const processed=readFileSync(pipelinePath,'utf8');
    assert.doesNotMatch(processed,/- \[(?: |!)\]/);assert.equal((processed.match(/Closed: posting confirmed closed/g)||[]).length,queue.length);
    const ledger=readFileSync(join(root,'data/status-log.tsv'),'utf8');
    assert.match(ledger,/Evaluated\tClosed/);assert.equal(ledger.trim().split('\n').filter(row=>!row.startsWith('#')).length,2);
    const again=run();assert.equal(again.status,0,again.stdout+again.stderr);
    assert.equal(readFileSync(trackerPath,'utf8'),updated);assert.equal(readFileSync(join(root,'data/status-log.tsv'),'utf8'),ledger);
    assert.equal(readFileSync(pipelinePath,'utf8'),processed);
  } finally {rmSync(root,{recursive:true,force:true});}
});
