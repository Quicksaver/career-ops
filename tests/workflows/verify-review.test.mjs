import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { pathToFileURL } from 'url';
import { fail, pass, ROOT } from '../helpers.mjs';

console.log('\nWorkflow — reviewed verification lifecycle');

const reviewLib = await import(pathToFileURL(join(ROOT, 'lib/verification-review.mjs')).href);
const schemaLib = await import(pathToFileURL(join(ROOT, 'lib/openai-output-schema.mjs')).href);
const tmp = mkdtempSync(join(tmpdir(), 'career-ops-verify-review-'));
const usersDir = join(tmp, 'users');
const userRoot = join(usersDir, 'test');
const dataDir = join(userRoot, 'data');
const reportsDir = join(userRoot, 'reports');
const mergedDir = join(userRoot, 'batch/tracker-additions/merged');
const outputDir = join(userRoot, 'output');
mkdirSync(dataDir, { recursive: true });
mkdirSync(reportsDir, { recursive: true });
mkdirSync(mergedDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });

const env = { ...process.env, CAREER_OPS_USERS_DIR: usersDir };
const trackerPath = join(dataDir, 'applications.md');
writeFileSync(trackerPath, [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-01-01 | Existing | Engineer | **4.0/5** | Evaluated | — | [1](../reports/001-existing-2026-01-01.md) | fixture |',
  '',
].join('\n'));
writeFileSync(join(reportsDir, '001-existing-2026-01-01.md'), [
  '# Evaluation: Existing — Engineer', '', '**URL:** https://example.com/jobs/1', '',
  '## Machine Summary', '```yaml', 'company: Existing', 'role: Engineer', 'score: 4.0', '```', '',
].join('\n'));
writeFileSync(join(reportsDir, '010-restorable-2026-01-02.md'), [
  '# Evaluation: Restorable — Backend Engineer', '', '**URL:** https://example.com/jobs/10', '',
  '## Machine Summary', '```yaml', 'company: Restorable', 'role: Backend Engineer', 'score: 3.8', '```', '',
].join('\n'));
writeFileSync(join(mergedDir, '7.tsv'), '010\t2026-01-02\tRestorable\tBackend Engineer\tEvaluated\t3.8/5\t❌\t[010](reports/010-restorable-2026-01-02.md)\trestore fixture\n');
writeFileSync(join(reportsDir, '011-archive-me-2026-01-03.md'), [
  '# Evaluation: Archive Me — Engineer', '', '**URL:** https://example.com/jobs/11', '',
  '## Machine Summary', '```yaml', 'company: Archive Me', 'role: Engineer', 'score: 2.0', '```', '',
].join('\n'));
writeFileSync(join(outputDir, '011-archive-me-2026-01-03.pdf'), 'fixture\n');

function decision(finding, overrides) {
  return {
    finding_id: finding.id,
    finding_code: finding.code,
    finding_level: finding.level,
    classification: 'false_positive',
    disposition: 'mark_seen',
    severity: 'low',
    needs_human_review: false,
    rationale: 'Fixture finding was inspected and accepted.',
    evidence: [],
    duplicate_resolution: null,
    orphan_resolution: null,
    tracker_patch: null,
    ...overrides,
  };
}

function applyReview(verification, findings) {
  const verificationPath = join(tmp, `verification-${Math.random()}.json`);
  const reviewPath = join(tmp, `review-${Math.random()}.json`);
  writeFileSync(verificationPath, JSON.stringify(verification));
  writeFileSync(reviewPath, JSON.stringify({ status: 'completed', needs_human_review: false, findings }));
  return JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'apply-verification-review.mjs'), '--user', 'test',
    '--verification', verificationPath, '--review', reviewPath, '--run-id', 'fixture', '--json',
  ], { cwd: ROOT, env, encoding: 'utf-8' }));
}

try {
  const reviewSchema = JSON.parse(readFileSync(join(ROOT, 'schemas/verify-review-output.schema.json'), 'utf-8'));
  try {
    schemaLib.assertOpenAIStructuredOutputSchema(reviewSchema, 'verify review schema');
    pass('verify review response schema stays within the OpenAI Structured Outputs subset');
  } catch (error) {
    fail(`verify review response schema is incompatible with Structured Outputs: ${error.message}`);
  }
  try {
    schemaLib.assertOpenAIStructuredOutputSchema({
      type: 'array', uniqueItems: true, items: { type: 'integer' },
    }, 'fixture schema');
    fail('Structured Outputs preflight accepted unsupported uniqueItems');
  } catch (error) {
    if (error.message.includes('uniqueItems') && error.message.includes('$.uniqueItems')) {
      pass('Structured Outputs preflight rejects unsupported schema keywords before invoking Codex');
    } else {
      fail(`Structured Outputs preflight returned the wrong diagnostic: ${error.message}`);
    }
  }
  try {
    schemaLib.assertUniqueArrayValues([1, 2, 2], 'duplicate_tracker_nums');
    fail('post-response validator accepted repeated duplicate candidates');
  } catch (error) {
    if (error.message.includes('duplicate_tracker_nums must contain unique values')) {
      pass('post-response validation preserves uniqueness outside the response schema');
    } else {
      fail(`post-response uniqueness validation returned the wrong diagnostic: ${error.message}`);
    }
  }

  const rawWarning = {
    id: 'possible-duplicate-tracker:1:2',
    code: 'possible_duplicate_tracker',
    message: 'Possible duplicate fixture',
    details: { tracker_nums: [1, 2] },
  };
  const verification = { errors: [], warnings: [rawWarning] };
  const finding = reviewLib.verificationFindings(verification)[0];
  const seenResult = applyReview(verification, [decision(finding)]);
  const ledger = reviewLib.readReviewLedger(join(dataDir, 'verification-reviews.jsonl'));
  const exact = reviewLib.partitionReviewedFindings(verification, ledger);
  const changed = reviewLib.partitionReviewedFindings({
    errors: [], warnings: [{ ...rawWarning, details: { tracker_nums: [1, 2], changed: true } }],
  }, ledger);
  if (seenResult.seen_recorded === 1 && exact.seen.length === 1 && exact.active.length === 0 && changed.active.length === 1) {
    pass('mark-seen ledger suppresses only the exact finding fingerprint and resurfaces changed evidence');
  } else {
    fail(`finding review partition wrong: exact=${JSON.stringify(exact)} changed=${JSON.stringify(changed)}`);
  }

  const orphanVerification = {
    errors: [],
    warnings: [{
      id: 'orphan-report:010-restorable-2026-01-02.md', code: 'orphan_report',
      message: 'Orphan report fixture', details: { report_num: 10, file: 'reports/010-restorable-2026-01-02.md' },
    }],
  };
  const orphanFinding = reviewLib.verificationFindings(orphanVerification)[0];
  const restored = applyReview(orphanVerification, [decision(orphanFinding, {
    classification: 'confirmed_orphan', disposition: 'restore_orphan',
    rationale: 'Complete evaluation and preserved tracker TSV should remain tracked.',
    evidence: [{ path: 'batch/tracker-additions/merged/7.tsv', observation: 'TSV matches report 010.' }],
    orphan_resolution: {
      report_file: 'reports/010-restorable-2026-01-02.md',
      tracker_tsv: 'batch/tracker-additions/merged/7.tsv',
    },
  })]);
  const restoredTracker = readFileSync(trackerPath, 'utf-8');
  if (restored.tracker_rows_restored === 1 && restoredTracker.includes('| 10 |') &&
      restoredTracker.includes('[010](../reports/010-restorable-2026-01-02.md)')) {
    pass('confirmed orphan can be deterministically restored from its preserved merged TSV');
  } else {
    fail(`orphan restore wrong: result=${JSON.stringify(restored)} tracker=${restoredTracker}`);
  }

  const archiveVerification = {
    errors: [],
    warnings: [{
      id: 'orphan-report:011-archive-me-2026-01-03.md', code: 'orphan_report',
      message: 'Redundant orphan fixture', details: { report_num: 11, file: 'reports/011-archive-me-2026-01-03.md' },
    }],
  };
  const archiveFinding = reviewLib.verificationFindings(archiveVerification)[0];
  const archived = applyReview(archiveVerification, [decision(archiveFinding, {
    classification: 'confirmed_orphan', disposition: 'archive_orphan',
    rationale: 'Fixture report was verified as redundant.',
    evidence: [{ path: 'reports/011-archive-me-2026-01-03.md', observation: 'Fixture evidence.' }],
    orphan_resolution: { report_file: 'reports/011-archive-me-2026-01-03.md', tracker_tsv: null },
  })]);
  const archiveRoots = readdirSync(join(reportsDir, 'orphans'));
  const archivedReport = join(reportsDir, 'orphans', archiveRoots[0], '011-archive-me-2026-01-03.md');
  if (archived.orphans_archived === 1 && archived.artifacts_archived === 1 &&
      existsSync(archivedReport) && !existsSync(join(reportsDir, '011-archive-me-2026-01-03.md'))) {
    pass('confirmed redundant orphan and matching output are backed up and archived');
  } else {
    fail(`orphan archive wrong: ${JSON.stringify(archived)}`);
  }

  const patchVerification = {
    errors: [],
    warnings: [{
      id: 'bold-score:1', code: 'bold_score', message: 'Bold score fixture',
      details: { tracker_num: 1, score: '**4.0/5**' },
    }],
  };
  const patchFinding = reviewLib.verificationFindings(patchVerification)[0];
  const patched = applyReview(patchVerification, [decision(patchFinding, {
    classification: 'actionable', disposition: 'patch_tracker',
    rationale: 'Report score confirms the unformatted value.',
    evidence: [{ path: 'reports/001-existing-2026-01-01.md', observation: 'Machine Summary score is 4.0.' }],
    tracker_patch: { tracker_num: 1, company: null, via: null, status: null, score: '4.0/5', report: null },
  })]);
  if (patched.tracker_rows_patched === 1 && readFileSync(trackerPath, 'utf-8').includes('| 4.0/5 |')) {
    pass('bounded tracker patch repairs an evidence-backed verifier finding');
  } else {
    fail(`tracker patch wrong: ${JSON.stringify(patched)}`);
  }

  writeFileSync(trackerPath, readFileSync(trackerPath, 'utf-8').replace('| 4.0/5 |', '| **4.0/5** |'));
  const chunkRows = [];
  for (let num = 20; num < 25; num++) {
    const padded = String(num).padStart(3, '0');
    const reportFile = `${padded}-chunk-company-${num}-2026-01-04.md`;
    chunkRows.push(`| ${num} | 2026-01-04 | Chunk Company ${num} | Engineer ${num} | **3.0/5** | Evaluated | — | [${num}](../reports/${reportFile}) | chunk fixture |`);
    writeFileSync(join(reportsDir, reportFile), [
      `# Evaluation: Chunk Company ${num} — Engineer ${num}`, '',
      `**URL:** https://example.com/jobs/${num}`, '',
      '## Machine Summary', '```yaml', `company: Chunk Company ${num}`,
      `role: Engineer ${num}`, 'score: 3.0', '```', '',
    ].join('\n'));
  }
  writeFileSync(trackerPath, `${readFileSync(trackerPath, 'utf-8').trimEnd()}\n${chunkRows.join('\n')}\n`);
  const fakeBin = join(tmp, 'bin');
  const fakeCodex = join(fakeBin, 'codex');
  const callCount = join(tmp, 'codex-calls.txt');
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(fakeCodex, [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    "const args = process.argv.slice(2);",
    "const output = args[args.indexOf('--output-last-message') + 1];",
    "let stdin = '';",
    "process.stdin.on('data', chunk => { stdin += chunk; });",
    "process.stdin.on('end', () => {",
    "  const inputPath = stdin.match(/^FINDINGS_JSON=(.+)$/m)[1].trim();",
    "  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));",
    "  if (input.findings.length > 5) { console.error('review chunk exceeded 5 findings'); process.exit(2); return; }",
    "  const findings = input.findings.map(finding => ({",
    "    finding_id: finding.id, finding_code: finding.code, finding_level: finding.level,",
    "    classification: 'false_positive', disposition: 'mark_seen', severity: 'low', needs_human_review: false,",
    "    rationale: 'Fixture reviewer confirmed an unchanged formatting warning.', evidence: [],",
    "    duplicate_resolution: null, orphan_resolution: null, tracker_patch: null,",
    "  }));",
    "  fs.appendFileSync(process.env.FAKE_CODEX_CALLS, '1\\n');",
    "  fs.writeFileSync(output, JSON.stringify({ status: 'completed', needs_human_review: false, findings }));",
    "});",
  ].join('\n') + '\n');
  execFileSync('chmod', ['+x', fakeCodex]);
  const runnerEnv = {
    ...env,
    PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
    FAKE_CODEX_CALLS: callCount,
  };
  const firstProcess = spawnSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2',
  ], { cwd: ROOT, env: runnerEnv, encoding: 'utf-8' });
  if (firstProcess.status !== 0) throw new Error(`first verify runner failed: ${firstProcess.stderr}`);
  const firstRun = JSON.parse(firstProcess.stdout);
  const secondRun = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2', '--quiet',
  ], { cwd: ROOT, env: runnerEnv, encoding: 'utf-8' }));
  const calls = readFileSync(callCount, 'utf-8').trim().split(/\r?\n/).filter(Boolean).length;
  if (firstRun.status === 'completed' && firstRun.counts.raw_warnings === 6 && firstRun.counts.seen === 6 &&
      secondRun.status === 'completed' && secondRun.passes === 0 && calls === 2) {
    pass('standalone verify runner reviews at most five findings per call, records seen state, and suppresses unchanged findings');
  } else {
    fail(`verify runner lifecycle wrong: first=${JSON.stringify(firstRun)} second=${JSON.stringify(secondRun)} calls=${calls}`);
  }
  if (firstProcess.stderr.includes('assigned findings 1-5 of 6') &&
      firstProcess.stderr.includes('reviewed 1/6 warning bold_score bold-score:1') &&
      firstProcess.stderr.includes('decision: mark_seen (classification=false_positive, severity=low, human_review=no; pending apply)') &&
      firstProcess.stderr.includes('rationale: Fixture reviewer confirmed an unchanged formatting warning.')) {
    pass('verify runner streams each finding issue, decision, and rationale after every review chunk');
  } else {
    fail(`verify runner omitted per-finding progress: ${firstProcess.stderr}`);
  }
} catch (error) {
  fail(`reviewed verification tests crashed: ${error.stack || error.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
