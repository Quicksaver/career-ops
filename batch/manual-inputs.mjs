import { readFileSync, writeFileSync, renameSync, realpathSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { isMainModule } from '../lib/is-main-module.mjs';

export const HOLD_REASONS = ['agency_confirmation', 'jd_unavailable'];
export const JD_SKIP_REASON = 'user-skipped-jd-unavailable';
export function validLocal(value, userRoot = null) {
  if (typeof value !== 'string' || !value.startsWith('local:jds/')) return false;
  const path = value.slice(6);
  if (/[\\\x00-\x1f\x7f?#%:]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) return false;
  if (userRoot) {
    const root = realpathSync(userRoot);
    const target = resolve(root, path);
    const actual = existsSync(target) ? realpathSync(target) : target;
    const rel = relative(root, actual);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) return false;
  }
  return true;
}
export function validPosting(value, userRoot = null) { return validUrl(value) || validLocal(value, userRoot); }
export function validUrl(value) {
  if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value)) return false;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const privateHost = host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.includes(':') || /^(?:127\.|10\.|169\.254\.|192\.168\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !privateHost;
  } catch { return false; }
}
export function isLinkedIn(value) {
  try { const host = new URL(value).hostname.toLowerCase().replace(/\.$/, ''); return host === 'linkedin.com' || host.endsWith('.linkedin.com'); } catch { return false; }
}
export function loadAnswers(path, user, userRoot = null) {
  if (!path) return [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(user)) throw new Error('invalid user ID');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.schema_version !== 1 || data.user !== user || !Array.isArray(data.answers)) throw new Error('answers file must have schema_version 1, matching user, and answers array');
  const keys = new Set();
  for (const a of data.answers) {
    if (!a || !validPosting(a.url, userRoot) || !HOLD_REASONS.includes(a.reason) || typeof a.answer !== 'string') throw new Error('invalid exact-URL manual answer');
    if (a.resolution !== undefined && a.resolution !== 'skip') throw new Error('invalid manual answer resolution');
    if (a.resolution === 'skip') {
      if (a.reason !== 'jd_unavailable' || a.answer !== '' || a.jd_text !== undefined || a.employer_url !== undefined || a.direct_employer !== undefined) throw new Error('skip requires jd_unavailable, an empty answer and no JD/employer fields');
    } else if (!a.answer.trim()) throw new Error('invalid exact-URL manual answer');
    const key = `${a.url}\n${a.reason}`;
    if (keys.has(key)) throw new Error('duplicate URL/reason answer');
    keys.add(key);
    if (a.direct_employer !== undefined && typeof a.direct_employer !== 'boolean') throw new Error('direct_employer must be boolean');
    if (a.jd_text !== undefined && (typeof a.jd_text !== 'string' || !a.jd_text.trim())) throw new Error('jd_text must be nonempty text');
    if (a.employer_url !== undefined && (!validUrl(a.employer_url) || isLinkedIn(a.employer_url))) throw new Error('employer_url must be a public employer URL, not LinkedIn');
    if (a.reason === 'jd_unavailable' && a.resolution !== 'skip' && !a.jd_text && !a.employer_url) throw new Error('jd_unavailable answer requires jd_text or employer_url');
  }
  return data.answers;
}
export function loadQueue(path, userRoot = null) {
  if (!path) return null;
  const urls = readFileSync(path, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (urls.some(url => !validPosting(url, userRoot))) throw new Error('queue file must contain HTTP(S) URLs or user-contained local:jds references, one per line');
  return new Set(urls);
}
export function validateHold(result, { id, url, reportNum } = {}) {
  const errors = [];
  if (result?.status !== 'needs_confirmation' || !HOLD_REASONS.includes(result.reason)) errors.push('invalid manual hold status/reason');
  if (result?.id !== String(id) || result?.url !== url || (reportNum !== undefined && result?.report_num !== String(reportNum))) errors.push('manual hold identity mismatch');
  if (typeof result?.question !== 'string' || !result.question.trim()) errors.push('manual hold requires a question');
  for (const field of ['score', 'legitimacy', 'via', 'company_confidential', 'pdf', 'report', 'tracker', 'error']) if (result?.[field] !== null) errors.push(`manual hold ${field} must be null`);
  if (result?.company !== '' || result?.role !== '') errors.push('manual hold cannot assert company/role');
  return errors;
}
export function canResume(hold, answers, { id, url, user }) {
  return hold?.user === user && validateHold(hold, { id, url }).length === 0 && answers.some(a => a.url === url && a.reason === hold.reason);
}
export function writeHold(path, result, user) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...result, schema_version: 1, user }, null, 2) + '\n');
  renameSync(tmp, path);
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('Usage: node batch/manual-inputs.mjs <validate|contains|resume|answers|skip|jd|hold|linkedin|local> USER ANSWERS_FILE QUEUE_FILE URL ID HOLD_FILE REPORT_NUM VALUE');
    process.exit(0);
  }
  try {
    const [action, user, answersPath, queuePath, url, id, holdPath, reportNum, value] = process.argv.slice(2);
    const userRoot = process.env.CAREER_OPS_ROOT || process.env.CAREER_OPS_DATA_DIR || null;
    const answers = loadAnswers(answersPath, user, userRoot);
    const queue = loadQueue(queuePath, userRoot);
    if (action === 'contains') process.exitCode = !queue || queue.has(url) ? 0 : 1;
    else if (action === 'resume') process.exitCode = canResume(JSON.parse(readFileSync(holdPath, 'utf8')), answers, { id, url, user }) ? 0 : 1;
    else if (action === 'answers') process.stdout.write(JSON.stringify(answers.filter(a => a.url === url)));
    else if (action === 'skip') {
      if ((!queue || queue.has(url)) && answers.some(a => a.url === url && a.reason === 'jd_unavailable' && a.resolution === 'skip')) process.stdout.write(JD_SKIP_REASON);
    }
    else if (action === 'jd') {
      const answer = answers.find(a => a.url === url && a.reason === 'jd_unavailable');
      if (answer?.jd_text) writeFileSync(holdPath, answer.jd_text);
      process.stdout.write(answer?.employer_url || url);
    } else if (action === 'hold') {
      const result = JSON.parse(value);
      const errors = validateHold(result, { id, url, reportNum });
      if (errors.length) throw new Error(errors.join('; '));
      writeHold(holdPath, result, user);
    } else if (action === 'linkedin') process.exitCode = isLinkedIn(url) ? 0 : 1;
    else if (action === 'local') process.exitCode = validLocal(url, holdPath) ? 0 : 1;
    else if (action !== 'validate') throw new Error('unknown manual-input action');
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
