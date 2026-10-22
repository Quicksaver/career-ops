import { stripVTControlCharacters } from 'node:util';

// Child output and job content never supply terminal controls. Only the
// presentation layer adds SGR, after sanitising and measuring plain text.
export function cleanRunText(text) {
  return stripVTControlCharacters(String(text)).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const runChars = text => [...graphemes.segment(text)].map(item => item.segment);
export function runCharWidth(char) {
  if (/^\p{Mark}+$/u.test(char)) return 0;
  return /[\p{Extended_Pictographic}ᄀ-ᅟ〈〉⺀-꓏가-힣豈-﫿︐-﹯！-｠￠-￦]/u.test(char) ? 2 : 1;
}
export const runTextWidth = text => runChars(cleanRunText(text)).reduce((sum, char) => sum + runCharWidth(char), 0);

// "[run] scan started" or "[run:scan] [scan-progress] started 3/9: Acme via lever".
const STARTED_STEP = /^((?:\[[^\]]+\] )+)(?:([\w.-]+) started|started \d+\/(\d+): (.+))$/;

/** Whether `line` reports the outcome of the step that `previous` started. */
export function finishesRunStep(previous, line) {
  const started = previous == null ? null : STARTED_STEP.exec(cleanRunText(previous));
  const text = cleanRunText(line);
  if (!started || !text.startsWith(started[1])) return false;
  const body = text.slice(started[1].length);
  if (started[2]) return body === `${started[2]} completed` || body === `${started[2]} failed`;
  // Parallel scans finish out of order, so the counters differ; the subject must not.
  const finished = /^(?:completed|failed) \d+\/(\d+): (.+)$/.exec(body);
  return Boolean(finished) && finished[1] === started[3]
    && (finished[2] === started[4] || finished[2].startsWith(`${started[4]} — `));
}

export function supportsRunColor(stream, env = process.env) {
  return Boolean(stream?.isTTY) && !Object.hasOwn(env, 'NO_COLOR')
    && env.FORCE_COLOR !== '0' && env.TERM !== 'dumb';
}

export function runLineTone(line) {
  const text = cleanRunText(line).trim();
  const prefixes = /^(?:\[[^\]]+\]\s*)+/.exec(text)?.[0] || '';
  const tags = [...prefixes.matchAll(/\[([^\]]+)\]/g)].map(match => match[1].toLowerCase());
  const content = text.slice(prefixes.length);
  const body = content.replace(/^(?:===|---)\s*/, '');
  if (tags.some(tag => /^(?:error|fatal|fail|failed)$/.test(tag))) return 'error';
  if (tags.some(tag => /^(?:warn|warning|hold|paused|blocked)$/.test(tag))) return 'warning';
  const summary = /^summary:\s*(\w+)/i.exec(body);
  if (summary) return /^completed$/i.test(summary[1]) ? 'success'
    : /^(failed|interrupted)$/i.test(summary[1]) ? 'error' : 'warning';
  const errors = /^(?:Network errors|Errors)(?::|\s*\()\s*(\d+)/i.exec(body);
  if (errors) return Number(errors[1]) > 0 ? 'error' : 'muted';
  if (/^(?:error\b|fatal\b|fail(?:ed|ure)?\b|unresolved error\b|❌|✗)/i.test(body)
    || /^(?:job|worker|offer)\s+#?\d+\s+failed\b/i.test(body)
    || /^[\w-]+(?: [\w-]+){0,3} failed\b/i.test(body)) return 'error';
  if (/^(?:warn(?:ing)?\b|hold\b|paused\b|rate limited\b|batch paused\b|action required\b|manual\b|incomplete\b|unresolved\b|question:|⚠|⛔)/i.test(body)
    || /^\S+ incomplete\b/i.test(body)) return 'warning';
  if (/^(?:skip\b|skipped\b|closed\b|⏭|logs:|already seen:|filtered out:)/i.test(body)) return 'muted';
  if (/^(?:completed\b|done\b|success\b|session active\b|login successful\b|added\b|wrote\b|✅|✓)/i.test(body)
    || /^\S+ completed\b/i.test(body)) return 'success';
  if (/^(?:started\b|starting\b|launching\b|checking\b|scanning\b|processing\b|batch queue pass\b|── Search\b)/i.test(body)
    || /^\S+ started\b/i.test(body)) return 'progress';
  if (/^[\w-]+ (?:processed|added|recovered|saved|merged|reconciled)\b/i.test(body)) return 'success';
  if (/^[\w-]+ (?:queued|task|assigned|reviewed|waiting)\b/i.test(body)) return 'progress';
  if (/^[\w-]+ skipped\b/i.test(body)) return 'muted';
  if (/^(?:queue\b|discovered:|verification:|total jobs found:|new offers added:|listings found:|JDs saved:|searches run:)/i.test(body)) return 'progress';
  // Every child phase gets a presentation style, including new scripts and
  // free-form agent progress such as "[handoff-progress] 1/20: Company".
  // Namespaces route display only; familiar severity/outcome cues above win.
  if (/^(?:===|---)/.test(content) || tags.some(tag => tag !== 'run')) return 'progress';
  return 'normal';
}

const styles = Object.freeze({
  progress: '36', success: '32', warning: '33', error: '1;31',
  muted: '2', question: '1;33', input: '1;32', link: '4;36',
  identity: '1', count: '1;36', id: '1;35', key: '1;36',
});

// Mark only meaningful fields. Unmarked prose keeps the terminal's normal
// foreground, including explanations on error lines. URLs/paths are protected
// first so a job slug such as "failed-engineer-429" never looks like an error.
function lineSpans(text, tone, kind) {
  const spans = [];
  const boundaries = new Set([...graphemes.segment(text)].map(segment => segment.index));
  boundaries.add(text.length);
  const mark = (start, end, style) => {
    if (end > start && boundaries.has(start) && boundaries.has(end)
      && !spans.some(span => start < span.end && end > span.start)) spans.push({ start, end, style });
  };
  const match = (regex, style) => {
    for (const m of text.matchAll(regex)) mark(m.index, m.index + m[0].length, style);
  };
  if (kind === 'input') {
    if (text.startsWith('> ')) mark(0, 1, 'input');
    return spans; // Pasted answers are user data, not status messages.
  }
  match(/https?:\/\/[^\s<>"`]+/gi, 'link');
  match(/(?:[A-Za-z]:[\\/]|\\\\)[^\s|,;]+|\b(?:users|reports|output|batch|data|jds|logs|runs|templates)\/[\w./\\-]+|\b[\w.-]+\.(?:mjs|sh|jsonl?|log|tsv|ya?ml|md|pdf|html)\b/gi, 'muted');
  const logPath = /\b(?:logs?|path|artifacts):\s+(.+)$/i.exec(text);
  if (logPath && /^(?:[A-Za-z]:[\\/]|\/|\.\/|users\/)/.test(logPath[1])) {
    // A labelled path may contain spaces. Replace shorter path fragments.
    const start = logPath.index + logPath[0].indexOf(logPath[1]);
    for (let i = spans.length - 1; i >= 0; i--) if (spans[i].start >= start && spans[i].style !== 'link') spans.splice(i, 1);
    mark(start, text.length, 'muted');
  }
  match(/#\d+\b/g, 'id');
  match(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?\b|\b\d+(?:\.\d+)?\s*(?:ms|seconds?|secs?|s|minutes?|mins?|MB|GB|KiB|MiB)\b/gi, 'muted');
  if (kind === 'shortcuts' || kind === 'hint') {
    match(/\bCtrl\+[A-Z]\b|\bEnter\b|\bretry\b|\/(?:skip|later|finish|direct)\b/gi, 'key');
  }
  if (kind === 'error') {
    const leading = /^\S+/.exec(text);
    if (leading) mark(0, leading[0].length, 'error');
  }
  if (kind === 'question-title') {
    const heading = /^(Question\s+)(\d+\/\d+)(:\s*)(.*)$/.exec(text);
    if (heading) {
      mark(0, heading[1].length, 'muted');
      mark(heading[1].length, heading[1].length + heading[2].length, 'count');
      mark(heading[1].length + heading[2].length + heading[3].length, text.length, 'question');
    }
  }
  const prefix = /^(?:\[[^\]]+\]\s*)+/.exec(text)?.[0] || '';
  for (const m of prefix.matchAll(/\[([^\]]+)\]/g)) {
    const colon = m[1].startsWith('run:') ? m[1].indexOf(':') : -1;
    const tagTone = /^(?:error|fatal|failed)$/i.test(m[1]) ? 'error'
      : /^(?:warn|warning|hold|paused|blocked)$/i.test(m[1]) ? 'warning' : 'progress';
    if (m[1] === 'run') mark(m.index, m.index + m[0].length, 'muted');
    else {
      const start = m.index + 1 + (colon < 0 ? 0 : colon + 1);
      mark(m.index, start, 'muted');
      mark(start, m.index + m[0].length - 1, tagTone);
      mark(m.index + m[0].length - 1, m.index + m[0].length, 'muted');
    }
  }
  const body = text.slice(prefix.length);
  const phase = /^(?:===\s*)?([\w.-]+)\s+(?:started|completed|failed|queued|task|processed|added|reviewed|incomplete)\b/i.exec(body);
  if (phase) {
    const start = prefix.length + phase[0].indexOf(phase[1]);
    mark(start, start + phase[1].length, 'identity');
  }
  for (const m of text.matchAll(/\b(?:Company|Role|Provider|Board|Source|Model|CLI|User|Via):\s+([^|]+?)(?=\s+[—–]|\s*\||$)/gi)) {
    const start = m.index + m[0].length - m[1].length;
    mark(start, start + m[1].trimEnd().length, 'identity');
  }
  // Counter meanings are local to each field, never inherited from the line.
  // "Completed: 8 | Failed: 0 | Pending: 2" must show three distinct outcomes.
  const metricTone = (label, value) => {
    if (Number(value) === 0) return 'muted';
    if (/fail|error/i.test(label)) return 'error';
    if (/blocked|hold|held|confirmation|paused|unresolved|warning/i.test(label)) return 'warning';
    if (/complet|added|saved|repaired|recovered|merged|processed/i.test(label)) return 'success';
    if (/skip|closed|seen|filtered/i.test(label)) return 'muted';
    return 'count';
  };
  const labels = 'needs confirmation|rate limited|already seen|filtered out|JDs saved|searches run|listings found|total jobs found|queue now|completed|failed|errors?|pending|processing|skipped|closed|paused|added|remaining|reviewed|repaired|unresolved|seen|total|blocked|held|working|questions|queued|processed|recovered|merged';
  for (const m of text.matchAll(new RegExp(`\\b(${labels})(:?\\s+)(\\d+(?:,\\d{3})*(?:\\.\\d+)?(?:/\\d+(?:,\\d{3})*)?)\\b`, 'gi'))) {
    const start = m.index + m[1].length + m[2].length;
    mark(start, start + m[3].length, metricTone(m[1], m[3]));
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d+(?:,\\d{3})*)\\s+(${labels})\\b`, 'gi'))) mark(m.index, m.index + m[1].length, metricTone(m[2], m[1]));
  // Task/company names after a progress counter are the subject of the line.
  const subject = /\b(?:\d+\/\d+|task\s+\d+):\s+([^|]+?)(?=\s+\(|\s+[—–]|$)/i.exec(body);
  if (subject) {
    const start = prefix.length + subject.index + subject[0].length - subject[1].length;
    mark(start, start + subject[1].length, 'identity');
  }
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?\/\d+(?:\.\d+)?\b|\b\d+(?:\.\d+)?%|\b\d+(?:,\d{3})*(?:\.\d+)?\b/g)) {
    mark(m.index, m.index + m[0].length, /^0(?:\.0+)?$/.test(m[0]) ? 'muted' : 'count');
  }
  const outcome = /\b(?:ERROR|WARN(?:ING)?|HOLD|SKIP|Closed|Completed|Failed|Started|Starting|Processing|Checking|Scanning|Queued|Added|Recovered|Saved|Merged|Reconciled|Done|Success|Partial|Interrupted|Waiting|Paused|Blocked|Unresolved|action required|needs confirmation)\b/gi;
  for (const m of body.matchAll(outcome)) {
    // Recognise diagnostics and outcome fields, not words inside job prose.
    const before = body.slice(0, m.index);
    if (!/^\s*(?:[✅✓❌✗⚠️⛔⏭]\s*)?(?:[\w.-]+\s+)?$/u.test(before)
      && !/^\s*(?:job|worker|offer)\s+#?\d+\s+$/i.test(before)
      && !/(?:[|;:]|===)\s*$/.test(before)) continue;
    const value = m[0].toLowerCase();
    const zeroCounter = /^:?\s+0(?:\.0+)?(?=\s|[|;,)]|$)/.test(body.slice(m.index + m[0].length));
    const style = zeroCounter ? 'muted' : /error|fail|interrupt/.test(value) ? 'error'
      : /warn|hold|partial|paused|blocked|unresolved|action required|confirmation/.test(value) ? 'warning'
      : /skip|closed/.test(value) ? 'muted'
      : /complet|added|recover|saved|merged|reconciled|done|success/.test(value) ? 'success' : 'progress';
    mark(prefix.length + m.index, prefix.length + m.index + m[0].length, style);
  }
  if (tone === 'error') match(/\b(?:worker-status-\w+|missing-report|missing-tracker|stale-processing-state)\b/g, 'error');
  match(/[|→]|(?:^|\s)(?:===|──+|---)(?=\s|$)/g, 'muted');
  return spans.sort((a, b) => a.start - b.start);
}

export function createRunOutput({ stream = process.stdout, env = process.env, color = supportsRunColor(stream, env) } = {}) {
  const paint = (text, tone = 'normal') => {
    const plain = cleanRunText(text);
    return color && Object.hasOwn(styles, tone) && plain ? `\x1b[${styles[tone]}m${plain}\x1b[0m` : plain;
  };
  return {
    paint,
    format(text, tone = runLineTone(text), { kind = 'log' } = {}) {
      const plain = cleanRunText(text);
      if (!color) return plain;
      const base = kind === 'shortcuts' || kind === 'hint' ? 'muted' : 'normal';
      let result = '', cursor = 0;
      for (const span of lineSpans(plain, tone, kind)) {
        result += paint(plain.slice(cursor, span.start), base) + paint(plain.slice(span.start, span.end), span.style);
        cursor = span.end;
      }
      return result + paint(plain.slice(cursor), base);
    },
  };
}
