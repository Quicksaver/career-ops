import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './helpers.mjs';

export function copyBatchOwnership(root) {
  for (const file of ['batch/runner-ownership.mjs', 'pipeline-lock.mjs', 'lib/is-main-module.mjs']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(root, file));
  }
}
