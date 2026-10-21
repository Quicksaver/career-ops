import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAnswers, loadQueue, canResume, validPosting } from '../batch/manual-inputs.mjs';
import { parseBatchInput, parseBatchState } from './pipeline-queue.mjs';
import { writeFileAtomic } from '../tracker-utils.mjs';
import { isMainModule } from './is-main-module.mjs';

const optional = path => existsSync(path) ? readFileSync(path, 'utf8') : '';
export const answerFingerprint = answer => createHash('sha256').update(JSON.stringify(answer || null)).digest('hex');
// batch-state.tsv counts failed attempts, including the initial attempt.
export const DEFAULT_MAX_RETRIES = 3;

/** Select once per posting/answer/retry request, under the existing batch owner. */
export function nextLiveInput({ controlPath, userRoot, user, answersPath, queuePath, running = 0, activeUrls = [], capacity = Infinity, maxRetries = DEFAULT_MAX_RETRIES, limit = 0, retryFailed = false, resumePaused = false }) {
  const control = JSON.parse(readFileSync(controlPath, 'utf8'));
  if (control.schema_version !== 1 || control.user !== user || !['open', 'finish'].includes(control.status) ||
      !Number.isSafeInteger(control.owner_pid) || control.owner_pid <= 0 || !Array.isArray(control.retries)) throw new Error('Invalid live-input coordinator');
  if (control.retries.some(item => !item || !validPosting(item.url, userRoot) || typeof item.token !== 'string' || !item.token.trim()) ||
      new Set(control.retries.map(item => item.url)).size !== control.retries.length) throw new Error('Invalid exact-posting retry request');
  try { process.kill(control.owner_pid, 0); } catch (error) {
    if (error.code !== 'EPERM') throw new Error('Live-input coordinator exited');
  }
  const answers = loadAnswers(answersPath, user, userRoot);
  const queue = loadQueue(queuePath, userRoot);
  if (!queue) throw new Error('Live input requires an exact queue file');
  const states = new Map(parseBatchState(optional(join(userRoot, 'batch/batch-state.tsv'))).map(row => [row.id, row]));
  const ledgerPath = `${controlPath}.dispatch.json`;
  const ledger = JSON.parse(optional(ledgerPath) || '[]');
  const inputs = parseBatchInput(optional(join(userRoot, 'batch/batch-input.tsv'))).filter(row => /^\d+$/.test(row.id));
  const canonicalIds = new Map();
  for (const row of [...ledger, ...inputs]) if (!canonicalIds.has(row.url)) canonicalIds.set(row.url, row.id);
  const unavailable = new Set([...activeUrls, ...[...states.values()]
    .filter(row => ['completed', 'skipped', 'closed', 'processing'].includes(row.status)).map(row => row.url)]);
  // A confirmation belongs to its posting even when an older input ID comes
  // first. Keep the held identity so canResume validates its exact payload.
  const heldIds = new Map();
  for (const state of states.values()) {
    if (state.status !== 'needs_confirmation' || !queue.has(state.url) || unavailable.has(state.url)) continue;
    if (heldIds.has(state.url) || ledger.some(row => row.url === state.url && row.id !== state.id) ||
        !inputs.some(row => row.url === state.url && row.id === state.id)) {
      throw new Error(`Conflicting confirmation identities for ${state.url}; repair batch input/state before resuming`);
    }
    heldIds.set(state.url, state.id);
    canonicalIds.set(state.url, state.id);
  }
  let selected = null;
  for (const row of running < capacity ? inputs : []) {
    if (!/^\d+$/.test(row.id) || !queue.has(row.url) || unavailable.has(row.url) || canonicalIds.get(row.url) !== row.id) continue;
    const state = states.get(row.id);
    if (state && state.url !== row.url) throw new Error(`Live input/state identity mismatch for #${row.id}`);
    if (['completed', 'skipped', 'closed', 'processing'].includes(state?.status)) continue;
    const request = control.retries.find(item => item.url === row.url);
    const prior = ledger.filter(item => item.url === row.url);
    const postingAnswers = answers.filter(item => item.url === row.url);
    const skipFailed = postingAnswers.some(item => item.reason === 'job_failed' && item.resolution === 'skip');
    const answerToken = postingAnswers.length ? `answer:${answerFingerprint(postingAnswers)}` : null;
    let answer = null;
    if (state?.status === 'needs_confirmation') {
      const hold = JSON.parse(optional(join(userRoot, 'batch/logs', `${row.id}.hold.json`)) || 'null');
      if (!canResume(hold, answers, { id: row.id, url: row.url, user })) continue;
      if (prior.some(item => item.answer_token === answerToken)) continue;
      answer = answers.find(item => item.url === row.url && item.reason === hold.reason);
    }
    const explicitRetry = Boolean(request) || retryFailed;
    if (state?.status === 'failed' && Number(state.retries) >= maxRetries && !explicitRetry && !skipFailed) continue;
    if (state?.status === 'paused_rate_limit' && !resumePaused && !request) continue;
    const token = answer ? answerToken : request ? `retry:${request.token}` : state?.status === 'failed' && Number(state.retries) < maxRetries ? `automatic:${state.retries}`
      : answerToken || 'initial';
    if (prior.some(item => item.token === token)) continue;
    // A failed/re-held attempt needs fresh input, not another automatic dispatch.
    if (prior.length && token === 'initial') continue;
    const admitted = new Set([...(control.admitted_urls || []), ...ledger.map(item => item.url)]);
    if (limit > 0 && !admitted.has(row.url) && admitted.size >= limit) continue;
    selected = { ...row, resetHold: Boolean(answer), explicitRetry, token };
    ledger.push({ id: row.id, url: row.url, token, answer_token: answerToken });
    writeFileAtomic(ledgerPath, JSON.stringify(ledger));
    break;
  }
  // Queued postings neither finished nor running, including holds that wait on an answer.
  const waiting = [...queue].filter(url => !unavailable.has(url) && url !== selected?.url);
  const admitted = new Set([...(control.admitted_urls || []), ...ledger.map(item => item.url)]);
  const unadmitted = waiting.filter(url => !admitted.has(url)).length;
  const remaining = limit > 0 ? waiting.length - unadmitted + Math.min(unadmitted, Math.max(0, limit - admitted.size)) : waiting.length;
  const result = { status: selected ? 'job' : running ? 'busy' : control.status === 'finish' ? 'done' : 'idle', running, remaining, selected };
  writeFileAtomic(`${controlPath}.status.json`, JSON.stringify(result));
  return result;
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('Internal live batch selector: CONTROL ROOT USER ANSWERS QUEUE RUNNING MAX_RETRIES LIMIT RETRY_FAILED RESUME_PAUSED CAPACITY [ACTIVE_URL ...]');
  } else try {
    const [controlPath, userRoot, user, answersPath, queuePath, running, maxRetries, limit, retryFailed, resumePaused, capacity, ...activeUrls] = process.argv.slice(2);
    const result = nextLiveInput({ controlPath, userRoot, user, answersPath, queuePath, running: Number(running), activeUrls, capacity: capacity ? Number(capacity) : Infinity, maxRetries: Number(maxRetries), limit: Number(limit), retryFailed: retryFailed === 'true', resumePaused: resumePaused === 'true' });
    const row = result.selected;
    // Unlike IFS tabs this delimiter preserves empty source/notes fields.
    process.stdout.write(row ? ['job', row.id, row.url, row.source.replaceAll('\x1f', ' '), row.notes.replaceAll('\x1f', ' '), String(row.resetHold), String(row.explicitRetry)].join('\x1f') : result.status);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
