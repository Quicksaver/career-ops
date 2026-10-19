import { resolve, dirname, join, basename, parse, sep } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, realpathSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Returns the resolved career-ops data directory root.
 * Priority: process.env.CAREER_OPS_ROOT or process.env.CAREER_OPS_DATA_DIR >
 * .career-ops-data marker file > users/{USER}. A valid explicit user is always required.
 * 
 * @returns {string} Absolute path to the data root
 */
export function getCareerOpsRoot() {
  const args = process.argv.slice(2);
  const cleaned = [];
  let userId = process.env.CAREER_OPS_USER?.trim() || '';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--user' || arg === '-u') {
      userId = args[++i];
      if (!userId || userId.startsWith('-')) throw new Error('--user requires a valid user ID.');
    } else if (arg.startsWith('--user=')) {
      userId = arg.slice(7);
      if (!userId) throw new Error('--user requires a valid user ID.');
    } else cleaned.push(arg);
  }
  if (userId) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(userId)) throw new Error('Invalid career-ops user. Pass --user <id>.');
    process.env.CAREER_OPS_USER = userId;
    process.argv.splice(2, process.argv.length - 2, ...cleaned);
    const dataOverride = process.env.CAREER_OPS_ROOT?.trim() || process.env.CAREER_OPS_DATA_DIR?.trim();
    if (dataOverride) return resolve(__dirname, dataOverride);
    const marker = join(__dirname, '.career-ops-data');
    if (!process.env.CAREER_OPS_USERS_DIR && existsSync(marker)) {
      const value = readFileSync(marker, 'utf8').trim();
      if (value) return resolve(__dirname, value);
    }
    return join(resolve(__dirname, process.env.CAREER_OPS_USERS_DIR?.trim() || 'users'), userId);
  }
  if (args.some(arg => ['--help', '-h', '--self-test', '--test'].includes(arg))) return __dirname;
  throw new Error('No career-ops user selected. Specify one with --user <id> or set CAREER_OPS_USER.');


}

/**
 * True when CAREER_OPS_PROFILE names a profile. Callers that must tell "an
 * override is set" from "none" use this instead of comparing paths: an override
 * may name the data-root profile itself.
 *
 * @returns {boolean}
 */
export function hasProfileOverride() {
  return Boolean(process.env.CAREER_OPS_PROFILE?.trim());
}

/**
 * Returns the path to the user's config/profile.yml.
 * Priority: rootDir argument > process.env.CAREER_OPS_PROFILE > data root.
 * A relative override resolves against the working directory, like the other
 * lane variables (CAREER_OPS_PORTALS, CAREER_OPS_PIPELINE, CAREER_OPS_SCAN_HISTORY).
 *
 * Every reader of the profile resolves it here. The override used to be
 * copied by hand into a handful of modules while the rest built the data-root
 * path themselves, so one install could read two different profiles (#5026).
 * A caller that passes its own rootDir has already said which workspace it
 * means, so the environment does not redirect it.
 *
 * @param {string} [rootDir] Explicit workspace root, when the caller has one
 * @returns {string} Path to the profile file: absolute unless the caller passed a relative rootDir
 */
export function getProfilePath(rootDir) {
  if (rootDir) return join(rootDir, 'config', 'profile.yml');
  // An override is a layout override, not a way around user selection: the
  // selected user is validated before either path is returned.
  const dataRoot = getCareerOpsRoot();
  const override = process.env.CAREER_OPS_PROFILE?.trim();
  return override ? resolve(override) : join(dataRoot, 'config', 'profile.yml');
}

/**
 * Canonicalize a tracker path: absolute + realpath (macOS's symlinked tmpdir
 * among others). This must be applied by EVERY resolver of the same tracker:
 * two implementations briefly coexisted, the un-canonicalized one derived
 * different lock paths (/var vs /private/var) for the same file, and shared
 * writer exclusion silently broke. This module is the single source of truth;
 * tracker-utils.mjs re-exports from here so both import paths agree.
 * Deliberately dependency-light (fs/path only): test fixtures copy this file
 * standalone next to the scripts they exercise.
 */
export function canonicalizeTrackerPath(path) {
  const absolutePath = resolve(path);
  try {
    return realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

/**
 * The spelling the Go dashboard canonicalizes a path to, for the tracker lock.
 *
 * Only the lock may use it. Every other path in the repository is compared with
 * realpathSync() spellings, so returning it from canonicalizeTrackerPath() made
 * a short %TEMP% fail containment and backup-path checks across the tracker
 * scripts.
 *
 * @param {string} path - An absolute path, already through realpathSync.
 * @returns {string} The path with each component as the filesystem stores it on
 *   Windows; unchanged elsewhere.
 */
export function storedSpelling(path) {
  return process.platform === 'win32' ? namesAsStoredOnWindows(path) : path;
}

/**
 * Spell each component of a Windows path the way the filesystem stores it.
 *
 * realpathSync() resolves links but keeps a component as it was written, so an
 * 8.3 short name (`C:\Users\RUNNER~1\...`, which %TEMP% often is) stays short.
 * The Go dashboard canonicalizes with filepath.EvalSymlinks, which writes the
 * long name, and the lock name is a hash of the path string: the two languages
 * derived two lock directories for one tracker and stopped excluding each other
 * (#4957). realpathSync.native() would expand the short name, but it also
 * resolves a `subst` drive to the directory behind it, which Go keeps as
 * written, so it would trade this divergence for another. Only each
 * component's own name is taken from it; the drive or share stays as given,
 * except that a drive letter is upper-cased, as EvalSymlinks writes it
 * (realpathSync keeps `c:\` as it was typed).
 *
 * @param {string} path - An absolute path with no links left in it.
 * @returns {string}
 */
function namesAsStoredOnWindows(path) {
  const { root } = parse(path);
  let out = /^[a-z]:/.test(root) ? root[0].toUpperCase() + root.slice(1) : root;
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    let name = part;
    try {
      name = basename(realpathSync.native(join(out, part)));
    } catch {
      // Unreadable here: keep the component as realpathSync wrote it.
    }
    out = join(out, name);
  }
  return out;
}

/**
 * Returns the canonical path to the tracker applications.md file for reading.
 * Priority: process.env.CAREER_OPS_TRACKER > root/data/applications.md > root/applications.md.
 *
 * @param {string} rootDir The career-ops data root directory
 * @returns {string} Canonical absolute path to the tracker file
 */
export function resolveTrackerPath(rootDir) {
  return canonicalizeTrackerPath(rawTrackerPath(rootDir));
}

/**
 * The tracker path before canonicalization: the lexical location, with no
 * symlink along the path resolved. resolveTrackerPath() realpaths this for the
 * lock key, but workspace derivation uses the raw form instead (see
 * resolveWorkspaceRootFor) so a symlinked `data/` does not realpath the
 * workspace out of the repo (#3169).
 *
 * @param {string} rootDir The career-ops data root directory
 * @returns {string} Uncanonicalized tracker path
 */
export function rawTrackerPath(rootDir) {
  const env = process.env.CAREER_OPS_TRACKER?.trim();
  return env
    ? env
    : existsSync(join(rootDir, 'data/applications.md'))
      ? join(rootDir, 'data/applications.md')
      : join(rootDir, 'applications.md');
}

/**
 * Returns the resolved path to the tracker applications.md file for writing.
 * Priority: process.env.CAREER_OPS_TRACKER > root/data/applications.md.
 * Does not check for file existence, providing a deterministic write target.
 * 
 * @param {string} root The career-ops data root directory
 * @returns {string} Absolute path to the tracker file for writing
 */
export function resolveTrackerPathForWrite(root) {
  const env = process.env.CAREER_OPS_TRACKER?.trim();
  if (env) {
    // Same canonicalization as the read path (see canonicalizeTrackerPath): an
    // un-canonicalized env override derives divergent lock paths on symlinked
    // tmpdirs and breaks shared writer exclusion.
    return canonicalizeTrackerPath(env);
  }
  return join(root, 'data/applications.md');
}

