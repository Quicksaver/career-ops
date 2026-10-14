#!/usr/bin/env node

import { resolveCodexSettings } from './lib/codex-config.mjs';
import { getUserContext, userPath } from './lib/user-context.mjs';

// Quote values as data, including embedded quotes and shell metacharacters.
const shellQuote = value => `'${value.replace(/'/g, `'"'"'`)}'`;

try {
  const context = getUserContext();
  let modelOverride;
  let reasoningEffortOverride;
  let shell = false;
  const args = context.args;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--shell') { shell = true; continue; }
    if (arg === '--json') continue;
    const name = arg.split('=')[0];
    if (!['--codex-model', '--codex-reasoning-effort'].includes(name)) throw new Error(`Unknown option: ${arg}`);
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++index];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    if (name === '--codex-model') modelOverride = value;
    else reasoningEffortOverride = value;
  }
  const settings = resolveCodexSettings({
    profilePath: userPath(context, 'config/profile.yml'), modelOverride, reasoningEffortOverride,
  });
  if (shell) {
    console.log(`CODEX_MODEL=${shellQuote(settings.model)}\nCODEX_REASONING_EFFORT=${shellQuote(settings.reasoningEffort)}`);
  } else {
    console.log(JSON.stringify({
      model: settings.model, reasoning_effort: settings.reasoningEffort,
      model_source: settings.modelSource, reasoning_effort_source: settings.reasoningEffortSource,
    }));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
