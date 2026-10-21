import { processedHeadingFor, sectionKind } from './pipeline-sections.mjs';

const NEXT_HEADER = /^##\s+/;
const PENDING_ROW = /^\s*-\s*\[\s\]\s+(.+?)\s*$/;
const BLOCKED_ROW = /^\s*-\s*\[!\]\s+(.+?)\s*$/;

export function parsePendingRows(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const headerIndex = lines.findIndex((line) => sectionKind(line.trim()) === 'pending');
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

export function parseBlockedRows(text) {
  const parsed = parsePendingRows(text);
  const rows = [];
  if (parsed.headerIndex < 0) return { ...parsed, rows };
  for (let i = parsed.headerIndex + 1; i < parsed.endIndex; i++) {
    const match = parsed.lines[i].match(BLOCKED_ROW);
    if (!match) continue;
    const body = match[1].trim();
    const url = /^(https?:\/\/\S+|local:\S+)/i.exec(body)?.[0];
    if (!url) throw new Error(`Blocked pipeline row has no posting URL: ${body}`);
    const question = body.slice(url.length).replace(/^\s*[—–|:-]\s*/, '').trim() || 'Resolve the blocked posting before resuming.';
    rows.push({ lineIndex: i, line: parsed.lines[i], body, url,
      reason: /agency (?:confirmation|unconfirmed)|confirm (?:the )?(?:agency|intermediary)/i.test(question) ? 'agency_confirmation'
        : /JD unavailable|paste (?:the )?(?:JD|text)|login required|log[ -]?in|captcha|access denied|(?:HTTP\s*)?(?:401|403)\b|(?:fetch|extract).*(?:fail|unavailable)/i.test(question) ? 'jd_unavailable' : 'job_input',
      question,
    });
  }
  return { ...parsed, rows };
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
    const [id = '', url = '', status = '', startedAt = '', completedAt = '', reportNum = '', score = '', error = '', retries = '0'] = line.split('\t');
    if (!id || !url) continue;
    rows.push({ id, url, status, startedAt, completedAt, reportNum, score, error, retries });
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
  let processedIndex = remaining.findIndex((line) => sectionKind(line.trim()) === 'processed');
  if (processedIndex < 0) {
    while (remaining.length && remaining[remaining.length - 1] === '') remaining.pop();
    remaining.push('', processedHeadingFor((parsed.lines[parsed.headerIndex] ?? '').trim()), '', ...moved, '');
  } else {
    let insertAt = processedIndex + 1;
    while (insertAt < remaining.length && remaining[insertAt].trim() === '') insertAt++;
    remaining.splice(insertAt, 0, ...moved);
  }
  return { text: remaining.join('\n'), moved };
}
