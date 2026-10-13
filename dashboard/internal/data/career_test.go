package data

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

func TestTrackerLockDirMatchesNodeProtocol(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	_, trackerPath := writeTracker(t, insertedColumnTracker)
	canonicalTracker, err := filepath.EvalSymlinks(trackerPath)
	if err != nil {
		t.Fatalf("canonical tracker: %v", err)
	}
	canonicalTemp, err := filepath.EvalSymlinks(os.TempDir())
	if err != nil {
		t.Fatalf("canonical temp dir: %v", err)
	}
	sum := sha256.Sum256([]byte(canonicalTracker))
	want := filepath.Join(canonicalTemp, fmt.Sprintf("career-ops-merge-tracker-%x.lock", sum[:8]))

	got, err := trackerLockDirFor(trackerPath)
	if err != nil {
		t.Fatalf("trackerLockDirFor: %v", err)
	}
	if got != want {
		t.Fatalf("lock dir = %q, want Node-compatible %q", got, want)
	}
}

func TestUpdateApplicationStatusWaitsForSharedLock(t *testing.T) {
	t.Setenv("CAREER_OPS_TRACKER_LOCK", "")
	tempDir, trackerPath := writeTracker(t, insertedColumnTracker)
	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 application, got %d", len(apps))
	}

	lock, err := acquireTrackerLock(trackerPath, trackerLockOptions{
		timeout: 2 * time.Second,
		retry:   10 * time.Millisecond,
		stale:   time.Minute,
	})
	if err != nil {
		t.Fatalf("acquire first lock: %v", err)
	}
	done := make(chan error, 1)
	go func() {
		done <- UpdateApplicationStatus(tempDir, apps[0], "Interview")
	}()

	select {
	case err := <-done:
		lock.release()
		t.Fatalf("dashboard update bypassed shared lock: %v", err)
	case <-time.After(150 * time.Millisecond):
		// Expected: the update is blocked before its tracker read.
	}
	concurrentRow := "| 99 | 2026-06-02 | Concurrent Co | Engineer | Remote | 4.0/5 | Evaluated | ❌ | [99](reports/099.md) | concurrent update |"
	contentWhileLocked, err := os.ReadFile(trackerPath)
	if err != nil {
		lock.release()
		t.Fatalf("read tracker while holding lock: %v", err)
	}
	updatedWhileLocked := strings.TrimRight(string(contentWhileLocked), "\n") + "\n" + concurrentRow + "\n"
	if err := os.WriteFile(trackerPath, []byte(updatedWhileLocked), 0o644); err != nil {
		lock.release()
		t.Fatalf("simulate concurrent tracker update: %v", err)
	}
	// CHECKED, not discarded. release() can return an error without removing
	// the directory and without marking itself released — os.RemoveAll on a
	// lock dir whose owner.json still has an open handle fails on Windows where
	// it succeeds on POSIX. Ignoring it left the lock in place, so the waiter
	// below blocked for its whole timeout and the test reported "did not resume
	// after lock release": the message blamed the resume, and the actual cause
	// had been thrown away.
	if err := lock.release(); err != nil {
		t.Fatalf("release first lock: %v", err)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("update after lock release: %v", err)
		}
	case <-time.After(10 * time.Second):
		// 10s against a 75ms production retry interval is a 133x margin, so
		// exhausting it means the waiter never re-acquired — i.e. the lock is
		// still there. Say whether it is, because that is the difference between
		// "slow" and "stuck" and the log could not tell them apart.
		t.Fatalf("dashboard update did not resume after lock release; %s", describeTrackerLock(lock.dir))
	}

	content, err := os.ReadFile(trackerPath)
	if err != nil {
		t.Fatalf("read tracker: %v", err)
	}
	if !strings.Contains(string(content), "| Interview |") {
		t.Fatalf("status was not updated after lock release:\n%s", content)
	}
	if !strings.Contains(string(content), concurrentRow) {
		t.Fatalf("dashboard update overwrote a row committed by the previous lock owner:\n%s", content)
	}
}

// Regression for #1180: a status word appearing as a substring of an earlier
// cell (Company "Applied Materials" contains "Applied") must not be rewritten;
// only the Status column changes.
func TestUpdateApplicationStatusOnlyRewritesStatusColumn(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("failed to create data dir: %v", err)
	}

	applications := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 7 | 2026-06-23 | Applied Materials | Staff Android Engineer | 4.2/5 | Applied | ✅ | [7](reports/007.md) | substring trap |
`
	path := filepath.Join(dataDir, "applications.md")
	if err := os.WriteFile(path, []byte(applications), 0o644); err != nil {
		t.Fatalf("failed to write tracker: %v", err)
	}

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 parsed application, got %d", len(apps))
	}

	if err := UpdateApplicationStatus(tempDir, apps[0], "Interview"); err != nil {
		t.Fatalf("UpdateApplicationStatus: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	out := string(got)

	if !strings.Contains(out, "| Applied Materials |") {
		t.Errorf("Company cell was corrupted, file now:\n%s", out)
	}
	if !strings.Contains(out, "| Interview |") {
		t.Errorf("Status cell was not updated to Interview, file now:\n%s", out)
	}
	if strings.Contains(out, "Interview Materials") {
		t.Errorf("status word was replaced inside the Company cell, file now:\n%s", out)
	}
	today := time.Now().Format("2006-01-02")
	if !strings.Contains(out, "substring trap; Status changed to Interview "+today) {
		t.Errorf("status interaction note was not appended, file now:\n%s", out)
	}

	reparsed := mustParseApplications(t, tempDir)
	if reparsed[0].Company != "Applied Materials" {
		t.Errorf("company = %q, want \"Applied Materials\"", reparsed[0].Company)
	}
	if reparsed[0].Status != "Interview" {
		t.Errorf("status = %q, want \"Interview\"", reparsed[0].Status)
	}
	if reparsed[0].LastContact != today {
		t.Errorf("LastContact = %q, want %q", reparsed[0].LastContact, today)
	}
}

func TestUpdateApplicationStatusAndNotesCommitsDiscardReasonAtomically(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("failed to create data dir: %v", err)
	}

	applications := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 8 | 2026-07-01 | Acme | Platform Engineer | 3.1/5 | Evaluated | ❌ | [8](reports/008.md) | needs review |
`
	path := filepath.Join(dataDir, "applications.md")
	if err := os.WriteFile(path, []byte(applications), 0o644); err != nil {
		t.Fatalf("failed to write tracker: %v", err)
	}

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 parsed application, got %d", len(apps))
	}
	if err := UpdateApplicationStatusAndNotes(tempDir, apps[0], "Discarded", "DISCARD: salary_too_low"); err != nil {
		t.Fatalf("UpdateApplicationStatusAndNotes: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	today := time.Now().Format("2006-01-02")
	want := "needs review; Status changed to Discarded " + today + "; DISCARD: salary_too_low"
	if !strings.Contains(string(got), "| Discarded |") || !strings.Contains(string(got), want) {
		t.Fatalf("status and discard reason were not committed together, file now:\n%s", got)
	}
}

func TestLoadReportDiscardReasonsNormalizesQuotedYamlAndRejectsTraversal(t *testing.T) {
	tempDir := t.TempDir()
	reportsDir := filepath.Join(tempDir, "reports")
	if err := os.MkdirAll(reportsDir, 0o755); err != nil {
		t.Fatalf("failed to create reports dir: %v", err)
	}
	report := "## Machine Summary\n\n```yaml\ndiscard_reasons:\n  - \"salary_too_low\"\n  - 'hybrid_required'\nnext_action: skip\n```\n"
	if err := os.WriteFile(filepath.Join(reportsDir, "008.md"), []byte(report), 0o644); err != nil {
		t.Fatalf("failed to write report: %v", err)
	}

	got := LoadReportDiscardReasons(tempDir, "[8](reports/008.md)")
	if strings.Join(got, ",") != "salary_too_low,hybrid_required" {
		t.Fatalf("discard reasons = %#v, want normalized YAML values", got)
	}
	if got := LoadReportDiscardReasons(tempDir, "../../outside.md"); got != nil {
		t.Fatalf("path traversal returned reasons: %#v", got)
	}
}

func TestClosedStatusNormalizationAndMetrics(t *testing.T) {
	cases := map[string]string{
		"Closed":     "closed",
		"expired":    "closed",
		"cerrada":    "closed",
		"cancelada":  "closed",
		"Discarded":  "discarded",
		"descartada": "discarded",
	}
	for raw, want := range cases {
		if got := NormalizeStatus(raw); got != want {
			t.Fatalf("NormalizeStatus(%q) = %q, want %q", raw, got, want)
		}
	}

	metrics := ComputeMetrics([]model.CareerApplication{
		{Status: "Evaluated", Score: 4.0},
		{Status: "Closed", Score: 4.5},
		{Status: "Discarded", Score: 3.0},
	})
	if metrics.ByStatus["closed"] != 1 {
		t.Fatalf("expected one closed row in metrics, got %+v", metrics.ByStatus)
	}
	if metrics.Actionable != 1 {
		t.Fatalf("expected only evaluated row to be actionable, got %d", metrics.Actionable)
	}
}

func TestParseApplicationsUsesTrackerNumberColumn(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("failed to create data dir: %v", err)
	}

	applications := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 140 | 2026-04-16 | Arize AI | AI Engineer, Instrumentation | 4.7/5 | Evaluated | ✅ | [140](reports/140-arize-ai-engineer-instrumentation-2026-04-16.md) | Strong fit |
| 143 | 2026-04-16 | Arize AI | AI Sales Engineer, US | 4.1/5 | Evaluated | ❌ | [143](reports/143-arize-ai-sales-engineer-us-2026-04-16.md) | Good fit |
`

	applicationsPath := filepath.Join(dataDir, "applications.md")
	if err := os.WriteFile(applicationsPath, []byte(applications), 0o644); err != nil {
		t.Fatalf("failed to write applications tracker: %v", err)
	}

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 2 {
		t.Fatalf("expected 2 parsed applications, got %d", len(apps))
	}

	if apps[0].Number != 140 {
		t.Fatalf("expected first application number to be 140, got %d", apps[0].Number)
	}
	if apps[1].Number != 143 {
		t.Fatalf("expected second application number to be 143, got %d", apps[1].Number)
	}
	if apps[0].ReportNumber != "140" || apps[1].ReportNumber != "143" {
		t.Fatalf("expected report numbers to stay aligned with tracker IDs, got %q and %q", apps[0].ReportNumber, apps[1].ReportNumber)
	}
}

func TestParseApplicationsUsesScanHistoryListingDate(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	reportsDir := filepath.Join(tempDir, "reports")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("failed to create data dir: %v", err)
	}
	if err := os.MkdirAll(reportsDir, 0o755); err != nil {
		t.Fatalf("failed to create reports dir: %v", err)
	}

	applications := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-05-18 | ExampleCo | Backend Engineer | 4.0/5 | Evaluated | ❌ | [001](reports/001-exampleco-2026-05-18.md) | Good fit |
`
	if err := os.WriteFile(filepath.Join(dataDir, "applications.md"), []byte(applications), 0o644); err != nil {
		t.Fatalf("failed to write applications: %v", err)
	}
	report := `# Evaluation: ExampleCo — Backend Engineer

**Date:** 2026-05-18
**URL:** https://example.com/jobs/backend-engineer
**Score:** 4.0/5
`
	if err := os.WriteFile(filepath.Join(reportsDir, "001-exampleco-2026-05-18.md"), []byte(report), 0o644); err != nil {
		t.Fatalf("failed to write report: %v", err)
	}
	history := "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n" +
		"https://example.com/jobs/backend-engineer\t2026-05-10\tgreenhouse-api\tBackend Engineer\tExampleCo\tadded\tRemote\n"
	if err := os.WriteFile(filepath.Join(dataDir, "scan-history.tsv"), []byte(history), 0o644); err != nil {
		t.Fatalf("failed to write scan history: %v", err)
	}

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 parsed application, got %d", len(apps))
	}
	if apps[0].ListingDate != "2026-05-10" {
		t.Fatalf("expected listing date from scan history, got %q", apps[0].ListingDate)
	}
	if apps[0].Date != "2026-05-18" {
		t.Fatalf("expected processed date to remain unchanged, got %q", apps[0].Date)
	}
}

func TestParseApplicationsPrefersReopenedDuplicateURLFromNotes(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	reportsDir := filepath.Join(tempDir, "reports")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("failed to create data dir: %v", err)
	}
	if err := os.MkdirAll(reportsDir, 0o755); err != nil {
		t.Fatalf("failed to create reports dir: %v", err)
	}

	applications := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 8 | 2026-06-28 | ReopenCo | Platform Engineer | 4.2/5 | Evaluated | ❌ | [008](reports/008-reopenco.md) | Reopened 2026-06-20: duplicate live posting found at https://jobs.example.com/older-platform; Reopened 2026-06-28: duplicate live posting found at https://jobs.example.com/new-platform |
`
	if err := os.WriteFile(filepath.Join(dataDir, "applications.md"), []byte(applications), 0o644); err != nil {
		t.Fatalf("failed to write applications: %v", err)
	}
	report := `# Evaluation: ReopenCo — Platform Engineer

**Date:** 2026-06-01
**URL:** https://jobs.example.com/old-closed-platform
**Score:** 4.2/5
`
	if err := os.WriteFile(filepath.Join(reportsDir, "008-reopenco.md"), []byte(report), 0o644); err != nil {
		t.Fatalf("failed to write report: %v", err)
	}

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 parsed application, got %d", len(apps))
	}
	if apps[0].JobURL != "https://jobs.example.com/new-platform" {
		t.Fatalf("expected reopened duplicate URL to beat stale report URL, got %q", apps[0].JobURL)
	}
}

func TestParseApplicationsUsesReportListingDateBeforeScanHistory(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	reportsDir := filepath.Join(tempDir, "reports")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("failed to create data dir: %v", err)
	}
	if err := os.MkdirAll(reportsDir, 0o755); err != nil {
		t.Fatalf("failed to create reports dir: %v", err)
	}

	applications := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 2 | 2026-05-18 | ReportDateCo | Product Engineer | 4.1/5 | Evaluated | ❌ | [002](reports/002-reportdateco-2026-05-18.md) | Good fit |
`
	if err := os.WriteFile(filepath.Join(dataDir, "applications.md"), []byte(applications), 0o644); err != nil {
		t.Fatalf("failed to write applications: %v", err)
	}
	report := `# Evaluation: ReportDateCo — Product Engineer

**Date:** 2026-05-18
**URL:** https://example.com/jobs/product-engineer

| Signal | Finding |
|---|---|
| Posting date | Published 18 March 2026 |
`
	if err := os.WriteFile(filepath.Join(reportsDir, "002-reportdateco-2026-05-18.md"), []byte(report), 0o644); err != nil {
		t.Fatalf("failed to write report: %v", err)
	}
	history := "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n" +
		"https://example.com/jobs/product-engineer\t2026-05-10\tgreenhouse-api\tProduct Engineer\tReportDateCo\tadded\tRemote\n"
	if err := os.WriteFile(filepath.Join(dataDir, "scan-history.tsv"), []byte(history), 0o644); err != nil {
		t.Fatalf("failed to write scan history: %v", err)
	}

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 parsed application, got %d", len(apps))
	}
	if apps[0].ListingDate != "2026-03-18" {
		t.Fatalf("expected listing date from report, got %q", apps[0].ListingDate)
	}
}

func TestParseApplicationsForDashboardSkipsReportEnrichment(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	reportsDir := filepath.Join(tempDir, "reports")
	for _, dir := range []string{dataDir, reportsDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("failed to create dir %s: %v", dir, err)
		}
	}

	applications := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 3 | 2026-05-18 | LazyCo | Staff Engineer | 4.3/5 | Evaluated | ❌ | [003](reports/003-lazyco.md) | Good fit |
`
	if err := os.WriteFile(filepath.Join(dataDir, "applications.md"), []byte(applications), 0o644); err != nil {
		t.Fatalf("failed to write applications: %v", err)
	}
	report := `# Evaluation: LazyCo — Staff Engineer

**URL:** https://example.com/jobs/staff-engineer

| Signal | Finding |
|---|---|
| Posting date | Published 18 March 2026 |
`
	if err := os.WriteFile(filepath.Join(reportsDir, "003-lazyco.md"), []byte(report), 0o644); err != nil {
		t.Fatalf("failed to write report: %v", err)
	}

	apps, err := ParseApplicationsForDashboard(tempDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(apps) != 1 {
		t.Fatalf("expected 1 parsed application, got %d", len(apps))
	}
	if apps[0].JobURL != "" {
		t.Fatalf("dashboard parser should not read report URL eagerly, got %q", apps[0].JobURL)
	}
	if apps[0].ListingDate != "" {
		t.Fatalf("dashboard parser should not read report listing date eagerly, got %q", apps[0].ListingDate)
	}

	fullApps := mustParseApplications(t, tempDir)
	if fullApps[0].JobURL != "https://example.com/jobs/staff-engineer" {
		t.Fatalf("full parser should still read report URL, got %q", fullApps[0].JobURL)
	}
	if fullApps[0].ListingDate != "2026-03-18" {
		t.Fatalf("full parser should still read report listing date, got %q", fullApps[0].ListingDate)
	}
}

func TestParseApplicationsResolvesTrackerRelativeReportLinks(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	reportsDir := filepath.Join(tempDir, "reports")
	for _, dir := range []string{dataDir, reportsDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("failed to create dir %s: %v", dir, err)
		}
	}

	// Tracker links are written relative to the tracker file itself
	// (merge-tracker.mjs normalization): ../reports/... when the tracker
	// lives under data/. Legacy trackers may still carry root-relative
	// links; both must resolve to the same on-disk report.
	applications := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-03 | Acme | Engineer | 4.0/5 | Evaluated | ✅ | [1](../reports/001-acme-2026-06-03.md) | Tracker-relative link |
| 2 | 2026-06-03 | Legacy Co | Engineer | 3.0/5 | Evaluated | ❌ | [2](reports/002-legacy-2026-06-03.md) | Legacy root-relative link |
`

	if err := os.WriteFile(filepath.Join(dataDir, "applications.md"), []byte(applications), 0o644); err != nil {
		t.Fatalf("failed to write applications tracker: %v", err)
	}
	for _, name := range []string{"001-acme-2026-06-03.md", "002-legacy-2026-06-03.md"} {
		if err := os.WriteFile(filepath.Join(reportsDir, name), []byte("# Report\n"), 0o644); err != nil {
			t.Fatalf("failed to write report %s: %v", name, err)
		}
	}

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 2 {
		t.Fatalf("expected 2 parsed applications, got %d", len(apps))
	}

	wantFirst := filepath.Join("reports", "001-acme-2026-06-03.md")
	if apps[0].ReportPath != wantFirst {
		t.Fatalf("expected tracker-relative link to resolve to %q, got %q", wantFirst, apps[0].ReportPath)
	}
	wantSecond := filepath.Join("reports", "002-legacy-2026-06-03.md")
	if apps[1].ReportPath != wantSecond {
		t.Fatalf("expected legacy root-relative link to resolve to %q, got %q", wantSecond, apps[1].ReportPath)
	}

	// Every consumer joins ReportPath against careerOpsPath — both rows
	// must point at files that exist.
	for i, app := range apps {
		if _, err := os.Stat(filepath.Join(tempDir, app.ReportPath)); err != nil {
			t.Fatalf("row %d: resolved report path %q does not exist: %v", i, app.ReportPath, err)
		}
	}
}

// writeTracker writes applications.md under data/ and returns the temp root and
// the tracker path.
func writeTracker(t *testing.T, body string) (string, string) {
	t.Helper()
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	path := filepath.Join(dataDir, "applications.md")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write tracker: %v", err)
	}
	return tempDir, path
}

const insertedColumnTracker = `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |
|---|------|---------|------|----------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | VP Marketing | Remote | 4.5/5 | Applied | ✅ | [1](reports/001.md) | hot lead |
`

// A tracker with a Location column inserted before Score (the customized layout
// the Node tracker tooling supports since #954) must not desync the Go reader.
// Without header-aware mapping, Status reads the Score cell and the report link
// reads the PDF cell, so ReportNumber comes back empty.
func TestParseApplicationsMapsColumnsByHeader(t *testing.T) {
	tempDir, _ := writeTracker(t, insertedColumnTracker)

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 application, got %d", len(apps))
	}
	a := apps[0]
	if a.Company != "Acme" {
		t.Errorf("Company = %q, want \"Acme\"", a.Company)
	}
	if a.Role != "VP Marketing" {
		t.Errorf("Role = %q, want \"VP Marketing\"", a.Role)
	}
	if a.Status != "Applied" {
		t.Errorf("Status = %q, want \"Applied\"", a.Status)
	}
	if a.ScoreRaw != "4.5/5" {
		t.Errorf("ScoreRaw = %q, want \"4.5/5\"", a.ScoreRaw)
	}
	if !a.HasPDF {
		t.Errorf("HasPDF = false, want true")
	}
	if a.ReportNumber != "1" {
		t.Errorf("ReportNumber = %q, want \"1\"", a.ReportNumber)
	}
}

// An explicit tracker Location column is shown as-is, even for a town no
// built-in city list knows and with nothing location-like in Notes.
func TestParseApplicationsReadsLocationColumn(t *testing.T) {
	tempDir, _ := writeTracker(t, `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |
|---|------|---------|------|----------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | Engineer | Cardiff, UK | 4.0/5 | Applied | | | |
`)

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 application, got %d", len(apps))
	}
	if apps[0].Location != "Cardiff, UK" {
		t.Errorf("Location = %q, want \"Cardiff, UK\"", apps[0].Location)
	}
}

func TestParseApplicationsUsesTrackerURLBeforeLegacyEnrichment(t *testing.T) {
	tempDir, _ := writeTracker(t, `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-08-28 | Acme | Triage Engineer | 4.0/5 | Evaluated | — | — | triage only | https://jobs.example.com/triage |
| 2 | 2026-08-28 | Globex | Platform Engineer | 4.2/5 | Evaluated | — | [2](../reports/002-globex.md) | has report | https://jobs.example.com/tracker |
| 3 | 2026-08-28 | Initech | Legacy Engineer | 3.9/5 | Evaluated | — | [3](../reports/003-initech.md) | legacy fallback | |
`)

	reportsDir := filepath.Join(tempDir, "reports")
	if err := os.MkdirAll(reportsDir, 0o755); err != nil {
		t.Fatalf("mkdir reports: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(reportsDir, "002-globex.md"),
		[]byte("**URL:** https://jobs.example.com/report\n"),
		0o644,
	); err != nil {
		t.Fatalf("write report: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(reportsDir, "003-initech.md"),
		[]byte("**URL:** https://jobs.example.com/legacy\n"),
		0o644,
	); err != nil {
		t.Fatalf("write legacy report: %v", err)
	}

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 3 {
		t.Fatalf("expected 3 applications, got %d", len(apps))
	}
	if got := apps[0].JobURL; got != "https://jobs.example.com/triage" {
		t.Errorf("triage-only JobURL = %q, want tracker URL", got)
	}
	if got := apps[1].JobURL; got != "https://jobs.example.com/tracker" {
		t.Errorf("report-backed JobURL = %q, want tracker URL to take precedence", got)
	}
	if got := apps[2].JobURL; got != "https://jobs.example.com/legacy" {
		t.Errorf("legacy JobURL = %q, want report URL fallback", got)
	}
}

// End-to-end status update on the inserted-column layout: parse, update, and
// re-parse. Only the Status cell may change; every other cell stays intact.
func TestUpdateApplicationStatusInsertedColumn(t *testing.T) {
	tempDir, path := writeTracker(t, insertedColumnTracker)

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 application, got %d", len(apps))
	}
	if err := UpdateApplicationStatus(tempDir, apps[0], "Interview"); err != nil {
		t.Fatalf("UpdateApplicationStatus: %v", err)
	}

	out, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	got := string(out)
	if !strings.Contains(got, "| Interview |") {
		t.Errorf("Status cell not updated to Interview, file now:\n%s", got)
	}
	for _, cell := range []string{"| Acme |", "| VP Marketing |", "| Remote |", "| 4.5/5 |", "| ✅ |"} {
		if !strings.Contains(got, cell) {
			t.Errorf("expected intact cell %q missing after write:\n%s", cell, got)
		}
	}
	if !strings.Contains(got, "[1](reports/001.md) | hot lead; Status changed to Interview ") {
		t.Errorf("status interaction note was not appended to the Notes cell, file now:\n%s", got)
	}

	reparsed := mustParseApplications(t, tempDir)
	if reparsed[0].Status != "Interview" {
		t.Errorf("reparsed Status = %q, want \"Interview\"", reparsed[0].Status)
	}
	if reparsed[0].ScoreRaw != "4.5/5" {
		t.Errorf("reparsed ScoreRaw = %q, want \"4.5/5\"", reparsed[0].ScoreRaw)
	}
}

// resolveTrackerColumns detects the header layout, and falls back to the legacy
// fixed layout when no recognizable header row is present.
func TestResolveTrackerColumns(t *testing.T) {
	header := strings.Split(insertedColumnTracker, "\n")
	cols := resolveTrackerColumns(header)
	if cols["status"] != 6 {
		t.Errorf("status index = %d, want 6 (inserted Location column)", cols["status"])
	}
	if cols["score"] != 5 {
		t.Errorf("score index = %d, want 5", cols["score"])
	}

	headerless := []string{"| 1 | 2026-06-01 | Acme | VP Marketing | 4.5/5 | Applied | ✅ | [1](reports/001.md) | note |"}
	fallback := resolveTrackerColumns(headerless)
	if fallback["status"] != 5 {
		t.Errorf("fallback status index = %d, want 5 (legacy layout)", fallback["status"])
	}
}

func TestParseApplicationsRespectsCareerOpsTracker(t *testing.T) {
	tempDir := t.TempDir()

	// Create a tracker file outside the tempDir's default search paths
	customTrackerPath := filepath.Join(tempDir, "custom-tracker.md")

	applications := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-07-01 | CustomCo | Specialist | 3.5/5 | Applied | ❌ | - | - |
`
	if err := os.WriteFile(customTrackerPath, []byte(applications), 0o644); err != nil {
		t.Fatalf("failed to write custom tracker: %v", err)
	}

	t.Setenv("CAREER_OPS_TRACKER", customTrackerPath)

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 parsed application, got %d", len(apps))
	}

	if apps[0].Company != "CustomCo" {
		t.Errorf("expected company CustomCo, got %q", apps[0].Company)
	}
}

// A duplicated header name resolves to its LAST occurrence, matching
// detectColumns in tracker-parse.mjs — the JS and Go readers must map an
// identical header row identically.
func TestResolveTrackerColumnsDuplicateHeaderLastWins(t *testing.T) {
	dup := strings.Split(`| # | Notes | Company | Role | Score | Status | PDF | Report | Notes |
|---|-------|---------|------|-------|--------|-----|--------|-------|
| 1 | stray | Acme | Engineer | 4.0/5 | Applied | ✅ | — | real note |`, "\n")
	cols := resolveTrackerColumns(dup)
	// Verify that the last "Notes" column wins
	if cols["notes"] != 8 {
		t.Fatalf("notes index = %d, expected 8 (tracker-parse.mjs parity)", cols["notes"])
	}
}

// A Via column (intermediary channel, #1596) between Company and Role maps by
// header name; later columns keep their correct indices.
func TestResolveTrackerColumnsVia(t *testing.T) {
	viaTracker := strings.Split(`| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 1 | 2026-01-05 | ? | Hays | Data Engineer | 4.2/5 | Applied | ✅ | — | fintech, Leeds |`, "\n")
	cols := resolveTrackerColumns(viaTracker)
	if cols["via"] != 3 {
		t.Errorf("via index = %d, want 3", cols["via"])
	}
	if cols["role"] != 4 {
		t.Errorf("role index = %d, want 4 (shifted by Via column)", cols["role"])
	}
	if cols["status"] != 6 {
		t.Errorf("status index = %d, want 6", cols["status"])
	}
}

// TestNormalizeStatus verifies that localized string variants map to the canonical English form.
func TestNormalizeStatus(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		// Turkish status strings
		{"değerlendirildi", "evaluated"},
		{"Değerlendirildi", "evaluated"},
		{"DEĞERLENDİRİLDİ", "evaluated"},
		{"başvuruldu", "applied"},
		{"Başvuruldu", "applied"},
		{"BAŞVURULDU", "applied"},
		{"yanıt verildi", "responded"},
		{"yanıt_verildi", "responded"},
		{"YANIT VERİLDİ", "responded"},
		{"mülakat", "interview"},
		{"Mülakat", "interview"},
		{"MÜLAKAT", "interview"},
		{"teklif", "offer"},
		{"Teklif", "offer"},
		{"TEKLİF", "offer"},
		{"reddedildi", "rejected"},
		{"Reddedildi", "rejected"},
		{"REDDEDİLDİ", "rejected"},
		{"iptal edildi", "closed"},
		{"iptal_edildi", "closed"},
		{"İPTAL EDİLDİ", "closed"},
		{"uygun değil", "skip"},
		{"uygun_değil", "skip"},
		{"UYGUN DEĞİL", "skip"},

		// No-diacritic variants
		{"degerlendirildi", "evaluated"},
		{"DEGERLENDIRILDI", "evaluated"},
		{"basvuruldu", "applied"},
		{"BASVURULDU", "applied"},
		{"yanit verildi", "responded"},
		{"mulakat", "interview"},
		{"uygun degil", "skip"},

		// English status strings
		{"Evaluated", "evaluated"},
		{"Applied", "applied"},
		{"Responded", "responded"},
		{"Assessment", "assessment"},
		{"online screening", "assessment"},
		{"screening", "assessment"},
		{"online assessment", "assessment"},
		{"online_assessment", "assessment"},
		{"phone screening", "phone screening"},
		{"Interview - phone screening", "interview"},
		{"Assessment prep", "assessment prep"},
		{"Interview", "interview"},
		{"Offer", "offer"},
		{"Rejected", "rejected"},
		{"Discarded", "discarded"},
		{"SKIP", "skip"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.input, func(t *testing.T) {
			t.Parallel()
			if got := NormalizeStatus(tt.input); got != tt.want {
				t.Errorf("NormalizeStatus(%q) = %q; want %q", tt.input, got, tt.want)
			}
		})
	}
}

// Regression: when an external writer (set-status.mjs, merge-tracker.mjs,
// another session) changes a row's status while the dashboard is open, the
// in-memory "old" status no longer matches the file. The update must still
// land in the Status column — identified via the header — rather than
// silently no-opping.
func TestUpdateApplicationStatusWithStaleInMemoryStatus(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	applications := `# Applications Tracker

| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 28 | 2026-07-10 | ? | DaCodes | Backend Engineer | 3.1/5 | Evaluated | ✅ | [28](../reports/028-dacodes.md) | note |
`
	path := filepath.Join(dataDir, "applications.md")
	if err := os.WriteFile(path, []byte(applications), 0o644); err != nil {
		t.Fatalf("write tracker: %v", err)
	}

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 app, got %d", len(apps))
	}

	// Simulate an external writer changing the status on disk after parse.
	stale := strings.Replace(applications, "| Evaluated |", "| Applied |", 1)
	if err := os.WriteFile(path, []byte(stale), 0o644); err != nil {
		t.Fatalf("rewrite tracker: %v", err)
	}

	// apps[0].Status is still "Evaluated" (stale) — the update must still work.
	if err := UpdateApplicationStatus(tempDir, apps[0], "Interview"); err != nil {
		t.Fatalf("UpdateApplicationStatus with stale status: %v", err)
	}

	out, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !strings.Contains(string(out), "| Interview |") {
		t.Errorf("status not updated, file now:\n%s", string(out))
	}
	if strings.Contains(string(out), "| Applied |") || strings.Contains(string(out), "| Evaluated |") {
		t.Errorf("old status still present, file now:\n%s", string(out))
	}
}

// A row whose canonical status column holds something unrecognizable must NOT
// be guessed at — the update fails loudly instead of corrupting a cell.
func TestUpdateApplicationStatusRefusesUnrecognizableCell(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	applications := `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 3 | 2026-07-10 | Acme | Engineer | 3.1/5 | Evaluated | ✅ | [3](reports/003.md) | note |
`
	path := filepath.Join(dataDir, "applications.md")
	if err := os.WriteFile(path, []byte(applications), 0o644); err != nil {
		t.Fatalf("write tracker: %v", err)
	}

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 app, got %d", len(apps))
	}

	// Corrupt the status cell into something that is not a status.
	broken := strings.Replace(applications, "| Evaluated |", "| ??? |", 1)
	if err := os.WriteFile(path, []byte(broken), 0o644); err != nil {
		t.Fatalf("rewrite tracker: %v", err)
	}

	if err := UpdateApplicationStatus(tempDir, apps[0], "Interview"); err == nil {
		t.Fatal("expected an error when the status cell is unrecognizable, got nil")
	}

	out, _ := os.ReadFile(path)
	if !strings.Contains(string(out), "| ??? |") {
		t.Errorf("file was modified despite refusal, now:\n%s", string(out))
	}
}

// The URL cell is written as a markdown link with a short label (#3516), while
// trackers written before that — and any row no merge has rewritten since —
// still carry the bare URL. Tier 0 of the JobURL chain must read the same href
// out of both, because failing to read one does not error: it looks exactly
// like a row with no URL and falls through to the report / scan-history tiers,
// which resolve a different posting.
func TestExtractCellURLReadsBothWrittenForms(t *testing.T) {
	cases := []struct {
		name string
		cell string
		want string
	}{
		{"bare (pre-#3516 tracker)", "https://jobs.ashbyhq.com/temporal/8a65908d", "https://jobs.ashbyhq.com/temporal/8a65908d"},
		{"linked with an ATS label", "[ashby](https://jobs.ashbyhq.com/temporal/8a65908d)", "https://jobs.ashbyhq.com/temporal/8a65908d"},
		{"linked with a host label", "[careers.snowflake.com](https://careers.snowflake.com/us/en/job/4735b223/Director)", "https://careers.snowflake.com/us/en/job/4735b223/Director"},
		{"href with balanced parens is not truncated", "[example.com](https://example.com/jobs/eng(remote))", "https://example.com/jobs/eng(remote)"},
		{"angle-bracketed destination", "[example.com](<https://example.com/jobs/1>)", "https://example.com/jobs/1"},
		{"query string survives", "[greenhouse](https://boards.greenhouse.io/acme/jobs/9?gh_jid=123)", "https://boards.greenhouse.io/acme/jobs/9?gh_jid=123"},
		{"empty cell", "", ""},
		{"placeholder is passed through, not invented into a URL", "—", "—"},
		{"non-http link is not mistaken for a posting URL", "[jd](local:jds/acme.md)", "[jd](local:jds/acme.md)"},
	}
	for _, tc := range cases {
		if got := extractCellURL(tc.cell); got != tc.want {
			t.Errorf("%s: extractCellURL(%q) = %q, want %q", tc.name, tc.cell, got, tc.want)
		}
	}
}

// The same property end to end: a linked cell and a bare cell must produce the
// same JobURL, and the linked one must still beat the report-header tier.
func TestParseApplicationsReadsLinkedURLCells(t *testing.T) {
	tempDir, _ := writeTracker(t, `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|-------|-----|
| 1 | 2026-08-28 | Acme | Triage Engineer | 4.0/5 | Evaluated | — | — | linked | [jobs.example.com](https://jobs.example.com/triage) |
| 2 | 2026-08-28 | Globex | Platform Engineer | 4.2/5 | Evaluated | — | [2](../reports/002-globex.md) | linked, has report | [jobs.example.com](https://jobs.example.com/tracker) |
`)

	reportsDir := filepath.Join(tempDir, "reports")
	if err := os.MkdirAll(reportsDir, 0o755); err != nil {
		t.Fatalf("mkdir reports: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(reportsDir, "002-globex.md"),
		[]byte("**URL:** https://jobs.example.com/report\n"),
		0o644,
	); err != nil {
		t.Fatalf("write report: %v", err)
	}

	apps := mustParseApplications(t, tempDir)
	if len(apps) != 2 {
		t.Fatalf("expected 2 applications, got %d", len(apps))
	}
	if got := apps[0].JobURL; got != "https://jobs.example.com/triage" {
		t.Errorf("linked JobURL = %q, want the href", got)
	}
	if got := apps[1].JobURL; got != "https://jobs.example.com/tracker" {
		t.Errorf("linked JobURL = %q, want the tracker href to beat the report header", got)
	}
}

// The writer only links a href that survives a markdown destination byte for
// byte (merge-tracker.mjs isLinkableDestination); everything else is written
// bare. Both forms must read back whole HERE too — the Node parser and this
// regex disagreeing about a row's URL is the drift the shared extractor exists
// to prevent. TestExtractCellURLMatchesNodeReader pins the full parity table.
func TestExtractCellURLAgreesWithTheWriterOnUnlinkableHrefs(t *testing.T) {
	cases := []struct {
		name string
		cell string
		want string
	}{
		// Written bare by the writer, so they must read back verbatim.
		{"unmatched close paren, bare", "https://example.com/jobs/a)b", "https://example.com/jobs/a)b"},
		{"unmatched open paren, bare", "https://example.com/jobs/a(b", "https://example.com/jobs/a(b"},
		{"backslash, bare", `https://example.com/jobs/a\b`, `https://example.com/jobs/a\b`},
		// Written linked, because balanced parens round-trip.
		{"balanced parens, linked", "[example.com](https://example.com/jobs/eng(remote))", "https://example.com/jobs/eng(remote)"},
		// Whitespace is percent-encoded by the writer rather than left raw.
		{"encoded space, linked", "[example.com](https://example.com/jobs/a%20b)", "https://example.com/jobs/a%20b"},
	}
	for _, tc := range cases {
		if got := extractCellURL(tc.cell); got != tc.want {
			t.Errorf("%s: extractCellURL(%q) = %q, want %q", tc.name, tc.cell, got, tc.want)
		}
	}
}

// One table, two readers: test-fixtures/url-cell-parity.json is asserted here
// against extractCellURL and in tracker-columns-tests.mjs against Node's
// extractCellUrl. Its expectations were generated from the Node reader, so this
// test failing means the Go port has drifted from the parser merge-tracker keys
// on — and a hand-edited cell would show the dashboard one posting while dedup
// matched another. The table includes every cell the earlier regex-based reader
// got wrong (#3854 review). Same shape as tracker_aliases_test.go.
func TestExtractCellURLMatchesNodeReader(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "test-fixtures", "url-cell-parity.json"))
	if err != nil {
		t.Fatalf("read shared URL-cell parity fixture: %v", err)
	}
	var fixture struct {
		Cases []struct {
			Name string `json:"name"`
			Cell string `json:"cell"`
			Href string `json:"href"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(content, &fixture); err != nil {
		t.Fatalf("parse shared URL-cell parity fixture: %v", err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("shared URL-cell parity fixture has no cases")
	}
	for _, tc := range fixture.Cases {
		if got := extractCellURL(tc.Cell); got != tc.Href {
			t.Errorf("%s: extractCellURL(%q) = %q, Node reader gives %q", tc.Name, tc.Cell, got, tc.Href)
		}
	}
}

// describeTrackerLock reports whether a lock directory is still present, and
// who owns it if so.
//
// Exists because "did not resume after lock release" is the same message
// whether the lock was released and the waiter is merely slow, or the release
// failed and the waiter is stuck forever. Those need different fixes, and on a
// runner nobody can attach to, the test output is the only place that
// distinction can live.
func describeTrackerLock(dir string) string {
	info, err := os.Stat(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return fmt.Sprintf("lock dir %s is gone, so the release worked and the waiter did not re-acquire within the budget", dir)
	}
	if err != nil {
		return fmt.Sprintf("lock dir %s could not be examined: %v", dir, err)
	}
	owner, ownerErr := readTrackerLockOwner(dir)
	if ownerErr != nil {
		return fmt.Sprintf("lock dir %s STILL EXISTS (mode %v); owner unreadable: %v", dir, info.Mode(), ownerErr)
	}
	return fmt.Sprintf("lock dir %s STILL EXISTS, held by pid %d token %s since %s — the release did not remove it",
		dir, owner.PID, owner.Token, owner.StartedAt)
}
