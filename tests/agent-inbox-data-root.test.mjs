// agent-inbox.mjs keeps its default queue under the data root
// (getCareerOpsRoot(): CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR > .career-ops-data
// marker > ~/career-ops-data for a plugin install copy > code root), and
// CAREER_OPS_INBOX still wins over all of them.
//
// The default used to be 'data/agent-inbox.md' relative to the working
// directory. A plugin install runs its scripts from the plugin copy, so the
// queue landed in a folder Claude Code replaces on update, and learn.mjs read
// a different file from the data root. The .gitignore self-heal edited the
// cwd's .gitignore for the same reason; it now edits the checkout's, and only
// when the data root is that checkout.
//
// Fork: every case selects the user `fixture`, so the default data root is the
// code root's users/fixture/, an explicit root is used as given, and a plugin
// copy defaults to ~/career-ops-data/users/fixture/. The fork's self-heal adds
// the queue's checkout-relative path unless the .gitignore already ignores
// users/*, and CAREER_OPS_INBOX resolves against the checkout, not the cwd.
//
// Every case runs the real CLI from a disposable code root holding the
// script's import closure, with every data-root variable cleared first, so no
// case can reach the developer's own files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'agent-inbox.mjs');
const RULE = 'users/fixture/data/agent-inbox.md';
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

// Every variable that could point a child at the developer's real data root.
const DATA_ROOT_ENV = [
  'CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_INBOX', 'CLAUDE_CODE_PLUGIN_CACHE_DIR', 'CAREER_OPS_USERS_DIR',
];

// The node_modules that serves the repo's packages (a worktree resolves it
// from an ancestor checkout), linked into each code root for js-yaml.
const NODE_MODULES = (() => {
  const pkg = createRequire(join(ROOT, 'package.json')).resolve('js-yaml/package.json');
  return pkg.slice(0, pkg.lastIndexOf(`${sep}node_modules${sep}`) + `${sep}node_modules`.length);
})();

function tmp(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Copy agent-inbox.mjs and its relative-import closure into `dir`, so
// path-resolver.mjs sees `dir` as the code root, plus tracker-aliases.json,
// which tracker-parse.mjs loads at import. No .career-ops-data marker is copied,
// so only the environment decides the data root.
function codeRoot(dir, gitignore) {
  const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  const seen = new Set();
  const stack = [CLI];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const target = resolve(dirname(file), m[1] || m[2]);
      if (existsSync(target)) stack.push(target);
    }
  }
  for (const file of [...seen, join(ROOT, 'tracker-aliases.json')]) {
    const dest = join(dir, file.slice(ROOT.length + 1));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(file));
  }
  symlinkSync(NODE_MODULES, join(dir, 'node_modules'), LINK_TYPE);
  writeFileSync(join(dir, '.gitignore'), gitignore);
  return dir;
}

// Run a code root's agent-inbox.mjs from `cwd` with only `env` deciding the
// data root; returns stdout.
function run(code, cwd, env, args) {
  const base = { ...process.env };
  for (const k of DATA_ROOT_ENV) delete base[k];
  return execFileSync(process.execPath, [join(code, 'agent-inbox.mjs'), ...args], {
    cwd, env: { ...base, CAREER_OPS_USER: 'fixture', ...env }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const ruleCount = (gitignore) => readFileSync(gitignore, 'utf8').split('\n').filter((l) => l.trim() === RULE).length;

test('default layout: the queue lands in users/fixture/data/ and .gitignore gains the rule once', (t) => {
  const code = codeRoot(tmp(t, 'inbox-repo-'), 'node_modules\noutput/*\n');
  const cwd = tmp(t, 'inbox-cwd-');
  run(code, cwd, {}, ['add', 'queue a scan']);
  run(code, cwd, {}, ['add', 'queue another']);
  assert.equal(ruleCount(join(code, '.gitignore')), 1);
  assert.match(readFileSync(join(code, 'users', 'fixture', 'data', 'agent-inbox.md'), 'utf8'), /queue another/);
  assert.deepEqual(readdirSync(cwd), [], 'nothing written under the cwd');
});

test('a checkout .gitignore that ignores users/* is left alone', (t) => {
  const code = codeRoot(tmp(t, 'inbox-repo-'), 'node_modules\nusers/*\n');
  run(code, tmp(t, 'inbox-cwd-'), {}, ['add', 'ignored already']);
  assert.ok(existsSync(join(code, 'users', 'fixture', 'data', 'agent-inbox.md')));
  assert.equal(readFileSync(join(code, '.gitignore'), 'utf8'), 'node_modules\nusers/*\n');
});

test('CAREER_OPS_ROOT naming a symlink to the checkout puts the queue in its data/', (t) => {
  const code = codeRoot(tmp(t, 'inbox-repo-'), 'node_modules\n');
  const link = join(tmp(t, 'inbox-link-'), 'checkout');
  symlinkSync(code, link, LINK_TYPE);
  run(code, tmp(t, 'inbox-cwd-'), { CAREER_OPS_ROOT: link }, ['add', 'through the link']);
  assert.ok(existsSync(join(code, 'data', 'agent-inbox.md')));
});

test('CAREER_OPS_DATA_DIR: the queue follows it, and neither .gitignore changes', (t) => {
  const code = codeRoot(tmp(t, 'inbox-code-'), 'node_modules\n');
  const data = tmp(t, 'inbox-data-');
  writeFileSync(join(data, '.gitignore'), 'secrets\n');
  const cwd = tmp(t, 'inbox-cwd-');
  run(code, cwd, { CAREER_OPS_DATA_DIR: data }, ['add', 'probe']);
  assert.match(readFileSync(join(data, 'data', 'agent-inbox.md'), 'utf8'), /^- \[ \] .* — probe$/m);
  assert.deepEqual(readdirSync(cwd), [], 'nothing written under the cwd');
  assert.ok(!existsSync(join(code, 'data', 'agent-inbox.md')), 'no queue in the code root');
  assert.equal(readFileSync(join(data, '.gitignore'), 'utf8'), 'secrets\n');
  assert.equal(readFileSync(join(code, '.gitignore'), 'utf8'), 'node_modules\n');
  assert.match(run(code, cwd, { CAREER_OPS_DATA_DIR: data }, ['list']), /probe/, 'list reads the same queue');
});

test('CAREER_OPS_INBOX wins over CAREER_OPS_DATA_DIR and resolves against the checkout', (t) => {
  const code = codeRoot(tmp(t, 'inbox-code-'), 'node_modules\n');
  const data = tmp(t, 'inbox-data-');
  const cwd = tmp(t, 'inbox-cwd-');
  run(code, cwd, { CAREER_OPS_DATA_DIR: data, CAREER_OPS_INBOX: 'q/inbox.md' }, ['add', 'override wins']);
  assert.match(readFileSync(join(code, 'q', 'inbox.md'), 'utf8'), /override wins/);
  assert.ok(!existsSync(join(data, 'data', 'agent-inbox.md')));
});

test('plugin install copy: the queue goes to ~/career-ops-data/users/fixture and the copy is left alone', (t) => {
  const plugins = tmp(t, 'inbox-plugins-');
  const copy = codeRoot(join(plugins, 'cache', 'career-ops', 'career-ops', '1.0.0'), 'node_modules\n');
  const home = tmp(t, 'inbox-home-');
  // SKILL.md runs every script from the plugin copy, so the copy is the cwd.
  run(copy, copy, {
    CLAUDE_CODE_PLUGIN_CACHE_DIR: plugins, CLAUDE_CONFIG_DIR: join(home, '.claude'),
    HOME: home, USERPROFILE: home,
  }, ['add', 'from the plugin']);
  assert.match(readFileSync(join(home, 'career-ops-data', 'users', 'fixture', 'data', 'agent-inbox.md'), 'utf8'), /from the plugin/);
  assert.ok(!existsSync(join(copy, 'data', 'agent-inbox.md')), 'nothing queued inside the copy');
  assert.equal(readFileSync(join(copy, '.gitignore'), 'utf8'), 'node_modules\n');
});
