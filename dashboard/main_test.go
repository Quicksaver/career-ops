package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeApplicationsFile(t *testing.T, userRoot string) {
	t.Helper()
	dataDir := filepath.Join(userRoot, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("mkdir data dir: %v", err)
	}
	content := "# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n"
	if err := os.WriteFile(filepath.Join(dataDir, "applications.md"), []byte(content), 0o644); err != nil {
		t.Fatalf("write applications.md: %v", err)
	}
}

func TestResolveCareerOpsPathAcceptsUserFolderPath(t *testing.T) {
	t.Setenv("CAREER_OPS_USERS_DIR", "")
	tempDir := t.TempDir()
	userRoot := filepath.Join(tempDir, "users", "alice")
	writeApplicationsFile(t, userRoot)

	gotPath, gotUser, err := resolveCareerOpsPath(userRoot, "", "")
	if err != nil {
		t.Fatalf("resolveCareerOpsPath returned error: %v", err)
	}
	if gotPath != userRoot {
		t.Fatalf("path = %q, want %q", gotPath, userRoot)
	}
	if gotUser != "alice" {
		t.Fatalf("user = %q, want alice", gotUser)
	}
}

func TestDashboardOpenTargetResolvesRelativeOutputPDFUnderUserRoot(t *testing.T) {
	tempDir := t.TempDir()
	userRoot := filepath.Join(tempDir, "users", "alice")

	got := dashboardOpenTarget(userRoot, "output/001-example.pdf")
	want := dashboardFileURL(filepath.Join(userRoot, "output", "001-example.pdf"))
	if got != want {
		t.Fatalf("open target = %q, want %q", got, want)
	}
}

func TestDashboardOpenTargetLeavesHTTPURLUnchanged(t *testing.T) {
	got := dashboardOpenTarget("/tmp/user", "https://example.com/jobs/1")
	if got != "https://example.com/jobs/1" {
		t.Fatalf("open target = %q, want unchanged HTTP URL", got)
	}
}

func TestResolveCareerOpsPathUsesProjectPathAndUser(t *testing.T) {
	t.Setenv("CAREER_OPS_USERS_DIR", "")
	projectRoot := t.TempDir()
	userRoot := filepath.Join(projectRoot, "users", "alice")
	writeApplicationsFile(t, userRoot)

	gotPath, gotUser, err := resolveCareerOpsPath(projectRoot, "", "alice")
	if err != nil {
		t.Fatalf("resolveCareerOpsPath returned error: %v", err)
	}
	if gotPath != userRoot {
		t.Fatalf("path = %q, want %q", gotPath, userRoot)
	}
	if gotUser != "alice" {
		t.Fatalf("user = %q, want alice", gotUser)
	}
}

func TestResolveCareerOpsPathInfersCurrentUserFolder(t *testing.T) {
	t.Setenv("CAREER_OPS_USERS_DIR", "")
	tempDir := t.TempDir()
	userRoot := filepath.Join(tempDir, "users", "alice")
	writeApplicationsFile(t, userRoot)
	t.Chdir(userRoot)

	gotPath, gotUser, err := resolveCareerOpsPath("", "", "")
	if err != nil {
		t.Fatalf("resolveCareerOpsPath returned error: %v", err)
	}
	if gotPath != userRoot {
		t.Fatalf("path = %q, want %q", gotPath, userRoot)
	}
	if gotUser != "alice" {
		t.Fatalf("user = %q, want alice", gotUser)
	}
}

func TestResolveCareerOpsPathInfersRepoRootWithUser(t *testing.T) {
	t.Setenv("CAREER_OPS_USERS_DIR", "")
	projectRoot := t.TempDir()
	userRoot := filepath.Join(projectRoot, "users", "alice")
	writeApplicationsFile(t, userRoot)
	t.Chdir(projectRoot)

	gotPath, gotUser, err := resolveCareerOpsPath("", "", "alice")
	if err != nil {
		t.Fatalf("resolveCareerOpsPath returned error: %v", err)
	}
	if gotPath != userRoot {
		t.Fatalf("path = %q, want %q", gotPath, userRoot)
	}
	if gotUser != "alice" {
		t.Fatalf("user = %q, want alice", gotUser)
	}
}

func TestResolveCareerOpsPathRequiresUserForProjectPath(t *testing.T) {
	t.Setenv("CAREER_OPS_USERS_DIR", "")
	projectRoot := t.TempDir()

	_, _, err := resolveCareerOpsPath(projectRoot, "", "")
	if err == nil {
		t.Fatal("resolveCareerOpsPath returned nil error, want missing-user error")
	}
}
