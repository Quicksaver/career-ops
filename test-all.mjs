#!/usr/bin/env node

/**
 * test-all.mjs — Comprehensive test suite for career-ops
 *
 * Run before merging any PR or pushing changes.
 * Tests: syntax, scripts, dashboard, data contract, personal data, paths.
 *
 * Usage:
 *   node test-all.mjs           # Run all tests
 *   node test-all.mjs --quick   # Skip dashboard build (faster)
 */

import { execSync, execFileSync } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const QUICK = process.argv.includes('--quick');

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }

function run(cmd, args = [], opts = {}) {
  try {
    if (Array.isArray(args) && args.length > 0) {
      return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
    }
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function fileExists(path) { return existsSync(join(ROOT, path)); }
function readFile(path) { return readFileSync(join(ROOT, path), 'utf-8'); }

console.log('\n🧪 career-ops test suite\n');

// ── 1. SYNTAX CHECKS ────────────────────────────────────────────

console.log('1. Syntax checks');

const mjsFiles = readdirSync(ROOT).filter(f => f.endsWith('.mjs'));
for (const f of mjsFiles) {
  const result = run('node', ['--check', f]);
  if (result !== null) {
    pass(`${f} syntax OK`);
  } else {
    fail(`${f} has syntax errors`);
  }
}

// ── 2. SCRIPT EXECUTION ─────────────────────────────────────────

console.log('\n2. Script execution (graceful on empty data)');

const scripts = [
  { name: 'cv-sync-check.mjs', expectExit: 1, allowFail: true }, // fails without cv.md (normal in repo)
  { name: 'verify-pipeline.mjs', expectExit: 0 },
  { name: 'normalize-statuses.mjs', expectExit: 0 },
  { name: 'dedup-tracker.mjs', expectExit: 0 },
  { name: 'merge-tracker.mjs', expectExit: 0 },
  { name: 'update-system.mjs check', expectExit: 0 },
];

for (const { name, allowFail } of scripts) {
  const result = run('node', name.split(' '), { stdio: ['pipe', 'pipe', 'pipe'] });
  if (result !== null) {
    pass(`${name} runs OK`);
  } else if (allowFail) {
    warn(`${name} exited with error (expected without user data)`);
  } else {
    fail(`${name} crashed`);
  }
}

// ── 3. LIVENESS CLASSIFICATION ──────────────────────────────────

console.log('\n3. Liveness classification');

try {
  const { classifyLiveness } = await import(pathToFileURL(join(ROOT, 'liveness-core.mjs')).href);

  const expiredChromeApply = classifyLiveness({
    finalUrl: 'https://example.com/jobs/closed-role',
    bodyText: 'Company Careers\nApply\nThe job you are looking for is no longer open.',
    applyControls: [],
  });
  if (expiredChromeApply.result === 'expired') {
    pass('Expired pages are not revived by nav/footer "Apply" text');
  } else {
    fail(`Expired page misclassified as ${expiredChromeApply.result}`);
  }

  const activeWorkdayPage = classifyLiveness({
    finalUrl: 'https://example.workday.com/job/123',
    bodyText: [
      '663 JOBS FOUND',
      'Senior AI Engineer',
      'Join our applied AI team to ship production systems, partner with customers, and own delivery across evaluation, deployment, and reliability.',
    ].join('\n'),
    applyControls: ['Apply for this Job'],
  });
  if (activeWorkdayPage.result === 'active') {
    pass('Visible apply controls still keep real job pages active');
  } else {
    fail(`Active job page misclassified as ${activeWorkdayPage.result}`);
  }

  const closedMycareersfuture = classifyLiveness({
    finalUrl: 'https://www.mycareersfuture.gov.sg/job/engineering/senior-staff-embedded-software-engineer',
    bodyText: [
      'Senior Staff Embedded Software Engineer',
      'MaxLinear Asia Singapore Private Limited',
      '9 applications    Posted 27 Oct 2025    Closed on 26 Nov 2025',
      'Applications have closed for this job',
      'Log in to Apply',
      "You'll need to log in with Singpass to verify your identity.",
      'Roles & Responsibilities: design, develop and maintain embedded firmware for broadband communications ICs.',
    ].join('\n'),
    applyControls: ['Log in to Apply'],
  });
  if (closedMycareersfuture.result === 'expired') {
    pass('Closed postings with "Applications have closed" banner are detected');
  } else {
    fail(`Closed mycareersfuture posting misclassified as ${closedMycareersfuture.result}`);
  }
} catch (e) {
  fail(`Liveness classification tests crashed: ${e.message}`);
}

// ── 4. CUSTOM PROVIDER RETRIES ──────────────────────────────────

console.log('\n4. Custom provider retries');

try {
  const {
    FETCH_MAX_ATTEMPTS,
    FETCH_RETRY_BASE_DELAY_MS,
    FETCH_RETRY_JITTER_RATIO,
    RETRYABLE_HTTP_STATUSES,
    fetchJsonWithRetry,
    isRetryableFetchError,
    retryDelayMs,
  } = await import(pathToFileURL(join(ROOT, 'providers/_custom-fetch.mjs')).href);
  const { detectCustomProvider, fetchCustomProvider } = await import(pathToFileURL(join(ROOT, 'providers/_custom.mjs')).href);

  const okJson = value => ({ ok: true, status: 200, json: async () => value });
  const statusJson = status => ({ ok: false, status, json: async () => ({}) });
  const isWithinJitter = (delay, retryNumber) => {
    const baseDelay = FETCH_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, retryNumber - 1));
    const min = Math.round(baseDelay * (1 - FETCH_RETRY_JITTER_RATIO));
    const max = Math.round(baseDelay * (1 + FETCH_RETRY_JITTER_RATIO));
    return delay >= min && delay <= max;
  };
  const expectReject = async (label, task, predicate, describeError = error => error.message) => {
    try {
      await task();
      fail(`${label} unexpectedly succeeded`);
    } catch (error) {
      if (predicate(error)) {
        pass(label);
      } else {
        fail(`${label} rejected unexpectedly: ${describeError(error)}`);
      }
    }
  };

  let calls = 0;
  const delays = [];
  const retryResult = await fetchJsonWithRetry('https://example.com/jobs.json', {
    fetchImpl: async () => {
      calls++;
      return calls < 3 ? statusJson(503) : okJson({ jobs: ['ok'] });
    },
    sleepFn: async ms => delays.push(ms),
    randomFn: () => 0.5,
  });
  if (
    calls === 3
    && retryResult.jobs?.[0] === 'ok'
    && delays.length === 2
    && delays[1] > delays[0]
    && delays.every((delay, index) => isWithinJitter(delay, index + 1))
  ) {
    pass('fetchJson retries retryable HTTP statuses with exponential backoff');
  } else {
    fail(`fetchJson retry sequence was unexpected: calls=${calls}, delays=${delays.join(',')}`);
  }

  calls = 0;
  await expectReject(
    'fetchJson does not retry HTTP 404',
    () => fetchJsonWithRetry('https://example.com/missing.json', {
      fetchImpl: async () => {
        calls++;
        return statusJson(404);
      },
      sleepFn: async () => {},
    }),
    () => calls === 1,
    () => `retried ${calls} times`
  );

  calls = 0;
  // 409 conflicts are excluded deliberately because identical retries normally
  // repeat the same state conflict rather than recovering like 429/5xx errors.
  await expectReject(
    'fetchJson does not retry HTTP 409 conflicts',
    () => fetchJsonWithRetry('https://example.com/conflict.json', {
      fetchImpl: async () => {
        calls++;
        return statusJson(409);
      },
      sleepFn: async () => {},
    }),
    () => calls === 1,
    () => `retried ${calls} times`
  );

  let optionRedirect;
  await fetchJsonWithRetry('https://boards-api.greenhouse.io/v1/boards/example/jobs', {
    configureOptions: (_url, options) => ({ ...options, redirect: 'error' }),
    fetchImpl: async (_url, options) => {
      optionRedirect = options.redirect;
      return okJson({ jobs: [] });
    },
    sleepFn: async () => {},
  });
  if (optionRedirect === 'error') {
    pass('fetchJson uses returned per-attempt option overrides');
  } else {
    fail(`fetchJson option override was not applied: ${optionRedirect}`);
  }

  await expectReject(
    'Greenhouse explicit APIs must use HTTPS',
    () => detectCustomProvider('greenhouse', {
      name: 'Invalid Greenhouse',
      api: 'http://boards-api.greenhouse.io/v1/boards/example/jobs',
    }),
    error => /must use HTTPS/.test(error.message)
  );

  await expectReject(
    'Greenhouse explicit APIs reject untrusted hosts',
    () => detectCustomProvider('greenhouse', {
      name: 'Invalid Greenhouse',
      api: 'https://evil-greenhouse.example/v1/boards/example/jobs',
    }),
    error => /untrusted hostname/.test(error.message)
  );

  const originalFetch = globalThis.fetch;
  let customProviderRedirect;
  try {
    globalThis.fetch = async (_url, options) => {
      customProviderRedirect = options.redirect;
      return okJson({ jobs: [{ title: 'AI Engineer', absolute_url: 'https://example.com/job', location: { name: 'Remote' } }] });
    };

    const greenhouseJobs = await fetchCustomProvider('greenhouse', {
      name: 'Example',
      api: 'https://boards-api.greenhouse.io/v1/boards/example/jobs',
    });

    if (customProviderRedirect === 'error' && greenhouseJobs[0]?.title === 'AI Engineer') {
      pass('Custom provider fetch wrapper preserves Greenhouse options and JSON parsing');
    } else {
      fail(`Custom provider wrapper result unexpected: redirect=${customProviderRedirect}, jobs=${greenhouseJobs.length}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const networkError = new TypeError('fetch failed');
  networkError.cause = { code: 'EAI_AGAIN' };
  const wrappedNetworkError = new Error('socket closed');
  wrappedNetworkError.code = 'ECONNRESET';
  const programmingError = new TypeError('Cannot read properties of undefined');
  const abortError = new Error('The operation was aborted');
  abortError.name = 'AbortError';

  if (
    isRetryableFetchError(networkError)
    && isRetryableFetchError(wrappedNetworkError)
    && isRetryableFetchError(abortError, { abortIsRetryable: true })
    && !isRetryableFetchError(abortError)
    && !isRetryableFetchError(programmingError)
    && RETRYABLE_HTTP_STATUSES.has(503)
    && !RETRYABLE_HTTP_STATUSES.has(409)
  ) {
    pass('Retryability guard only accepts network/timeout failures and selected statuses');
  } else {
    fail('Retryability guard accepted or rejected the wrong error/status');
  }

  calls = 0;
  await expectReject(
    'fetchJson stops after the configured max attempts',
    () => fetchJsonWithRetry('https://example.com/down.json', {
      fetchImpl: async () => {
        calls++;
        return statusJson(503);
      },
      sleepFn: async () => {},
      maxAttempts: 3,
    }),
    () => calls === 3,
    () => `stopped after ${calls} attempts`
  );

  await expectReject(
    'fetchJson rejects invalid maxAttempts',
    () => fetchJsonWithRetry('https://example.com/invalid-attempts.json', {
      fetchImpl: async () => okJson({}),
      maxAttempts: 0,
    }),
    error => error instanceof RangeError,
    error => error.name
  );

  const jitteredLow = retryDelayMs(1, () => 0);
  const jitteredHigh = retryDelayMs(1, () => 0.999999);
  const expectedLow = Math.round(FETCH_RETRY_BASE_DELAY_MS * (1 - FETCH_RETRY_JITTER_RATIO));
  const expectedHigh = Math.round(FETCH_RETRY_BASE_DELAY_MS * (1 + FETCH_RETRY_JITTER_RATIO));
  if (FETCH_MAX_ATTEMPTS > 1 && jitteredLow === expectedLow && jitteredHigh <= expectedHigh && jitteredHigh > FETCH_RETRY_BASE_DELAY_MS) {
    pass('Retry attempt naming and jitter bounds are explicit');
  } else {
    fail(`Retry constants/jitter unexpected: attempts=${FETCH_MAX_ATTEMPTS}, low=${jitteredLow}, high=${jitteredHigh}`);
  }
} catch (e) {
  fail(`Custom provider retry tests crashed: ${e.message}`);
}

// ── 5. DASHBOARD BUILD ──────────────────────────────────────────

if (!QUICK) {
  console.log('\n5. Dashboard build');
  const goBuild = run('cd dashboard && go build -o /tmp/career-dashboard-test . 2>&1');
  if (goBuild !== null) {
    pass('Dashboard compiles');
  } else {
    fail('Dashboard build failed');
  }
} else {
  console.log('\n5. Dashboard build (skipped --quick)');
}

// ── 6. DATA CONTRACT ────────────────────────────────────────────

console.log('\n6. Data contract validation');

// Check system files exist
const systemFiles = [
  'CLAUDE.md', 'VERSION', 'DATA_CONTRACT.md',
  'modes/_shared.md', 'modes/_profile.template.md',
  'modes/oferta.md', 'modes/pdf.md', 'modes/scan.md',
  'templates/states.yml', 'templates/cv-template.html',
  '.claude/skills/career-ops/SKILL.md',
];

for (const f of systemFiles) {
  if (fileExists(f)) {
    pass(`System file exists: ${f}`);
  } else {
    fail(`Missing system file: ${f}`);
  }
}

// Check user files are NOT tracked (gitignored)
const userFiles = [
  'config/profile.yml', 'modes/_profile.md', 'portals.yml',
];
for (const f of userFiles) {
  const tracked = run('git', ['ls-files', f]);
  if (tracked === '') {
    pass(`User file gitignored: ${f}`);
  } else if (tracked === null) {
    pass(`User file gitignored: ${f}`);
  } else {
    fail(`User file IS tracked (should be gitignored): ${f}`);
  }
}

// ── 7. PERSONAL DATA LEAK CHECK ─────────────────────────────────

console.log('\n7. Personal data leak check');

const leakPatterns = [
  'Santiago', 'santifer.io', 'Santifer iRepair', 'Zinkee', 'ALMAS',
  'hi@santifer.io', '688921377', '/Users/santifer/',
];

const scanExtensions = ['md', 'yml', 'html', 'mjs', 'sh', 'go', 'json'];
const allowedFiles = [
  // English README + localized translations (all legitimately credit Santiago)
  'README.md', 'README.es.md', 'README.ja.md', 'README.ko-KR.md',
  'README.pt-BR.md', 'README.ru.md',
  // Standard project files
  'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md',
  'package.json', '.github/FUNDING.yml', 'CLAUDE.md', 'AGENTS.md', 'go.mod', 'test-all.mjs',
  // Community / governance files (added in v1.3.0, all legitimately reference the maintainer)
  'CODE_OF_CONDUCT.md', 'GOVERNANCE.md', 'SECURITY.md', 'SUPPORT.md',
  '.github/SECURITY.md',
  // Dashboard credit string
  'dashboard/internal/ui/screens/pipeline.go',
];

// Build pathspec for git grep — only scan tracked files matching these
// extensions. This is what `grep -rn` was trying to do, but git-aware:
// untracked files (debate artifacts, AI tool scratch, local plans/) and
// gitignored files can't trigger false positives because they were never
// going to reach a commit anyway.
const grepPathspec = scanExtensions.map(e => `'*.${e}'`).join(' ');

let leakFound = false;
for (const pattern of leakPatterns) {
  const result = run(
    `git grep -n "${pattern}" -- ${grepPathspec} 2>/dev/null`
  );
  if (result) {
    for (const line of result.split('\n')) {
      const file = line.split(':')[0];
      if (allowedFiles.some(a => file.includes(a))) continue;
      if (file.includes('dashboard/go.mod')) continue;
      warn(`Possible personal data in ${file}: "${pattern}"`);
      leakFound = true;
    }
  }
}
if (!leakFound) {
  pass('No personal data leaks outside allowed files');
}

// ── 8. ABSOLUTE PATH CHECK ──────────────────────────────────────

console.log('\n8. Absolute path check');

// Same git grep approach: only scans tracked files. Untracked AI tool
// outputs, local debate artifacts, etc. can't false-positive here.
const absPathResult = run(
  `git grep -n "/Users/" -- '*.mjs' '*.sh' '*.md' '*.go' '*.yml' 2>/dev/null | grep -v README.md | grep -v LICENSE | grep -v CLAUDE.md | grep -v test-all.mjs`
);
if (!absPathResult) {
  pass('No absolute paths in code files');
} else {
  for (const line of absPathResult.split('\n').filter(Boolean)) {
    fail(`Absolute path: ${line.slice(0, 100)}`);
  }
}

// ── 9. MODE FILE INTEGRITY ──────────────────────────────────────

console.log('\n9. Mode file integrity');

const expectedModes = [
  '_shared.md', '_profile.template.md', 'oferta.md', 'pdf.md', 'scan.md',
  'batch.md', 'apply.md', 'auto-pipeline.md', 'contacto.md', 'deep.md',
  'ofertas.md', 'pipeline.md', 'project.md', 'tracker.md', 'training.md',
];

for (const mode of expectedModes) {
  if (fileExists(`modes/${mode}`)) {
    pass(`Mode exists: ${mode}`);
  } else {
    fail(`Missing mode: ${mode}`);
  }
}

// Check _shared.md references _profile.md
const shared = readFile('modes/_shared.md');
if (shared.includes('_profile.md')) {
  pass('_shared.md references _profile.md');
} else {
  fail('_shared.md does NOT reference _profile.md');
}

// ── 10. AGENTS.md INTEGRITY ──────────────────────────────────────

console.log('\n10. AGENTS.md integrity');

const agents = readFile('AGENTS.md');
const requiredSections = [
  'Data Contract', 'Update Check', 'Ethical Use',
  'Offer Verification', 'Canonical States', 'TSV Format',
  'First Run', 'Onboarding',
];

for (const section of requiredSections) {
  if (agents.includes(section)) {
    pass(`AGENTS.md has section: ${section}`);
  } else {
    fail(`AGENTS.md missing section: ${section}`);
  }
}

// ── 11. VERSION FILE ─────────────────────────────────────────────

console.log('\n11. Version file');

if (fileExists('VERSION')) {
  const version = readFile('VERSION').trim();
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    pass(`VERSION is valid semver: ${version}`);
  } else {
    fail(`VERSION is not valid semver: "${version}"`);
  }
} else {
  fail('VERSION file missing');
}

// ── SUMMARY ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('🟡 Tests passed with warnings — review before pushing\n');
  process.exit(0);
} else {
  console.log('🟢 All tests passed — safe to push/merge\n');
  process.exit(0);
}
