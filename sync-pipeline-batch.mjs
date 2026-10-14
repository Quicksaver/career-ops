#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { withPipelineLock } from './pipeline-lock.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import {
  getUserContext,
  printUserContextErrorAndExit,
  userPath,
} from './lib/user-context.mjs';
import {
  normalizeTsvCell,
  parseBatchInput,
  parseBatchState,
  parsePendingRows,
  serializeBatchInput,
} from './lib/pipeline-queue.mjs';

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
const inputPath = userPath(context, 'batch/batch-input.tsv');
const statePath = userPath(context, 'batch/batch-state.tsv');
function synchronize() {
if (!existsSync(pipelinePath)) {
  throw new Error(`Pipeline not found: ${pipelinePath}`);
}

const pending = parsePendingRows(readFileSync(pipelinePath, 'utf-8')).rows;
const existing = existsSync(inputPath)
  ? parseBatchInput(readFileSync(inputPath, 'utf-8'))
  : [];
const state = existsSync(statePath)
  ? parseBatchState(readFileSync(statePath, 'utf-8'))
  : [];
const knownUrls = new Set(existing.map((row) => row.url));
const inputById = new Map(existing.map((row) => [row.id, row.url]));
const stateByUrl = new Map(state.map((row) => [row.url, row]));
const numericIds = [...existing, ...state].map((row) => Number.parseInt(row.id, 10)).filter(Number.isFinite);
let nextId = numericIds.length ? Math.max(...numericIds) + 1 : 1;
const additions = [];
const stateConflicts = [];

for (const row of pending) {
  if (!row.url || knownUrls.has(row.url)) continue;
  const notes = normalizeTsvCell(row.fields.join(' | '));
  const saved = stateByUrl.get(row.url);
  let id = saved?.id;
  if (id && inputById.has(id) && inputById.get(id) !== row.url) {
    stateConflicts.push({ id, state_url: row.url, input_url: inputById.get(id) });
    continue;
  }
  if (!id) id = String(nextId++);
  additions.push({ id, url: row.url, source: saved ? 'pipeline-recovered' : 'pipeline', notes });
  inputById.set(id, row.url);
  knownUrls.add(row.url);
}

const byUrl = new Map();
for (const row of existing) {
  const ids = byUrl.get(row.url) || [];
  ids.push(row.id);
  byUrl.set(row.url, ids);
}
const duplicateInputUrls = [...byUrl.entries()]
  .filter(([, ids]) => ids.length > 1)
  .map(([url, ids]) => ({ url, ids }));

if (stateConflicts.length) {
  const failure = {
    status: 'failed', user: context.userId, error: 'batch input/state ID conflicts detected',
    state_conflicts: stateConflicts, dry_run: dryRun,
  };
  return failure;
}

if (!dryRun && additions.length) {
  mkdirSync(dirname(inputPath), { recursive: true });
  writeFileAtomic(inputPath, serializeBatchInput([...existing, ...additions]));
}

const result = {
  status: 'completed',
  user: context.userId,
  pending: pending.length,
  existing: existing.length,
  added: additions.length,
  additions,
  duplicate_input_urls: duplicateInputUrls,
  state_rows: state.length,
  dry_run: dryRun,
};
return result;
}
const result = dryRun ? synchronize() : await withPipelineLock(inputPath, synchronize);
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
