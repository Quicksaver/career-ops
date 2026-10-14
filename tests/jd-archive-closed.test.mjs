import './user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkJdArchive } from '../check-jd-archive.mjs';

test('closed postings skip historical archive warnings until reopened; active applications stay checked', t => {
  const root=mkdtempSync(join(tmpdir(),'career-ops-closed-archive-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const reports=join(root,'reports'),jds=join(root,'jds'),tracker=join(root,'applications.md');
  mkdirSync(reports);mkdirSync(jds);
  writeFileSync(join(reports,'001-example-2026-01-01.md'),'# Evaluation\n\nNo archived posting.\n');
  for(const status of ['Closed','expired','Evaluated','Applied','Interview','Offer','Rejected','SKIP']) {
    writeFileSync(tracker,`| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-01-01 | Example | Engineer | 4/5 | ${status} | - | [001](reports/001-example-2026-01-01.md) | |\n`);
    const result=checkJdArchive(reports,jds,{trackerPath:tracker});
    const active=['Evaluated','Applied','Interview','Offer'].includes(status);
    assert.equal(result.findings.length,active?1:0,status);
    if(active)assert.equal(result.findings[0].type,'jd-archive-review-due');
  }
  assert.equal(checkJdArchive(reports,jds).findings[0].type,'missing-jd-archive','fresh reports without a tracker still require an archive');
});
