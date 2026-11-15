#!/usr/bin/env node

import { resolve } from 'path';
import { synchronizeBatch, URL_EXIT } from './lib/run-batch-sync.mjs';
import {
  getUserContext,
  printUserContextErrorAndExit,
  userPath,
} from './lib/user-context.mjs';

let context;
try {
  context = getUserContext(process.argv.slice(2));
} catch (error) {
  printUserContextErrorAndExit(error);
}

const USAGE = `Usage: node sync-pipeline-batch.mjs --user <id> [--dry-run] [--json] [--url <url>]
Append live pipeline Pending rows to the user batch input with stable IDs.
  --url <url>  queue only the Pending row with this posting URL. Exit status:
               0 queued, 3 already in batch-input.tsv (nothing to queue),
               4 not an unchecked Pending row whose URL is the first cell after "- [ ] ", 1 other errors.`;

const args = context.args;
if (args.includes('-h') || args.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}
let dryRun = false;
let json = false;
let onlyUrl = null;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--dry-run') dryRun = true;
  else if (arg === '--json') json = true;
  else if (arg === '--url' || arg.startsWith('--url=')) {
    const value = arg === '--url' ? args[++i] : arg.slice('--url='.length);
    if (!value || value.startsWith('--')) {
      console.error('Missing value for --url');
      process.exit(1);
    }
    onlyUrl = value;
  } else {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
}

const pipelinePath = process.env.CAREER_OPS_PIPELINE
  ? resolve(context.projectRoot, process.env.CAREER_OPS_PIPELINE)
  : userPath(context, 'data/pipeline.md');

const result = await synchronizeBatch({ userRoot: context.userRoot, user: context.userId, pipelinePath, dryRun, onlyUrl });
const alreadyQueued = onlyUrl && result.status === 'completed' && result.added === 0;
if (json) console.log(JSON.stringify(result));
else if (result.status === 'failed') {
  console.error(`Batch sync failed: ${result.error}`);
  for (const conflict of result.state_conflicts) {
    console.error(`  #${conflict.id}: state ${conflict.state_url} conflicts with input ${conflict.input_url}`);
  }
}
else if (result.status === 'not_pending') {
  console.error(`Not an unchecked Pending row in ${pipelinePath}: ${onlyUrl} (the URL must be the first cell after "- [ ] ")`);
}
else if (alreadyQueued) {
  console.log(`${onlyUrl} is already in batch-input.tsv — nothing to queue.`);
}
else {
  console.log(`Pending pipeline rows: ${result.pending}${onlyUrl ? ', 1 selected with --url' : ''}`);
  console.log(`Batch rows added: ${result.added}${dryRun ? ' (dry run)' : ''}`);
  if (result.duplicate_input_urls.length) console.log(`Warnings: ${result.duplicate_input_urls.length} duplicate batch-input URL(s)`);
  if (onlyUrl && !dryRun) console.log(`Run \`./batch/batch-runner.sh --user ${context.userId}\` to evaluate it.`);
}
if (result.status === 'failed') process.exitCode = 1;
else if (result.status === 'not_pending') process.exitCode = URL_EXIT.NOT_PENDING;
else if (alreadyQueued) process.exitCode = URL_EXIT.ALREADY_QUEUED;
else process.exitCode = 0;
