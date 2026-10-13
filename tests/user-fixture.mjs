import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const isolatedUsers = mkdtempSync(path.join(tmpdir(), 'career-ops-fixture-users-'));
process.env.CAREER_OPS_USER = 'test';
process.env.CAREER_OPS_USERS_DIR = isolatedUsers;
delete process.env.CAREER_OPS_ROOT;
delete process.env.CAREER_OPS_DATA_DIR;

// Give an upstream flat fixture an explicit user without changing its layout.
export function userFixtureEnv(env, explicitSelection = false) {
  if (explicitSelection) return env;
  const tracker = env.CAREER_OPS_TRACKER;
  const trackerDir = tracker ? path.dirname(tracker) : '';
  const root = env.CAREER_OPS_ROOT?.trim() || env.CAREER_OPS_DATA_DIR?.trim() ||
    (trackerDir ? (path.basename(trackerDir) === 'data' ? path.dirname(trackerDir) : trackerDir) : '');
  if (!root) return env;
  const absolute = path.resolve(root);
  return { ...env, CAREER_OPS_USER: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(path.basename(absolute)) ? path.basename(absolute) : 'fixture', CAREER_OPS_USERS_DIR: path.dirname(absolute), CAREER_OPS_DATA_DIR: root };
}

export function selectTestUser(root) {
  if (root) Object.assign(process.env, userFixtureEnv({ CAREER_OPS_ROOT: root }));
  return root;
}

export function restoreTestUser(root) {
  if (root) return selectTestUser(root);
  process.env.CAREER_OPS_USER = 'test';
  process.env.CAREER_OPS_USERS_DIR = isolatedUsers;
  delete process.env.CAREER_OPS_DATA_DIR;
  return root;
}
