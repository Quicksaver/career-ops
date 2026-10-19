import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './helpers.mjs';

export function copyBatchOwnership(root) {
  for (const file of ['batch/runner-ownership.mjs', 'batch/state-store.mjs', 'batch/worker-process.mjs', 'pipeline-lock.mjs', 'lib/dir-lock.mjs', 'lib/is-main-module.mjs', 'lib/run-artifacts.mjs', 'lib/walk-tree.mjs', 'lib/scratch-dirs.mjs', 'lib/runner-command.mjs', 'lib/cli-launch.mjs', 'lib/windows-job-worker.ps1']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(root, file));
  }
}
