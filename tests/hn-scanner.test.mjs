import { userFixtureEnv } from './user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractWithAI, hnScanConfig } from '../scan-hn.mjs';

test('Hacker News AI Extraction Logic', async (t) => {
  const mockModel = {
    generateContent: async (prompt) => {
      if (prompt.includes('Stripe')) {
        return { response: { text: () => 'company: Stripe\ntitle: Engineer\nlocation: Remote' } };
      }
      if (prompt.includes('MISSING_KEYS')) {
        return { response: { text: () => 'company: null' } }; 
      }
      if (prompt.includes('MALFORMED')) {
        return { response: { text: () => 'company: { [ malformed : yaml }' } };
      }
      return { response: { text: () => 'null' } };
    }
  };

  await t.test('should extract valid data from a standard HN post', async () => {
    const res = await extractWithAI('Stripe post', mockModel);
    assert.strictEqual(res.company, 'Stripe');
    assert.strictEqual(res.title, 'Engineer');
  });

  await t.test('should return null for malformed YAML output', async () => {
    const res = await extractWithAI('MALFORMED data', mockModel);
    assert.strictEqual(res, null);
  });

  await t.test('should return null for non-job related text', async () => {
    const res = await extractWithAI('Random text', mockModel);
    assert.strictEqual(res, null);
  });

  await t.test('should let a failed API call reach the caller instead of returning null', async () => {
    // An invalid key, exhausted quota or retired model makes generateContent
    // throw. Returning null for that is indistinguishable from "no match".
    const failingModel = {
      generateContent: async () => { throw new Error('[404 Not Found] models/gemini-1.5-flash is not found'); },
    };
    await assert.rejects(() => extractWithAI('Stripe post', failingModel), /404 Not Found/);
  });

  await t.test('should handle objects missing required keys gracefully', async () => {
    const res = await extractWithAI('MISSING_KEYS', mockModel);
    assert.strictEqual(res.company, '');
    assert.strictEqual(res.title, '');
    assert.strictEqual(res.location, 'Remote/Unknown');
  });
});

// Offline fetch fixture for runs of the real scanner. HN is served from canned
// responses, Gemini fails the way an invalid key does, and any other request is
// recorded in `unexpected` and refused. With `serveHn: false` every request is
// refused, for runs that must not reach the network at all.
function writeFetchFixture(dir, { serveHn = true, posts = [
  'Stripe | Software Engineer | Remote | https://stripe.com/jobs/1',
  'Acme | Software Engineer | Berlin | https://acme.example/jobs/2',
] } = {}) {
  const unexpected = join(dir, 'unexpected-requests');
  const preload = join(dir, 'fetch-fixture.cjs');
  writeFileSync(preload, `
    const { appendFileSync } = require('node:fs');
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
    const serveHn = ${serveHn};
    globalThis.fetch = async (input) => {
      const url = String(input?.url ?? input);
      if (serveHn && url.includes('hn.algolia.com/api/v1/search_by_date')) {
        return json({ hits: [{ objectID: '424242', title: 'Ask HN: Who is hiring? (September 2026)' }] });
      }
      if (serveHn && url.includes('hn.algolia.com/api/v1/items/424242')) {
        return json({ children: ${JSON.stringify(posts.map(text => ({ text })))} });
      }
      appendFileSync(${JSON.stringify(unexpected)}, url + '\\n');
      throw new Error('network forbidden in test: ' + url);
    };
  `);
  return { preload, unexpected };
}

function runScanHn(dir, preload, args, envOverrides = {}, entrypoint = '../scan-hn.mjs') {
  const env = userFixtureEnv({ ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', ...envOverrides }, false);
  if (!Object.hasOwn(envOverrides, 'CAREER_OPS_PORTALS')) delete env.CAREER_OPS_PORTALS;
  if (!Object.hasOwn(envOverrides, 'CAREER_OPS_SCAN_HANDOFF')) delete env.CAREER_OPS_SCAN_HANDOFF;
  delete env.GEMINI_MODEL;
  return spawnSync(process.execPath, [
    '--require', preload,
    fileURLToPath(new URL(entrypoint, import.meta.url)),
    ...args,
  ], { cwd: dir, encoding: 'utf8', timeout: 30000, env });
}

test('scan-hn remains deterministic with a Gemini key present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive: [Software Engineer]\n');
    const { preload, unexpected } = writeFetchFixture(dir);

    const r = runScanHn(dir, preload, [], { GEMINI_API_KEY: 'invalid-test-key' });

    assert.equal(r.error, undefined, `scan-hn failed to spawn: ${r.error?.message}`);
    assert.equal(existsSync(unexpected), false, 'scan-hn made a request outside the fixture');
    assert.match(r.stdout, /Total jobs found:\s+2/);
    assert.match(r.stdout, /New offers added:\s+2/);
    assert.doesNotMatch(r.stdout + r.stderr, /AI errors|AI Key detected/);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(dir, 'data', 'scan-handoff.json')), false, 'HN must not leave an empty replacement handoff');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// --help used to run the live scan, and so did any flag this script never had
// (#4598). Both must stop before the first fetch: nothing served, nothing
// written.
test('scan-hn --help prints usage and an unknown flag is refused, neither runs the scan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const { preload, unexpected } = writeFetchFixture(dir, { serveHn: false });

    const help = runScanHn(dir, preload, ['--help']);
    assert.equal(help.error, undefined, `scan-hn failed to spawn: ${help.error?.message}`);
    assert.equal(help.status, 0, `expected --help to exit 0, got ${help.status}\n${help.stderr}`);
    assert.match(help.stdout, /Usage:\n\s+node scan-hn\.mjs/);
    assert.match(help.stdout, /data\/pipeline\.md/, 'usage should say what the scan writes');

    const bogus = runScanHn(dir, preload, ['--unknown']);
    assert.equal(bogus.status, 1, `expected an unknown flag to exit 1, got ${bogus.status}\n${bogus.stdout}`);
    assert.match(bogus.stderr, /unrecognized flag\(s\): --unknown/);

    assert.equal(existsSync(unexpected), false, 'a flag-only run reached the network');
    assert.equal(existsSync(join(dir, 'data', 'pipeline.md')), false, 'a flag-only run wrote data/pipeline.md');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// A portals.yml that exists but does not parse used to be swallowed, and the
// scan ran on the default "Software Engineer" instead of the user's
// hn_hiring.keywords (#4921). The fixture thread only carries Software Engineer
// postings, so the valid file is the control: its keywords are read and match
// nothing. The broken one must stop before the first fetch, as scan.mjs does.
test('scan-hn refuses a portals.yml that does not parse instead of scanning with the default keyword', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const portals = join(dir, 'portals.yml');
    const keywords = 'hn_hiring:\n  keywords:\n    - Registered Nurse\n';

    const served = writeFetchFixture(dir);
    writeFileSync(portals, keywords);
    const valid = runScanHn(dir, served.preload, [], { GEMINI_API_KEY: '' });
    assert.equal(valid.error, undefined, `scan-hn failed to spawn: ${valid.error?.message}`);
    assert.equal(valid.status, 0, `expected a valid portals.yml to exit 0, got ${valid.status}\n${valid.stderr}`);
    assert.match(valid.stdout, /Total jobs found:\s+2/);
    assert.match(valid.stdout, /New offers added:\s+0/, 'legacy keywords should provide a title policy when none is configured');

    const refused = writeFetchFixture(dir, { serveHn: false });
    writeFileSync(portals, `${keywords}title_filter:\n  positive: ["unclosed\n`);
    const broken = runScanHn(dir, refused.preload, [], { GEMINI_API_KEY: '' });
    assert.equal(broken.status, 1, `expected a parse error to exit 1, got ${broken.status}\n${broken.stdout}`);
    assert.match(broken.stderr, /Error: failed to parse .*portals\.yml: /);
    assert.doesNotMatch(broken.stdout, /Match:/);
    assert.equal(existsSync(refused.unexpected), false, 'a run with an unparseable portals.yml reached the network');
    assert.equal(existsSync(join(dir, 'data', 'pipeline.md')), false, 'a run with an unparseable portals.yml wrote data/pipeline.md');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('HN narrowing preserves canonical policy and configured board overrides without mutating config', () => {
  const config = {
    title_filter: { positive: ['Engineer'], negative: ['Sales'] },
    hn_hiring: { keywords: ['Nurse'] },
    country_eligibility_filter: { exclusionary: ['US only'] },
    visa_filter: { require_mention: true },
    dedup: { recheck_after_days: 7 },
    job_boards: [
      { name: 'Other', provider: 'lever' },
      { name: 'Configured HN', provider: 'hackernews', filter_on: ['title'], location_filter: { block: ['USA'] } },
    ],
    tracked_companies: [{ name: 'Other company', provider: 'lever' }],
  };
  const original = structuredClone(config);
  const narrowed = hnScanConfig(config);
  assert.deepEqual(narrowed.job_boards, [{ ...config.job_boards[1], enabled: true }]);
  assert.deepEqual(narrowed.tracked_companies, []);
  for (const key of ['title_filter', 'country_eligibility_filter', 'visa_filter', 'dedup']) {
    assert.deepEqual(narrowed[key], config[key]);
  }
  assert.deepEqual(config, original);
});

test('HN uses canonical location, negative title, company, seniority, blacklist and history gates while preserving handoff', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-gates-'));
  try {
    const data = join(dir, 'data');
    mkdirSync(data, { recursive: true });
    const portals = `
hn_hiring:
  keywords: [Nurse]
title_filter:
  positive: [Software Engineer]
  negative: [Sales]
location_filter:
  allow: [Remote]
  block_hard: [USA]
company_filter:
  block: [BlockedCo]
skip_tiers: [entry]
job_boards:
  - name: Configured HN
    provider: hackernews
tracked_companies:
  - name: Unsupported Company
    scan_method: websearch
`;
    writeFileSync(join(dir, 'portals.yml'), portals);
    writeFileSync(join(data, 'blacklist.md'), '| Company | Since | Scope | Reason |\n| --- | --- | --- | --- |\n| BlacklistedCo | 2026-01-01 | all | User decision |\n');
    const handoff = '{"count":1,"items":[{"company":"Unsupported Company","method":"websearch","query":"careers"}],"custom":"retain exact bytes"}\n';
    writeFileSync(join(data, 'scan-handoff.json'), handoff);
    const { preload, unexpected } = writeFetchFixture(dir, { posts: [
      'AllowedCo | Senior Software Engineer | Remote | https://allowed.example/jobs/1',
      'WrongLocation | Senior Software Engineer | Remote USA | https://location.example/jobs/2',
      'WrongTitle | Sales Software Engineer | Remote | https://title.example/jobs/3',
      'BlockedCo | Senior Software Engineer | Remote | https://company.example/jobs/4',
      'WrongTier | Junior Software Engineer | Remote | https://tier.example/jobs/5',
      'BlacklistedCo | Senior Software Engineer | Remote | https://blacklist.example/jobs/6',
    ] });
    const result = runScanHn(dir, preload, ['--json'], { GEMINI_API_KEY: 'must-not-be-used' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(unexpected), false);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.found, 6);
    assert.equal(receipt.added, 1);
    assert.deepEqual(receipt.added_urls, ['https://allowed.example/jobs/1']);
    const pipeline = readFileSync(join(data, 'pipeline.md'), 'utf8');
    assert.match(pipeline, /AllowedCo/);
    assert.doesNotMatch(pipeline, /WrongLocation|WrongTitle|BlockedCo|WrongTier|BlacklistedCo/);
    assert.match(readFileSync(join(data, 'scan-history.tsv'), 'utf8'), /skipped_location/);
    assert.equal(readFileSync(join(data, 'scan-handoff.json'), 'utf8'), handoff);
    assert.equal(readFileSync(join(dir, 'portals.yml'), 'utf8'), portals);

    const repeated = runScanHn(dir, preload, ['--json'], { GEMINI_API_KEY: '' });
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(JSON.parse(repeated.stdout).added, 0, 'canonical history must prevent a second append');
    assert.equal(readFileSync(join(data, 'scan-handoff.json'), 'utf8'), handoff);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('HN dry-run preserves handoff and creates no canonical scan outputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-dry-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive: [Software Engineer]\n');
    const handoff = 'existing main scan handoff\n';
    writeFileSync(join(dir, 'data', 'scan-handoff.json'), handoff);
    const { preload, unexpected } = writeFetchFixture(dir);
    const result = runScanHn(dir, preload, ['--dry-run', '--json'], { GEMINI_API_KEY: '' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(unexpected), false);
    assert.equal(JSON.parse(result.stdout).added, 2);
    assert.equal(readFileSync(join(dir, 'data', 'scan-handoff.json'), 'utf8'), handoff);
    for (const name of ['pipeline.md', 'scan-history.tsv', 'scan-runs.tsv', 'portal-health.tsv']) {
      assert.equal(existsSync(join(dir, 'data', name)), false, name);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('HN honors explicit portals, pipeline and history paths plus canonical visa missing-data policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-paths-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const portalsPath = join(dir, 'custom-portals.yml');
    const pipelinePath = join(dir, 'lane-pipeline.md');
    const historyPath = join(dir, 'lane-history.tsv');
    const config = 'title_filter:\n  positive: [Software Engineer]\nvisa_filter:\n  require_mention: true\n';
    writeFileSync(portalsPath, config);
    const { preload, unexpected } = writeFetchFixture(dir);
    const env = {
      GEMINI_API_KEY: '', CAREER_OPS_PORTALS: portalsPath,
      CAREER_OPS_PIPELINE: pipelinePath, CAREER_OPS_SCAN_HISTORY: historyPath,
    };
    const blocked = runScanHn(dir, preload, ['--json'], env);
    assert.equal(blocked.status, 0, blocked.stderr);
    assert.equal(JSON.parse(blocked.stdout).added, 0, 'visa require_mention must reject missing descriptions');
    assert.match(blocked.stderr, /Filtered by visa:\s+2/);
    writeFileSync(portalsPath, config.replace('require_mention: true', 'require_mention: false'));
    const allowed = runScanHn(dir, preload, ['--json'], env);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(JSON.parse(allowed.stdout).added, 2);
    assert.equal(existsSync(pipelinePath), true);
    assert.equal(existsSync(historyPath), true);
    assert.equal(existsSync(join(dir, 'data', 'pipeline.md')), false);
    assert.equal(existsSync(join(dir, 'data', 'scan-history.tsv')), false);
    assert.equal(existsSync(unexpected), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('HN preserves the main handoff when the canonical provider fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-error-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive: [Software Engineer]\n');
    const handoff = 'retain main scan artifact even after failure\n';
    writeFileSync(join(dir, 'data', 'scan-handoff.json'), handoff);
    const { preload } = writeFetchFixture(dir, { serveHn: false });
    const result = runScanHn(dir, preload, ['--json'], { GEMINI_API_KEY: '' });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).errors.length, 1);
    assert.equal(readFileSync(join(dir, 'data', 'scan-handoff.json'), 'utf8'), handoff);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('canonical handoff defaults and absolute/relative overrides keep user selection mandatory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-handoff-paths-'));
  try {
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'portals.yml'), 'tracked_companies: []\njob_boards: []\n');
    const { preload, unexpected } = writeFetchFixture(dir, { serveHn: false });
    const shared = join(dir, 'data', 'scan-handoff.json');
    const normal = runScanHn(dir, preload, ['--json'], {}, '../scan.mjs');
    assert.equal(normal.status, 0, normal.stderr);
    assert.equal(JSON.parse(readFileSync(shared, 'utf8')).schema, 'career-ops.scan-handoff.v1');
    const original = readFileSync(shared, 'utf8');
    const projectRoot = fileURLToPath(new URL('../', import.meta.url));
    for (const value of [join(dir, 'absolute.json'), relative(projectRoot, join(dir, 'relative.json'))]) {
      const result = runScanHn(dir, preload, ['--json'], { CAREER_OPS_SCAN_HANDOFF: value }, '../scan.mjs');
      assert.equal(result.status, 0, result.stderr);
      const output = join(dir, value.includes('absolute') ? 'absolute.json' : 'relative.json');
      assert.equal(JSON.parse(readFileSync(output, 'utf8')).count, 0);
      assert.equal(readFileSync(shared, 'utf8'), original);
    }
    const unselected = spawnSync(process.execPath, [
      '--require', preload, fileURLToPath(new URL('../scan.mjs', import.meta.url)), '--json',
    ], { cwd: dir, encoding: 'utf8', timeout: 30000, env: {
      ...userFixtureEnv({ ...process.env, CAREER_OPS_ROOT: dir }),
      CAREER_OPS_USER: '', CAREER_OPS_SCAN_HANDOFF: join(dir, 'unselected.json'),
    } });
    assert.equal(unselected.status, 1, unselected.stderr);
    assert.match(unselected.stderr, /No career-ops user selected/);
    assert.equal(existsSync(join(dir, 'unselected.json')), false);
    assert.equal(existsSync(unexpected), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// Intercept the actual child handoff publication, when the old snapshot/restore
// implementation had already clobbered the shared file. Run a main scan at
// that exact point or kill the child, without allowing any real HTTP requests.
for (const stop of ['concurrent', 'child', 'wrapper']) {
  test(`HN private handoff survives ${stop === 'concurrent' ? 'a concurrent main scan' : `forced ${stop} termination`}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'career-ops-handoff-isolation-'));
    try {
      mkdirSync(join(dir, 'data'));
      writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive: [Software Engineer]\n');
      const mainPortals = join(dir, 'main-portals.yml');
      writeFileSync(mainPortals, 'tracked_companies: []\njob_boards: []\n');
      const shared = join(dir, 'data', 'scan-handoff.json');
      const inheritedOverride = join(dir, 'parent-lane-handoff.json');
      const original = 'main scan artifact before HN\n';
      writeFileSync(shared, original);
      writeFileSync(inheritedOverride, original);
      const observed = join(dir, 'observed.json');
      const mainSnapshot = join(dir, 'main-snapshot.json');
      const { preload, unexpected } = writeFetchFixture(dir);
      const intercept = join(dir, 'handoff-intercept.cjs');
      writeFileSync(intercept, `
        require(${JSON.stringify(preload)});
        const fs = require('node:fs');
        const originalWrite = fs.writeFileSync;
        const originalRename = fs.renameSync;
        fs.renameSync = function(source, file, ...args) {
          const result = originalRename.call(this, source, file, ...args);
          if (!process.env.MAIN_SCAN_FIXTURE && String(file).endsWith('scan-handoff.json')) {
            originalWrite(${JSON.stringify(observed)}, JSON.stringify({
              path: String(file), shared: fs.readFileSync(${JSON.stringify(shared)}, 'utf8'),
            }));
            if (${stop === 'wrapper'}) process.kill(process.ppid, 'SIGKILL');
            if (${stop !== 'concurrent'}) process.kill(process.pid, 'SIGKILL');
            const main = require('node:child_process').spawnSync(process.execPath, [
              '--require', ${JSON.stringify(intercept)},
              ${JSON.stringify(fileURLToPath(new URL('../scan.mjs', import.meta.url)))}, '--json',
            ], { encoding: 'utf8', timeout: 15000, env: {
              ...process.env, MAIN_SCAN_FIXTURE: '1',
              CAREER_OPS_PORTALS: ${JSON.stringify(mainPortals)}, CAREER_OPS_SCAN_HANDOFF: '',
            }});
            if (main.status !== 0) throw new Error('main fixture failed: ' + main.stderr);
            originalWrite(${JSON.stringify(mainSnapshot)}, fs.readFileSync(${JSON.stringify(shared)}));
          }
          return result;
        };
        require('node:module').syncBuiltinESMExports();
      `);
      const result = runScanHn(dir, intercept, ['--json'], { CAREER_OPS_SCAN_HANDOFF: inheritedOverride });
      assert.equal(result.error, undefined, result.error?.message);
      if (stop === 'wrapper') assert.notEqual(result.status, 0, result.stderr);
      else assert.equal(result.status, stop === 'child' ? 1 : 0, result.stderr);
      const observation = JSON.parse(readFileSync(observed, 'utf8'));
      assert.notEqual(observation.path, shared);
      assert.notEqual(observation.path, inheritedOverride);
      assert.equal(observation.shared, original, 'HN must never transiently replace the shared file');
      assert.equal(readFileSync(inheritedOverride, 'utf8'), original, 'HN owns its private path even with an inherited override');
      assert.equal(readFileSync(shared, 'utf8'), stop !== 'concurrent' ? original : readFileSync(mainSnapshot, 'utf8'));
      if (stop === 'wrapper') {
        // SIGKILL skips finally. Only the private scratch artifact may remain.
        const scratch = dirname(observation.path);
        assert.ok(scratch.startsWith(join(tmpdir(), 'career-ops-hn-')));
        assert.equal(existsSync(scratch), true);
        rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } else {
        assert.equal(existsSync(dirname(observation.path)), false, 'the wrapper removes only its temporary directory');
      }
      assert.equal(existsSync(unexpected), false);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}
