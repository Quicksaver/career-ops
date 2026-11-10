package data

import (
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

// Each week's rows are split by their current normalized status.
func TestWeeklyActivitySplitsByStatus(t *testing.T) {
	pm := ComputeProgressMetrics([]model.CareerApplication{
		{Number: 1, Date: "2026-11-02", Status: "Evaluated"},
		{Number: 2, Date: "2026-11-03", Status: "Applied"},
		{Number: 3, Date: "2026-11-04", Status: "SKIP"},
		{Number: 4, Date: "2026-11-05", Status: "Skip"},
		{Number: 5, Date: "2026-11-10", Status: "Closed"},
	})
	if len(pm.WeeklyActivity) != 2 {
		t.Fatalf("got %d weeks, want 2: %+v", len(pm.WeeklyActivity), pm.WeeklyActivity)
	}
	w45 := pm.WeeklyActivity[0]
	if w45.Week != "2026-W45" || w45.Count != 4 {
		t.Fatalf("first week = %s with %d rows, want 2026-W45 with 4", w45.Week, w45.Count)
	}
	want := map[string]int{"evaluated": 1, "applied": 1, "skip": 2}
	if len(w45.ByStatus) != len(want) {
		t.Fatalf("W45 statuses = %v, want %v", w45.ByStatus, want)
	}
	for status, n := range want {
		if w45.ByStatus[status] != n {
			t.Errorf("W45 %s = %d, want %d", status, w45.ByStatus[status], n)
		}
	}
	if got := pm.WeeklyActivity[1].ByStatus["closed"]; got != 1 {
		t.Errorf("W46 closed = %d, want 1", got)
	}
}
