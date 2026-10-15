import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const root=resolve(import.meta.dirname,'..');
// Execute the actual private helpers against files; no test-only production API.
function definition(source,name) {
  const text=source.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'))?.[0];
  assert.ok(text,`production helper ${name} exists`); return text;
}

test('resumed action results cannot satisfy replacement pending inputs from a newer pass generation', t => {
  const dir=mkdtempSync(join(tmpdir(),'verify-action-generations-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=readFileSync(join(root,'verify-runner.mjs'),'utf8');
  const context={existsSync,readFileSync,createHash,join,basename,runDir:dir};
  const helpers=runInNewContext(`${definition(source,'actionInputDigest')}\n${definition(source,'priorActionResult')}\n({actionInputDigest,priorActionResult})`,context);
  const old=['verification.apply-resume-01.json','review.applicable-resume-01.json'].map(name=>join(dir,name));
  const current=['verification.apply-01.json','review.applicable-01.json'].map(name=>join(dir,name));
  old.forEach((path,n)=>writeFileSync(path,JSON.stringify({generation:1,kind:n})));
  current.forEach((path,n)=>writeFileSync(path,JSON.stringify({generation:2,kind:n})));
  const result=join(dir,'action-result.review.pass-01.json');
  writeFileSync(result,JSON.stringify({status:'completed',input_files:old.map(path=>basename(path)),input_digest:helpers.actionInputDigest(old)}));
  assert.equal(helpers.priorActionResult('review',1,old).status,'completed');
  assert.equal(helpers.priorActionResult('review',1,current),null,'valid old resume files cannot authenticate new pending repair evidence');
  writeFileSync(result,JSON.stringify({status:'completed',input_files:current.map(path=>basename(path)),input_digest:helpers.actionInputDigest(current)}));
  assert.equal(helpers.priorActionResult('review',1,current).status,'completed');
});

test('PDF theme overrides insert literal replacement metacharacters without duplicating document content', () => {
  const source=readFileSync(join(root,'generate-pdf.mjs'),'utf8');
  const theme=source.match(/^const THEME_VARIABLES = \{[\s\S]*?^\};/m)?.[0];
  assert.ok(theme);
  const apply=runInNewContext(`${theme}\n${definition(source,'isSafeCssValue')}\n${definition(source,'applyThemeOverrides')}\napplyThemeOverrides`);
  const html='<html><head><title>one</title></head><body>unique</body></html>';
  for(const value of ["'$&'","'$`'","'$\u0027'","'$$'" ]) {
    const result=apply(html,{primary:value}).html;
    assert.ok(result.includes(`--cv-primary: ${value};`));
    assert.equal(result.match(/unique/g).length,1);
    assert.equal(result.match(/<title>/g).length,1);
  }
});
