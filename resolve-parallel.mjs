#!/usr/bin/env node

import { resolveParallel } from './lib/parallel-config.mjs';

const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  }
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed) {
    const value = prefixed.slice(name.length + 1);
    if (!value) throw new Error(`${name} requires a value`);
    return value;
  }
  return null;
}

try {
  const profilePath = optionValue('--profile');
  if (!profilePath) throw new Error('--profile requires a value');
  const override = optionValue('--override');
  const json = args.includes('--json');
  const known = new Set(['--profile', '--override']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (known.has(arg)) { index++; continue; }
    if (arg === '--json' || arg.startsWith('--profile=') || arg.startsWith('--override=')) continue;
    throw new Error(`Unknown option: ${arg}`);
  }
  const result = resolveParallel({ profilePath, override });
  if (json) console.log(JSON.stringify(result));
  else console.log(`${result.parallel}\t${result.source}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
