import { stripVTControlCharacters } from 'node:util';

// Child output and job content never supply terminal controls. Only the
// presentation layer adds SGR, after sanitising and measuring plain text.
export function cleanRunText(text) {
  return stripVTControlCharacters(String(text)).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
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
});

export function createRunOutput({ stream = process.stdout, env = process.env, color = supportsRunColor(stream, env) } = {}) {
  const paint = (text, tone = 'normal') => {
    const plain = cleanRunText(text);
    return color && Object.hasOwn(styles, tone) && plain ? `\x1b[${styles[tone]}m${plain}\x1b[0m` : plain;
  };
  return {
    paint,
    format(text, tone = runLineTone(text)) {
      const plain = cleanRunText(text);
      const prefix = /^(\[run(?::[^\]]+)?\])(\s*)(.*)$/.exec(plain);
      return prefix ? paint(prefix[1], 'muted') + prefix[2] + paint(prefix[3], tone) : paint(plain, tone);
    },
  };
}
