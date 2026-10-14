import { fileURLToPath } from 'url';
import { loadCanonicalStates, resolveCanonicalStateId } from '../tracker-utils.mjs';

const states = loadCanonicalStates(fileURLToPath(new URL('../templates/states.yml', import.meta.url)));
const STATUS_RANK = new Map([
  ['skip', 0], ['closed', 0], ['discarded', 0], ['evaluated', 1],
  ['applied', 2], ['rejected', 3], ['responded', 4], ['assessment', 4.5],
  ['interview', 5], ['offer', 6], ['hired', 7],
]);

export function normalizeDuplicateStatus(status) {
  return String(status || '')
    .replace(/\*\*/g, '')
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '')
    .trim()
    .toLowerCase();
}

export function duplicateStatusRank(status) {
  return STATUS_RANK.get(resolveCanonicalStateId(status, states)) ?? 0;
}

export function mostAdvancedDuplicateRow(rows, keeperNum) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) =>
      duplicateStatusRank(right.row.status) - duplicateStatusRank(left.row.status) ||
      Number(right.row.num === keeperNum) - Number(left.row.num === keeperNum) ||
      left.index - right.index)[0].row;
}
