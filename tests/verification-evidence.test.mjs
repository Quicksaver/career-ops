import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { reconcileDuplicateConsistency, verificationFindings } from '../lib/verification-review.mjs';

const code = resolve(import.meta.dirname, '..');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'verification-evidence-'));
  for (const dir of ['data', 'reports', 'output']) mkdirSync(join(root, dir));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_')));
  Object.assign(env, { CAREER_OPS_USER: 'fixture', CAREER_OPS_ROOT: root });
  const cli = (script, args = []) => spawnSync(process.execPath, [join(code, script), '--user', 'fixture', ...args], {env,cwd:code,encoding:'utf8',timeout:30000});
  const tracker = join(root, 'data/applications.md');
  const initial = '# Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|\n' + [1,2,3].map(n=>`| ${n} | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [${n}](../reports/00${n}.md) | fixture | https://example.org/jobs/shared |`).join('\n')+'\n';
  writeFileSync(tracker, initial);
  for (let n=1;n<=3;n++) writeFileSync(join(root, `reports/00${n}.md`), '# Evaluation: Acme — Engineer\n\n**URL:** https://example.org/jobs/shared\n\n## Job Description (archived verbatim)\n'+ 'Build and maintain reliable systems. '.repeat(20)+'\n\n## Machine Summary\n```yaml\ncompany: Acme\nrole: Engineer\nscore: 4\n```\n');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return {root,tracker,initial,cli};
}

test('duplicate apply rejects changed posting evidence with unchanged candidate membership', t => {
  const f=fixture(t); const checked=f.cli('verify-pipeline.mjs',['--json']);
  assert.ok([0,1].includes(checked.status),checked.stderr);
  const snapshot=JSON.parse(checked.stdout);
  const warning=snapshot.warnings.find(w=>w.code==='possible_duplicate_tracker' && w.details.tracker_nums.length===3);
  assert.ok(warning,'production verifier must emit the reviewed group');
  const verification=join(f.root,'verification.json'), triage=join(f.root,'triage.json');
  writeFileSync(verification,JSON.stringify({...snapshot,warnings:[warning]}));
  writeFileSync(triage,JSON.stringify({warnings:[{warning_id:warning.id,warning_code:warning.code,classification:'confirmed_duplicate',duplicate_resolution:{keeper_tracker_num:1,duplicate_tracker_nums:[2,3],keeper_report_file:null,duplicate_report_files:[]}}]}));
  const changed=f.initial.replace(/(\| 3 \|[^\n]+)https:\/\/example.org\/jobs\/shared/, '$1https://example.org/jobs/different');
  assert.notEqual(changed,f.initial); writeFileSync(f.tracker,changed);
  const result=f.cli('resolve-verify-warnings.mjs',['--verification',verification,'--triage',triage,'--json']);
  assert.equal(result.status,1,result.stdout); assert.match(result.stderr,/identity changed/);
  assert.equal(readFileSync(f.tracker,'utf8'),changed);
  assert.ok(existsSync(join(f.root,'reports/003.md')));
});

function decision(finding, disposition, classification) {
  return {finding_id:finding.id,finding_code:finding.code,finding_level:'warning',disposition,classification,severity:'medium',needs_human_review:disposition==='manual_review',rationale:'Inspected fixture',duplicate_resolution:null};
}

test('partial report holds defer overlapping tracker archival across finding types', () => {
  const tracker={id:'tracker:1:2:3',code:'possible_duplicate_tracker',details:{tracker_nums:[1,2,3],entries:[1,2,3].map(n=>({tracker_num:n,report:`[${n}](../reports/00${n}.md)`}))}};
  const report={id:'reports:1:2',code:'duplicate_reports_same_role',details:{files:['reports/001.md','reports/002.md']}};
  const unrelated={id:'tracker:4:5',code:'possible_duplicate_tracker',details:{tracker_nums:[4,5]}};
  const findings=verificationFindings({warnings:[tracker,report,unrelated],errors:[]});
  const result=reconcileDuplicateConsistency({warnings:[tracker,report,unrelated],errors:[]},{findings:findings.map(f=>decision(f,f.id===report.id?'manual_review':'resolve_duplicate',f.id===report.id?'needs_human_review':'confirmed_duplicate'))});
  assert.equal(result.review.findings.find(f=>f.finding_id===tracker.id).disposition,'manual_review');
  assert.equal(result.review.findings.find(f=>f.finding_id===unrelated.id).disposition,'resolve_duplicate');
});

test('a broad mixed-posting exception permits a proven exact subgroup while a manual hold vetoes it', () => {
  const broad={id:'broad',code:'possible_duplicate_tracker',details:{tracker_nums:[1,2,3]}};
  const exact={id:'exact',code:'possible_duplicate_tracker',details:{tracker_nums:[1,2],match_basis:'canonical_url',canonical_url:'https://example.org/jobs/a'}};
  for(const [disposition,classification,expected] of [['mark_seen','legitimate_exception','resolve_duplicate'],['mark_seen','false_positive','resolve_duplicate'],['manual_review','needs_human_review','manual_review']]) {
    const result=reconcileDuplicateConsistency({warnings:[broad,exact],errors:[]},{findings:[decision(broad,disposition,classification),decision(exact,'resolve_duplicate','confirmed_duplicate')]});
    assert.equal(result.review.findings[1].disposition,expected);
  }
});

test('complete cross-type report mappings permit exact A/A subgroups of mixed A/A/B exceptions', () => {
  const tracker = (id, nums, exact = false) => ({id,code:'possible_duplicate_tracker',details:{tracker_nums:nums,entries:nums.map(n=>({tracker_num:n,report:`[${n}](../reports/00${n}.md)`})),...(exact?{match_basis:'canonical_url',canonical_url:'https://example.org/jobs/a'}:{})}});
  const report = (id, nums, exact = false) => ({id,code:'duplicate_reports_same_role',details:{files:nums.map(n=>`reports/00${n}.md`),...(exact?{match_basis:'canonical_url',canonical_url:'https://example.org/jobs/a'}:{})}});
  const broadTracker=tracker('broad-tracker',[1,2,3]), broadReport=report('broad-report',[1,2,3]);
  const exactTracker=tracker('exact-tracker',[1,2],true), exactReport=report('exact-report',[1,2],true);
  function reconcile(findings, broadDisposition='mark_seen') {
    return reconcileDuplicateConsistency({warnings:findings,errors:[]},{findings:findings.map(f=>{
      const broad=f.id.startsWith('broad');
      const d=decision(f,broad?broadDisposition:'resolve_duplicate',broad?(broadDisposition==='manual_review'?'needs_human_review':'legitimate_exception'):'confirmed_duplicate');
      if(!broad)d.duplicate_resolution=f.code==='possible_duplicate_tracker'?{keeper_tracker_num:1,duplicate_tracker_nums:[2],keeper_report_file:null,duplicate_report_files:[]}:{keeper_tracker_num:null,duplicate_tracker_nums:[],keeper_report_file:'reports/001.md',duplicate_report_files:['reports/002.md']};
      return d;
    })}).review.findings;
  }
  const all=[broadTracker,broadReport,exactTracker,exactReport];
  const resolved=reconcile(all);
  for(const id of ['exact-tracker','exact-report']) assert.equal(resolved.find(f=>f.finding_id===id).disposition,'resolve_duplicate');
  for(const d of reconcile(all,'manual_review').filter(f=>f.finding_id.startsWith('exact'))) assert.equal(d.disposition,'manual_review');
  // One missing or multiply mapped candidate cannot prove cross-type membership.
  for(const entries of [exactTracker.details.entries.slice(0,1),[exactTracker.details.entries[0],exactTracker.details.entries[0]]]) {
    const incomplete={...exactTracker,details:{...exactTracker.details,entries}};
    assert.equal(reconcile([broadReport,incomplete]).find(f=>f.finding_id==='exact-tracker').disposition,'manual_review');
  }
  assert.equal(reconcile([report('broad-report',[1,2]),exactTracker]).find(f=>f.finding_id==='exact-tracker').disposition,'manual_review','equal sets remain vetoed');
});

test('name-scoped portal finding IDs survive peer removal and YAML detail order', t => {
  const f=fixture(t);
  const path=join(f.root,'portals.yml');
  writeFileSync(path,'tracked_companies:\n  - name: Shared\n    provider: nonexistent\n    careers_url: https://one.example.org/jobs\n    enabled: true\n  - name: Shared\n    provider: nonexistent\n    careers_url: https://two.example.org/jobs\n    enabled: true\n');
  const first=JSON.parse(f.cli('verify-pipeline.mjs',['--json']).stdout).errors.filter(e=>e.code==='portal_unknown_provider');
  assert.equal(first.length,2); assert.notEqual(first[0].id,first[1].id);
  writeFileSync(path,'tracked_companies:\n  - enabled: true\n    careers_url: https://two.example.org/jobs\n    provider: nonexistent\n    name: Shared\n');
  const second=JSON.parse(f.cli('verify-pipeline.mjs',['--json']).stdout).errors.find(e=>e.code==='portal_unknown_provider');
  assert.equal(second.id,first.find(e=>e.details.careers_url.includes('two.')).id);
});
