#!/usr/bin/env node

/**
 * doctor.mjs — Setup validation for career-ops
 * Checks all prerequisites and prints a pass/fail checklist.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  getUserContext,
  printUserContextErrorAndExit,
  userPath,
} from './lib/user-context.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const targetIdx = argv.indexOf('--target');
const projectRoot =
  targetIdx !== -1 && argv[targetIdx + 1] ? argv[targetIdx + 1] : __dirname;
const JSON_OUT = argv.includes('--json');
let userContext;
try {
  userContext = getUserContext(argv);
} catch (err) {
  printUserContextErrorAndExit(err);
}

// ANSI colors (only on TTY)
const isTTY = process.stdout.isTTY;
const green = (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;
const red = (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s;
const yellow = (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s;
const dim = (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s;

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0]);
  if (major >= 18) {
    return { pass: true, label: `Node.js >= 18 (v${process.versions.node})` };
  }
  return {
    pass: false,
    label: `Node.js >= 18 (found v${process.versions.node})`,
    fix: 'Install Node.js 18 or later from https://nodejs.org',
  };
}

function checkDependencies() {
  if (existsSync(join(projectRoot, 'node_modules'))) {
    return { pass: true, label: 'Dependencies installed' };
  }
  return {
    pass: false,
    label: 'Dependencies not installed',
    fix: 'Run: npm install',
  };
}

async function checkPlaywright() {
  try {
    const { chromium } = await import('playwright');
    const execPath = chromium.executablePath();
    if (existsSync(execPath)) {
      return { pass: true, label: 'Playwright chromium installed' };
    }
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  } catch {
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  }
}

// The browser tools (`browser_navigate` / `browser_snapshot`) that scan / pipeline /
// apply rely on are provided by the Playwright MCP server, registered through a
// project-level Claude Code config (`.mcp.json` or `.claude/settings.json`). When it
// is absent, SPA job boards silently return empty or stale content (#522) — so doctor
// surfaces it as a non-fatal warning rather than letting it fail invisibly.
const PLAYWRIGHT_MCP_WARNING = 'Playwright MCP tools not detected';

function playwrightMcpConfigured(root) {
  const configFiles = ['.mcp.json', '.claude/settings.json', '.claude/settings.local.json'];
  for (const rel of configFiles) {
    const file = join(root, ...rel.split('/'));
    if (!existsSync(file)) continue;
    try {
      const servers = JSON.parse(readFileSync(file, 'utf8'))?.mcpServers;
      if (servers && typeof servers === 'object') {
        for (const server of Object.values(servers)) {
          if (JSON.stringify(server ?? '').toLowerCase().includes('playwright')) return true;
        }
      }
    } catch {
      // Malformed config — keep scanning the other locations; never crash doctor on it.
    }
  }
  return false;
}

function checkPlaywrightMcp(root) {
  if (playwrightMcpConfigured(root)) {
    return { pass: true, label: 'Playwright MCP server configured' };
  }
  return {
    warn: true,
    label: PLAYWRIGHT_MCP_WARNING,
    fix: [
      'Browser-driven JD fetching and liveness checks (scan / pipeline / apply) need the',
      'Playwright MCP server, which this project does not configure yet — SPA job boards',
      'may return empty or stale content. Tracking: https://github.com/santifer/career-ops/issues/506',
    ],
  };
}

// Single source of truth for the four user-layer prerequisites (the list
// AGENTS.md "First Run" documents). BOTH the human checklist (`checkPrereq`)
// and the machine-readable cold-start state (`onboardingState`) derive from
// THIS array, so they cannot drift. Paths use "/" and are split for join().
const USER_LAYER_PREREQS = [
  {
    path: 'cv.md',
    fix: [
      `Create users/${userContext.userId}/cv.md with your CV in markdown`,
      'See examples/ for reference CVs',
    ],
  },
  {
    path: 'config/profile.yml',
    fix: [
      `Run: mkdir -p users/${userContext.userId}/config && cp config/profile.example.yml users/${userContext.userId}/config/profile.yml`,
      'Then edit it with your details',
    ],
  },
  {
    path: 'modes/_profile.md',
    fix: [
      `Run: mkdir -p users/${userContext.userId}/modes && cp modes/_profile.template.md users/${userContext.userId}/modes/_profile.md`,
      'Then customize your archetypes / targeting narrative',
    ],
  },
  {
    path: 'portals.yml',
    fix: [
      `Run: mkdir -p users/${userContext.userId} && cp templates/portals.example.yml users/${userContext.userId}/portals.yml`,
      'Then customize with your target companies',
    ],
  },
];

function prereqPresent(root, path) {
  return existsSync(join(root, ...path.split('/')));
}

function checkPrereq({ path, fix }) {
  if (prereqPresent(userContext.userRoot, path)) {
    return { pass: true, label: `users/${userContext.userId}/${path} found` };
  }
  return { pass: false, label: `users/${userContext.userId}/${path} not found`, fix };
}

function checkFonts() {
  const fontsDir = join(projectRoot, 'fonts');
  if (!existsSync(fontsDir)) {
    return {
      pass: false,
      label: 'fonts/ directory not found',
      fix: 'The fonts/ directory is required for PDF generation',
    };
  }
  try {
    const files = readdirSync(fontsDir);
    if (files.length === 0) {
      return {
        pass: false,
        label: 'fonts/ directory is empty',
        fix: 'The fonts/ directory must contain font files for PDF generation',
      };
    }
  } catch {
    return {
      pass: false,
      label: 'fonts/ directory not readable',
      fix: 'Check permissions on the fonts/ directory',
    };
  }
  return { pass: true, label: 'Fonts directory ready' };
}

function checkAutoDir(name) {
  const dirPath = userPath(userContext, name);
  if (existsSync(dirPath)) {
    return { pass: true, label: `users/${userContext.userId}/${name}/ directory ready` };
  }
  try {
    mkdirSync(dirPath, { recursive: true });
    return { pass: true, label: `users/${userContext.userId}/${name}/ directory ready (auto-created)` };
  } catch {
    return {
      pass: false,
      label: `users/${userContext.userId}/${name}/ directory could not be created`,
      fix: `Run: mkdir -p users/${userContext.userId}/${name}`,
    };
  }
}

async function main() {
  console.log('\ncareer-ops doctor');
  console.log('================\n');
  console.log(`User: ${userContext.userId}\n`);

  const checks = [
    checkNodeVersion(),
    checkDependencies(),
    await checkPlaywright(),
    checkPlaywrightMcp(projectRoot),
    ...USER_LAYER_PREREQS.map(checkPrereq),
    checkFonts(),
    checkAutoDir('data'),
    checkAutoDir('output'),
    checkAutoDir('reports'),
  ];

  let failures = 0;
  let warnings = 0;

  for (const result of checks) {
    const fixes = Array.isArray(result.fix) ? result.fix : result.fix ? [result.fix] : [];
    if (result.warn) {
      warnings++;
      console.log(`${yellow('⚠')} ${result.label}`);
      for (const hint of fixes) {
        console.log(`  ${dim('→ ' + hint)}`);
      }
    } else if (result.pass) {
      console.log(`${green('✓')} ${result.label}`);
    } else {
      failures++;
      console.log(`${red('✗')} ${result.label}`);
      for (const hint of fixes) {
        console.log(`  ${dim('→ ' + hint)}`);
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`Result: ${failures} issue${failures === 1 ? '' : 's'} found. Fix them and run \`npm run doctor -- --user ${userContext.userId}\` again.`);
    process.exit(1);
  } else {
    const warnNote = warnings > 0 ? ` (${warnings} warning${warnings === 1 ? '' : 's'} — see above)` : '';
    console.log(`Result: All checks passed${warnNote}. You're ready to go! Run \`claude\` (or \`opencode\`) to start.`);
    console.log('');
    console.log('Join the community: https://discord.gg/8pRpHETxa4');
    process.exit(0);
  }
}

// Single source of truth for the cold-start state: the same four user-layer
// prerequisites that AGENTS.md "First Run" lists. `--json` turns the trigger into
// a deterministic mechanism the agent runs (instead of re-deriving it from prose),
// and `--target <dir>` lets the test suite point it at a simulated virgin env.
function onboardingState(root) {
  const missing = USER_LAYER_PREREQS
    .filter(({ path }) => !prereqPresent(userContext.userRoot, path))
    .map(({ path }) => path);
  const warnings = playwrightMcpConfigured(root) ? [] : [PLAYWRIGHT_MCP_WARNING];
  return { onboardingNeeded: missing.length > 0, missing, warnings };
}

if (JSON_OUT) {
  console.log(JSON.stringify(onboardingState(projectRoot)));
  process.exit(0);
} else {
  main().catch((err) => {
    console.error('doctor.mjs failed:', err.message);
    process.exit(1);
  });
}
