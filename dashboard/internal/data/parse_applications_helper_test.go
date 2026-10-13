package data

import (
	"regexp"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// mustParseApplications is ParseApplications for the tests that expect the read
// to succeed, which is all of them except the ones asserting a failure.
//
// A helper rather than `apps, _ := ParseApplications(...)` at each site: the
// discarded form would let a test that stopped being able to read its own
// fixture keep running against a nil slice, pass every "no unexpected rows"
// assertion, and report as coverage. Failing here names the fixture instead.
func mustParseApplications(t *testing.T, careerOpsPath string) []model.CareerApplication {
	t.Helper()
	apps, err := ParseApplications(careerOpsPath)
	if err != nil {
		t.Fatalf("ParseApplications(%q): %v", careerOpsPath, err)
	}
	return apps
}

func withoutStatusInteractionNotes(notes string) string {
	clean := regexp.MustCompile(`(?:; )?Status changed to [^;|]+ \d{4}-\d{2}-\d{2}`).ReplaceAllString(notes, "")
	return strings.Trim(strings.TrimSpace(clean), "; ")
}

func withoutStatusNotesInTracker(text string) string {
	clean := regexp.MustCompile(`Status changed to [^;|]+ \d{4}-\d{2}-\d{2}; `).ReplaceAllString(text, "")
	return regexp.MustCompile(`; Status changed to [^;|]+ \d{4}-\d{2}-\d{2}`).ReplaceAllString(clean, "")
}
