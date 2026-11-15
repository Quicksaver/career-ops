import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { withPipelineLock } from '../pipeline-lock.mjs';
import { writeFileAtomic } from '../tracker-utils.mjs';
import { normalizeTsvCell, parseBatchInput, parseBatchState, parsePendingRows, serializeBatchInput } from './pipeline-queue.mjs';

/** Exit statuses of a --url sync besides 0 (queued) and 1 (error). */
export const URL_EXIT = Object.freeze({ ALREADY_QUEUED: 3, NOT_PENDING: 4 });

// The same posting URL in two spellings (host case, a default port) is one row.
function sameUrl(a, b) {
  if (a === b) return true;
  try { return new URL(a).href === new URL(b).href; } catch { return false; }
}

// onlyUrl selects one Pending row (the dashboard Inbox `e` key, #5269): the
// first row with that URL gets the same ID recovery and conflict checks as a
// full sync. A pipeline without such a row returns status `not_pending`.
export async function synchronizeBatch({ userRoot, user, pipelinePath, dryRun = false, onlyUrl = null }) {
  const inputPath = join(userRoot, 'batch/batch-input.tsv');
  const statePath = join(userRoot, 'batch/batch-state.tsv');
  const synchronize = () => {
    if (!existsSync(pipelinePath)) {
      if (onlyUrl) return { status: 'not_pending', user, url: onlyUrl, dry_run: dryRun };
      throw new Error(`Pipeline not found: ${pipelinePath}`);
    }

    const allPending = parsePendingRows(readFileSync(pipelinePath, 'utf-8')).rows;
    const pending = onlyUrl ? allPending.filter((row) => sameUrl(row.url, onlyUrl)).slice(0, 1) : allPending;
    if (onlyUrl && pending.length === 0) return { status: 'not_pending', user, url: onlyUrl, dry_run: dryRun };
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
        status: 'failed', user, error: 'batch input/state ID conflicts detected',
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
      user,
      pending: allPending.length,
      ...(onlyUrl ? { selected: pending.length } : {}),
      existing: existing.length,
      added: additions.length,
      additions,
      duplicate_input_urls: duplicateInputUrls,
      state_rows: state.length,
      dry_run: dryRun,
    };
    return result;
  };
  return dryRun ? synchronize() : withPipelineLock(inputPath, synchronize);
}
