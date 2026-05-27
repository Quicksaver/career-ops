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
import { readFileSync, existsSync, readdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const QUICK = process.argv.includes('--quick');
const NODE = process.execPath;
const TEST_USERS_DIR = mkdtempSync(join(tmpdir(), 'career-ops-users-'));
const TEST_USER_ENV = {
  ...process.env,
  CAREER_OPS_USERS_DIR: TEST_USERS_DIR,
  CAREER_OPS_USER: 'test',
};

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

const mjsFiles = [
  ...readdirSync(ROOT).filter(f => f.endsWith('.mjs')),
  ...(existsSync(join(ROOT, 'lib'))
    ? readdirSync(join(ROOT, 'lib')).filter(f => f.endsWith('.mjs')).map(f => `lib/${f}`)
    : []),
];
for (const f of mjsFiles) {
  const result = run(NODE, ['--check', f]);
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
  { name: 'analyze-patterns.mjs --self-test', expectExit: 0 },
  { name: 'update-system.mjs check', expectExit: 0 },
];

for (const { name, allowFail } of scripts) {
  const result = run(NODE, name.split(' '), { stdio: ['pipe', 'pipe', 'pipe'], env: TEST_USER_ENV });
  if (result !== null) {
    pass(`${name} runs OK`);
  } else if (allowFail) {
    warn(`${name} exited with error (expected without user data)`);
  } else {
    fail(`${name} crashed`);
  }
}

// ── 3. LIVENESS CLASSIFICATION ──────────────────────────────────

console.log('\n3. User context resolver');

try {
  const { getUserContext, UserContextError } = await import(pathToFileURL(join(ROOT, 'lib/user-context.mjs')).href);
  const parsed = getUserContext(['--user', 'test-user', '--dry-run']);
  if (
    parsed.userId === 'test-user'
    && parsed.userRoot.endsWith('users/test-user')
    && parsed.args.length === 1
    && parsed.args[0] === '--dry-run'
  ) {
    pass('user-context parses and strips --user from script args');
  } else {
    fail(`user-context parsed unexpected result: ${JSON.stringify(parsed)}`);
  }

  let rejected = false;
  try {
    getUserContext(['--user', '../secret']);
  } catch (err) {
    rejected = err instanceof UserContextError;
  }
  if (rejected) {
    pass('user-context rejects path-like user IDs');
  } else {
    fail('user-context accepted a path-like user ID');
  }
} catch (e) {
  fail(`User context tests crashed: ${e.message}`);
}

// ── 4. LIVENESS CLASSIFICATION ──────────────────────────────────

console.log('\n4. Liveness classification');

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

// ── 5. CUSTOM PROVIDER RETRIES ──────────────────────────────────

console.log('\n5. Custom provider retries');

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
    fail(
      `fetchJson retry sequence was unexpected: expected 3 calls, one ok job, and 2 increasing delays within jitter bounds; `
      + `got calls=${calls}, jobs=${JSON.stringify(retryResult.jobs)}, delays=[${delays.join(', ')}], `
      + `withinJitter=${delays.map((delay, index) => isWithinJitter(delay, index + 1)).join(',')}`
    );
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
  if (FETCH_MAX_ATTEMPTS <= 1) {
    fail(`FETCH_MAX_ATTEMPTS must be > 1, got ${FETCH_MAX_ATTEMPTS}`);
  } else if (jitteredLow !== expectedLow) {
    fail(`Jitter low bound incorrect: expected ${expectedLow}, got ${jitteredLow}`);
  } else if (jitteredHigh > expectedHigh) {
    fail(`Jitter high bound exceeds maximum: expected <= ${expectedHigh}, got ${jitteredHigh}`);
  } else if (jitteredHigh <= FETCH_RETRY_BASE_DELAY_MS) {
    fail(`Jitter high bound should exceed base delay ${FETCH_RETRY_BASE_DELAY_MS}, got ${jitteredHigh}`);
  } else {
    pass('Retry configuration and jitter bounds are valid');
  }
} catch (e) {
  fail(`Custom provider retry tests crashed: ${e.message}`);
}

// ── 6. DASHBOARD BUILD ──────────────────────────────────────────

if (!QUICK) {
  console.log('\n6. Dashboard build');
  const goBuild = run('cd dashboard && go build -o /tmp/career-dashboard-test . 2>&1');
  if (goBuild !== null) {
    pass('Dashboard compiles');
  } else {
    fail('Dashboard build failed');
  }
} else {
  console.log('\n6. Dashboard build (skipped --quick)');
}

// ── 7. DATA CONTRACT ────────────────────────────────────────────

console.log('\n7. Data contract validation');

// Check system files exist
const systemFiles = [
  'CLAUDE.md', 'VERSION', 'DATA_CONTRACT.md',
  'modes/_shared.md', 'modes/_profile.template.md',
  'modes/oferta.md', 'modes/pdf.md', 'modes/scan.md',
  'templates/states.yml', 'templates/cv-template.html',
  'lib/user-context.mjs',
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
  'users/example/cv.md',
];
for (const f of userFiles) {
  const ignored = run('git', ['check-ignore', f]);
  if (ignored !== null) {
    pass(`User file gitignored: ${f}`);
  } else {
    fail(`User file is not gitignored: ${f}`);
  }
}

// ── 8. PERSONAL DATA LEAK CHECK ─────────────────────────────────

console.log('\n8. Personal data leak check');

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

// ── 9. ABSOLUTE PATH CHECK ──────────────────────────────────────

console.log('\n9. Absolute path check');

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

// ── 10. MODE FILE INTEGRITY ──────────────────────────────────────

console.log('\n10. Mode file integrity');

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

// ── 11. LOCAL PARSER CONTRACT ───────────────────────────────────

console.log('\n11. Local parser contract');

const scanScript = readFile('scan.mjs');
if (
  scanScript.includes('typeof company.name !== \'string\'') &&
  scanScript.includes('company.name.trim()') &&
  scanScript.includes('company.name.toLowerCase()')
) {
  pass('scan.mjs guards company names before filtering');
} else {
  fail('scan.mjs does not guard company names before filtering');
}

if (
  scanScript.includes("skipIds: ['local-parser']") &&
  scanScript.includes('local parser failed, used API fallback') &&
  scanScript.includes('resolveProvider(company, providers')
) {
  pass('scan.mjs falls back to ATS API when local parser fails');
} else {
  fail('scan.mjs does not fall back to ATS API when local parser fails');
}

if (fileExists('providers/local-parser.mjs')) {
  pass('local-parser provider module exists');
} else {
  fail('local-parser provider module is missing');
}

const scanMode = fileExists('modes/scan.md') ? readFile('modes/scan.md') : '';
if (
  scanMode.includes('local_parser_ok') &&
  scanMode.includes('no repetir scraping caro') &&
  scanMode.includes('nombre no listado en `local_parser_ok`')
) {
  pass('scan.md skips expensive levels after successful local parser');
} else {
  fail('scan.md missing local_parser_ok skip rules for agent scan');
}

if (!fileExists('scripts/parsers/cohere_jobs.py')) {
  pass('Cohere parser example is not bundled as a runtime script');
} else {
  fail('Cohere parser example is still bundled as a runtime script');
}

const portalExample = readFile('templates/portals.example.yml');
if (
  !portalExample.includes('cohere_jobs.py') &&
  portalExample.includes('scripts/parsers/example-js-company-jobs.js') &&
  portalExample.includes('scripts/parsers/example_python_company_jobs.py') &&
  portalExample.includes('already know their target careers URL')
) {
  pass('portals example documents a generic local parser contract');
} else {
  fail('portals example still points at a bundled Cohere parser');
}

// ── 12. AGENTS.md INTEGRITY ─────────────────────────────────────

console.log('\n12. AGENTS.md integrity');

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

// ── 13. VERSION FILE ─────────────────────────────────────────────

console.log('\n13. Version file');

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

// ── 14. LOCATION FILTER — always_allow tier ───────────────────────

console.log('\n14. Location filter — always_allow tier');

try {
  const { buildLocationFilter } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  const filter = buildLocationFilter({
    always_allow: ['belgium', 'brussels'],
    allow: ['europe', 'emea', 'remote'],
    block: ['france', 'germany', 'united states'],
  });

  // Case 1: home-region passes regardless of other text
  if (filter('Brussels, Belgium') === true) pass('Brussels, Belgium passes (always_allow hit)');
  else fail('Brussels, Belgium should pass');

  // Case 2: always_allow wins over block (THE motivating case for this tier)
  if (filter('Remote, Belgium or France') === true) pass('Remote, Belgium or France passes (always_allow beats block)');
  else fail('Remote, Belgium or France should pass — always_allow must win over block');

  // Case 3: no always_allow hit, block still rejects
  if (filter('Paris, France') === false) pass('Paris, France is rejected (block still applies)');
  else fail('Paris, France should be rejected');

  // Case 4: empty location → pass (existing semantics, unchanged)
  if (filter('') === true) pass('empty location passes (unchanged semantics)');
  else fail('empty location should pass');

  // Case 5: case-insensitivity
  if (filter('BRUSSELS, BELGIUM') === true) pass('case-insensitive match works');
  else fail('case-insensitive match failed');

  // Case 6: backward compatibility — no always_allow key behaves like stock allow/block
  const stockFilter = buildLocationFilter({
    allow: ['europe', 'remote'],
    block: ['france'],
  });
  if (stockFilter('Remote, Belgium or France') === false) pass('without always_allow, block still wins (backward compatible)');
  else fail('without always_allow, behaviour must match stock allow/block (block wins)');

  // Case 7: null/missing locationFilter → pass-all filter (early-return path)
  const nullFilter = buildLocationFilter(null);
  if (nullFilter('Anywhere on Earth') === true && nullFilter('') === true) {
    pass('null locationFilter returns a pass-all filter (early-return path)');
  } else {
    fail('null locationFilter should return a pass-all filter');
  }

  // Case 8: string-instead-of-array → wrapped to a 1-item list
  const stringFilter = buildLocationFilter({ always_allow: 'belgium', block: ['france'] });
  if (stringFilter('Remote, Belgium or France') === true) {
    pass('always_allow as a bare string is wrapped to a single-item list');
  } else {
    fail('always_allow as a bare string should still work');
  }

  // Case 9: null/non-string items are filtered out (no crash, no false matches)
  const messyFilter = buildLocationFilter({
    always_allow: [null, 'belgium', 42, undefined],
    block: ['france', null, 7],
  });
  if (messyFilter('Brussels, Belgium') === true && messyFilter('Paris, France') === false) {
    pass('non-string entries (null, numbers, undefined) are filtered out without crashing');
  } else {
    fail('mixed-type keyword lists should not crash and should still match string entries');
  }

  // Case 10: all-null/non-string list → empty after normalization (no false rejects)
  const allBadFilter = buildLocationFilter({ block: [null, 42, undefined], allow: ['remote'] });
  if (allBadFilter('Remote') === true) {
    pass('a block list with only non-string entries normalizes to [] (no false rejects)');
  } else {
    fail('non-string-only block list should not cause rejection');
  }

  // Case 11: empty / whitespace-only entries are dropped (would otherwise pass-all via includes(''))
  const emptyKeywordFilter = buildLocationFilter({
    always_allow: ['', '  '],
    allow: ['remote'],
    block: ['france'],
  });
  if (emptyKeywordFilter('Paris, France') === false) {
    pass('empty/whitespace always_allow entries are dropped (no pass-all via includes(""))');
  } else {
    fail('empty always_allow entries should NOT bypass block — would have made the filter pass-all');
  }

  // Case 12: surrounding whitespace is trimmed so the keyword still matches
  const whitespaceFilter = buildLocationFilter({
    always_allow: ['  Belgium  ', '\tBrussels\n'],
    block: ['france'],
  });
  if (whitespaceFilter('Remote, Belgium or France') === true) {
    pass('whitespace-padded keywords still match after trim');
  } else {
    fail('"  Belgium  " should be trimmed and still match "Remote, Belgium or France"');
  }

  // Case 13: whitespace-only location is treated as missing (pass-all-tiers)
  if (filter('   \t  ') === true) pass('whitespace-only location passes (treated as missing)');
  else fail('whitespace-only location should pass');

  // Case 14: non-string location (number/object/null) → pass without throwing
  let crashed = false;
  try {
    const r1 = filter(42);
    const r2 = filter({ city: 'Brussels' });
    const r3 = filter(null);
    const r4 = filter(undefined);
    if (r1 === true && r2 === true && r3 === true && r4 === true) {
      pass('non-string location values (number, object, null, undefined) pass without throwing');
    } else {
      fail(`non-string location results: number=${r1}, object=${r2}, null=${r3}, undefined=${r4}`);
    }
  } catch (e) {
    crashed = true;
    fail(`non-string location crashed: ${e.message}`);
  }

  // Case 15: a malformed location (e.g. legacy object) does NOT bypass block when interpreted naively —
  // the guard returns true (pass) BEFORE block/allow even run, which is correct: scoring/eval happens
  // downstream from the scan filter, so malformed locations should fall through to the manual evaluation
  // step rather than being silently dropped here.
  if (filter(42) === true) pass('non-string locations are passed through to downstream evaluation, not silently dropped');
  else fail('non-string locations should pass through');

} catch (e) {
  fail(`always_allow tests crashed: ${e.message}`);
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
