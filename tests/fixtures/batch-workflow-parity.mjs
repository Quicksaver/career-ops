// Shared offline fixture for the batch-workflow-parity suites. The suites are
// split so each stays inside test-all's per-file node:test budget.
import { copyBatchOwnership } from '../copy-batch-ownership.mjs';
import { writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, getBash, toBashPath } from '../helpers.mjs';

export const url = 'https://www.linkedin.com/jobs/view/123';
export const hold = { status: 'needs_confirmation', id: '1', url, report_num: '001', company: '', role: '', score: null, legitimacy: null, via: null, company_confidential: null, pdf: null, report: null, tracker: null, error: null, question: 'Paste JD text or employer URL', reason: 'jd_unavailable' };

export function fixture({ handoffUrl = '', workerResult = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'batch-parity-'));
  const batch = join(root, 'batch');
  const bin = join(root, 'bin');
  for (const dir of [batch, bin, join(root, 'reports'), join(root, 'jds'), join(root, 'config')]) mkdirSync(dir, { recursive: true });
  for (const name of ['batch-runner.sh', 'batch-prompt.md', 'batch-output-schema.json', 'manual-inputs.mjs']) copyFileSync(join(ROOT, 'batch', name), join(batch, name));
  mkdirSync(join(root, 'lib'), { recursive: true });
  copyBatchOwnership(root);
  copyFileSync(join(ROOT, 'lib/is-main-module.mjs'), join(root, 'lib/is-main-module.mjs'));
  writeFileSync(join(root, 'reserve-report-num.mjs'), 'if (!process.argv.includes("--release")) console.log("001");\n');
  for (const name of ['merge-tracker.mjs', 'reconcile-pipeline.mjs']) writeFileSync(join(root, name), 'console.log("fixture reconciliation");\n');
  // Any network/paid agent call becomes observable without contacting anything.
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\necho curl >> "$FIXTURE_CALLS"\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(root, 'fixture-worker.mjs'), `import {readFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2), prompt=args.at(-1)==='-'?readFileSync(0,'utf8'):args.at(-1);
writeFileSync(process.env.FIXTURE_CALLS+'.worker',args.join('\\n'));
writeFileSync(process.env.FIXTURE_CALLS+'.prompt',prompt);
const jdPath=prompt.match(/^JD file: (.+)$/m)?.[1];
if(jdPath) writeFileSync(process.env.FIXTURE_CALLS+'.jd',readFileSync(jdPath));
const result=JSON.parse(process.env.FIXTURE_RESULT);
result.url=process.env.FIXTURE_HANDOFF_URL || prompt.match(/^Internal batch locator: (.+)$/m)?.[1] || result.url;
if(args.includes('--output-last-message')) writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(result));
console.log('\u0060\u0060\u0060json\\n'+JSON.stringify(result)+'\\n\u0060\u0060\u0060');\n`);
  writeFileSync(join(bin, 'claude'), '#!/usr/bin/env bash\nnode "$FIXTURE_WORKER" "$@"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), '#!/usr/bin/env bash\necho unexpected-codex-worker >&2\nexit 99\n', { mode: 0o755 });
  writeFileSync(join(batch, 'batch-input.tsv'), `id\turl\tsource\tnotes\n1\t${url}\tfixture\t\n2\thttps://example.com/other\tfixture\t\n`);
  const calls = join(root, 'calls');
  writeFileSync(join(root, 'browser-extract.mjs'), `import {appendFileSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
appendFileSync(process.env.FIXTURE_CALLS+'.browser',JSON.stringify(process.argv.slice(2))+'\\n');
const output=join(import.meta.dirname,'browser-result.json');
if(existsSync(output)) process.stdout.write(readFileSync(output));
else process.exitCode=1;
`);
  const run = (args, cli = 'claude', envCli = '') => spawnSync(getBash(), ['-c', 'export PATH="$1:$PATH"\nshift\nexec bash "$@"', 'batch-fixture', toBashPath(bin), join(batch, 'batch-runner.sh'), '--user', 'fixture', ...(cli ? ['--cli', cli, '--model', 'fixture'] : []), '--defer-verification', ...args], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_USER: 'fixture', CAREER_OPS_BATCH_CLI: envCli, PATH: bin + delimiter + process.env.PATH, FIXTURE_CALLS: calls, FIXTURE_WORKER: join(root, 'fixture-worker.mjs'), FIXTURE_CURL_JS: join(root, 'curl-stub.mjs'), FIXTURE_HANDOFF_URL: handoffUrl, FIXTURE_RESULT: JSON.stringify({ ...hold, reason: 'agency_confirmation', question: 'Which agency?', ...workerResult }) },
  });
  return { root, batch, calls, run };
}
