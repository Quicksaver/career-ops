import test from 'node:test';
import assert from 'node:assert/strict';
import { reuseCompletedReview, verificationFindings } from '../lib/verification-review.mjs';

function fixture() {
  const finding = { id: 'bold-score:1', code: 'bold_score', message: 'Bold score', details: { tracker_num: 1, score: '**4.0/5**' } };
  const cleanup = { id: 'stale-reservation-removed:2-RESERVED.md', code: 'stale_reservation_removed', message: 'Removed stale reservation', details: { file: 'reports/2-RESERVED.md', resolved: true } };
  const saved = { errors: [], warnings: [finding, cleanup] };
  const current = { errors: [], warnings: [finding] };
  const review = { status: 'completed', needs_human_review: false, findings: verificationFindings(saved).map(item => ({
    finding_id: item.id, finding_code: item.code, finding_level: item.level,
    classification: 'false_positive', disposition: 'mark_seen', severity: 'low', needs_human_review: false,
    rationale: 'Inspected fixture evidence.', evidence: [], duplicate_resolution: null, orphan_resolution: null, tracker_patch: null,
  })) };
  return { saved, current, review };
}

test('completed review survives removal of already-resolved notices and lane regrouping', () => {
  const { saved, current, review } = fixture();
  const reused = reuseCompletedReview(saved, review, current, verificationFindings(current));
  assert.equal(reused.review.findings.length, 1);
  assert.equal(reused.review.findings[0].finding_id, 'bold-score:1');
});

for (const mode of ['changed', 'new', 'missing-unresolved', 'missing-decision']) {
  test(`completed review is not reused for ${mode} evidence`, () => {
    const { saved, current, review } = fixture();
    if (mode === 'changed') current.warnings = [{ ...current.warnings[0], details: { tracker_num: 1, score: '**2.0/5**' } }];
    if (mode === 'new') current.warnings.push({ id: 'bold-score:3', code: 'bold_score', details: { tracker_num: 3 } });
    if (mode === 'missing-unresolved') saved.warnings[1].details.resolved = false;
    if (mode === 'missing-decision') review.findings = review.findings.slice(1);
    assert.equal(reuseCompletedReview(saved, review, current, verificationFindings(current)), null);
  });
}

test('completed review reuse still validates saved decision contracts', () => {
  const { saved, current, review } = fixture();
  review.findings[0].finding_code = 'another_code';
  assert.throws(() => reuseCompletedReview(saved, review, current, verificationFindings(current)), /finding_code/);
});
