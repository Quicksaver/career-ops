import { existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';

export const DEFAULT_PARALLEL = 1;
export const MIN_PARALLEL = 1;
export const MAX_PARALLEL = 32;

function parseParallel(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if ((typeof normalized !== 'number' && typeof normalized !== 'string') ||
      (typeof normalized === 'string' && !/^\d+$/.test(normalized))) {
    throw new Error(`${label} must be an integer from ${MIN_PARALLEL} to ${MAX_PARALLEL}`);
  }
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < MIN_PARALLEL || parsed > MAX_PARALLEL) {
    throw new Error(`${label} must be an integer from ${MIN_PARALLEL} to ${MAX_PARALLEL}`);
  }
  return parsed;
}

export function readProfileParallel(profilePath) {
  if (!profilePath || !existsSync(profilePath)) return null;
  let profile;
  try {
    profile = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
  } catch (error) {
    throw new Error(`Cannot parse ${profilePath}: ${error.message}`);
  }
  const batch = profile.batch;
  if (batch === undefined || batch === null) return null;
  if (typeof batch !== 'object' || Array.isArray(batch)) {
    throw new Error(`${profilePath}: batch must be a mapping`);
  }
  if (batch.parallel === undefined || batch.parallel === null || batch.parallel === '') return null;
  return parseParallel(batch.parallel, `${profilePath}: batch.parallel`);
}

export function resolveParallel({ profilePath, override, defaultValue = DEFAULT_PARALLEL } = {}) {
  if (override !== undefined && override !== null && override !== '') {
    return { parallel: parseParallel(override, '--parallel'), source: 'argument' };
  }
  const profileParallel = readProfileParallel(profilePath);
  if (profileParallel !== null) return { parallel: profileParallel, source: 'profile' };
  return {
    parallel: parseParallel(defaultValue, 'default parallelism'),
    source: 'default',
  };
}
