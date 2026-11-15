// Plain .mjs (same pattern as run-cli-support.mjs / tracker-table.mjs) so
// tests/lib/data-root.test.mjs can import it directly under Node. Import it with
// the .mjs extension included.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Resolve the selected user's data root, matching the fork's core
 * `path-resolver.mjs` `getCareerOpsRoot()` for an explicit user:
 *
 *   1. `CAREER_OPS_DATA_DIR`
 *   2. the `.career-ops-data` marker in the checkout, only when no users
 *      directory is configured
 *   3. `{CAREER_OPS_USERS_DIR}/{user}`, else `users/{user}` in the checkout, or
 *      `~/career-ops-data/users/{user}` when the checkout is a Claude Code
 *      plugin install copy
 *
 * `CAREER_OPS_USER` is required. `CAREER_OPS_ROOT` is not a data root here: the
 * web reads it as its legacy code-root alias, so it cannot select a root user.
 * A value from step 1 or 2 that lands inside a plugin install copy throws
 * `UnsafeDataRootError` instead of being returned (AGENTS.md, "Path Resolution
 * Override & Precedence").
 *
 * Relative values resolve against `coreRoot`, the checkout (path-resolver's
 * `__dirname`), never the web's cwd (`<core>/web`). The core is not imported:
 * bundled into the Next server output, its `import.meta.url` would name the
 * bundle instead of the checkout.
 *
 * @param {string} coreRoot Absolute path to the career-ops checkout.
 * @param {() => string | null | undefined} readMarker Reads the checkout's `.career-ops-data` marker.
 * @param {NodeJS.ProcessEnv} env
 * @param {(...parts: string[]) => string} resolve `path.resolve`
 * @param {(...parts: string[]) => string} join `path.join`
 * @param {PluginHost} [host] Home directory, realpath and platform, for the plugin-copy check.
 * @returns {string} Absolute data root.
 * @throws {UnsafeDataRootError} When the environment or the marker names a folder inside a plugin install copy.
 */
export function resolveDataRoot(coreRoot, readMarker, env, resolve, join, host = defaultHost()) {
  const id = env.CAREER_OPS_USER?.trim();
  if (!id) throw new Error('No career-ops user selected. Set CAREER_OPS_USER=<username>.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error('Invalid CAREER_OPS_USER.');
  const data = env.CAREER_OPS_DATA_DIR?.trim();
  if (data) return explicitRoot(resolve(coreRoot, data), "CAREER_OPS_DATA_DIR", env, host);
  const users = env.CAREER_OPS_USERS_DIR?.trim();
  if (users) return join(resolve(coreRoot, users), id);
  const marker = readMarker()?.trim();
  if (marker) return explicitRoot(resolve(coreRoot, marker), "The .career-ops-data marker", env, host);
  // A plugin install copy is replaced on every plugin update, so its users/
  // folder cannot hold the user's files.
  if (isPluginInstallCopy(coreRoot, env, host)) return join(pluginDefaultDataRoot(host), "users", id);
  return join(resolve(coreRoot, "users"), id);
}

function defaultHost() {
  return { homedir: os.homedir, realpath: fs.realpathSync, platform: process.platform };
}

/**
 * What the plugin-copy check needs from the machine, injected so tests can point
 * it at a fixture home.
 *
 * @typedef {object} PluginHost
 * @property {() => string} homedir `os.homedir`
 * @property {(p: string) => string} realpath `fs.realpathSync`; may throw for a path not on disk
 * @property {string} platform `process.platform`
 */

// The directories under Claude Code's plugins root that hold a plugin's files
// on Claude Code's behalf. Same list as path-resolver.mjs's PLUGIN_COPY_SUBDIRS.
const PLUGIN_COPY_SUBDIRS = ["cache", "marketplaces", "synced"];

/**
 * Claude Code's plugins roots: CLAUDE_CODE_PLUGIN_CACHE_DIR when set, and
 * `plugins/` under the config directory (CLAUDE_CONFIG_DIR, else ~/.claude).
 * Mirrors path-resolver.mjs's claudePluginsRoots().
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {PluginHost} host
 * @returns {string[]}
 */
export function claudePluginsRoots(env, host) {
  const roots = [];
  const cacheDir = env.CLAUDE_CODE_PLUGIN_CACHE_DIR?.trim();
  if (cacheDir) roots.push(path.resolve(cacheDir));
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  roots.push(path.join(configDir ? path.resolve(configDir) : path.join(host.homedir(), ".claude"), "plugins"));
  return roots;
}

// The path with its symlinks resolved. A path not on disk yet resolves through
// its nearest existing ancestor, so `<link-to-plugin-copy>/new-data` reads as
// inside the copy just like `<link>` does (#7026). Null when nothing resolves.
// Mirrors path-resolver.mjs's realSpelling().
function realSpelling(p, host) {
  try {
    return host.realpath(p);
  } catch {
    // Not on disk yet: resolve the nearest ancestor that is.
  }
  const missing = [];
  let current = path.resolve(p);
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    missing.unshift(path.basename(current));
    current = parent;
    try {
      return path.join(host.realpath(current), ...missing);
    } catch {
      // Keep walking up.
    }
  }
}

function spellings(p, host) {
  const out = [path.resolve(p)];
  const real = realSpelling(p, host);
  if (real) out.push(real);
  return host.platform === "win32" ? out.map((s) => s.toLowerCase()) : out;
}

function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  // A ".." segment leaves the parent; a name like "..local" stays inside it.
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * True when `dir` is inside a copy Claude Code keeps for an installed plugin.
 * Mirrors path-resolver.mjs's isPluginInstallCopy().
 *
 * @param {string} dir
 * @param {NodeJS.ProcessEnv} env
 * @param {PluginHost} host
 * @returns {boolean}
 */
export function isPluginInstallCopy(dir, env, host) {
  const candidates = spellings(dir, host);
  return claudePluginsRoots(env, host).some((root) => PLUGIN_COPY_SUBDIRS.some((sub) => {
    const parents = spellings(path.join(root, sub), host);
    return candidates.some((c) => parents.some((p) => isWithin(c, p)));
  }));
}

/**
 * Where a plugin install keeps the user's files when neither the environment
 * nor a marker says where: ~/career-ops-data.
 *
 * @param {PluginHost} host
 * @returns {string}
 */
export function pluginDefaultDataRoot(host) {
  return path.join(host.homedir(), "career-ops-data");
}

/**
 * Thrown when an explicit data root (an environment variable or the marker
 * file) resolves inside a plugin install copy. Same name, code, fields and
 * message as path-resolver.mjs's UnsafeDataRootError, so the web app and the
 * CLI refuse the same folder with the same words.
 */
export class UnsafeDataRootError extends Error {
  /**
   * @param {string} root
   * @param {string} source
   * @param {PluginHost} host
   */
  constructor(root, source, host) {
    super(
      `${source} points inside a Claude Code plugin install (${root}), which Claude Code replaces on every plugin update. ` +
      `Set it to a folder outside ~/.claude/plugins, or remove it to use ${pluginDefaultDataRoot(host)}.`,
    );
    this.name = "UnsafeDataRootError";
    this.code = "CAREER_OPS_UNSAFE_DATA_ROOT";
    this.root = root;
    this.source = source;
  }
}

function explicitRoot(root, source, env, host) {
  if (isPluginInstallCopy(root, env, host)) throw new UnsafeDataRootError(root, source, host);
  return root;
}

/**
 * The one-line message of an UnsafeDataRootError, or null for any other value.
 * Matched on `code`, not `instanceof`, so it also recognises the core's own
 * error class. Callers that already turn a missing data folder into a message
 * use this to turn a refused one into a message too, instead of a 500.
 *
 * @param {unknown} err
 * @returns {string | null}
 */
export function unsafeDataRootMessage(err) {
  return err instanceof Error && /** @type {{code?: unknown}} */ (err).code === "CAREER_OPS_UNSAFE_DATA_ROOT" ? err.message : null;
}

/** One line for a data root that is not a directory. No stack, no second sentence. */
export function dataFolderMissingMessage(root) {
  return `Career-Ops data folder not found at ${root}. Set CAREER_OPS_ROOT or CAREER_OPS_DATA_DIR, or run node onboard-write.mjs`;
}
