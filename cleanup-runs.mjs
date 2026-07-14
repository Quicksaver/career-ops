#!/usr/bin/env node

import {
  getUserContext,
  printUserContextErrorAndExit,
} from './lib/user-context.mjs';
import { cleanupExpiredRuns, RUN_RETENTION_DAYS } from './lib/run-artifacts.mjs';

const HELP = `career-ops run artifact cleanup

Usage: ./cleanup-runs.mjs --user <id> [options]

Options:
  --json                Emit the complete machine-readable result
  -h, --help            Show this help

Deletes timestamped run directories older than ${RUN_RETENTION_DAYS} days from
the active user's data/verify-runs and data/go-runs directories. Cleanup is
skipped while another go or verify runner is active for that user.`;

let context;
try {
  context = getUserContext(process.argv.slice(2));
} catch (error) {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    console.log(HELP);
    process.exit(0);
  }
  printUserContextErrorAndExit(error);
}

const rawArgs = context.args;
if (rawArgs.includes('-h') || rawArgs.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}
for (const arg of rawArgs) {
  if (arg !== '--json') throw new Error(`Unknown option: ${arg}`);
}

const result = cleanupExpiredRuns({ userRoot: context.userRoot });
const output = { user: context.userId, ...result };
if (rawArgs.includes('--json')) {
  console.log(JSON.stringify(output));
} else if (result.status === 'skipped') {
  const owners = result.active_runners.map(item => `${item.lock} PID ${item.pid}`).join(', ');
  console.log(`[cleanup:runs] skipped for ${context.userId}: active runner (${owners})`);
} else {
  const byKind = result.deleted.reduce((counts, item) => {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
    return counts;
  }, {});
  console.log(
    `[cleanup:runs] deleted ${result.deleted_runs} run(s) older than ${RUN_RETENTION_DAYS} days ` +
    `(verify ${byKind.verify || 0}, go ${byKind.go || 0}); freed ${result.deleted_human}`,
  );
}
