package data

import (
	"testing"
	"time"

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
	if w45.Week != "2026-W45" || w45.Start != "2026-11-02" || w45.Count != 4 {
		t.Fatalf("first week = %s from %s with %d rows, want 2026-W45 from 2026-11-02 with 4", w45.Week, w45.Start, w45.Count)
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
	if got := pm.WeeklyActivity[1]; got.Start != "2026-11-09" || got.ByStatus["closed"] != 1 {
		t.Errorf("W46 = %+v, want start 2026-11-09 with 1 closed", got)
	}
}

// Every week with rows is listed, oldest first, not just the most recent few.
func TestWeeklyActivityListsEveryWeek(t *testing.T) {
	var apps []model.CareerApplication
	for i := 0; i < 12; i++ {
		day := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC).AddDate(0, 0, 7*i)
		apps = append(apps, model.CareerApplication{Number: i + 1, Date: day.Format("2006-01-02"), Status: "SKIP"})
	}
	pm := ComputeProgressMetrics(apps)
	if len(pm.WeeklyActivity) != 12 {
		t.Fatalf("got %d weeks, want all 12", len(pm.WeeklyActivity))
	}
	if first := pm.WeeklyActivity[0].Start; first != "2026-08-03" {
		t.Errorf("first week starts %s, want the oldest, 2026-08-03", first)
	}
}
