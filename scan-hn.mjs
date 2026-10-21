#!/usr/bin/env node

/** HN-only entry point for the canonical, deterministic portal scanner. */
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import * as yaml from 'js-yaml';
import { loadYaml } from './lib/yaml-document.mjs';
import { getUserContext } from './lib/user-context.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags } from './lib/cli-flags.mjs';

const KNOWN_FLAGS = ['--help', '-h', '--dry-run', '--json', '--quiet'];
const USAGE = `Usage:
  node scan-hn.mjs --user <id>       # scan the latest HN hiring thread
  node scan-hn.mjs --user <id> --dry-run

Runs the native Hacker News provider through scan.mjs, preserving portals.yml
filters, blacklist, profile eligibility, dedup and history rules. New offers go
to data/pipeline.md. GEMINI_API_KEY never enables paid extraction automatically.

Flags:
  --dry-run                         # preview without writing scan artifacts
  --json                            # emit the canonical scanner receipt
  --quiet                           # suppress the scanner footer
  --help, -h                        # show this help and exit`;

/** Keep the full filter policy, narrowing only the scan targets. */
export function hnScanConfig(config) {
  const boards = Array.isArray(config.job_boards) ? config.job_boards : [];
  const hnBoards = boards.filter(board => board?.provider === 'hackernews');
  const board = hnBoards.find(board => board.enabled !== false) || hnBoards[0]
    || { name: 'HN Hiring', provider: 'hackernews' };
  return {
    ...config,
    // Legacy keywords supply a default only when no canonical title policy exists.
    title_filter: config.title_filter ?? { positive: config.hn_hiring?.keywords ?? ['Software Engineer'] },
    tracked_companies: [],
    job_boards: [{ ...board, enabled: true }],
  };
}

// Kept as an explicit extraction utility for existing callers. The scanner does
// not call it: extracted fields must never become an alternate admission path.
export async function extractWithAI(rawText, model) {
  const prompt = `--- BEGIN UNTRUSTED DATA ---\n${rawText.substring(0, 2000)}\n--- END UNTRUSTED DATA ---`;
  const result = await model.generateContent(prompt);
  try {
    const parsed = loadYaml(result.response.text().replace(/```yaml|```/g, '').trim());
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      company: (parsed.company || parsed.COMPANY || '').trim(),
      title: (parsed.title || parsed.TITLE || '').trim(),
      location: (parsed.location || parsed.LOCATION || 'Remote/Unknown').trim(),
    };
  } catch {
    return null;
  }
}

function runScanner(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      ...process.execArgv, fileURLToPath(new URL('./scan.mjs', import.meta.url)), ...args,
    ], { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
}

export async function scanHn(argv = process.argv.slice(2)) {
  const ctx = getUserContext(argv, { requireUser: false });
  validateFlags(ctx.args, KNOWN_FLAGS, USAGE);
  const user = ctx.userRoot ? ctx : getUserContext(argv);
  const portalsPath = process.env.CAREER_OPS_PORTALS
    ? path.resolve(process.env.CAREER_OPS_PORTALS) : path.join(user.userRoot, 'portals.yml');
  if (!existsSync(portalsPath)) throw new Error('portals.yml not found. Run onboarding first.');
  let config;
  try {
    config = loadYaml(readFileSync(portalsPath, 'utf8'));
  } catch (err) {
    throw new Error(`failed to parse ${portalsPath}: ${err.message}`);
  }
  const narrowed = hnScanConfig(config && typeof config === 'object' ? config : {});
  const scratch = mkdtempSync(path.join(tmpdir(), 'career-ops-hn-'));
  const temporaryPortals = path.join(scratch, 'portals.yml');
  try {
    writeFileSync(temporaryPortals, yaml.dump(narrowed), 'utf8');
    return await runScanner(['--user', user.userId, ...user.args], {
      ...process.env,
      CAREER_OPS_PORTALS: temporaryPortals,
      CAREER_OPS_SCAN_HANDOFF: path.join(scratch, 'scan-handoff.json'),
    });
  } finally {
    // Only the fresh directory owned by this invocation is removed.
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (isMainModule(import.meta.url)) {
  scanHn().then(code => { process.exitCode = code; }).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}
