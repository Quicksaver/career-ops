import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROJECT_ROOT } from './user-context.mjs';
import { parseBatchState, parseBlockedRows, parsePendingRows } from './pipeline-queue.mjs';
import { loadAnswers } from '../batch/manual-inputs.mjs';

function readOptional(path) {
  try { return readFileSync(path, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export function goPipelinePath(userRoot) {
  return process.env.CAREER_OPS_PIPELINE
    ? resolve(PROJECT_ROOT, process.env.CAREER_OPS_PIPELINE)
    : join(userRoot, 'data/pipeline.md');
}

export function readGoQueue(userRoot) {
  const text = readOptional(goPipelinePath(userRoot));
  const pending = parsePendingRows(text);
  if (pending.headerIndex < 0 && /^\s*-\s*\[(?: |!)\]/m.test(text)) {
    throw new Error('Pipeline contains open jobs under an unrecognized Pending header');
  }
  return { text, pending: pending.rows, blocked: parseBlockedRows(text).rows };
}

export function readGoBatchState(userRoot) {
  return parseBatchState(readOptional(join(userRoot, 'batch/batch-state.tsv')));
}

export function readGoAnswers(path, user, userRoot) {
  return loadAnswers(path, user, userRoot);
}

export function queueActions(userRoot, user) {
  const queue = readGoQueue(userRoot);
  const states = readGoBatchState(userRoot);
  const queued = new Set([...queue.pending, ...queue.blocked].map(row => row.url));
  const actions = queue.blocked.map(row => ({
    kind: 'job', phase: 'pipeline', url: row.url, reason: row.reason,
    question: row.reason === 'job_input'
      ? `${row.question} Resume after resolving the error by changing this exact row from [!] to [ ] in ${goPipelinePath(userRoot)}, then rerun go.`
      : row.question,
    resume_kind: row.reason === 'job_input' ? 'pipeline_edit' : 'answers_file', status: 'pending',
  }));
  for (const row of states) {
    if (!queued.has(row.url) || row.status !== 'needs_confirmation') continue;
    if (!/^[A-Za-z0-9_-]+$/.test(row.id)) throw new Error(`Invalid held batch job ID: ${row.id}`);
    const path = join(userRoot, 'batch/logs', `${row.id}.hold.json`);
    let hold;
    if (existsSync(path)) {
      try { hold = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
        throw new Error(`Cannot read hold for batch job ${row.id}: ${error.message}`);
      }
      if (hold.user !== user || String(hold.id) !== row.id || hold.url !== row.url ||
          hold.status !== 'needs_confirmation' ||
          !['agency_confirmation', 'jd_unavailable'].includes(hold.reason) ||
          typeof hold.question !== 'string' || !hold.question.trim() ||
          ['score', 'legitimacy', 'via', 'company_confidential', 'pdf', 'report', 'tracker', 'error'].some(key => hold[key] !== null)) {
        throw new Error(`Invalid confirmation hold identity for batch job ${row.id}`);
      }
    }
    const reason = hold?.reason || 'job_confirmation';
    const action = {
      kind: 'job', phase: 'pipeline', id: row.id, url: row.url, reason,
      question: hold?.question || row.error || 'Inspect the job log and provide the requested confirmation.',
      status: 'pending',
    };
    const existing = actions.findIndex(item => item.url === row.url);
    if (existing >= 0) actions[existing] = action;
    else actions.push(action);
  }
  return actions;
}

export function actionableQueue(userRoot, user, answers = [], { resumePaused = false } = {}) {
  const queue = readGoQueue(userRoot);
  const held = new Set(queueActions(userRoot, user)
    .filter(action => !answers.some(answer => answer.url === action.url && answer.reason === action.reason))
    .map(action => action.url));
  const states = new Map(readGoBatchState(userRoot).map(row => [row.url, row]));
  return queue.pending.filter(row => {
    const status = states.get(row.url)?.status;
    return !held.has(row.url) && !['completed', 'skipped'].includes(status) && (resumePaused || status !== 'paused_rate_limit');
  });
}

export function validateHandoff(value, taskCount, observedAdded) {
  const keys = ['status', 'processed_items', 'added', 'duplicates', 'expired', 'errors', 'requires_user_action', 'user_action'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
      !['completed', 'partial', 'blocked'].includes(value.status) ||
      !Array.isArray(value.errors) || typeof value.requires_user_action !== 'boolean' ||
      !(value.user_action === null || typeof value.user_action === 'string')) {
    throw new Error('Invalid scan-handoff result schema');
  }
  for (const key of ['processed_items', 'added', 'duplicates', 'expired']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error(`Invalid handoff ${key}`);
  }
  for (const error of value.errors) {
    if (!error || Object.keys(error).length !== 3 || typeof error.item !== 'string' ||
        typeof error.message !== 'string' || typeof error.recoverable !== 'boolean') {
      throw new Error('Invalid handoff error record');
    }
  }
  if (value.processed_items > taskCount || value.added !== observedAdded ||
      value.added + value.duplicates + value.expired > value.processed_items ||
      (value.status === 'completed' && (value.processed_items !== taskCount || value.errors.length || value.requires_user_action)) ||
      (value.requires_user_action && !value.user_action?.trim()) ||
      (!value.requires_user_action && value.user_action !== null)) {
    throw new Error('Scan-handoff counts/status disagree with observed queue or required actions');
  }
  return value;
}

export function queueFingerprint(rows, states) {
  const byUrl = new Map(states.map(row => [row.url, row]));
  return JSON.stringify(rows.map(row => {
    const state = byUrl.get(row.url);
    return [row.url, state?.status || 'pending', state?.retries || '0'];
  }).sort((a, b) => a[0].localeCompare(b[0])));
}
