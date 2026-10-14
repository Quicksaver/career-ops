import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
export const TEST_USERS_DIR = mkdtempSync(path.join(tmpdir(), 'career-ops-fixture-users-'));
mkdirSync(path.join(TEST_USERS_DIR, 'test'), { recursive: true });
process.once('exit', () => rmSync(TEST_USERS_DIR, { recursive: true, force: true }));
process.env.CAREER_OPS_USER = 'test';
process.env.CAREER_OPS_USERS_DIR = TEST_USERS_DIR;
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
  const selected = { ...env, CAREER_OPS_USER: env.CAREER_OPS_USER || 'fixture', CAREER_OPS_USERS_DIR: env.CAREER_OPS_USERS_DIR || TEST_USERS_DIR };
  // Preserve competing aliases independently: tests must exercise actual precedence.
  if (!env.CAREER_OPS_ROOT?.trim() && !env.CAREER_OPS_DATA_DIR?.trim()) selected.CAREER_OPS_DATA_DIR = root;
  return selected;
}

export function selectTestUser(root) {
  // Explicit fixture selection pins both aliases for CLI and web callers.
  // userFixtureEnv itself preserves aliases independently for precedence tests.
  if (root) Object.assign(process.env, userFixtureEnv({ CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root }));
  return root;
}

export function restoreTestUser(root) {
  if (root) return selectTestUser(root);
  process.env.CAREER_OPS_USER = 'test';
  process.env.CAREER_OPS_USERS_DIR = TEST_USERS_DIR;
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_ROOT;
  return root;
}
