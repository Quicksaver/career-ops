import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { loadAnswers, validPosting } from '../batch/manual-inputs.mjs';
import { queueActions, readRunBatchState } from './run-queue.mjs';
import { writeFileAtomic } from '../tracker-utils.mjs';
import { getProfilePath } from '../path-resolver.mjs';

export function readAgencyPolicy(userRoot) {
  // The workflow names the user root, so the policy is that user's own profile.
  const path = getProfilePath(userRoot);
  const profile = existsSync(path) ? yaml.load(readFileSync(path, 'utf8')) : null;
  const policy = profile?.batch?.agency_confirmation ?? 'required';
  if (!['required', 'posting_evidence'].includes(policy)) {
    throw new Error('batch.agency_confirmation must be required or posting_evidence');
  }
  return policy;
}

// This is the user's delegation of identification, not a claim that they
// independently verified a recruiter or the undisclosed end employer.
export const AGENCY_POLICY_ANSWER = 'Use the agency identified by the posting evidence under my standing agency policy. Proceed without asking me to confirm it or supply a direct URL. Record unknown agency/employer details as unknown, preserve the original posting URL and apply normal legitimacy checks.';

/** Called under the workflow owner lock, before interactive answers are loaded. */
export function prepareAgencyAnswers({ userRoot, user, answersFile }) {
  if (readAgencyPolicy(userRoot) !== 'posting_evidence') return answersFile;
  const path = join(userRoot, 'data/manual-answers.json');
  const answers = existsSync(path) ? loadAnswers(path, user, userRoot) : [];
  // Explicit automation input wins over stored answers; its file stays read-only.
  for (const answer of loadAnswers(answersFile, user, userRoot)) {
    const index = answers.findIndex(item => item.url === answer.url && item.reason === answer.reason);
    if (index >= 0) answers[index] = answer;
    else answers.push(answer);
  }
  const terminal = new Set(readRunBatchState(userRoot).filter(row => ['completed', 'skipped', 'closed'].includes(row.status)).map(row => row.url));
  for (const action of queueActions(userRoot, user)) {
    if (action.reason !== 'agency_confirmation' || terminal.has(action.url) || answers.some(item => item.url === action.url && item.reason === action.reason)) continue;
    if (!validPosting(action.url, userRoot)) throw new Error('Invalid posting identity for standing agency policy');
    answers.push({ url: action.url, reason: action.reason, answer: AGENCY_POLICY_ANSWER, source: 'standing_policy' });
  }
  writeFileAtomic(path, JSON.stringify({ schema_version: 1, user, answers }, null, 2) + '\n');
  return path;
}
