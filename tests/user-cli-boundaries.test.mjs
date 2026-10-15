import './user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { userFixtureEnv } from './user-fixture.mjs';

const code = resolve(import.meta.dirname, '..');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-cli-boundaries-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('CAREER_OPS_')) delete env[key];
  Object.assign(env, { CAREER_OPS_ROOT: root, CAREER_OPS_USERS_DIR: join(root, 'decoy-users') });
  for (const path of ['reports', 'config', 'output', 'data']) mkdirSync(join(root, path));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = (name, args, extra = {}) => spawnSync(process.execPath, [join(code, name), ...args], { cwd: code, env: { ...env, ...extra }, encoding: 'utf8', timeout: 15000 });
  return { root, env, cli };
}

test('fixture aliases retain competing overrides and a separate selected-user default', () => {
  const env = userFixtureEnv({ CAREER_OPS_ROOT: '/preferred', CAREER_OPS_DATA_DIR: '/alternate' });
  assert.equal(env.CAREER_OPS_ROOT, '/preferred'); assert.equal(env.CAREER_OPS_DATA_DIR, '/alternate');
  assert.notEqual(join(env.CAREER_OPS_USERS_DIR, env.CAREER_OPS_USER), '/preferred');
});

test('CLI and web normalize the selected environment user consistently', t => {
  if (!existsSync(join(code, 'web', 'src'))) { t.skip('web/ is absent in this core-only checkout'); return; }
  const f = fixture(t);
  const cliUrl = pathToFileURL(join(code, 'lib/user-context.mjs')).href;
  const rootUrl = pathToFileURL(join(code, 'path-resolver.mjs')).href;
  const webUrl = pathToFileURL(join(code, 'web/src/lib/user-context.mjs')).href;
  const script = `const {getUserContext}=await import(${JSON.stringify(cliUrl)});const {getCareerOpsRoot}=await import(${JSON.stringify(rootUrl)});const {careerOpsUserId}=await import(${JSON.stringify(webUrl)});const before=getUserContext([]).userId;getCareerOpsRoot();console.log(JSON.stringify([before,process.env.CAREER_OPS_USER,careerOpsUserId()]));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...f.env, CAREER_OPS_USER: ' alice ' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), ['alice', 'alice', 'alice']);
  const pattern = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}';
  for (const file of ['lib/user-context.mjs', 'path-resolver.mjs', 'lib/cli-flags.mjs', 'batch/manual-inputs.mjs', 'web/src/lib/user-context.mjs', 'web/src/lib/core/data-root.mjs', 'dashboard/main.go']) {
    assert.ok(readFileSync(join(code, file), 'utf8').includes(pattern), `${file} uses the same 1–64 character ID contract`);
  }
});

test('answer read modes require a user and contain both relative and repository-style paths', t => {
  const f = fixture(t); const report = join(f.root, 'reports', '001.md');
  writeFileSync(report, '# Report\n');
  for (const mode of ['--read', '--read-draft']) {
    const missing = f.cli('application-answers.mjs', [mode, '--report', report]);
    assert.notEqual(missing.status, 0); assert.match(missing.stderr, /No career-ops user selected/);
    const valid = f.cli('application-answers.mjs', ['--user', 'alice', mode, '--report', 'reports/001.md']);
    assert.equal(valid.status, 0, valid.stderr); assert.equal(JSON.parse(valid.stdout), null);
    const prefixed = f.cli('application-answers.mjs', ['--user', 'alice', mode, '--report', 'users/alice/reports/001.md']);
    assert.equal(prefixed.status, 0, prefixed.stderr);
    const outside = f.cli('application-answers.mjs', ['--user', 'alice', mode, '--report', join(code, 'AGENTS.md')]);
    assert.notEqual(outside.status, 0); assert.match(outside.stderr, /outside the active user/);
  }
});

test('template module imports without user selection when the caller supplies a profile', t => {
  const f = fixture(t); const profile = join(f.root, 'config', 'profile.yml');
  writeFileSync(profile, 'cv:\n  template: compact\n');
  const script = `const {loadProfileDefault,resolveTemplate}=await import(${JSON.stringify(pathToFileURL(join(code,'cv-templates.mjs')).href)});resolveTemplate('cv','standard');console.log(loadProfileDefault('cv',{profilePath:${JSON.stringify(profile)}}));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'compact');
});

test('OpenRouter command help stops before user reads, environment loading or network discovery', t => {
  const f=fixture(t); const preload=join(f.root,'guard.mjs'), calls=join(f.root,'forbidden');
  writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const original=fs.readFileSync;
fs.readFileSync=function(file,...args){if(/(?:^|[\\\\/])(?:\\.env|cv\\.md|profile\\.yml|model-blacklist\\.json)$/.test(String(file))){fs.writeFileSync(${JSON.stringify(calls)},String(file));throw new Error('forbidden data read');}return original.call(this,file,...args);};
syncBuiltinESMExports();globalThis.fetch=async()=>{fs.writeFileSync(${JSON.stringify(calls)},'fetch');throw new Error('forbidden fetch');};\n`);
  for(const args of [['help'],['--help'],['-h'],['evaluate','--help'],['models','-h'],['--user','alice','pipeline','--help']]) {
    const result=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,join(code,'openrouter-runner.mjs'),...args],{cwd:code,env:f.env,encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/COMMANDS:/);
    assert.equal(existsSync(calls),false,args.join(' '));
  }
  const operand=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,join(code,'openrouter-runner.mjs'),'evaluate','help'],{cwd:code,env:f.env,encoding:'utf8',timeout:10000});
  assert.notEqual(operand.status,0); assert.match(operand.stderr,/No career-ops user selected/);
  assert.doesNotMatch(operand.stdout,/COMMANDS:/); assert.equal(existsSync(calls),false);
});

test('plugin removal rejects path-like IDs before changing plugins, config or locks', t => {
  const f=fixture(t); mkdirSync(join(f.root,'plugins')); mkdirSync(join(f.root,'plugins','keep'));
  const sentinel=join(f.root,'plugins','keep','sentinel'); writeFileSync(sentinel,'keep');
  for(const id of ['..','../keep','../../data','/tmp','C:/tmp','a/b','a\\b']) {
    const result=f.cli('plugins.mjs',['--user','alice','remove',id]);
    assert.notEqual(result.status,0); assert.match(result.stderr,/Invalid plugin id/i);
    assert.equal(readFileSync(sentinel,'utf8'),'keep');
  }
});

test('configured scan history writes use the same absolute lane outside the current directory', t => {
  const f=fixture(t); const lane=join(f.root,'lane/history.tsv');
  const script=`const {getUserContext}=await import(${JSON.stringify(pathToFileURL(join(code,'lib/user-context.mjs')).href)});const scan=await import(${JSON.stringify(pathToFileURL(join(code,'scan.mjs')).href)});scan.configureScanUserPaths(getUserContext(['--user','alice']),{historyPath:${JSON.stringify(lane)}});await scan.appendToScanHistory([{company:'Fixture',title:'Engineer',url:'https://example.org/jobs/1',location:'Remote'}],'2026-10-15');`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:tmpdir(),env:{...f.env,CAREER_OPS_USER:'alice',CAREER_OPS_SCAN_HISTORY:'decoy.tsv'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); assert.match(readFileSync(lane,'utf8'),/https:\/\/example.org\/jobs\/1/);
  assert.equal(existsSync(join(f.root,'data/scan-history.tsv')),false);
});

test('portal audits pass an explicit profile override to the selected provider', t => {
  const f=fixture(t);
  const script=`const {auditCompanies}=await import(${JSON.stringify(pathToFileURL(join(code,'audit-portals.mjs')).href)});let profile;const rows=await auditCompanies([{name:'Fixture',provider:'fixture'}],{providers:new Map([['fixture',{id:'fixture',fetch:async(entry,ctx)=>{profile=ctx.profilePath;return [{title:'Engineer',url:'https://example.org/jobs/1'}];}}]])});console.log(JSON.stringify({profile,rows}));`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:code,env:{...f.env,CAREER_OPS_USER:'alice',CAREER_OPS_PROFILE:'relative-profile.yml'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);
  assert.equal(value.profile,resolve(code,'relative-profile.yml'));
  assert.equal(value.rows[0].count,1);assert.notEqual(value.rows[0].verdict,'error');
});

test('tracker sync CLI retains legacy interviews fallback and prefers a canonical file when present', t => {
  const f=fixture(t);
  writeFileSync(join(f.root,'data/applications.md'),'# Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
  writeFileSync(join(f.root,'active-interviews.md'),'| Company | Role | Status | Notes |\n|---|---|---|---|\n| Legacy | Engineer | Interview | fixture |\n');
  let result=f.cli('tracker-sync-check.mjs',['--user','alice']);
  assert.equal(result.status,0,result.stderr); assert.equal(JSON.parse(result.stdout).summary.total,1);
  writeFileSync(join(f.root,'data/active-interviews.md'),'| Company | Role | Status | Notes |\n|---|---|---|---|\n');
  result=f.cli('tracker-sync-check.mjs',['--user','alice']);
  assert.equal(result.status,0,result.stderr); assert.equal(JSON.parse(result.stdout).summary.total,0);
});

test('LaTeX positional arguments are parsed after the explicit user', t => {
  const f = fixture(t); const input = join(f.root, 'missing.json');
  const result = f.cli('build-cv-latex.mjs', ['--user', 'alice', input, join(f.root, 'output', 'cv.tex')]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Input file not found/); assert.ok(result.stderr.includes(input));
});

test('preparing an application reads an in-root cover letter on either platform', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'output', 'cv.pdf'), '%PDF-fixture');
  writeFileSync(join(f.root, 'cover.txt'), 'A factual cover letter.');
  const result = f.cli('prepare-application.mjs', ['--user', 'alice', '--url', 'https://boards.greenhouse.io/fixture/jobs/123', '--pdf', 'output/cv.pdf', '--cover', 'cover.txt']);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Cover\s+cover.txt \(4 words\)/);
  assert.doesNotMatch(result.stderr, /escapes/);
});

test('CV outputs reject a symlinked ancestor before rendering', t => {
  const f = fixture(t); const outside = mkdtempSync(join(tmpdir(), 'career-ops-output-decoy-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(f.root, 'output', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const input = join(f.root, 'input.json'); writeFileSync(input, '{}');
  for (const name of ['build-cv-html.mjs', 'img-to-pdf.mjs', 'build-cv-latex.mjs']) {
    const result = f.cli(name, ['--user', 'alice', input, join(f.root, 'output', 'escape', 'cv.pdf')]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /outside the active user root/);
    assert.equal(existsSync(join(outside, 'cv.pdf')), false);
  }
});

test('plugin management discovers and creates local plugins in the selected data root', t => {
  const f = fixture(t);
  const created = f.cli('plugins.mjs', ['--user', 'alice', 'new', 'fixture-source']);
  assert.equal(created.status, 0, created.stderr);
  assert.ok(existsSync(join(f.root, 'plugins.local', 'fixture-source', 'manifest.json')));
  const listed = f.cli('plugins.mjs', ['--user', 'alice', 'list']);
  assert.equal(listed.status, 0, listed.stderr); assert.match(listed.stdout, /fixture-source/);
});

test('global command help succeeds without selecting a user', t => {
  const f = fixture(t);
  for (const name of ['find.mjs', 'company-funded.mjs', 'mark-pdf-ready.mjs', 'set-status.mjs']) {
    const result = f.cli(name, ['--help']); assert.equal(result.status, 0, `${name}: ${result.stderr}`); assert.match(result.stdout, /Usage/);
  }
});
