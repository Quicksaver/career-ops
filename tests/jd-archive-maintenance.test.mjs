import './user-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveReportEvidence, checkJdArchive } from '../check-jd-archive.mjs';
import { maintainJdArchives, structuredPostingText } from '../lib/jd-archive-maintenance.mjs';
import { partitionReviewedFindings, readReviewLedger } from '../lib/verification-review.mjs';

const description = 'Responsibilities: You will design and build reliable distributed services, review code, collaborate with product teams, and maintain production systems. Requirements: We seek an experienced engineer who can debug difficult problems, communicate clearly, write maintainable code, and support customers. You will work closely with colleagues to improve performance, measure outcomes, document technical decisions, and deliver useful software through small, well tested changes with careful attention to operational reliability and accessibility.';
const url = 'https://jobs.example.com/posting/123';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-archive-maintenance-'));
  for (const dir of ['data', 'reports', 'jds']) mkdirSync(join(root, dir));
  const file = 'reports/001-fixture-2026-01-01.md';
  const report = `# Evaluation: Fixture — Engineer\n\n**URL:** ${url}\n\n## Machine Summary\n\`\`\`yaml\ncompany: Fixture\nrole: Engineer\nscore: 4.0\n\`\`\`\n`;
  writeFileSync(join(root, file), report);
  const tracker = join(root, 'data/applications.md');
  writeFileSync(tracker, '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-01-01 | Fixture | Engineer | 4.0/5 | Applied | — | [1](../reports/001-fixture-2026-01-01.md) | fixture |\n');
  const context = { userId: 'fixture', userRoot: root };
  const verification = () => ({ user: 'fixture', root, tracker, errors: [], warnings: [{
    id: 'jd-review:001-fixture-2026-01-01.md', code: 'jd_archive_review_due', message: 'JD archive missing',
    details: { file, ...archiveReportEvidence(readFileSync(join(root, file), 'utf8')) },
  }] });
  return { root, file, report, context, verification, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('recover an exact saved capture without network, preserving report and source provenance', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'jds/arbitrary-name.md'), `---\nsource_url: ${url}\n---\n\n${description}`);
    const result = await maintainJdArchives(f.context, f.verification(), { retrieve: () => assert.fail('must use local capture') });
    assert.equal(result.recovered, 1);
    assert.equal(result.known_gaps, 0);
    assert.equal(readFileSync(join(f.root, f.file), 'utf8'), f.report);
    assert.match(readFileSync(join(f.root, result.entries[0].capture_file), 'utf8'), /Responsibilities: You will/);
    assert.equal(result.entries[0].source.path, 'jds/arbitrary-name.md');
    assert.equal(checkJdArchive(join(f.root, 'reports'), join(f.root, 'jds'), { trackerPath: join(f.root, 'data/applications.md') }).findings.length, 0);
  } finally { f.cleanup(); }
});

test('unrecoverable gap is informational, durable, retried only explicitly or after changed evidence', async () => {
  const f = fixture(); let calls = 0;
  try {
    const options = { runId: 'fixture', retrieve: async () => { calls++; return null; } };
    const original = f.verification();
    assert.equal((await maintainJdArchives(f.context, original, options)).known_gaps, 1);
    assert.equal((await maintainJdArchives(f.context, original, options)).known_gaps, 1);
    assert.equal(calls, 1);
    const ledgerPath = join(f.root, 'data/verification-reviews.jsonl');
    const ledger = readReviewLedger(ledgerPath);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].classification, 'informational');
    assert.match(ledger[0].rationale, /not an archive or a user confirmation/);
    assert.equal(partitionReviewedFindings(original, ledger).active.length, 0);
    assert.equal(checkJdArchive(join(f.root, 'reports'), join(f.root, 'jds'), { trackerPath: join(f.root, 'data/applications.md') }).findings.length, 1, 'gap acknowledgement must not claim an archive exists');
    await maintainJdArchives(f.context, original, { ...options, retryGaps: true });
    assert.equal(calls, 2);
    writeFileSync(join(f.root, f.file), f.report.replace('/123', '/456'));
    const changed = f.verification();
    assert.equal(partitionReviewedFindings(changed, readReviewLedger(ledgerPath)).active.length, 1);
    await maintainJdArchives(f.context, changed, options);
    assert.equal(calls, 3);
    assert.equal(readReviewLedger(ledgerPath).length, 2);
  } finally { f.cleanup(); }
});

test('a newly saved source repairs a known gap without repeating network requests', async () => {
  const f = fixture(); let calls = 0;
  try {
    const options = { retrieve: async () => { calls++; return null; } };
    await maintainJdArchives(f.context, f.verification(), options);
    writeFileSync(join(f.root, 'jds/newly-recovered.md'), `source_url: ${url}\n\n${description}`);
    assert.equal((await maintainJdArchives(f.context, f.verification(), options)).recovered, 1);
    assert.equal(calls, 1);
  } finally { f.cleanup(); }
});

test('different posting, company boilerplate and login-wall captures cannot repair a JD', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'jds/other.md'), `source_url: https://jobs.example.com/posting/999\n\n${description}`);
    writeFileSync(join(f.root, 'jds/company.md'), `source_url: ${url}\n\n${'We are a global business serving customers around the world. '.repeat(8)}`);
    const result = await maintainJdArchives(f.context, f.verification(), { retrieve: async () => ({ text: description, source: { url: 'https://jobs.example.com/posting/999' } }) });
    assert.equal(result.recovered, 0);
    assert.equal(result.known_gaps, 1);
  } finally { f.cleanup(); }
});

test('conflicting saved descriptions remain a known gap instead of choosing arbitrary historical wording', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'jds/old.md'), `source_url: ${url}\n\n${description}`);
    writeFileSync(join(f.root, 'jds/new.md'), `source_url: ${url}\n\n${description} The role now requires additional management duties.`);
    const result = await maintainJdArchives(f.context, f.verification(), { retrieve: () => assert.fail('conflicting historical evidence needs no new current wording') });
    assert.equal(result.entries[0].reason, 'conflicting_saved_descriptions');
    assert.equal(result.recovered, 0);
  } finally { f.cleanup(); }
});

test('live exact-posting recovery records present capture time without rewriting historical evaluation', async () => {
  const f = fixture();
  try {
    const result = await maintainJdArchives(f.context, f.verification(), { retrieve: async source => ({ text: description, source: { kind: 'exact_posting_api', url: source, historical_text: false } }) });
    assert.equal(result.recovered, 1);
    assert.match(readFileSync(join(f.root, result.entries[0].capture_file), 'utf8'), /does not establish the historical wording/);
    assert.equal(readFileSync(join(f.root, f.file), 'utf8'), f.report);
  } finally { f.cleanup(); }
});

test('LinkedIn archives use local evidence only and never trigger login or paid workers', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, f.file), f.report.replace(url, 'https://www.linkedin.com/jobs/view/4470000001/'));
    const result = await maintainJdArchives(f.context, f.verification(), { retrieve: () => assert.fail('LinkedIn must not be fetched') });
    assert.equal(result.entries[0].reason, 'authenticated_source_unavailable');
    assert.equal(result.known_gaps, 1);
  } finally { f.cleanup(); }
});

test('hard archive errors and mismatched user or report evidence cannot be acknowledged', async () => {
  const f = fixture();
  try {
    const hard = f.verification(); hard.errors = [{ ...hard.warnings[0], code: 'missing_jd_archive' }]; hard.warnings = [];
    assert.equal((await maintainJdArchives(f.context, hard)).entries.length, 0);
    assert.equal(existsSync(join(f.root, 'data/verification-reviews.jsonl')), false);
    await assert.rejects(maintainJdArchives({ ...f.context, userId: 'other' }, f.verification()), /selected user/);
    const stale = f.verification(); writeFileSync(join(f.root, f.file), f.report + '\nChanged');
    await assert.rejects(maintainJdArchives(f.context, stale), /changed since verification/);
  } finally { f.cleanup(); }
});

test('structured recovery accepts only one exact role and rejects a board or wrong posting', () => {
  const jsonLd = jobs => `<script type="application/ld+json">${JSON.stringify(jobs)}</script>`;
  const job = { '@type': 'JobPosting', url, description };
  assert.equal(structuredPostingText(jsonLd(job), url).text, description);
  assert.equal(structuredPostingText(jsonLd([job, { ...job, url: 'https://jobs.example.com/posting/999' }]), url), null);
  assert.equal(structuredPostingText(jsonLd({ ...job, url: 'https://jobs.example.com/posting/999' }), url), null);
  assert.equal(structuredPostingText(jsonLd({ ...job, url: undefined }), url), null);
  assert.equal(structuredPostingText('<p>Company homepage</p>', url), null);
});
