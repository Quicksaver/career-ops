import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadAnswers, validUrl, isLinkedIn } from '../batch/manual-inputs.mjs';
import { queueActions, readRunBatchState, readRunQueue } from './run-queue.mjs';
import { writeFileAtomic } from '../tracker-utils.mjs';
import { DEFAULT_MAX_RETRIES } from './run-live-inputs.mjs';

const identity = action => JSON.stringify([action.kind, action.phase, action.url || action.id, action.reason]);

/** Human input stays here; batch consumes the existing validated answers API. */
export class RunInteractive extends EventEmitter {
  constructor({ terminal, userRoot, user, summary, answersFile, onRetry, onAnswer, canAsk = () => true }) {
    super();
    Object.assign(this, { terminal, userRoot, user, summary, onRetry, onAnswer, canAsk });
    this.path = join(userRoot, 'data/manual-answers.json');
    this.answers = existsSync(this.path) ? loadAnswers(this.path, user, userRoot) : [];
    for (const answer of loadAnswers(answersFile, user, userRoot)) {
      this.answers = this.answers.filter(item => item.url !== answer.url || item.reason !== answer.reason);
      this.answers.push(answer);
    }
    this.save(this.answers);
    this.settled = new Set(); this.tasks = new Set();
    this.active = true; this.error = null; this.revision = 0;
    this.onLeave = () => {
      if (!this.active) return;
      this.active = false; this.refreshSafely();
      this.terminal.log('run | finishing without input; active work will drain.');
    };
    terminal.on('leave', this.onLeave);
    this.refresh(false);
    // Supplied/persisted answers get a chance to run before asking again.
    for (const action of this.questions) if (this.answers.some(answer => answer.url === action.url && answer.reason === action.reason)) this.settled.add(action.key);
    this.refresh();
    this.timer = setInterval(() => this.refreshSafely(), 250);
  }
  refreshSafely() {
    try { this.refresh(); } catch (error) { this.error = error; this.active = false; this.emit('change'); }
  }
  save(answers) {
    const temporary = `${this.path}.validate-${process.pid}`;
    try {
      writeFileAtomic(temporary, JSON.stringify({ schema_version: 1, user: this.user, answers }, null, 2) + '\n');
      loadAnswers(temporary, this.user, this.userRoot);
      writeFileAtomic(this.path, readFileSync(temporary));
    } finally { rmSync(temporary, { force: true }); }
  }
  refresh(present = true) {
    const queue = readRunQueue(this.userRoot);
    const states = readRunBatchState(this.userRoot);
    const queued = new Set([...queue.pending, ...queue.blocked].map(row => row.url));
    const jobs = queueActions(this.userRoot, this.user);
    for (const state of states) {
      if (!queued.has(state.url) || !['failed', 'paused_rate_limit'].includes(state.status)) continue;
      if (state.status === 'failed' && Number(state.retries) < DEFAULT_MAX_RETRIES) continue;
      if (jobs.some(action => action.url === state.url)) continue;
      jobs.push({ kind: 'job', phase: 'batch', id: state.id, url: state.url,
        reason: state.status === 'failed' ? 'job_failed' : 'rate_limit',
        question: state.status === 'failed' ? `Job #${state.id} failed. Inspect its log, correct the cause, then retry. ${state.error || ''}` : 'Resolve the CLI quota/session limit, then retry.' });
    }
    const actions = [...this.summary.manual_actions.filter(action => action.kind !== 'job' && !(action.reason === 'rate_limit' && jobs.some(job => job.reason === 'rate_limit'))), ...jobs];
    this.summary.manual_actions = actions;
    const questions = actions.map(action => {
      const state = states.find(row => row.url === action.url);
      const hold = state && join(this.userRoot, 'batch/logs', `${state.id}.hold.json`);
      const generationPath = action.reason === 'rate_limit' ? null : hold;
      const stamp = generationPath && existsSync(generationPath) ? statSync(generationPath).mtimeMs : 0;
      return { ...action, key: `${identity(action)}:${action.attempt || 0}:${state?.startedAt || ''}:${state?.retries || ''}:${stamp}` };
    }).filter(action => !this.settled.has(action.key) && this.canAsk(action));
    this.questions = questions;
    const signature = JSON.stringify(actions);
    if (signature !== this.lastActions) {
      writeFileAtomic(join(this.userRoot, 'data/manual-actions.json'), JSON.stringify({ schema_version: 1, user: this.user, run_id: this.summary.run_id, updated_at: new Date().toISOString(), actions }, null, 2) + '\n');
      this.lastActions = signature;
    }
    const processing = states.filter(row => row.status === 'processing' && queued.has(row.url)).length;
    const question = this.active ? questions.find(action => action.key === this.currentKey) || questions[0] : null;
    this.currentKey = question?.key;
    if (present) this.terminal.setStatus(`${queue.pending.length} pending | ${processing} working | ${questions.length} questions${!this.active ? ' | finishing without input' : ''}`);
    if (present) this.terminal.setQuestion(question ? {
      ...question, position: questions.indexOf(question) + 1, total: questions.length,
      title: question.reason.replaceAll('_', ' '), multiline: question.reason === 'jd_unavailable',
      hint: question.reason === 'agency_confirmation' ? 'Agency name + Enter, /direct for direct employer, /later to defer.'
        : question.reason === 'jd_unavailable' ? 'Paste JD + Ctrl+D, or employer URL + Enter. Empty Ctrl+D skips this job; /later defers.'
        : question.reason === 'job_failed' ? 'Type retry + Enter after fixing the issue, or /skip + Enter to discard this job. /later defers.'
        : 'Fix the issue outside this terminal, then type retry + Enter. /later defers.',
      submit: text => this.submit(question, text),
    } : null);
    this.emit('change');
  }
  async submit(question, text) {
    const value = text.trim();
    if (value === '/finish') { this.onLeave(); return; }
    if (value === '/later') { this.settled.add(question.key); this.refresh(); return; }
    const skipFailed = value === '/skip' && question.kind === 'job' && question.reason === 'job_failed';
    if (value === '/skip' && question.reason !== 'jd_unavailable' && !skipFailed) throw new Error('Skipping is available for missing-JD and failed-job questions.');
    if (['agency_confirmation', 'jd_unavailable'].includes(question.reason) || skipFailed) {
      const answer = { url: question.url, reason: question.reason, answer: value };
      if (skipFailed) {
        answer.answer = ''; answer.resolution = 'skip';
      } else if (question.reason === 'agency_confirmation' && value === '/direct') {
        answer.answer = 'This posting is by the direct employer.'; answer.direct_employer = true;
      } else if (question.reason === 'jd_unavailable') {
        if (value === '/skip') {
          answer.answer = ''; answer.resolution = 'skip';
        } else if (/^https?:\/\//i.test(value) && !value.includes('\n')) {
          if (!validUrl(value) || isLinkedIn(value)) throw new Error('Provide a public employer posting URL, or paste its job description.');
          answer.employer_url = value;
        } else {
          if (value.length < 40 || value.split(/\s+/).length < 6) throw new Error('Paste the job description, or enter its employer URL.');
          answer.jd_text = text;
        }
      }
      const updated = this.answers.filter(item => item.url !== answer.url || item.reason !== answer.reason).concat(answer);
      const previous = this.answers.find(item => item.url === answer.url && item.reason === answer.reason);
      if (previous && JSON.stringify(previous) === JSON.stringify(answer)) throw new Error('That answer was already tried. Provide corrected information, or /later to defer.');
      this.save(updated);
      this.answers.splice(0, this.answers.length, ...updated);
      await this.onAnswer(answer);
    } else {
      if (!/^\/?retry$/i.test(value)) throw new Error('Type retry after correcting the issue, or /later to defer.');
      const task = Promise.resolve().then(() => this.onRetry(question));
      this.tasks.add(task);
      task.catch(error => {
        this.settled.delete(question.key);
        this.terminal.error(error.message);
      }).finally(() => { this.tasks.delete(task); this.refreshSafely(); });
    }
    this.settled.add(question.key); this.revision++; this.refresh();
  }
  async wait({ until = () => false } = {}) {
    this.refresh();
    while (this.active && (this.questions.length || this.tasks.size) && !until()) {
      await new Promise(resolve => this.once('change', resolve));
      if (this.error) throw this.error;
    }
    if (!until()) await Promise.allSettled([...this.tasks]);
    if (this.error) throw this.error;
  }
  close() { clearInterval(this.timer); this.terminal.off('leave', this.onLeave); }
}
