import { EventEmitter } from 'node:events';
import { emitKeypressEvents } from 'node:readline';
import { cleanRunText as clean, createRunOutput, runLineTone } from './run-output.mjs';

const ESC = '\x1b[';
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const chars = text => [...segments.segment(text)].map(item => item.segment);
function width(char) {
  if (/^\p{Mark}+$/u.test(char)) return 0;
  return /[\p{Extended_Pictographic}\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(char) ? 2 : 1;
}
function clip(text, columns) {
  let result = '', used = 0;
  for (const char of chars(clean(text))) {
    const size = width(char);
    if (used + size > columns) break;
    result += char; used += size;
  }
  return result;
}
const questionDisplay = question => question ? JSON.stringify([
  question.key, question.position, question.total, question.title, question.url,
  question.question, question.hint, question.multiline,
]) : null;

/** The only writer to the interactive terminal. Child streams remain piped. */
export class RunTerminal extends EventEmitter {
  constructor({ input = process.stdin, output = process.stdout, color, env = process.env } = {}) {
    super();
    if (!input.isTTY || !output.isTTY) throw new Error('Interactive run requires an input and output terminal');
    this.input = input; this.output = output;
    this.colors = createRunOutput({ stream: output, env, color });
    this.draft = []; this.cursor = 0; this.question = null;
    this.footerTop = null;
    this.status = 'Starting workflow'; this.message = ''; this.closed = false; this.busy = false;
    this.wasRaw = Boolean(input.isRaw);
    this.onKey = (text, key) => this.key(text, key);
    this.onResize = () => { this.clearFooter(); this.render(); };
    this.onEnd = () => this.emit('leave');
    emitKeypressEvents(input);
    input.setRawMode(true); input.resume();
    input.on('keypress', this.onKey); input.on('end', this.onEnd);
    output.on('resize', this.onResize);
    this.render();
  }
  get columns() { return Math.max(12, this.output.columns || 80); }
  get rows() { return Math.max(4, this.output.rows || 24); }
  get footerRows() { return this.question ? Math.min(7, this.rows - 2) : 0; }
  get logBottom() { return this.rows - this.footerRows; }
  setStatus(text) { if (this.status !== text) { this.status = text; this.render(); } }
  setQuestion(question) {
    const displayChanged = questionDisplay(this.question) !== questionDisplay(question);
    const changed = this.question?.key !== question?.key;
    if (changed) { this.draft = []; this.cursor = 0; this.message = ''; }
    this.question = question;
    if (changed && question) this.log(`Question: ${question.question}\n${question.url || ''}`);
    else if (displayChanged) this.render();
  }
  error(message) {
    this.message = message; this.busy = false;
    if (this.question) this.render();
    else this.log(`Error: ${message}`);
  }
  log(message) {
    if (this.closed) { this.output.write(`${this.colors.format(message)}\n`); return; }
    if (!this.question) {
      this.clearFooter();
      for (const line of String(message).split(/\r?\n/)) this.output.write(`${this.colors.format(line)}\r\n`);
      return;
    }
    if (this.footerTop === null) this.render();
    this.output.write(`${ESC}1;${this.logBottom}r${ESC}${this.logBottom};1H`);
    for (const line of String(message).split(/\r?\n/)) {
      const tone = runLineTone(line);
      let remaining = chars(clean(line));
      do {
        const part = clip(remaining.join(''), this.columns - 1);
        this.output.write(`${this.colors.format(part, tone)}\r\n`);
        remaining = remaining.slice(chars(part).length);
      } while (remaining.length);
    }
    this.render();
  }
  clearFooter() {
    if (this.footerTop === null) return;
    this.output.write(`${ESC}r${ESC}${Math.min(this.footerTop, this.rows)};1H${ESC}J${ESC}?2004l${ESC}?25h`);
    this.footerTop = null;
  }
  render() {
    if (this.closed) return;
    const question = this.question;
    if (!question) { this.clearFooter(); return; }
    if (this.footerTop === null) {
      // Make room without painting over the most recent rolling output.
      this.output.write(`${ESC}?2004h${'\r\n'.repeat(this.footerRows)}`);
    }
    this.footerTop = this.logBottom + 1;
    const before = this.draft.slice(0, this.cursor).join('').split('\n').at(-1);
    const after = this.draft.slice(this.cursor).join('').split('\n')[0];
    const preceding = chars(before);
    let start = preceding.length, used = 0;
    while (start > 0 && used + width(preceding[start - 1]) <= this.columns - 5) used += width(preceding[--start]);
    const visibleBefore = preceding.slice(start);
    const prompt = `> ${visibleBefore.join('')}`;
    const shortcuts = this.columns >= 98
      ? 'Enter: answer | Ctrl+D: JD/empty defer | /later: defer | /finish: drain & exit | Ctrl+C: stop'
      : 'Enter answer | Ctrl+D JD/empty defer | /finish exit | Ctrl+C stop';
    const lines = [
      `run | ${this.status}`,
      `Question ${question.position}/${question.total}: ${question.title}`,
      question.url || '',
      question.question || '',
      `${question.multiline ? `${this.draft.join('').split('\n').length} line(s) | ` : ''}${this.message || question.hint || 'Empty Ctrl+D defers. /finish drains active work and exits.'}`,
      this.busy ? 'Saving answer...' : prompt + after,
      shortcuts,
    ].map((text, index) => ({ text, tone: ['progress', 'question', 'link', 'question', this.message ? 'error' : 'muted', this.busy ? 'progress' : 'input', 'muted'][index] }));
    // Keep shortcuts below the input, including when a short terminal omits details.
    const shown = this.footerRows < 7 ? [lines[0], lines[1], ...lines.slice(3)].slice(-this.footerRows) : lines;
    this.output.write(`${ESC}1;${this.logBottom}r`);
    shown.forEach((line, index) => this.output.write(`${ESC}${this.logBottom + index + 1};1H${ESC}2K${this.colors.paint(clip(line.text, this.columns - 1), line.tone)}`));
    const inputIndex = shown.length - 2;
    const cursorColumn = question && !this.busy ? Math.min(this.columns - 1, 1 + chars(prompt).reduce((n, c) => n + width(c), 0)) : 1;
    this.output.write(`${ESC}${this.logBottom + inputIndex + 1};${cursorColumn}H${ESC}?25h`);
  }
  async submit(text = this.draft.join('')) {
    if (!this.question || this.busy) return;
    if (!text.trim()) { this.error('Enter an answer, or /later to defer.'); return; }
    this.busy = true; this.message = ''; this.render();
    try { await this.question.submit(text); }
    catch (error) { this.error(error.message); }
    finally { this.busy = false; this.render(); }
  }
  key(text, key = {}) {
    if (this.closed) return;
    if (key.sequence === '\x1b[200~') { this.pasting = true; return; }
    if (key.sequence === '\x1b[201~') { this.pasting = false; return; }
    if (this.pasting) {
      if (text === '\n' && this.pasteCR) { this.pasteCR = false; return; }
      this.pasteCR = text === '\r';
    }
    if (key.ctrl && key.name === 'c') { this.emit('interrupt'); return; }
    if (key.ctrl && key.name === 'd') {
      if (this.busy) return;
      if (this.question) void this.submit(this.draft.join('').trim() ? this.draft.join('') : '/later');
      else this.emit('leave');
      return;
    }
    if (!this.question || this.busy) return;
    if (key.ctrl && key.name === 'u') { this.draft = []; this.cursor = 0; }
    else if (key.name === 'left') this.cursor = Math.max(0, this.cursor - 1);
    else if (key.name === 'right') this.cursor = Math.min(this.draft.length, this.cursor + 1);
    else if (key.name === 'home' || key.ctrl && key.name === 'a') this.cursor = 0;
    else if (key.name === 'end' || key.ctrl && key.name === 'e') this.cursor = this.draft.length;
    else if (key.name === 'backspace' && this.cursor) this.draft.splice(--this.cursor, 1);
    else if (key.name === 'delete') this.draft.splice(this.cursor, 1);
    else if (key.name === 'return' || key.name === 'enter') {
      const value = this.draft.join('').trim();
      if (!this.pasting && (!this.question.multiline || /^https?:\/\//i.test(value) && !value.includes('\n') || ['/later', '/finish'].includes(value))) void this.submit();
      else { this.draft.splice(this.cursor, 0, '\n'); this.cursor++; }
    } else if (text && !key.ctrl && !key.meta && !text.startsWith('\x1b')) {
      if (this.draft.length >= 500000) { this.error('Input is too large. Use an employer URL instead.'); return; }
      const inserted = chars(text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ''));
      this.draft.splice(this.cursor, 0, ...inserted); this.cursor += inserted.length;
    }
    if (!this.renderPending) {
      this.renderPending = true;
      setImmediate(() => { this.renderPending = false; this.render(); });
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.input.off('keypress', this.onKey); this.input.off('end', this.onEnd);
    this.output.off('resize', this.onResize);
    this.input.setRawMode(this.wasRaw); this.input.pause();
    this.clearFooter();
  }
}
