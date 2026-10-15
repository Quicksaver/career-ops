import './user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { postingIdentity, validateWorkerArtifacts, parseTrackerAddition } from '../batch/validate-worker-artifacts.mjs';

test('strict worker identity preserves SPA job IDs without broadening other URL components', () => {
  const base='https://careers.example.org/';
  assert.notEqual(postingIdentity(base+'#/jobs/111'),postingIdentity(base+'#/jobs/222'));
  assert.equal(postingIdentity(base+'#/job/111'),postingIdentity(base+'#/jobs/111'));
  assert.equal(postingIdentity(base+'#/jobs/111'),postingIdentity(base+'?_career_ops_fragment_job_id=111'));
  assert.equal(postingIdentity(base+'#overview'),postingIdentity(base));
  assert.notEqual(postingIdentity(base+'?utm_source=a'),postingIdentity(base));
  assert.notEqual(postingIdentity(base+'jobs/111/'),postingIdentity(base+'jobs/111'));
  assert.notEqual(postingIdentity(base+'?req=111'),postingIdentity(base+'?req=222'));
});

test('report-backed Via repair appends a missing optional column and preserves header order and posting authorization', t => {
  const root=mkdtempSync(join(tmpdir(),'batch-via-column-'));
  t.after(()=>rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  mkdirSync(join(root,'reports')); const reportPath=join(root,'reports/001-fixture.md');
  const trackerPath=join(root,'1.tsv');
  writeFileSync(reportPath,'## Job Description (archived verbatim)\n'+'Engineer builds and maintains reliable applications. '.repeat(30)+'\n## Machine Summary\n\n```yaml\ncompany: Acme\nrole: Engineer\nscore: 4\nvia: Hays\ncompany_confidential: false\nfinal_decision: Apply\nhard_stops: []\n```\n');
  const expectedUrl='https://careers.example.org/#/jobs/111';
  const headers=['role','num','company','report','pdf','date','score','status','url'];
  const fields=['Engineer','001','Acme','[001](reports/001-fixture.md)','❌','2026-10-15','4.0/5','Evaluated',expectedUrl];
  const validate=repair=>validateWorkerArtifacts({reportPath,trackerPath,strictWorkflow:true,userRoot:root,reportNum:'001',expectedUrl,repair});
  for(const existingColumn of [false,true]) {
    const header=[...headers,...(existingColumn?['via']:[])];
    const row=[...fields,...(existingColumn?['']:[])];
    writeFileSync(trackerPath,header.join('\t')+'\n'+row.map(value=>value.replace('#/jobs/111','#/jobs/222')).join('\t')+'\n');
    const wrong=readFileSync(trackerPath,'utf8');
    const refused=validate(true);
    assert.equal(refused.valid,false); assert.equal(refused.repaired,false);
    assert.match(refused.errors.join(';'),/posting identity/);
    assert.equal(readFileSync(trackerPath,'utf8'),wrong);
    writeFileSync(trackerPath,header.join('\t')+'\n'+row.join('\t')+'\n');
    const repaired=validate(true);assert.equal(repaired.valid,true,repaired.errors.join(';'));
    assert.equal(repaired.repaired,true);
    const lines=readFileSync(trackerPath,'utf8').trimEnd().split('\n').map(line=>line.split('\t'));
    assert.deepEqual(lines[0],[...headers,'via']);
    assert.deepEqual(lines[1],[...fields,'Hays']);
    assert.equal(parseTrackerAddition(readFileSync(trackerPath,'utf8')).via,'Hays');
    assert.equal(validate(true).repaired,false,'a completed repair is idempotent');
  }
});
