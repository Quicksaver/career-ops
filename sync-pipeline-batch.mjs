#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
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

const pipelinePath = userPath(context, 'data/pipeline.md');
const inputPath = userPath(context, 'batch/batch-input.tsv');
const statePath = userPath(context, 'batch/batch-state.tsv');
if (!existsSync(pipelinePath)) {
  console.error(`Pipeline not found: ${pipelinePath}`);
  process.exit(1);
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
  console.log(JSON.stringify({
    status: 'failed', user: context.userId, error: 'batch input/state ID conflicts detected',
    state_conflicts: stateConflicts, dry_run: dryRun,
  }));
  process.exit(1);
}

if (!dryRun && additions.length) {
  mkdirSync(dirname(inputPath), { recursive: true });
  const temporary = `${inputPath}.tmp-${process.pid}`;
  writeFileSync(temporary, serializeBatchInput([...existing, ...additions]), 'utf-8');
  renameSync(temporary, inputPath);
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
if (json) console.log(JSON.stringify(result));
else {
  console.log(`Pending pipeline rows: ${pending.length}`);
  console.log(`Batch rows added: ${additions.length}${dryRun ? ' (dry run)' : ''}`);
  if (duplicateInputUrls.length) console.log(`Warnings: ${duplicateInputUrls.length} duplicate batch-input URL(s)`);
}
