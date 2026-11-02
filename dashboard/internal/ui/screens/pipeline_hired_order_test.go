package screens

import (
	"sort"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// The status sort uses data.StatusPriority, while statusGroupOrder lists
// Hired first. The two must agree: StatusPriority had no case for Hired, so a
// hired row fell to the default bucket and sorted below Rejected and
// Discarded. The fork's Closed shares Rejected's priority, so equal
// neighbours are allowed; an inversion is not.
func TestStatusPriorityFollowsStatusGroupOrder(t *testing.T) {
	for i := 1; i < len(statusGroupOrder); i++ {
		prev, cur := statusGroupOrder[i-1], statusGroupOrder[i]
		if data.StatusPriority(prev) > data.StatusPriority(cur) {
			t.Errorf("StatusPriority(%q)=%d is above StatusPriority(%q)=%d, but statusGroupOrder puts %q first",
				prev, data.StatusPriority(prev), cur, data.StatusPriority(cur), prev)
		}
	}
}

// The fork is flat-only, so upstream's grouped-view check becomes a check of
// the status sort comparator across statuses.
func TestStatusSortListsHiredFirst(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Acme", Role: "Ops Lead", Status: "Discarded"},
		{Company: "Globex", Role: "Ops Lead", Status: "Hired"},
		{Company: "Initech", Role: "Ops Lead", Status: "Interview"},
		{Company: "Umbrella", Role: "Ops Lead", Status: "Rejected"},
	}
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, t.TempDir(), 120, 40)
	pm.sortMode = sortStatus
	less := pm.sortLess()
	sorted := append([]model.CareerApplication(nil), apps...)
	sort.SliceStable(sorted, func(i, j int) bool { return less(sorted[i], sorted[j]) })

	got := make([]string, len(sorted))
	for i, app := range sorted {
		got[i] = app.Status
	}
	want := []string{"Hired", "Interview", "Rejected", "Discarded"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("status sort order = %v, want %v", got, want)
		}
	}
}
