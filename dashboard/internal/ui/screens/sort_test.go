package screens

import (
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestSortCycleIncludesNewColumns(t *testing.T) {
	want := map[string]bool{sortID: false, sortLocation: false, sortPay: false, sortLast: false}
	for _, s := range sortCycle {
		if _, ok := want[s]; ok {
			want[s] = true
		}
	}
	for mode, found := range want {
		if !found {
			t.Errorf("sort cycle is missing %q", mode)
		}
	}
}

func TestSortByID(t *testing.T) {
	apps := []model.CareerApplication{
		{Number: 12, Company: "Twelve", Status: "Applied"},
		{Number: 101, Company: "OneOhOne", Status: "Applied"},
		{Number: 3, Company: "Three", Status: "Applied"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.activeTab = tabIndexForFilter(t, filterApplied)
	pm.sortMode = sortID
	pm.applyFilterAndSort()

	want := []int{101, 12, 3}
	for i, id := range want {
		if pm.filtered[i].Number != id {
			t.Fatalf("ID sort: position %d = #%d, want #%d", i, pm.filtered[i].Number, id)
		}
	}
}

func TestSortByPayLocationAndLastContact(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "LowPay", Status: "Applied", PayMax: 150_000, WorkMode: "Full", Location: "Austin, TX", LastContact: "2026-06-01"},
		{Company: "NoPay", Status: "Applied", PayMax: 0, WorkMode: "", LastContact: ""},
		{Company: "HighPay", Status: "Applied", PayMax: 250_000, WorkMode: "Hybrid", Location: "Charlotte, NC", LastContact: "2026-06-05"},
		{Company: "MidPay", Status: "Applied", PayMax: 200_000, WorkMode: "Remote", LastContact: "2026-06-03"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.activeTab = tabIndexForFilter(t, filterApplied)

	pm.sortMode = sortPay
	pm.applyFilterAndSort()
	if pm.filtered[0].Company != "HighPay" || pm.filtered[len(pm.filtered)-1].Company != "NoPay" {
		t.Fatalf("pay sort: expected HighPay first and NoPay last, got %s..%s",
			pm.filtered[0].Company, pm.filtered[len(pm.filtered)-1].Company)
	}

	pm.sortMode = sortLocation
	pm.applyFilterAndSort()
	// Remote-first ordering: Remote, Hybrid, Full, unknown.
	wantOrder := []string{"MidPay", "HighPay", "LowPay", "NoPay"}
	for i, w := range wantOrder {
		if pm.filtered[i].Company != w {
			t.Fatalf("location sort: position %d = %s, want %s", i, pm.filtered[i].Company, w)
		}
	}

	pm.sortMode = sortLast
	pm.applyFilterAndSort()
	if pm.filtered[0].Company != "HighPay" || pm.filtered[len(pm.filtered)-1].Company != "NoPay" {
		t.Fatalf("last-contact sort: expected HighPay first and NoPay last, got %s..%s",
			pm.filtered[0].Company, pm.filtered[len(pm.filtered)-1].Company)
	}
}

// The date sort orders by what the DATE column shows: the ledger's latest
// transition when there is one, else the tracker date.
func TestSortByDateUsesListingOrTrackerDate(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "OldEvalRecentChange", Status: "Evaluated", Date: "2026-05-01", StatusDate: "2026-06-20"},
		{Company: "NewEvalNoChange", Status: "Evaluated", Date: "2026-06-10"},
		{Company: "MidEvalMidChange", Status: "Evaluated", Date: "2026-05-15", StatusDate: "2026-06-15"},
		{Company: "NoDates", Status: "Evaluated"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.sortMode = sortDate
	pm.applyFilterAndSort()

	wantOrder := []string{"NewEvalNoChange", "MidEvalMidChange", "OldEvalRecentChange", "NoDates"}
	for i, w := range wantOrder {
		if pm.filtered[i].Company != w {
			t.Fatalf("date sort: position %d = %s, want %s", i, pm.filtered[i].Company, w)
		}
	}
}

func TestSortByPosted(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Old", Status: "Evaluated", PostedOn: "2026-05-01"},
		{Company: "NoDate", Status: "Evaluated", PostedOn: ""},
		{Company: "Fresh", Status: "Evaluated", PostedOn: "2026-08-20"},
		{Company: "Mid", Status: "Evaluated", PostedOn: "2026-07-10"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.sortMode = sortPosted
	pm.applyFilterAndSort()

	// Freshest posting first; rows with no posted date sink to the bottom.
	wantOrder := []string{"Fresh", "Mid", "Old", "NoDate"}
	for i, w := range wantOrder {
		if pm.filtered[i].Company != w {
			t.Fatalf("posted sort: position %d = %s, want %s", i, pm.filtered[i].Company, w)
		}
	}
}
