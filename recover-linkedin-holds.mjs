#!/usr/bin/env node
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getUserContext } from './lib/user-context.mjs';
import { acquirePipelineLock } from './pipeline-lock.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';
import { linkedinPostingId, publishRecovery, recoverPosting, recoveryTargets } from './lib/linkedin-recovery.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log('Usage: node recover-linkedin-holds.mjs --user <id> [--limit N] [--retry-errors | --retry-unavailable]\nRecovers only saved LinkedIn missing-JD holds. Resumes its durable ledger; performs no search or evaluation.');
    return;
  }
  const ctx = getUserContext(argv);
  const args = [...ctx.args];
  const limitIndex = args.indexOf('--limit');
  let limit = 0;
  if (limitIndex >= 0) {
    const value = args[limitIndex + 1];
    if (!/^\d+$/.test(value || '')) throw new Error('--limit requires a nonnegative integer');
    limit = Number(value); args.splice(limitIndex, 2);
  }
  const retry = args.includes('--retry-unavailable');
  const retryErrors = args.includes('--retry-errors');
  if (args.some(arg => !['--retry-unavailable', '--retry-errors'].includes(arg))) throw new Error(`Unknown option: ${args.find(arg => !['--retry-unavailable', '--retry-errors'].includes(arg))}`);
  const data = join(ctx.userRoot, 'data');
  mkdirSync(data, { recursive: true });
  const pipelinePath = process.env.CAREER_OPS_PIPELINE ? resolve(ctx.projectRoot, process.env.CAREER_OPS_PIPELINE) : join(data, 'pipeline.md');
  const ledgerPath = join(data, 'linkedin-recovery.json');
  const owner = await acquirePipelineLock(join(data, 'linkedin-recovery.pid'), { timeoutMs: 1000, maxWaitMs: 1000 });
  let context, stopping = false;
  const stop = () => {stopping = true;};
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    const targets = recoveryTargets(readFileSync(pipelinePath, 'utf8'));
    const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {
      schema_version: 1, user: ctx.userId, started_at: new Date().toISOString(), targets: targets.map(row => row.url), results: {},
    };
    if (ledger.schema_version !== 1 || ledger.user !== ctx.userId || !Array.isArray(ledger.targets) || ledger.targets.some(url => !linkedinPostingId(url)) || !ledger.results || typeof ledger.results !== 'object') throw new Error('Invalid recovery ledger identity');
    const persist = () => {ledger.updated_at = new Date().toISOString(); writeFileAtomic(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');};
    persist();
    const known = new Set(ledger.targets);
    const todo = targets.filter(row => known.has(row.url) && (!ledger.results[row.url] || retry && ['unavailable', 'error', 'login_required'].includes(ledger.results[row.url].status) || retryErrors && ledger.results[row.url]?.status === 'error'));
    console.log(`[linkedin-recovery] ${todo.length} held postings to recover; ${ledger.targets.length} original targets; saved progress ${ledgerPath}`);
    const profile = join(process.env.CAREER_OPS_SCAN_AUTH_DIR ? resolve(ctx.projectRoot, process.env.CAREER_OPS_SCAN_AUTH_DIR) : join(process.env.USERPROFILE || process.env.HOME, '.scan-auth', 'users'), ctx.userId, 'linkedin/profile');
    if (!existsSync(profile)) throw new Error('No saved LinkedIn session; use scan-auth --login for this user');
    // Use the existing user session without anti-bot flags or browser changes.
    context = await chromium.launchPersistentContext(profile, { headless: false, viewport: { width: 1280, height: 900 } });
    let attempted = 0, failures = 0;
    for (const target of todo) {
      if (stopping || limit && attempted >= limit) break;
      let result;
      const page = await context.newPage();
      try {
        result = await recoverPosting(page, target.url);
        if (['recovered', 'closed'].includes(result.status)) result = await publishRecovery({ userRoot: ctx.userRoot, pipelinePath, target, result });
      } catch (error) {result = { status: 'error', error: error.message };}
      finally { await page.close().catch(() => {}); }
      attempted++;
      ledger.results[target.url] = { ...result, attempted_at: new Date().toISOString() };
      persist();
      console.log(`[linkedin-recovery] ${Object.keys(ledger.results).length}/${ledger.targets.length} ${result.status}: ${target.url}${result.error ? ` — ${result.error}` : ''}`);
      if (result.status === 'login_required') break;
      failures = ['unavailable', 'error'].includes(result.status) ? failures + 1 : 0;
      if (failures >= 15) {console.error('[linkedin-recovery] Stopped after 15 consecutive failures; progress is saved'); break;}
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const counts = {};
    for (const result of Object.values(ledger.results)) counts[result.status] = (counts[result.status] || 0) + 1;
    ledger.summary = { ...counts, remaining_unattempted: ledger.targets.length - Object.keys(ledger.results).length, interrupted: stopping };
    persist(); console.log(`[linkedin-recovery] summary ${JSON.stringify(ledger.summary)}`);
  } finally {
    await context?.close(); owner.release();
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}

if (isMainModule(import.meta.url)) main().catch(error => {console.error(`[linkedin-recovery] ${error.message}`); process.exitCode = 1;});
