import { existsSync, readFileSync } from 'fs';
import { loadYaml } from './yaml-document.mjs';

export const CODEX_REASONING_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
export const DEFAULT_CODEX_MODEL = 'gpt-6.1-sol';
export const DEFAULT_CODEX_REASONING_EFFORT = 'medium';

function optionalString(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function readProfileCodexSettings(profilePath) {
  if (!profilePath || !existsSync(profilePath)) return { model: null, reasoningEffort: null };
  let profile;
  try {
    profile = loadYaml(readFileSync(profilePath, 'utf-8')) || {};
  } catch (error) {
    throw new Error(`Cannot parse ${profilePath}: ${error.message}`);
  }
  const codex = profile.codex;
  if (codex === undefined || codex === null) return { model: null, reasoningEffort: null };
  if (typeof codex !== 'object' || Array.isArray(codex)) {
    throw new Error(`${profilePath}: codex must be a mapping`);
  }
  const model = optionalString(codex.model, `${profilePath}: codex.model`);
  const reasoningEffort = optionalString(
    codex.reasoning_effort,
    `${profilePath}: codex.reasoning_effort`,
  );
  if (reasoningEffort && !CODEX_REASONING_EFFORTS.has(reasoningEffort)) {
    throw new Error(
      `${profilePath}: codex.reasoning_effort must be one of ${[...CODEX_REASONING_EFFORTS].join(', ')}`,
    );
  }
  return { model, reasoningEffort };
}

export function resolveCodexSettings({ profilePath, modelOverride, reasoningEffortOverride } = {}) {
  const profile = readProfileCodexSettings(profilePath);
  const argumentModel = optionalString(modelOverride, '--codex-model');
  const argumentReasoning = optionalString(reasoningEffortOverride, '--codex-reasoning-effort');
  if (argumentReasoning && !CODEX_REASONING_EFFORTS.has(argumentReasoning)) {
    throw new Error(
      `--codex-reasoning-effort must be one of ${[...CODEX_REASONING_EFFORTS].join(', ')}`,
    );
  }
  return {
    model: argumentModel || profile.model || DEFAULT_CODEX_MODEL,
    reasoningEffort: argumentReasoning || profile.reasoningEffort || DEFAULT_CODEX_REASONING_EFFORT,
    modelSource: argumentModel ? 'argument' : profile.model ? 'profile' : 'default',
    reasoningEffortSource: argumentReasoning
      ? 'argument'
      : profile.reasoningEffort ? 'profile' : 'default',
  };
}

export function codexReasoningConfigArg(reasoningEffort) {
  return `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`;
}
