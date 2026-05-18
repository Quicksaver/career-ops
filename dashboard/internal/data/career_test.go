package data

import (
	"os"
	"path/filepath"
	"testing"
)

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

	apps := ParseApplications(tempDir)
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

	apps := ParseApplications(tempDir)
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

	apps := ParseApplications(tempDir)
	if len(apps) != 1 {
		t.Fatalf("expected 1 parsed application, got %d", len(apps))
	}
	if apps[0].ListingDate != "2026-03-18" {
		t.Fatalf("expected listing date from report, got %q", apps[0].ListingDate)
	}
}
