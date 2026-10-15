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
  for (const name of ['build-cv-html.mjs', 'img-to-pdf.mjs']) {
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

test('OpenRouter help bypasses user-bound imports and candidate context', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'data', 'model-blacklist.json'), '["candidate-private-marker"]');
  writeFileSync(join(f.root, 'cv.md'), 'candidate-private-marker');
  for (const spelling of ['help', '--help', '-h']) {
    const result = f.cli('openrouter-runner.mjs', [spelling]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /COMMANDS:/);
    assert.doesNotMatch(result.stdout, /candidate-private-marker|\[blacklist\]/);
  }
});
