#!/usr/bin/env node
/**
 * inbox-skip.mjs — skip one Inbox row in data/pipeline.md, or undo the skip (#5269).
 *
 * Skip flips the Pending row `- [ ] <url> | …` to `- [x] <url> | …`; --undo
 * flips it back. Only the checkbox character changes. The rule itself is
 * lib/inbox-skip.mjs: the posting URL must be the first cell after the
 * checkbox, and a row under Processed never matches.
 *
 * The write is lib/inbox-skip.mjs, under the pipeline lock that scan.mjs
 * takes. The dashboard's Inbox `x` and `u` keys run this script, and the web
 * inbox's Skip runs a byte copy of that module with the same lock, so both
 * make the same change the same way.
 *
 * Exit status, so a caller need not read the output:
 *   0  the row was changed
 *   3  nothing to change: every matching row already has that checkbox
 *   4  no Pending row has this URL as its first cell, or there is no pipeline.md
 *   1  any other error: a --url that is not an http(s) posting URL, the
 *      pipeline lock held past its timeout, a read or write failure
 *
 * Run: node inbox-skip.mjs --user <id> --url <url> [--undo] [--pipeline <path>]
 * The default pipeline is the selected user's data/pipeline.md, the file the
 * web inbox and the dashboard's Inbox read. A user is required even with
 * --pipeline, as for every career-ops command.
 */

import { join, resolve } from 'path';
import { applyInboxSkip, jobUrlFromRest, postingUrl, setInboxSkip as setInboxSkipWithLock } from './lib/inbox-skip.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { getUserContext, printUserContextErrorAndExit } from './lib/user-context.mjs';

export { applyInboxSkip, jobUrlFromRest, postingUrl };

/** Exit statuses besides 0 (changed) and 1 (error). */
export const SKIP_EXIT = Object.freeze({ UNCHANGED: 3, NOT_PENDING: 4 });

/**
 * Skip (`done` true) or restore one Pending row under the pipeline lock. See
 * setInboxSkip in lib/inbox-skip.mjs; this passes it the core's lock.
 *
 * @param {string} pipelinePath absolute path to pipeline.md
 * @param {string} url posting URL
 * @param {boolean} done
 * @param {{ timeoutMs?: number, retryMs?: number, maxWaitMs?: number }} [lockOptions]
 *   passed to withPipelineLock; the defaults and their env overrides are its own
 */
export function setInboxSkip(pipelinePath, url, done, lockOptions = {}) {
  return setInboxSkipWithLock(pipelinePath, url, done, withPipelineLock, lockOptions);
}

// ── CLI entry point ────────────────────────────────────────────────────────

if (isMainModule(import.meta.url)) {
  const USAGE = 'Usage: node inbox-skip.mjs --user <id> --url <url> [--undo] [--pipeline <path>]\n'
    + '  Skips the Pending row of the user\'s data/pipeline.md whose first cell is <url> ("- [ ]" becomes "- [x]").\n'
    + '  --undo      flip it back to "- [ ]"\n'
    + '  --pipeline  the pipeline file (default: data/pipeline.md under the user\'s data root)\n'
    + '  Exit status: 0 changed, 3 nothing to change, 4 no Pending row with that URL first\n'
    + '  (or no pipeline.md), 1 other errors.';
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }
  let args;
  try {
    const ctx = getUserContext(rawArgs);
    args = ctx.args;
    process.env.CAREER_OPS_USER = ctx.userId;
  } catch (error) {
    printUserContextErrorAndExit(error);
  }
  const VALUE_FLAGS = ['--url', '--pipeline'];
  // A mistyped --undo must not fall through to a Skip.
  validateFlags(args, ['--undo', ...VALUE_FLAGS, '--help', '-h'], USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  const url = hasFlag(args, '--url') ? flagValue(args, '--url') : undefined;
  if (!url) {
    console.error(`Missing --url.\n${USAGE}`);
    process.exit(1);
  }
  const undo = hasFlag(args, '--undo');
  const pipeline = hasFlag(args, '--pipeline')
    ? resolve(flagValue(args, '--pipeline'))
    : join(getCareerOpsRoot(), 'data', 'pipeline.md');

  let result;
  try {
    result = await setInboxSkip(pipeline, url, !undo);
  } catch (err) {
    console.error(`Could not ${undo ? 'undo the skip' : 'skip the row'}: ${err?.message ?? err}`);
    process.exit(1);
  }

  if (result.ok && result.changed > 0) {
    console.log(undo ? `Back in Pending: ${url}` : `Skipped: ${url}`);
    process.exit(0);
  }
  if (result.ok) {
    console.log(undo ? `Not skipped, nothing to undo: ${url}` : `Already skipped, nothing changed: ${url}`);
    process.exit(SKIP_EXIT.UNCHANGED);
  }
  switch (result.error) {
    case 'invalid-url':
      console.error(`--url must be an http(s) posting URL: ${url}`);
      process.exit(1);
      break;
    case 'busy':
      console.error(`${pipeline} is being written by another command right now. Try again.`);
      process.exit(1);
      break;
    case 'not-found':
      console.error(`No pipeline file at ${pipeline}; nothing changed.`);
      process.exit(SKIP_EXIT.NOT_PENDING);
      break;
    default:
      console.error(`No Pending row in ${pipeline} has this URL as its first cell after the checkbox: ${url}`);
      process.exit(SKIP_EXIT.NOT_PENDING);
  }
}
