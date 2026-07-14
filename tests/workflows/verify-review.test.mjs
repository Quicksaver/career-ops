import { execFileSync, spawn, spawnSync } from 'child_process';
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

  const archiveFindings = [636, 677, 705, 709, 712].map(num => ({
    level: 'warning',
    id: `orphan-report:${num}-bairesdev-2026-06-03.md`,
    code: 'orphan_report',
    details: { report_num: num, file: `reports/${num}-bairesdev-2026-06-03.md` },
  }));
  const incompleteArchiveReview = {
    status: 'completed', needs_human_review: false,
    findings: archiveFindings.map(finding => decision(finding, {
      classification: 'confirmed_orphan', disposition: 'archive_orphan',
      orphan_resolution: null,
    })),
  };
  const normalizedArchiveReview = reviewLib.normalizeReviewDecisions(
    archiveFindings, incompleteArchiveReview,
  );
  try {
    reviewLib.validateReviewDecisions(archiveFindings, normalizedArchiveReview.review);
    const canonical = normalizedArchiveReview.review.findings.every((item, index) =>
      item.orphan_resolution?.report_file === archiveFindings[index].details.file &&
      item.orphan_resolution?.tracker_tsv === null);
    if (canonical && normalizedArchiveReview.normalizations.length === 5) {
      pass('archive_orphan report metadata is derived deterministically for every finding in a chunk');
    } else {
      fail(`archive_orphan normalization wrong: ${JSON.stringify(normalizedArchiveReview)}`);
    }
  } catch (error) {
    fail(`normalized archive_orphan decisions did not validate: ${error.message}`);
  }

  const restorePathReview = {
    status: 'completed', needs_human_review: false,
    findings: [decision(archiveFindings[0], {
      classification: 'confirmed_orphan', disposition: 'restore_orphan',
      orphan_resolution: {
        report_file: `users/test/${archiveFindings[0].details.file}`,
        tracker_tsv: 'users/test/batch/tracker-additions/merged/636.tsv',
      },
    })],
  };
  const normalizedRestorePathReview = reviewLib.normalizeReviewDecisions(
    [archiveFindings[0]], restorePathReview,
  );
  try {
    reviewLib.validateReviewDecisions([archiveFindings[0]], normalizedRestorePathReview.review);
    const resolution = normalizedRestorePathReview.review.findings[0].orphan_resolution;
    if (resolution.report_file === archiveFindings[0].details.file &&
        resolution.tracker_tsv === 'batch/tracker-additions/merged/636.tsv' &&
        normalizedRestorePathReview.normalizations.length === 1) {
      pass('restore_orphan report and tracker TSV paths are canonicalized before checkpointing');
    } else {
      fail(`restore_orphan path normalization wrong: ${JSON.stringify(normalizedRestorePathReview)}`);
    }
  } catch (error) {
    fail(`normalized restore_orphan paths did not validate: ${error.message}`);
  }

  const aggregateInvalidReview = {
    status: 'completed', needs_human_review: false,
    findings: archiveFindings.slice(0, 2).map(finding => decision(finding, {
      classification: 'confirmed_orphan', disposition: 'restore_orphan',
      orphan_resolution: null,
    })),
  };
  try {
    reviewLib.validateReviewDecisions(archiveFindings.slice(0, 2), aggregateInvalidReview);
    fail('review validation accepted multiple malformed orphan decisions');
  } catch (error) {
    if (error.validationErrors?.length === 2 &&
        error.message.includes(archiveFindings[0].id) &&
        error.message.includes(archiveFindings[1].id)) {
      pass('review validation reports every malformed decision in the five-finding chunk');
    } else {
      fail(`review validation did not aggregate malformed decisions: ${error.message}`);
    }
  }

  const relatedFindings = [
    {
      level: 'warning', id: 'possible-duplicate-tracker:1:2', code: 'possible_duplicate_tracker',
      details: {
        tracker_nums: [1, 2],
        entries: [
          { tracker_num: 1, report: '[1](../reports/001-one.md)' },
          { tracker_num: 2, report: '[2](../reports/002-two.md)' },
        ],
      },
    },
    {
      level: 'warning', id: 'duplicate-reports:001-one.md:002-two.md', code: 'duplicate_reports_same_role',
      details: { files: ['reports/001-one.md', 'reports/002-two.md'] },
    },
    {
      level: 'warning', id: 'orphan-report:002-two.md', code: 'orphan_report',
      details: { report_num: 2, file: 'reports/002-two.md' },
    },
    {
      level: 'warning', id: 'bold-score:99', code: 'bold_score',
      details: { tracker_num: 99, score: '**3.0/5**' },
    },
  ];
  const dependencyLanes = reviewLib.buildReviewLanes(relatedFindings, 2);
  const laneFor = findingId => dependencyLanes.findIndex(lane =>
    lane.some(item => item.finding.id === findingId));
  if (dependencyLanes.length === 2 &&
      laneFor(relatedFindings[0].id) === laneFor(relatedFindings[1].id) &&
      laneFor(relatedFindings[1].id) === laneFor(relatedFindings[2].id) &&
      laneFor(relatedFindings[3].id) !== laneFor(relatedFindings[0].id)) {
    pass('parallel review lanes serialize overlapping tracker/report/orphan identities');
  } else {
    fail(`dependency-safe review lanes wrong: ${JSON.stringify(dependencyLanes)}`);
  }

  const combinedDuplicateResolution = {
    keeper_tracker_num: 1,
    duplicate_tracker_nums: [2],
    keeper_report_file: 'users/test/reports/001-one.md',
    duplicate_report_files: ['users/test/reports/002-two.md'],
  };
  const combinedDuplicateReview = {
    status: 'completed', needs_human_review: false,
    findings: relatedFindings.slice(0, 2).map(finding => decision(finding, {
      classification: 'confirmed_duplicate', disposition: 'resolve_duplicate', severity: 'medium',
      duplicate_resolution: combinedDuplicateResolution,
    })),
  };
  try {
    reviewLib.validateReviewDecisions(relatedFindings.slice(0, 2), combinedDuplicateReview);
    fail('review validation accepted tracker and report fields copied into both duplicate findings');
  } catch (error) {
    if (error.validationErrors?.length >= 2 &&
        error.message.includes('tracker duplicate resolution cannot include report files') &&
        error.message.includes('report duplicate resolution cannot include tracker rows')) {
      pass('review validation rejects cross-type fields on paired duplicate findings');
    } else {
      fail(`paired duplicate validation returned the wrong diagnostics: ${error.message}`);
    }
  }
  const normalizedDuplicateReview = reviewLib.normalizeReviewDecisions(
    relatedFindings.slice(0, 2), combinedDuplicateReview,
  );
  try {
    reviewLib.validateReviewDecisions(relatedFindings.slice(0, 2), normalizedDuplicateReview.review);
    const [trackerDecision, reportDecision] = normalizedDuplicateReview.review.findings;
    if (normalizedDuplicateReview.normalizations.length === 2 &&
        trackerDecision.duplicate_resolution.keeper_report_file === null &&
        trackerDecision.duplicate_resolution.duplicate_report_files.length === 0 &&
        reportDecision.duplicate_resolution.keeper_tracker_num === null &&
        reportDecision.duplicate_resolution.duplicate_tracker_nums.length === 0 &&
        reportDecision.duplicate_resolution.keeper_report_file === 'reports/001-one.md' &&
        reportDecision.duplicate_resolution.duplicate_report_files[0] === 'reports/002-two.md') {
      pass('paired duplicate decisions are mechanically split into tracker-only and report-only plans');
    } else {
      fail(`paired duplicate normalization wrong: ${JSON.stringify(normalizedDuplicateReview)}`);
    }
  } catch (error) {
    fail(`normalized paired duplicate decisions did not validate: ${error.message}`);
  }

  const trackerDuplicateDecision = decision(relatedFindings[0], {
    classification: 'confirmed_duplicate', disposition: 'resolve_duplicate', severity: 'medium',
    duplicate_resolution: {
      keeper_tracker_num: 1, duplicate_tracker_nums: [2],
      keeper_report_file: null, duplicate_report_files: [],
    },
  });
  const reportDuplicateDecision = decision(relatedFindings[1], {
    classification: 'confirmed_duplicate', disposition: 'resolve_duplicate', severity: 'medium',
    duplicate_resolution: {
      keeper_tracker_num: null, duplicate_tracker_nums: [],
      keeper_report_file: 'reports/001-one.md',
      duplicate_report_files: ['reports/002-two.md'],
    },
  });
  try {
    reviewLib.validateDuplicateConsistency(
      { errors: [], warnings: relatedFindings.slice(0, 2) },
      { findings: [trackerDuplicateDecision, reportDuplicateDecision] },
    );
    pass('exact tracker/report duplicate candidate sets accept a matching keeper');
  } catch (error) {
    fail(`matching exact duplicate decisions conflicted: ${error.message}`);
  }
  try {
    reviewLib.validateDuplicateConsistency(
      { errors: [], warnings: relatedFindings.slice(0, 2) },
      { findings: [trackerDuplicateDecision, decision(relatedFindings[1], {})] },
    );
    fail('exact tracker/report duplicate candidate sets accepted conflicting dispositions');
  } catch (error) {
    if (error.message.includes('duplicate consistency validation failed')) {
      pass('exact tracker/report duplicate candidate sets still require one disposition');
    } else {
      fail(`exact duplicate conflict returned the wrong diagnostic: ${error.message}`);
    }
  }
  const broadReportFinding = {
    level: 'warning',
    id: 'duplicate-reports:001-one.md:002-two.md:003-orphan.md',
    code: 'duplicate_reports_same_role',
    details: { files: ['reports/001-one.md', 'reports/002-two.md', 'reports/003-orphan.md'] },
  };
  try {
    reviewLib.validateDuplicateConsistency(
      { errors: [], warnings: [relatedFindings[0], broadReportFinding] },
      { findings: [trackerDuplicateDecision, decision(broadReportFinding, {})] },
    );
    pass('a non-duplicate report superset does not invalidate a proven tracker subset');
  } catch (error) {
    fail(`broad report superset incorrectly conflicted with tracker subset: ${error.message}`);
  }

  const jobIdFixtures = [
    reviewLib.findingJobIds(relatedFindings[0]),
    reviewLib.findingJobIds(relatedFindings[1]),
    reviewLib.findingJobIds(relatedFindings[2]),
    reviewLib.findingJobIds({
      details: { tracker_num: 207, report: '[206](reports/206-example.md)' },
    }),
  ];
  if (JSON.stringify(jobIdFixtures) === JSON.stringify([[1, 2], [1, 2], [2], [207]])) {
    pass('review progress job IDs prefer tracker IDs and fall back to report IDs');
  } else {
    fail(`review progress job IDs wrong: ${JSON.stringify(jobIdFixtures)}`);
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

  writeFileSync(join(reportsDir, '012-legacy-tabs-2026-01-02.md'), [
    '# Evaluation: Legacy Tabs — Backend Engineer', '',
    '**URL:** https://example.com/jobs/12', '',
    '## Machine Summary', '```yaml', 'company: Legacy Tabs',
    'role: Backend Engineer', 'score: 3.1', '```', '',
  ].join('\n'));
  writeFileSync(join(mergedDir, '8.tsv'), [
    '012', '2026-01-02', 'Legacy Tabs', 'Backend Engineer', 'Evaluated', '3.1/5',
    '—', '[012](reports/012-legacy-tabs-2026-01-02.md)', 'legacy escaped tabs',
  ].join('\\t') + '\n');
  const legacyOrphanVerification = {
    errors: [], warnings: [{
      id: 'orphan-report:012-legacy-tabs-2026-01-02.md', code: 'orphan_report',
      message: 'Legacy escaped TSV fixture',
      details: { report_num: 12, file: 'reports/012-legacy-tabs-2026-01-02.md' },
    }],
  };
  const legacyOrphanFinding = reviewLib.verificationFindings(legacyOrphanVerification)[0];
  const legacyRestored = applyReview(legacyOrphanVerification, [decision(legacyOrphanFinding, {
    classification: 'confirmed_orphan', disposition: 'restore_orphan',
    rationale: 'Legacy merged artifact is otherwise a complete tracker row.',
    evidence: [{ path: 'batch/tracker-additions/merged/8.tsv', observation: 'Row matches report 012.' }],
    orphan_resolution: {
      report_file: 'reports/012-legacy-tabs-2026-01-02.md',
      tracker_tsv: 'batch/tracker-additions/merged/8.tsv',
    },
  })]);
  if (legacyRestored.tracker_rows_restored === 1 &&
      readFileSync(trackerPath, 'utf-8').includes('| 12 |')) {
    pass('orphan restoration accepts legacy merged TSVs with escaped tab separators');
  } else {
    fail(`legacy escaped TSV restore wrong: ${JSON.stringify(legacyRestored)}`);
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
  mkdirSync(join(userRoot, 'config'), { recursive: true });
  writeFileSync(join(userRoot, 'config/profile.yml'), [
    'batch:', '  parallel: 2',
    'codex:', '  model: profile-review-model', '  reasoning_effort: low', '',
  ].join('\n'));
  const fakeBin = join(tmp, 'bin');
  const fakeCodex = join(fakeBin, 'codex');
  const callCount = join(tmp, 'codex-calls.txt');
  const concurrencyLog = join(tmp, 'codex-concurrency.jsonl');
  const argvLog = join(tmp, 'codex-argv.jsonl');
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
    "  fs.appendFileSync(process.env.FAKE_CODEX_ARGV, JSON.stringify(args) + '\\n');",
    "  fs.appendFileSync(process.env.FAKE_CODEX_CONCURRENCY, JSON.stringify({ event: 'start', pid: process.pid, at: Date.now() }) + '\\n');",
    "  if (process.env.FAKE_CODEX_FAIL_FINDING && input.findings.some(finding => finding.id.includes(process.env.FAKE_CODEX_FAIL_FINDING))) {",
    "    console.error('fixture reviewer failure'); process.exit(3); return;",
    "  }",
    "  let findings = input.findings.map(finding => ({",
    "    finding_id: finding.id, finding_code: finding.code, finding_level: finding.level,",
    "    classification: 'false_positive', disposition: 'mark_seen', severity: 'low', needs_human_review: false,",
    "    rationale: 'Fixture reviewer confirmed an unchanged formatting warning.', evidence: [],",
    "    duplicate_resolution: null, orphan_resolution: null, tracker_patch: null,",
    "  }));",
    "  if (process.env.FAKE_CODEX_COMBINED_DUPLICATES) {",
    "    findings = input.findings.map(finding => {",
    "      if (!['possible_duplicate_tracker', 'duplicate_reports_same_role'].includes(finding.code)) return {",
    "        finding_id: finding.id, finding_code: finding.code, finding_level: finding.level,",
    "        classification: 'false_positive', disposition: 'mark_seen', severity: 'low', needs_human_review: false,",
    "        rationale: 'Fixture reviewer accepted an unrelated finding.', evidence: [],",
    "        duplicate_resolution: null, orphan_resolution: null, tracker_patch: null,",
    "      };",
    "      const trackerNums = finding.code === 'possible_duplicate_tracker'",
    "        ? finding.details.tracker_nums",
    "        : finding.details.files.map(file => Number(file.split('/').pop().match(/^([0-9]+)/)[1]));",
    "      const reportFiles = finding.code === 'duplicate_reports_same_role'",
    "        ? finding.details.files",
    "        : finding.details.entries.map(entry => entry.report.match(/\\]\\(([^)]+)\\)/)[1]).map(file => `reports/${file.split('/').pop()}`);",
    "      return {",
    "        finding_id: finding.id, finding_code: finding.code, finding_level: finding.level,",
    "        classification: 'confirmed_duplicate', disposition: 'resolve_duplicate', severity: 'medium', needs_human_review: false,",
    "        rationale: 'Fixture reports identify the same canonical posting.', evidence: [{ path: 'fixture', observation: 'Same posting ID.' }],",
    "        duplicate_resolution: {",
    "          keeper_tracker_num: trackerNums[0], duplicate_tracker_nums: trackerNums.slice(1),",
    "          keeper_report_file: `users/test/${reportFiles[0]}`, duplicate_report_files: reportFiles.slice(1).map(file => `users/test/${file}`),",
    "        },",
    "        orphan_resolution: null, tracker_patch: null,",
    "      };",
    "    });",
    "  }",
    "  if (process.env.FAKE_CODEX_RESTORE_ORPHAN) {",
    "    findings = input.findings.map(finding => {",
    "      if (finding.code !== 'orphan_report') return {",
    "        finding_id: finding.id, finding_code: finding.code, finding_level: finding.level,",
    "        classification: 'false_positive', disposition: 'mark_seen', severity: 'low', needs_human_review: false,",
    "        rationale: 'Fixture reviewer accepted an unrelated finding.', evidence: [],",
    "        duplicate_resolution: null, orphan_resolution: null, tracker_patch: null,",
    "      };",
    "      const reportNum = finding.details.report_num;",
    "      return {",
    "        finding_id: finding.id, finding_code: finding.code, finding_level: finding.level,",
    "        classification: 'confirmed_orphan', disposition: 'restore_orphan', severity: 'low', needs_human_review: false,",
    "        rationale: 'Fixture has a preserved merged tracker row.',",
    "        evidence: [{ path: `users/test/batch/tracker-additions/merged/${reportNum}.tsv`, observation: 'Preserved row matches.' }],",
    "        duplicate_resolution: null,",
    "        orphan_resolution: { report_file: `users/test/${finding.details.file}`, tracker_tsv: `users/test/batch/tracker-additions/merged/${reportNum}.tsv` },",
    "        tracker_patch: null,",
    "      };",
    "    });",
    "  }",
    "  if (process.env.FAKE_CODEX_MANUAL_REVIEW) {",
    "    findings = input.findings.map(finding => ({",
    "      finding_id: finding.id, finding_code: finding.code, finding_level: finding.level,",
    "      classification: 'needs_human_review', disposition: 'manual_review', severity: 'medium', needs_human_review: true,",
    "      rationale: 'Fixture requires a user decision.', evidence: [],",
    "      duplicate_resolution: null, orphan_resolution: null, tracker_patch: null,",
    "    }));",
    "  }",
    "  if (process.env.FAKE_CODEX_INVALID_ONCE && !fs.existsSync(process.env.FAKE_CODEX_INVALID_ONCE)) {",
    "    fs.writeFileSync(process.env.FAKE_CODEX_INVALID_ONCE, 'invalid emitted\\n');",
    "    findings = findings.map(finding => ({ ...finding, classification: 'actionable', disposition: 'patch_tracker', tracker_patch: null }));",
    "  }",
    "  setTimeout(() => {",
    "    fs.appendFileSync(process.env.FAKE_CODEX_CALLS, '1\\n');",
    "    fs.writeFileSync(output, JSON.stringify({ status: 'completed', needs_human_review: findings.some(finding => finding.needs_human_review), findings }));",
    "    fs.appendFileSync(process.env.FAKE_CODEX_CONCURRENCY, JSON.stringify({ event: 'end', pid: process.pid, at: Date.now() }) + '\\n');",
    "  }, Number(process.env.FAKE_CODEX_DELAY || 150));",
    "});",
  ].join('\n') + '\n');
  execFileSync('chmod', ['+x', fakeCodex]);
  const runnerEnv = {
    ...env,
    PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
    FAKE_CODEX_CALLS: callCount,
    FAKE_CODEX_CONCURRENCY: concurrencyLog,
    FAKE_CODEX_ARGV: argvLog,
  };
  const firstProcess = spawnSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2', '--json',
  ], { cwd: ROOT, env: runnerEnv, encoding: 'utf-8' });
  if (firstProcess.status !== 0) throw new Error(`first verify runner failed: ${firstProcess.stderr}`);
  const firstRun = JSON.parse(firstProcess.stdout);
  const secondRun = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2', '--quiet', '--json',
  ], { cwd: ROOT, env: runnerEnv, encoding: 'utf-8' }));
  const calls = readFileSync(callCount, 'utf-8').trim().split(/\r?\n/).filter(Boolean).length;
  const concurrencyEvents = readFileSync(concurrencyLog, 'utf-8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const intervals = new Map();
  for (const event of concurrencyEvents) {
    const interval = intervals.get(event.pid) || {};
    interval[event.event] = event.at;
    intervals.set(event.pid, interval);
  }
  const completedIntervals = [...intervals.values()].filter(interval => interval.start && interval.end);
  const overlapped = completedIntervals.length === 2 &&
    Math.max(...completedIntervals.map(interval => interval.start)) <
      Math.min(...completedIntervals.map(interval => interval.end));
  const reviewerArgv = readFileSync(argvLog, 'utf-8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const inheritedCodexSettings = reviewerArgv.length === 2 && reviewerArgv.every(args =>
    args.includes('--model') && args[args.indexOf('--model') + 1] === 'profile-review-model' &&
    args.includes('-c') && args[args.indexOf('-c') + 1] === 'model_reasoning_effort="low"');
  const phaseLogsUnique = new Set(firstRun.phases.map(phase => phase.log)).size === firstRun.phases.length &&
    firstRun.phases.every(phase => phase.status === 'completed');
  const completedRunFiles = readdirSync(firstRun.logs);
  if (firstRun.status === 'completed' && firstRun.counts.raw_warnings === 6 && firstRun.counts.seen === 6 &&
      firstRun.parallel === 2 && firstRun.parallel_source === 'profile' && inheritedCodexSettings &&
      phaseLogsUnique && overlapped && completedRunFiles.length === 1 && completedRunFiles[0] === 'summary.json' &&
      secondRun.status === 'completed' && secondRun.passes === 0 && calls === 2) {
    pass('standalone verify runner runs concurrent review lanes, suppresses seen findings, and compacts completed artifacts');
  } else {
    fail(`verify runner lifecycle wrong: first=${JSON.stringify(firstRun)} second=${JSON.stringify(secondRun)} calls=${calls}`);
  }
  if (firstProcess.stderr.includes('2 dependency-safe lane(s), up to 2 concurrent reviewer(s)') &&
      firstProcess.stderr.includes(`[verify] run-id: ${firstRun.run_id}`) &&
      firstProcess.stderr.includes(`[verify] logs: ${firstRun.logs}`) &&
      firstProcess.stderr.includes('reviewed 1/6, job #1, bold_score → false_positive') &&
      !firstProcess.stderr.includes('  issue:') &&
      !firstProcess.stderr.includes('  decision:') &&
      !firstProcess.stderr.includes('  rationale:') &&
      !firstProcess.stderr.includes('  evidence:')) {
    pass('verify runner keeps machine stdout pure while streaming concise review progress to stderr');
  } else {
    fail(`verify runner per-finding progress was missing or verbose: ${firstProcess.stderr}`);
  }

  const retryReport = '026-retry-company-2026-01-04.md';
  writeFileSync(join(reportsDir, retryReport), [
    '# Evaluation: Retry Company — Engineer', '',
    '**URL:** https://example.com/jobs/26', '',
    '## Machine Summary', '```yaml', 'company: Retry Company',
    'role: Engineer', 'score: 3.0', '```', '',
  ].join('\n'));
  writeFileSync(trackerPath, `${readFileSync(trackerPath, 'utf-8').trimEnd()}\n| 26 | 2026-01-04 | Retry Company | Engineer | **3.0/5** | Evaluated | — | [26](../reports/${retryReport}) | retry fixture |\n`);
  const invalidOnce = join(tmp, 'invalid-once.marker');
  const retryRun = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2',
    '--parallel', '1', '--review-retries', '1', '--quiet', '--json',
  ], {
    cwd: ROOT,
    env: { ...runnerEnv, FAKE_CODEX_INVALID_ONCE: invalidOnce },
    encoding: 'utf-8',
  }));
  if (retryRun.status === 'completed' && retryRun.review_resilience.retries_used === 1 &&
      retryRun.review_resilience.semantic_retry_limit === 1 &&
      retryRun.phases.some(phase => phase.name.includes('-retry-01'))) {
    pass('invalid five-finding review contracts retry only their current chunk');
  } else {
    fail(`review semantic retry wrong: ${JSON.stringify(retryRun)}`);
  }

  const checkpointRows = [];
  for (let num = 40; num < 46; num++) {
    const reportFile = `${num}-checkpoint-company-${num}-2026-01-04.md`;
    checkpointRows.push(`| ${num} | 2026-01-04 | Checkpoint Company ${num} | Engineer ${num} | **3.0/5** | Evaluated | — | [${num}](../reports/${reportFile}) | checkpoint fixture |`);
    writeFileSync(join(reportsDir, reportFile), [
      `# Evaluation: Checkpoint Company ${num} — Engineer ${num}`, '',
      `**URL:** https://example.com/jobs/${num}`, '',
      '## Machine Summary', '```yaml', `company: Checkpoint Company ${num}`,
      `role: Engineer ${num}`, 'score: 3.0', '```', '',
    ].join('\n'));
  }
  writeFileSync(trackerPath, `${readFileSync(trackerPath, 'utf-8').trimEnd()}\n${checkpointRows.join('\n')}\n`);
  const checkpointFailure = spawnSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2',
    '--parallel', '1', '--review-retries', '0', '--quiet', '--json',
  ], {
    cwd: ROOT,
    env: { ...runnerEnv, FAKE_CODEX_FAIL_FINDING: 'bold-score:45' },
    encoding: 'utf-8',
  });
  const failedCheckpointRun = JSON.parse(checkpointFailure.stdout);
  const checkpointFiles = readdirSync(failedCheckpointRun.logs)
    .filter(name => name.startsWith('review-checkpoint.'));
  const humanFailure = spawnSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2',
    '--parallel', '1', '--review-retries', '0', '--quiet',
  ], {
    cwd: ROOT,
    env: { ...runnerEnv, FAKE_CODEX_FAIL_FINDING: 'bold-score:45' },
    encoding: 'utf-8',
  });
  if (humanFailure.status === 1 && humanFailure.stdout.includes('[verify] summary: failed') &&
      humanFailure.stdout.includes('[verify] error:') &&
      !humanFailure.stdout.includes('"initial_verification"') &&
      humanFailure.stdout.length < 8000) {
    pass('verify runner failure output is compact and exposes only the actual operational error');
  } else {
    fail(`verify runner human failure contract wrong: status=${humanFailure.status} stdout=${humanFailure.stdout}`);
  }
  const resumedCheckpointRun = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2',
    '--parallel', '1', '--review-retries', '0', '--resume-run', failedCheckpointRun.run_id,
    '--quiet', '--json',
  ], { cwd: ROOT, env: runnerEnv, encoding: 'utf-8' }));
  if (checkpointFailure.status === 1 && failedCheckpointRun.status === 'failed' &&
      checkpointFiles.length === 1 && resumedCheckpointRun.status === 'completed' &&
      resumedCheckpointRun.resumed_from === failedCheckpointRun.run_id &&
      resumedCheckpointRun.review_resilience.checkpoints_reused === 1) {
    pass('resume-run reuses only validated matching chunk checkpoints');
  } else {
    fail(`review checkpoint resume wrong: failed=${JSON.stringify(failedCheckpointRun)} checkpoints=${JSON.stringify(checkpointFiles)} resumed=${JSON.stringify(resumedCheckpointRun)}`);
  }

  for (const num of [60, 61]) {
    const reportFile = `${String(num).padStart(3, '0')}-paired-duplicate-2026-01-06.md`;
    writeFileSync(join(reportsDir, reportFile), [
      '# Evaluation: Paired Duplicate — Backend Engineer', '',
      '**URL:** https://example.com/jobs/shared-posting', '',
      '## Machine Summary', '```yaml', 'company: Paired Duplicate',
      'role: Backend Engineer', 'score: 3.0', '```', '',
    ].join('\n'));
    writeFileSync(trackerPath, `${readFileSync(trackerPath, 'utf-8').trimEnd()}\n| ${num} | 2026-01-06 | Paired Duplicate | Backend Engineer | 3.0/5 | SKIP | — | [${num}](../reports/${reportFile}) | duplicate fixture |\n`);
  }
  const normalizedDuplicateRun = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2',
    '--parallel', '1', '--review-retries', '0', '--quiet', '--json',
  ], {
    cwd: ROOT,
    env: { ...runnerEnv, FAKE_CODEX_COMBINED_DUPLICATES: '1' },
    encoding: 'utf-8',
  }));
  if (normalizedDuplicateRun.status === 'completed' &&
      normalizedDuplicateRun.actions.tracker_rows_removed === 1 &&
      normalizedDuplicateRun.actions.reports_archived === 1 &&
      normalizedDuplicateRun.review_resilience.mechanical_normalizations >= 2) {
    pass('combined tracker/report reviewer output is normalized before duplicate resolution');
  } else {
    fail(`combined duplicate runner normalization wrong: ${JSON.stringify(normalizedDuplicateRun)}`);
  }

  const resumeReportFile = '070-resume-orphan-2026-01-07.md';
  writeFileSync(join(reportsDir, resumeReportFile), [
    '# Evaluation: Resume Orphan — Backend Engineer', '',
    '**URL:** https://example.com/jobs/resume-orphan', '',
    '## Machine Summary', '```yaml', 'company: Resume Orphan',
    'role: Backend Engineer', 'score: 3.0', '```', '',
  ].join('\n'));
  const callsBeforeApplyResume = readFileSync(callCount, 'utf-8').trim().split(/\r?\n/).filter(Boolean).length;
  const pendingApplyFailure = spawnSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2',
    '--parallel', '1', '--review-retries', '0', '--quiet', '--json',
  ], {
    cwd: ROOT,
    env: { ...runnerEnv, FAKE_CODEX_RESTORE_ORPHAN: '1' },
    encoding: 'utf-8',
  });
  const pendingApplyRun = JSON.parse(pendingApplyFailure.stdout);
  writeFileSync(join(mergedDir, '70.tsv'),
    `070\t2026-01-07\tResume Orphan\tBackend Engineer\tEvaluated\t3.0/5\t—\t[070](reports/${resumeReportFile})\tresume fixture\n`);
  const resumedApplyRun = JSON.parse(execFileSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2',
    '--parallel', '1', '--review-retries', '0', '--resume-run', pendingApplyRun.run_id,
    '--quiet', '--json',
  ], {
    cwd: ROOT,
    env: { ...runnerEnv, FAKE_CODEX_RESTORE_ORPHAN: '1' },
    encoding: 'utf-8',
  }));
  const callsAfterApplyResume = readFileSync(callCount, 'utf-8').trim().split(/\r?\n/).filter(Boolean).length;
  if (pendingApplyFailure.status === 1 && pendingApplyRun.status === 'failed' &&
      pendingApplyRun.error.includes('restore artifacts are missing') &&
      resumedApplyRun.status === 'completed' && resumedApplyRun.actions.tracker_rows_restored === 1 &&
      resumedApplyRun.review_resilience.checkpoints_reused === 1 &&
      callsAfterApplyResume - callsBeforeApplyResume === 1) {
    pass('resume continues a fingerprint-matched pending apply without repeating prompt review');
  } else {
    fail(`pending apply resume wrong: failed=${JSON.stringify(pendingApplyRun)} resumed=${JSON.stringify(resumedApplyRun)} callDelta=${callsAfterApplyResume - callsBeforeApplyResume}`);
  }

  const humanRun = spawnSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2',
  ], { cwd: ROOT, env: runnerEnv, encoding: 'utf-8' });
  const runIdPosition = humanRun.stdout.indexOf('[verify] run-id:');
  const firstPhasePosition = humanRun.stdout.indexOf('[verify] verify-pipeline-initial started');
  if (humanRun.status === 0 && humanRun.stdout.includes('[verify] summary: completed') &&
      humanRun.stdout.includes('[verify] reviewed ') &&
      runIdPosition >= 0 && firstPhasePosition > runIdPosition &&
      !humanRun.stdout.includes('"initial_verification"') &&
      !humanRun.stdout.trimStart().startsWith('{')) {
    pass('verify runner prints the run ID before work and ends with a compact human summary');
  } else {
    fail(`verify runner human summary contract wrong: status=${humanRun.status} stdout=${humanRun.stdout} stderr=${humanRun.stderr}`);
  }

  const manualReport = '027-manual-review-2026-01-04.md';
  writeFileSync(join(reportsDir, manualReport), [
    '# Evaluation: Manual Review — Engineer', '',
    '**URL:** https://example.com/jobs/27', '',
    '## Machine Summary', '```yaml', 'company: Manual Review',
    'role: Engineer', 'score: 3.0', '```', '',
  ].join('\n'));
  writeFileSync(trackerPath, `${readFileSync(trackerPath, 'utf-8').trimEnd()}\n| 27 | 2026-01-04 | Manual Review | Engineer | **3.0/5** | Evaluated | — | [27](../reports/${manualReport}) | manual fixture |\n`);
  const manualJsonProcess = spawnSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '1',
    '--parallel', '1', '--quiet', '--json',
  ], {
    cwd: ROOT,
    env: { ...runnerEnv, FAKE_CODEX_MANUAL_REVIEW: '1' },
    encoding: 'utf-8',
  });
  const manualJson = JSON.parse(manualJsonProcess.stdout);
  const manualRun = spawnSync(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '1',
    '--parallel', '1', '--quiet',
  ], {
    cwd: ROOT,
    env: { ...runnerEnv, FAKE_CODEX_MANUAL_REVIEW: '1' },
    encoding: 'utf-8',
  });
  const manualLines = manualRun.stdout.trim().split(/\r?\n/);
  if (manualJsonProcess.status === 0 && manualJson.status === 'partial' &&
      !Object.hasOwn(manualJson, 'humanReviewRecap') &&
      manualRun.status === 0 && manualRun.stdout.includes('[verify] summary: partial') &&
      manualRun.stdout.includes('[verify] human review required (1):') &&
      manualLines.at(-1) === '[verify] human review, job #27, bold_score → needs_human_review') {
    pass('non-JSON verification repeats human-review items in a compact final recap');
  } else {
    fail(`verify human-review recap wrong: status=${manualRun.status} stdout=${manualRun.stdout}`);
  }

  const interruptedRows = [];
  for (let num = 30; num < 32; num++) {
    const padded = String(num).padStart(3, '0');
    const reportFile = `${padded}-interrupt-company-${num}-2026-01-05.md`;
    interruptedRows.push(`| ${num} | 2026-01-05 | Interrupt Company ${num} | Engineer ${num} | **3.0/5** | Evaluated | — | [${num}](../reports/${reportFile}) | interrupt fixture |`);
    writeFileSync(join(reportsDir, reportFile), [
      `# Evaluation: Interrupt Company ${num} — Engineer ${num}`, '',
      `**URL:** https://example.com/jobs/${num}`, '',
      '## Machine Summary', '```yaml', `company: Interrupt Company ${num}`,
      `role: Engineer ${num}`, 'score: 3.0', '```', '',
    ].join('\n'));
  }
  writeFileSync(trackerPath, `${readFileSync(trackerPath, 'utf-8').trimEnd()}\n${interruptedRows.join('\n')}\n`);
  const startsBeforeInterrupt = readFileSync(concurrencyLog, 'utf-8').split(/\r?\n/)
    .filter(Boolean).map(JSON.parse).filter(event => event.event === 'start').length;
  const interruptedRunner = spawn(process.execPath, [
    join(ROOT, 'verify-runner.mjs'), '--user', 'test', '--max-passes', '2', '--quiet',
  ], {
    cwd: ROOT,
    env: { ...runnerEnv, FAKE_CODEX_DELAY: '10000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  interruptedRunner.stdout.resume();
  interruptedRunner.stderr.resume();
  let interruptReviewerPids = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(concurrencyLog)) {
      const starts = readFileSync(concurrencyLog, 'utf-8').split(/\r?\n/)
        .filter(Boolean).map(JSON.parse).filter(event => event.event === 'start');
      interruptReviewerPids = starts.slice(startsBeforeInterrupt).map(event => event.pid);
      if (interruptReviewerPids.length >= 2) break;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const interruptedExitPromise = new Promise(resolve =>
    interruptedRunner.once('exit', (code, signal) => resolve({ code, signal })));
  interruptedRunner.kill('SIGINT');
  const interruptedExit = await Promise.race([
    interruptedExitPromise,
    new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 3000)),
  ]);
  await new Promise(resolve => setTimeout(resolve, 100));
  const reviewerStillAlive = interruptReviewerPids.some(pid => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  });
  if (interruptReviewerPids.length === 2 && !interruptedExit.timeout &&
      interruptedExit.signal === 'SIGINT' && !reviewerStillAlive &&
      !existsSync(join(dataDir, 'verify-runner.pid'))) {
    pass('interrupting parallel review stops every reviewer and releases the user lock');
  } else {
    fail(`parallel review interrupt cleanup wrong: pids=${JSON.stringify(interruptReviewerPids)} exit=${JSON.stringify(interruptedExit)} alive=${reviewerStillAlive}`);
  }
} catch (error) {
  fail(`reviewed verification tests crashed: ${error.stack || error.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
