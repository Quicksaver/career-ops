#!/usr/bin/env node

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  getUserContext,
  printUserContextErrorAndExit,
  userPath,
} from './lib/user-context.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function usage() {
  console.log(`career-ops batch tailor — bulk generate tailored CVs for high-scoring batch jobs

Usage:
  node batch-tailor.mjs --user <id> [--min-score=4.0]

Options:
  --min-score=N   Minimum score to tailor (default: 4.0)
`);
  process.exit(0);
}

const rawArgs = process.argv.slice(2);
if (rawArgs.includes('-h') || rawArgs.includes('--help')) {
  usage();
}

let userContext;
try {
  userContext = getUserContext(rawArgs);
} catch (err) {
  printUserContextErrorAndExit(err);
}
const args = userContext.args;
const batchStateFile = userPath(userContext, 'batch/batch-state.tsv');
const reportsDir = userPath(userContext, 'reports');

let minScore = 4.0;
for (const arg of args) {
  if (arg.startsWith('--min-score=')) {
    minScore = parseFloat(arg.split('=')[1]);
  }
}

if (!existsSync(batchStateFile)) {
  console.error(`ERROR: Batch state file not found at ${batchStateFile}`);
  process.exit(1);
}

const lines = readFileSync(batchStateFile, 'utf-8').split('\n');
const toProcess = [];

for (const line of lines) {
  if (!line || line.startsWith('id\t')) continue;
  const parts = line.split('\t');
  if (parts.length < 7) continue;
  
  const id = parts[0];
  const url = parts[1];
  const status = parts[2];
  const reportNum = parts[5];
  const scoreStr = parts[6];
  
  if (status === 'completed') {
    const score = parseFloat(scoreStr);
    if (!isNaN(score) && score >= minScore) {
      toProcess.push({ id, url, reportNum, score });
    }
  }
}

if (toProcess.length === 0) {
  console.log(`No completed roles found with score >= ${minScore}.`);
  process.exit(0);
}

console.log(`Found ${toProcess.length} roles scoring >= ${minScore}. Beginning bulk tailoring...`);

const reports = existsSync(reportsDir) ? readdirSync(reportsDir) : [];

for (let i = 0; i < toProcess.length; i++) {
  const job = toProcess[i];
  console.log(`\n[${i + 1}/${toProcess.length}] Tailoring CV for Report ${job.reportNum} (Score: ${job.score}) — ${job.url}`);
  
  // Try to find the local report file to pass to the agent
  const matchingReport = reports.find(f => f.startsWith(`${job.reportNum}-`) && f.endsWith('.md'));
  const reportContext = matchingReport
    ? `\nThe evaluation report is available at: users/${userContext.userId}/reports/${matchingReport}`
    : '';
  
  const prompt = `Run career-ops pdf mode for active user ${userContext.userId}. Tailor the CV for this role and generate the HTML and PDF CVs under users/${userContext.userId}/output/. \nURL: ${job.url}\nReport number: ${job.reportNum}${reportContext}`;
  
  const claudeArgs = [
    '-p',
    '--dangerously-skip-permissions',
    '--append-system-prompt-file',
    'modes/pdf.md',
    prompt
  ];
  
  const res = spawnSync('claude', claudeArgs, { stdio: 'inherit', cwd: __dirname });
  if (res.error) {
    console.error(`Error running claude: ${res.error.message}`);
  } else if (res.status !== 0) {
    console.error(`Worker exited with status ${res.status}`);
  } else {
    console.log(`✅ Finished tailoring for Report ${job.reportNum}`);
  }
}

console.log('\nBulk tailoring complete.');
