import { EventEmitter } from 'node:events';
import { emitKeypressEvents } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

const ESC = '\x1b[';
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const chars = text => [...segments.segment(text)].map(item => item.segment);
function clean(text) {
  return stripVTControlCharacters(String(text)).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}
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
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    super();
    if (!input.isTTY || !output.isTTY) throw new Error('Interactive run requires an input and output terminal');
    this.input = input; this.output = output;
    this.draft = []; this.cursor = 0; this.question = null;
    this.status = 'Starting workflow'; this.message = ''; this.closed = false; this.busy = false;
    this.wasRaw = Boolean(input.isRaw);
    this.onKey = (text, key) => this.key(text, key);
    this.onResize = () => this.render();
    this.onEnd = () => this.emit('leave');
    emitKeypressEvents(input);
    input.setRawMode(true); input.resume();
    input.on('keypress', this.onKey); input.on('end', this.onEnd);
    output.on('resize', this.onResize);
    output.write(`${ESC}?2004h`);
    this.render();
  }
  get columns() { return Math.max(12, this.output.columns || 80); }
  get rows() { return Math.max(4, this.output.rows || 24); }
  get footerRows() { return Math.min(7, this.rows - 2); }
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
  error(message) { this.message = message; this.busy = false; this.render(); }
  log(message) {
    if (this.closed) { this.output.write(`${clean(message)}\n`); return; }
    this.output.write(`${ESC}1;${this.logBottom}r${ESC}${this.logBottom};1H`);
    for (const line of String(message).split(/\r?\n/)) {
      let remaining = chars(clean(line));
      do {
        const part = clip(remaining.join(''), this.columns - 1);
        this.output.write(`${part}\r\n`);
        remaining = remaining.slice(chars(part).length);
      } while (remaining.length);
    }
    this.render();
  }
  render() {
    if (this.closed) return;
    const question = this.question;
    const before = this.draft.slice(0, this.cursor).join('').split('\n').at(-1);
    const after = this.draft.slice(this.cursor).join('').split('\n')[0];
    const preceding = chars(before);
    let start = preceding.length, used = 0;
    while (start > 0 && used + width(preceding[start - 1]) <= this.columns - 5) used += width(preceding[--start]);
    const visibleBefore = preceding.slice(start);
    const prompt = `> ${visibleBefore.join('')}`;
    const lines = [
      `run | ${this.status}`,
      question ? `Question ${question.position}/${question.total}: ${question.title}` : 'Processing; questions will appear here.',
      question?.url || '',
      question?.question || '',
      this.message || question?.hint || 'Ctrl+C stops safely. Ctrl+D leaves interactive mode.',
      this.busy ? 'Saving answer...' : question ? prompt + after : '',
      question?.multiline ? `${this.draft.join('').split('\n').length} line(s) | Ctrl+D submits | /later defers` : '',
    ];
    // Small terminals keep the question, instructions and input together.
    const shown = this.footerRows < 7 ? [lines[0], lines[1], lines[4], lines[5]].slice(-this.footerRows) : lines;
    this.output.write(`${ESC}1;${this.logBottom}r`);
    shown.forEach((line, index) => this.output.write(`${ESC}${this.logBottom + index + 1};1H${ESC}2K${clip(line, this.columns - 1)}`));
    const inputIndex = this.footerRows < 7 ? shown.length - 1 : 5;
    const cursorColumn = question && !this.busy ? Math.min(this.columns - 1, 1 + chars(prompt).reduce((n, c) => n + width(c), 0)) : 1;
    this.output.write(`${ESC}${this.logBottom + inputIndex + 1};${cursorColumn}H${ESC}?25h`);
  }
  async submit() {
    if (!this.question || this.busy) return;
    const text = this.draft.join('');
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
      if (this.question && this.draft.length) void this.submit();
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
      if (!this.pasting && (!this.question.multiline || /^https?:\/\//i.test(value) && !value.includes('\n') || value === '/later')) void this.submit();
      else { this.draft.splice(this.cursor, 0, '\n'); this.cursor++; }
    } else if (text && !key.ctrl && !key.meta && !text.startsWith('\x1b')) {
      if (this.draft.length >= 500000) { this.error('Input is too large. Use an employer URL instead.'); return; }
      const inserted = chars(text.replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ''));
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
    this.output.write(`${ESC}r${ESC}?2004l${ESC}${this.logBottom + 1};1H${ESC}J${ESC}?25h`);
  }
}
