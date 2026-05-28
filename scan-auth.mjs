#!/usr/bin/env node

/**
 * Authenticated Job Portal Scanner (Harness)
 *
 * Uses Playwright persistent browser profiles for portals that need a logged-in
 * session. All career-ops data paths are scoped to the active user; auth
 * browser profiles are also per-user and kept outside the repo.
 *
 * Usage:
 *   node scan-auth.mjs --user <id> linkedin
 *   node scan-auth.mjs --user <id> --login linkedin
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createInterface } from 'readline';
import { homedir } from 'os';

import {
  ensureUserDirs,
  getUserContext,
  printUserContextErrorAndExit,
  userPath,
} from './lib/user-context.mjs';
import LinkedInScanner from './scan-auth/linkedin.mjs';

const SCANNERS = {
  linkedin: new LinkedInScanner(),
};

let PORTALS_PATH = '';
let SCAN_HISTORY_PATH = '';
let PIPELINE_PATH = '';
let JDS_DIR = '';

export function getScanAuthBaseDir() {
  const configured = process.env.CAREER_OPS_SCAN_AUTH_DIR;
  if (!configured) return join(homedir(), '.scan-auth', 'users');
  return configured.startsWith('/') ? configured : resolve(process.cwd(), configured);
}

export function getProfileDir(ctx, portal) {
  return join(getScanAuthBaseDir(), ctx.userId, portal, 'profile');
}

function getLegacyProfileDir(portal) {
  return join(homedir(), '.scan-auth', portal, 'profile');
}

function configureUserPaths(ctx) {
  ensureUserDirs(ctx, ['data', 'jds']);
  PORTALS_PATH = process.env.CAREER_OPS_PORTALS
    ? resolve(process.env.CAREER_OPS_PORTALS)
    : userPath(ctx, 'portals.yml');
  SCAN_HISTORY_PATH = userPath(ctx, 'data/scan-history.tsv');
  PIPELINE_PATH = userPath(ctx, 'data/pipeline.md');
  JDS_DIR = userPath(ctx, 'jds');
}

function usage(supportedNames = Object.keys(SCANNERS)) {
  return [
    'Usage: node scan-auth.mjs --user <id> [--login] <portal>',
    `Supported portals: ${supportedNames.join(', ')}`,
  ].join('\n');
}

export function parseCliArgs(args, supportedNames = Object.keys(SCANNERS)) {
  const knownFlags = new Set(['--login']);
  const parsedFlags = new Set();
  const positionalArgs = [];

  for (const arg of args) {
    if (arg.startsWith('--')) {
      if (!knownFlags.has(arg)) {
        throw new Error(`Unknown flag: "${arg}"\n${usage(supportedNames)}`);
      }
      parsedFlags.add(arg);
    } else {
      positionalArgs.push(arg);
    }
  }

  if (positionalArgs.length === 0) {
    throw new Error(usage(supportedNames));
  }
  if (positionalArgs.length > 1) {
    throw new Error(`Too many arguments: "${positionalArgs.join('", "')}"\n${usage(supportedNames)}`);
  }

  const portalId = positionalArgs[0];
  if (!supportedNames.includes(portalId)) {
    throw new Error(`Unknown portal: "${portalId}"\n${usage(supportedNames)}`);
  }

  return {
    portalId,
    login: parsedFlags.has('--login'),
  };
}

function log(msg) { console.log(`[scan-auth] ${msg}`); }
function warn(msg) { console.warn(`[scan-auth] WARN: ${msg}`); }
function error(msg) { console.error(`[scan-auth] ERROR: ${msg}`); }

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}

function extractJobIdFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/jobs\/view\/(\d+)/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function loadScanHistory() {
  const keys = new Set();
  if (!existsSync(SCAN_HISTORY_PATH)) return keys;
  const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (!cols[0]) continue;
    const url = cols[0];

    try {
      if (new URL(url).hostname.includes('linkedin')) {
        const jobId = extractJobIdFromUrl(url);
        if (jobId) keys.add(jobId);
      }
    } catch {
      // Non-URL entries can still contribute company::title below.
    }

    const title = (cols[3] || '').trim();
    const company = (cols[4] || '').trim();
    if (company && title) keys.add(`${company}::${title}`.toLowerCase());
  }
  return keys;
}

function appendScanHistory(entries) {
  const today = new Date().toISOString().split('T')[0];
  let needsHeader = false;
  if (!existsSync(SCAN_HISTORY_PATH)) {
    needsHeader = true;
    mkdirSync(dirname(SCAN_HISTORY_PATH), { recursive: true });
  }
  const lines = [];
  if (needsHeader) lines.push('url\tfirst_seen\tportal\ttitle\tcompany\tstatus');
  for (const e of entries) {
    if (!e.url) continue;
    const title = e.title.replace(/\t/g, ' ');
    const company = e.company.replace(/\t/g, ' ');
    lines.push(`${e.url}\t${today}\t${e.portal}\t${title}\t${company}\t${e.status}`);
  }
  if (lines.length) {
    const content = (needsHeader ? '' : '\n') + lines.join('\n') + '\n';
    writeFileSync(SCAN_HISTORY_PATH, content, { flag: 'a' });
  }
  return needsHeader ? Math.max(0, lines.length - 1) : lines.length;
}

function appendToPipeline(listings) {
  if (listings.length === 0) return;
  if (!existsSync(PIPELINE_PATH)) {
    warn(`pipeline.md not found for this user; listings were not added. Create ${PIPELINE_PATH} or run onboarding first.`);
    return;
  }

  let text = readFileSync(PIPELINE_PATH, 'utf-8');
  const firstH2Match = /^## .+$/m.exec(text);
  if (!firstH2Match) return;
  const firstH2 = firstH2Match.index;
  const afterFirstH2 = text.indexOf('\n', firstH2);
  const secondH2Match = /^## .+$/m.exec(text.slice(afterFirstH2 + 1));
  const secondH2 = secondH2Match ? afterFirstH2 + 1 + secondH2Match.index : -1;
  const insertAt = secondH2 === -1 ? text.length : secondH2;

  const before = text.slice(0, insertAt);
  const prefix = before.endsWith('\n') ? '' : '\n';
  const block = listings.map(l =>
    `- [ ] ${l.url} | ${l.company.replace(/\|/g, '-')} | ${l.title.replace(/\|/g, '-')}`
  ).join('\n') + '\n';
  text = before + prefix + block + text.slice(insertAt);

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

async function launchBrowser(profileDir) {
  mkdirSync(profileDir, { recursive: true });

  log(`Launching browser (profile: ${profileDir})`);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return context;
}

async function waitForLogin(page, scanner) {
  console.log('\nPlease log in to ' + scanner.name + ' in the browser window.');
  console.log('Press ENTER here once you are logged in.\n');

  await prompt('');

  const ok = await scanner.checkSession(page);
  if (!ok) {
    warn('Still not logged in. Try again or Ctrl+C to exit.');
    return waitForLogin(page, scanner);
  }
  return true;
}

function yamlEscape(str) {
  const s = String(str).replace(/\n/g, ' ').trim();
  if (/[":{}[\],&*?|<>=!%@#`]/.test(s) || s.includes("'")) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `"${s}"`;
}

function saveJd(detail, portalId) {
  mkdirSync(JDS_DIR, { recursive: true });
  const jobId = extractJobIdFromUrl(detail.url || '');
  const suffix = jobId || Date.now().toString();
  const slug = slugify(`${detail.company}-${detail.title}-${suffix}`);
  const filename = `${slug}.md`;
  const filepath = join(JDS_DIR, filename);

  const content = `---
title: ${yamlEscape(detail.title)}
company: ${yamlEscape(detail.company)}
application_url: ${yamlEscape(detail.applicationUrl || '')}
source_url: ${yamlEscape(detail.url || '')}
scraped: "${new Date().toISOString().split('T')[0]}"
source: ${portalId}
---

# ${detail.title} - ${detail.company}

${detail.jdText}
`;

  writeFileSync(filepath, content, 'utf-8');
  return `jds/${filename}`;
}

function printSummary(scanner, userContext, results) {
  const s = results.stats;
  console.log(`\n${scanner.name} Scan Summary`);
  console.log('---------------------');
  console.log(`User:             ${userContext.userId}`);
  console.log(`Searches run:     ${s.searched}`);
  console.log(`Listings found:   ${s.found}`);
  console.log(`Extracted:        ${s.extracted}`);
  console.log(`Filtered out:     ${s.skipped_filter}`);
  console.log(`Already seen:     ${s.skipped_dedup}`);
  console.log(`Viewed skipped:   ${s.skipped_viewed ?? 0}`);
  console.log(`JDs saved:        ${s.saved}`);
  console.log(`Errors:           ${s.errors}`);

  if (results.listings.length > 0) {
    console.log('\nNew listings:');
    for (const l of results.listings) {
      console.log(`  - ${l.title} - ${l.company}`);
    }
    console.log(`\nNext step: run /career-ops pipeline ${userContext.userId} to evaluate the saved listings.`);
  } else {
    console.log('\nNo new listings found this run.');
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }

  let userContext;
  try {
    userContext = getUserContext(argv);
  } catch (err) {
    printUserContextErrorAndExit(err);
  }

  let cli;
  try {
    cli = parseCliArgs(userContext.args);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  configureUserPaths(userContext);

  const scanner = SCANNERS[cli.portalId];
  log(`Starting ${scanner.name} scanner for user "${userContext.userId}"...`);

  let config = null;
  if (!cli.login) {
    if (!existsSync(PORTALS_PATH)) {
      error(`portals.yml not found for user "${userContext.userId}". Expected: ${PORTALS_PATH}`);
      process.exit(1);
    }
    config = scanner.parseConfig(readFileSync(PORTALS_PATH, 'utf-8'));
  }

  const profileDir = getProfileDir(userContext, cli.portalId);
  const legacyProfileDir = getLegacyProfileDir(cli.portalId);
  if (!existsSync(profileDir) && existsSync(legacyProfileDir)) {
    warn(`Found legacy shared profile at ${legacyProfileDir}; not reusing it for user "${userContext.userId}". Run login once to create ${profileDir}.`);
  }

  const context = await launchBrowser(profileDir);

  try {
    const page = await context.newPage();

    log('Checking session...');
    const loggedIn = await scanner.checkSession(page);
    if (loggedIn) {
      log('Session active - logged in');
    } else {
      warn('Not logged in - login required');
    }

    if (!loggedIn && !cli.login) {
      await page.close();
      throw new Error(`Not logged in to ${scanner.name}. Run: node scan-auth.mjs --user ${userContext.userId} --login ${cli.portalId}`);
    }

    if (!loggedIn && cli.login) {
      log(`Login mode - opening ${scanner.name} login page`);
      await page.goto(scanner.loginUrl, { waitUntil: 'domcontentloaded' });
      await waitForLogin(page, scanner);
    }

    await page.close();

    if (cli.login) {
      log(`Login successful - ${scanner.name} session saved for user "${userContext.userId}". Run again without --login to scan.`);
      return;
    }

    const scanResult = await scanner.scan(context, config, {
      scanHistory: loadScanHistory(),
    });
    if (!scanResult) return;

    const pipelineEntries = [];
    const historyEntries = [];
    for (const detail of scanResult.listings) {
      const jdFile = saveJd(detail, cli.portalId);
      const url = jdFile ? `local:${jdFile}` : detail.url;
      pipelineEntries.push({
        url,
        title: detail.title,
        company: detail.company,
      });
      historyEntries.push({
        url: detail.url,
        portal: cli.portalId,
        title: detail.title,
        company: detail.company,
        status: 'added',
      });
    }

    for (const entry of scanResult.skipped || []) {
      historyEntries.push({
        url: entry.url,
        portal: cli.portalId,
        title: entry.title,
        company: entry.company,
        status: entry.status,
      });
    }

    appendToPipeline(pipelineEntries);
    const historyCount = appendScanHistory(historyEntries);
    log(`Added ${pipelineEntries.length} listings to ${PIPELINE_PATH}`);
    log(`Wrote ${historyCount} entries to ${SCAN_HISTORY_PATH} (${pipelineEntries.length} added, ${(scanResult.skipped || []).length} skipped)`);
    printSummary(scanner, userContext, {
      listings: pipelineEntries,
      stats: { ...scanResult.stats, saved: pipelineEntries.length },
      errors: scanResult.errors,
    });
  } finally {
    await context.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => {
    error(err.message);
    process.exit(1);
  });
}
