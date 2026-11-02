// tests/ollama-profile-context.test.mjs — Ollama receives both profile sources (#2488).
//
// Run the real CLI from an isolated fixture root and capture its request with a
// mock Ollama server. This proves profile content reaches the model without
// touching a contributor's local career-ops data.
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import {
  copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { listTree } from '../lib/walk-tree.mjs';
import { pass, fail, ownRootEnv, NODE, ROOT } from './helpers.mjs';

console.log('\nollama-eval — includes profile.yml and _profile.md in model context (#2488)');

const fixtureRoot = mkdtempSync(join(ROOT, '.tmp-script-test-ollama-profile-context-'));
const copyIntoFixture = (relativePath) => {
  const destination = join(fixtureRoot, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(ROOT, relativePath), destination);
};

/** Copy a directory (and everything under it) into the fixture root. */
const copyDirIntoFixture = (relativeDir) => {
  for (const abs of listTree(join(ROOT, relativeDir))) copyIntoFixture(relative(ROOT, abs));
};

// The fixture is a hand-maintained transitive closure of ollama-eval's imports,
// and every new shared module it pulls in has to be added here or the child dies
// with ERR_MODULE_NOT_FOUND before it reaches the mock server (#5530-era fix).
// Enumerating lib/ file by file made that a recurring papercut: the privacy
// boundary added three modules (llm-outbound, privacy-guard, pii-interceptor)
// and the list silently went stale. lib/ is a flat, dependency-light shared
// layer, so copy the whole directory instead and stop maintaining the closure by
// hand. Top-level entry points stay explicit — those are the files under test.
copyDirIntoFixture('lib');

for (const relativePath of [
  'ollama-eval.mjs',
  'path-resolver.mjs',
  'pipeline-lock.mjs',
  'lib/cli-flags.mjs',
  'profile-language.mjs',
  'reserve-report-num.mjs',
  'tracker-aliases.json',
  'tracker-parse.mjs',
  'tracker-utils.mjs',
  'utils/token-tracker.mjs',
]) {
  copyIntoFixture(relativePath);
}

mkdirSync(join(fixtureRoot, 'modes'), { recursive: true });
const usersDir = join(fixtureRoot, 'users');
mkdirSync(join(usersDir, 'test', 'config'), { recursive: true });
mkdirSync(join(usersDir, 'test', 'modes'), { recursive: true });
writeFileSync(join(usersDir, 'test', 'config', 'profile.yml'), [
  'language:',
  '  output: en',
  'north_star: PROFILE_YML_SENTINEL_REMOTE_ONLY',
  '',
].join('\n'));
writeFileSync(join(usersDir, 'test', 'modes', '_profile.md'), 'PROFILE_MD_SENTINEL_REMOTE_ONLY\n');
writeFileSync(join(fixtureRoot, 'modes', '_shared.md'), 'SHARED CONTEXT\n');
writeFileSync(join(fixtureRoot, 'modes', 'oferta.md'), 'EVALUATION MODE\n');
writeFileSync(join(usersDir, 'test', 'cv.md'), 'CANDIDATE CV\n');

let capturedSystemPrompt = '';
const responseText = [
  'Evaluation complete.',
  '---SCORE_SUMMARY---',
  'COMPANY: Example',
  'ROLE: Engineer',
  'SCORE: 4.0',
  'ARCHETYPE: Builder',
  'LEGITIMACY: High Confidence',
  '---END_SUMMARY---',
].join('\n');

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [] }));
      return;
    }

    try {
      const body = JSON.parse(raw);
      capturedSystemPrompt = body.messages?.find((message) => message.role === 'system')?.content ?? '';
    } catch {
      capturedSystemPrompt = '';
    }

    if (req.url === '/api/chat') {
      res.end(JSON.stringify({
        message: { role: 'assistant', content: responseText },
        prompt_eval_count: 10,
        eval_count: 5,
      }));
    } else {
      res.end(JSON.stringify({
        choices: [{ message: { content: responseText } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    }
  });
});

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const result = await new Promise((resolve) => {
    execFile(
      NODE,
      [join(fixtureRoot, 'ollama-eval.mjs'), '--user', 'test', '--url', `http://127.0.0.1:${port}`, '--no-save', 'On-site role.'],
      { timeout: 30000, env: ownRootEnv({ CAREER_OPS_USERS_DIR: usersDir }) },

      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    );
  });

  if (result.error) {
    fail(`Ollama fixture run failed: ${(result.stderr || result.error.message).trim().split('\n').pop()}`);
  } else {
    pass('runs the real Ollama evaluator against the isolated mock server');
  }

  if (capturedSystemPrompt.includes('PROFILE_YML_SENTINEL_REMOTE_ONLY')) {
    pass('sends config/profile.yml content to Ollama');
  } else {
    fail('config/profile.yml content is missing from the Ollama system prompt');
  }

  if (capturedSystemPrompt.includes('PROFILE_MD_SENTINEL_REMOTE_ONLY')) {
    pass('sends modes/_profile.md content to Ollama');
  } else {
    fail('modes/_profile.md content is missing from the Ollama system prompt');
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(fixtureRoot, { recursive: true, force: true });
}
