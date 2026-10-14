import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { careerOpsRoot } from '../../src/lib/user-context.mjs';

const CORE = path.resolve(import.meta.dirname, '../../..');
const resolve = (root, env) => {
  const saved = {...process.env};
  try {
    for (const key of Object.keys(process.env).filter(key => key.startsWith('CAREER_OPS_'))) delete process.env[key];
    Object.assign(process.env, {CAREER_OPS_CODE_ROOT: root, ...env});
    return careerOpsRoot();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
};

test('missing selection rejects legacy root, data-dir, and marker fallbacks', () => {
  for (const env of [{}, { CAREER_OPS_ROOT: '/legacy' }, { CAREER_OPS_DATA_DIR: '/legacy' }]) {
    assert.throws(() => resolve(CORE, env), /No career-ops user selected/);
  }
});

test('invalid user IDs cannot escape their users directory', () => {
  for (const id of ['..', '../other', '/other', 'a/b', '_other']) {
    assert.throws(() => resolve(CORE, { CAREER_OPS_USER: id }), /Invalid/);
  }
});

test('selected users resolve independently of the legacy root alias', () => {
  for (const id of ['alice', 'Bob-2.dev_test']) {
    assert.equal(resolve(CORE, { CAREER_OPS_USER: id, CAREER_OPS_ROOT: '/legacy' }), path.join(CORE, 'users', id));
  }
});

test('web and copied core resolver agree on default, relative, and absolute user directories', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'data-root-')));
  const saved = { ...process.env };
  try {
    fs.copyFileSync(path.join(CORE, 'path-resolver.mjs'), path.join(root, 'path-resolver.mjs'));
    const mod = await import(pathToFileURL(path.join(root, 'path-resolver.mjs')).href);
    for (const configured of [undefined, 'alternate-users', path.join(root, 'absolute-users')]) {
      for (const key of ['CAREER_OPS_USER', 'CAREER_OPS_USERS_DIR', 'CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR']) delete process.env[key];
      const env = { CAREER_OPS_USER: 'test' };
      if (configured) env.CAREER_OPS_USERS_DIR = configured;
      Object.assign(process.env, env);
      assert.equal(resolve(root, env), mod.getCareerOpsRoot());
    }
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production web data roots honor data-dir, marker and users override precedence', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'web-marker-'));
  try {
    fs.writeFileSync(path.join(root,'.career-ops-data'),'marker-data');
    assert.equal(resolve(root,{CAREER_OPS_USER:'fixture'}),path.join(root,'marker-data'));
    assert.equal(resolve(root,{CAREER_OPS_USER:'fixture',CAREER_OPS_DATA_DIR:'explicit-data'}),path.join(root,'explicit-data'));
    assert.equal(resolve(root,{CAREER_OPS_USER:'fixture',CAREER_OPS_USERS_DIR:'other-users'}),path.join(root,'other-users','fixture'));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
