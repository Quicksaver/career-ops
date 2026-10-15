#!/usr/bin/env node

import { resolve } from 'path';
import { synchronizeBatch } from './lib/run-batch-sync.mjs';
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

const args = context.args;
const dryRun = args.includes('--dry-run');
const json = args.includes('--json');
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: node sync-pipeline-batch.mjs --user <id> [--dry-run] [--json]');
  console.log('Append live pipeline Pending rows to the user batch input with stable IDs.');
  process.exit(0);
}
const unknown = args.filter((arg) => !['--dry-run', '--json'].includes(arg));
if (unknown.length) {
  console.error(`Unknown option: ${unknown[0]}`);
  process.exit(1);
}

const pipelinePath = process.env.CAREER_OPS_PIPELINE
  ? resolve(context.projectRoot, process.env.CAREER_OPS_PIPELINE)
  : userPath(context, 'data/pipeline.md');

const result = await synchronizeBatch({ userRoot: context.userRoot, user: context.userId, pipelinePath, dryRun });
if (json) console.log(JSON.stringify(result));
else if (result.status === 'failed') {
  console.error(`Batch sync failed: ${result.error}`);
  for (const conflict of result.state_conflicts) {
    console.error(`  #${conflict.id}: state ${conflict.state_url} conflicts with input ${conflict.input_url}`);
  }
}
else {
  console.log(`Pending pipeline rows: ${result.pending}`);
  console.log(`Batch rows added: ${result.added}${dryRun ? ' (dry run)' : ''}`);
  if (result.duplicate_input_urls.length) console.log(`Warnings: ${result.duplicate_input_urls.length} duplicate batch-input URL(s)`);
}
process.exitCode = result.status === 'failed' ? 1 : 0;
