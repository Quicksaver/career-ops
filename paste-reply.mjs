#!/usr/bin/env node

/**
 * paste-reply.mjs — manual, no-Gmail input path into the reply-watch.mjs
 * classification pipeline (#1802).
 *
 * reply-watch.mjs already classifies employer replies (Interview / Responded /
 * Need Action / Rejected / Offer / Auto-confirmation / Noise / Unknown), matches
 * them to tracker rows, and prompts before touching data/applications.md — but
 * its only input is users/{USER}/data/reply-candidates.json, and the only planned way to
 * populate that file is a Gmail scanner (#1583, unbuilt, requires OAuth
 * inbox-read access). This script is the alternative for anyone who doesn't
 * want to grant any tool mailbox access but is willing to paste an email's
 * text themselves.
 *
 * This script does ONE job: normalize raw pasted (or file-provided) email text
 * into the exact candidate object shape reply-watch.mjs expects, and append it
 * to the active user's data/reply-candidates.json. It does NOT classify the reply — classification
 * stays reply-watch.mjs's job. reply-matcher.mjs's classifyReply() derives its
 * verdict from `subject` + `body_snippet` text directly; `signal` is only ever
 * used as a supplementary confidence boost (`cand.signal || ''`), never a hard
 * dependency — so leaving `signal: null` here is safe. This script never runs
 * reply-watch.mjs itself and never touches the active user's applications.md.
 *
 * Usage:
 *   node paste-reply.mjs --user <username>                  # interactive
 *   node paste-reply.mjs --user <username> --file email.txt # file input
 *   node paste-reply.mjs --help
 *
 * --file format (header lines optional, blank line separates headers from body):
 *   Subject: <subject line>
 *   From: <sender email or name>
 *
 *   <body text, any number of lines>
 *
 * If no "Subject:"/"From:" header lines are found, the entire file content is
 * treated as the body and the subject is left blank.
 *
 * Env:
 *   CAREER_OPS_REPLY_CANDIDATES  override the output JSON path (used by tests;
 *                                 otherwise the active user's path is required)
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import {
  getUserContext,
  printUserContextErrorAndExit,
  userPath,
} from './lib/user-context.mjs';

const CANDIDATES_OVERRIDE = process.env.CAREER_OPS_REPLY_CANDIDATES || '';


/**
 * Parse the --file input format: optional "Subject:"/"From:" header lines,
 * an optional blank separator line, then the body (everything else).
 * Exported for direct unit testing.
 */
export function parseFileInput(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let subject = '';
  let from = '';
  let i = 0;
  while (i < lines.length) {
    const subjMatch = /^Subject:\s*(.*)$/i.exec(lines[i]);
    const fromMatch = /^From:\s*(.*)$/i.exec(lines[i]);
    if (subjMatch) {
      subject = subjMatch[1].trim();
      i++;
      continue;
    }
    if (fromMatch) {
      from = fromMatch[1].trim();
      i++;
      continue;
    }
    break;
  }
  if (lines[i] === '') i++; // skip a single blank header/body separator
  const body = lines.slice(i).join('\n').trim();
  return { subject, from, body };
}

// No real email message ID exists on the manual path — synthesize a unique one
// from a timestamp + short random suffix so two pastes in the same millisecond
// can never collide.
function nextMessageId() {
  return `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalize raw {subject, from, body} into the exact candidate shape
 * reply-watch.mjs expects. Exported for direct unit testing.
 */
export function normalizeCandidate({ subject, from, body }) {
  return {
    message_id: nextMessageId(),
    from: from || '',
    subject: subject || '',
    body_snippet: body || '',
    // Classification is reply-watch.mjs's job, not this script's — leaving
    // signal unset is safe (see file header comment for why).
    signal: null,
  };
}

/**
 * Append a candidate to the candidates JSON file, creating the file/array if
 * missing, without disturbing any existing entries. Exported for direct unit
 * testing. Returns the total candidate count after the append.
 */
export function appendCandidate(candidate, candidatesPath = CANDIDATES_OVERRIDE) {
  if (!candidatesPath) {
    throw new Error('No reply candidates path selected; run the CLI with --user <username>.');
  }
  let candidates = [];
  if (fs.existsSync(candidatesPath)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
    } catch (e) {
      throw new Error(`Could not parse existing candidates file at ${candidatesPath}: ${e.message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`Existing candidates file at ${candidatesPath} is not a JSON array`);
    }
    candidates = parsed;
  } else {
    fs.mkdirSync(path.dirname(candidatesPath), { recursive: true });
  }
  candidates.push(candidate);
  // Write-then-rename so an interrupted write (crash, signal, disk full)
  // can never leave the real candidates file truncated/corrupted.
  const tmpPath = `${candidatesPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(candidates, null, 2), 'utf-8');
  fs.renameSync(tmpPath, candidatesPath);
  return candidates.length;
}

// Collect subject/from/body from stdin via a single readline.Interface and a
// tiny manual state machine driven off its 'line' event.
//
// Earlier drafts chained `rl.question()` calls (one interface per prompt, or
// repeated `.question()` on one interface). Both are unreliable on piped
// (non-TTY) stdin: Node's readline resolves the FIRST `.question()` call
// correctly, but a SECOND `.question()` on the same interface never fires its
// callback when the input isn't a real TTY — confirmed directly against this
// Node build, not assumed. A single 'line' listener with manual state
// tracking works identically on both TTY and piped/non-interactive stdin.
function collectInteractive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let stage = 'subject';
  let subject = '';
  let from = '';
  const bodyLines = [];

  rl.setPrompt('Subject: ');
  rl.prompt();

  return new Promise((resolve) => {
    rl.on('line', (line) => {
      if (stage === 'subject') {
        subject = line.trim();
        stage = 'from';
        rl.setPrompt('From (optional, press Enter to skip): ');
        rl.prompt();
      } else if (stage === 'from') {
        from = line.trim();
        stage = 'body';
        console.log('Paste the email body. Finish with EOF (Ctrl+D, or Ctrl+Z then Enter on Windows):');
        rl.setPrompt('');
      } else {
        bodyLines.push(line);
      }
    });
    rl.on('close', () => resolve({ subject, from, body: bodyLines.join('\n').trim() }));
  });
}

function printHelp() {
  console.log(`paste-reply.mjs — manual/no-Gmail input into the reply-watch.mjs pipeline (#1802)

Usage:
  node paste-reply.mjs --user <username>                  interactive input
  node paste-reply.mjs --user <username> --file <path>    file input
  node paste-reply.mjs --help

--file format:
  Subject: <subject line>
  From: <sender>            (optional)

  <body text...>

If no Subject:/From: header lines are found, the whole file is treated as the body.

Appends one normalized candidate to users/{USER}/data/reply-candidates.json (creates it if
missing; never overwrites or removes existing entries). Run
\`node reply-watch.mjs --user {USER}\` afterward to classify it and review tracker updates —
this script never runs reply-watch.mjs or touches the tracker itself.`);
}

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    return;
  }

  let userContext;
  try {
    userContext = getUserContext(rawArgs, { requireUser: !CANDIDATES_OVERRIDE });
  } catch (err) {
    printUserContextErrorAndExit(err);
  }
  const args = userContext.args;
  const candidatesPath = CANDIDATES_OVERRIDE || userPath(userContext, 'data/reply-candidates.json');

  const fileIdx = args.indexOf('--file');
  let input;
  if (fileIdx !== -1) {
    const filePath = args[fileIdx + 1];
    if (!filePath) {
      console.error('Error: --file requires a path argument.');
      process.exit(1);
    }
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    input = parseFileInput(raw);
  } else {
    input = await collectInteractive();
  }

  if (!input.subject && !input.body) {
    console.error('Error: no subject or body text found — nothing to add.');
    process.exit(1);
  }

  const candidate = normalizeCandidate(input);
  const total = appendCandidate(candidate, candidatesPath);

  const preview = candidate.body_snippet.length > 80
    ? `${candidate.body_snippet.slice(0, 80)}…`
    : candidate.body_snippet;

  console.log('\nAppended a new reply candidate:');
  console.log(`  message_id:   ${candidate.message_id}`);
  console.log(`  from:         ${candidate.from || '(none)'}`);
  console.log(`  subject:      ${candidate.subject || '(none)'}`);
  console.log(`  body_snippet: ${preview || '(none)'}`);
  console.log(`\n${candidatesPath} now has ${total} candidate(s).`);
  const userFlag = userContext.userId ? ` --user ${userContext.userId}` : '';
  console.log(`Next: run \`node reply-watch.mjs${userFlag}\` to classify and review this reply.`);
}

// Only run when executed directly (`node paste-reply.mjs`), not when imported
// for unit testing (e.g. `import(pathToFileURL(SCRIPT).href)` in tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
