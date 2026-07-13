import { readFileSync } from 'fs';

const PENDING_HEADER = /^##\s+(Pending|Pendientes)\s*$/i;
const PROCESSED_HEADER = /^##\s+(Processed|Procesadas)\s*$/i;
const NEXT_HEADER = /^##\s+/;
const PENDING_ROW = /^\s*-\s*\[\s\]\s+(.+?)\s*$/;

export function parsePendingRows(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const headerIndex = lines.findIndex((line) => PENDING_HEADER.test(line.trim()));
  if (headerIndex < 0) return { lines, headerIndex: -1, endIndex: -1, rows: [] };

  let endIndex = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (NEXT_HEADER.test(lines[i].trim())) {
      endIndex = i;
      break;
    }
  }

  const rows = [];
  for (let i = headerIndex + 1; i < endIndex; i++) {
    const match = lines[i].match(PENDING_ROW);
    if (!match) continue;
    const body = match[1].trim();
    const fields = body.split('|').map((field) => field.trim());
    const url = fields.shift() || '';
    rows.push({ lineIndex: i, line: lines[i], body, url, fields });
  }
  return { lines, headerIndex, endIndex, rows };
}

export function pendingCount(text) {
  return parsePendingRows(text).rows.length;
}

export function normalizeTsvCell(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

export function parseBatchInput(text) {
  const rows = [];
  for (const line of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim() || /^id\turl\t/i.test(line)) continue;
    const [id = '', url = '', source = '', notes = ''] = line.split('\t');
    if (!id || !url) continue;
    rows.push({ id, url, source, notes });
  }
  return rows;
}

export function parseBatchState(text) {
  const rows = [];
  for (const line of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim() || /^id\turl\tstatus\t/i.test(line)) continue;
    const [id = '', url = '', status = ''] = line.split('\t');
    if (!id || !url) continue;
    rows.push({ id, url, status });
  }
  return rows;
}

export function serializeBatchInput(rows) {
  const lines = ['id\turl\tsource\tnotes'];
  for (const row of rows) {
    lines.push([
      normalizeTsvCell(row.id),
      normalizeTsvCell(row.url),
      normalizeTsvCell(row.source),
      normalizeTsvCell(row.notes),
    ].join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

export function appendExpiredRows(text, expiredUrls) {
  const parsed = parsePendingRows(text);
  if (parsed.headerIndex < 0 || expiredUrls.size === 0) {
    return { text, moved: [] };
  }

  const moved = [];
  const removeIndexes = new Set();
  for (const row of parsed.rows) {
    if (!expiredUrls.has(row.url)) continue;
    removeIndexes.add(row.lineIndex);
    moved.push(`- [x] ~~${row.body}~~ — posting expired (liveness sweep)`);
  }
  if (moved.length === 0) return { text, moved };

  const remaining = parsed.lines.filter((_, index) => !removeIndexes.has(index));
  let processedIndex = remaining.findIndex((line) => PROCESSED_HEADER.test(line.trim()));
  if (processedIndex < 0) {
    while (remaining.length && remaining[remaining.length - 1] === '') remaining.pop();
    remaining.push('', '## Processed', '', ...moved, '');
  } else {
    let insertAt = processedIndex + 1;
    while (insertAt < remaining.length && remaining[insertAt].trim() === '') insertAt++;
    remaining.splice(insertAt, 0, ...moved);
  }
  return { text: remaining.join('\n'), moved };
}

export function readPendingFile(path) {
  return parsePendingRows(readFileSync(path, 'utf-8'));
}
