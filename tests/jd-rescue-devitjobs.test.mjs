import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pass, fail, ROOT, NODE } from './helpers.mjs';

console.log('\nJD rescue from the DevITJobs family server-rendered job');

// DevITJobs boards render client-side, so the stripped page is a title and
// chrome. The JD ships in window.__detailedJob; before this strategy the batch
// handed the worker an empty JD file.
const SCRIPT = join(ROOT, 'batch/jd-rescue.mjs');

function rescue(html, url) {
  const dir = mkdtempSync(join(tmpdir(), 'co-jdrescue-devit-'));
  const raw = join(dir, 'page.html');
  const out = join(dir, 'jd.txt');
  writeFileSync(raw, html);
  let stdout = '';
  let ok = true;
  try {
    stdout = execFileSync(NODE, [SCRIPT, url, raw, out, '12'], { encoding: 'utf-8', timeout: 20000 });
  } catch (e) {
    ok = false;
    stdout = e.stdout ?? '';
  }
  const [words, method] = String(stdout).trim().split('\t');
  const result = { ok, words: Number(words) || 0, method: method ?? '', out: existsSync(out) ? readFileSync(out, 'utf-8') : null };
  rmSync(dir, { recursive: true, force: true });
  return result;
}

const list = marker => Array.from({ length: 30 }, (_, i) => `- ${marker} ${i}`).join('\n');
const page = (job) => `<html><head><script>window.__detailedJob = ${JSON.stringify(job).replaceAll('</', '\\u003c/')}</script></head><body><div id="app">Palantir Developer Job in UK</div></body></html>`;
const job = {
  name: 'Palantir Developer',
  company: 'Experis',
  actualCity: 'UK',
  workplace: 'remote',
  jobType: 'Full-Time',
  description: 'We are a growing Defence &amp; National Security practice.',
  responsibilitiesTextArea: list('Build data pipelines'),
  requirementsMustTextArea: list('Hands-on Foundry'),
  requirementsNiceTextArea: 'Gotham',
};

{
  const r = rescue(page(job), 'https://devitjobs.uk/jobs/Experis-Palantir-Developer');
  if (r.ok && r.method === 'devitjobs-detailed-job' && /## Responsibilities[\s\S]*Build data pipelines 29[\s\S]*## Requirements[\s\S]*## Nice to have\n\nGotham/.test(r.out) && r.out.includes('Defence & National Security')) pass('a DevITJobs page yields description, responsibilities and requirements');
  else fail(`DevITJobs job not rescued: ${JSON.stringify(r)}`);
}

{
  const r = rescue(page({ ...job, isDisabledOrOutdated: true }), 'https://swissdevjobs.ch/jobs/x');
  if (r.ok && r.out.startsWith('**Board status:** disabled or outdated')) pass('a disabled board posting says so at the top of the JD');
  else fail(`disabled posting not flagged: ${JSON.stringify(r)}`);
}

{
  const r = rescue(page(job), 'https://jobs.example.com/co/abc123');
  if (!r.ok) pass('the same global on another host is not read');
  else fail(`foreign host rescued: ${JSON.stringify(r)}`);
}
