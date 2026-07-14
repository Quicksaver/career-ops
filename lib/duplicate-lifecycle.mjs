const STATUS_RANK = new Map([
  ['skip', 0], ['closed', 0], ['discarded', 0],
  ['evaluated', 1], ['applied', 2], ['rejected', 3], ['responded', 4],
  ['interview', 5], ['offer', 6], ['hired', 7],
  ['no aplicar', 0], ['no_aplicar', 0], ['cerrada', 0], ['cancelada', 0],
  ['descartado', 0], ['descartada', 0], ['evaluada', 1], ['condicional', 1],
  ['aplicado', 2], ['enviada', 2], ['aplicada', 2],
  ['rechazado', 3], ['rechazada', 3], ['respondido', 4],
  ['entrevista', 5], ['oferta', 6],
  ['contratado', 7], ['contratada', 7], ['accepted', 7], ['accept', 7],
]);

export function normalizeDuplicateStatus(status) {
  return String(status || '')
    .replace(/\*\*/g, '')
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '')
    .trim()
    .toLowerCase();
}

export function duplicateStatusRank(status) {
  return STATUS_RANK.get(normalizeDuplicateStatus(status)) ?? 0;
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
