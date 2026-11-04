package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func otherStatusApps() []model.CareerApplication {
	return []model.CareerApplication{
		{Company: "Northwind", Role: "Designer", Status: "Evaluated", Score: 4, HasScore: true},
		{Company: "Contoso", Role: "Designer", Status: "Paused", Score: 3, HasScore: true},
		{Company: "Fabrikam", Role: "Designer", Status: "hold", Score: 3.5, HasScore: true},
		{Company: "Litware", Role: "Designer", Status: "Closed", Score: 3, HasScore: true},
	}
}

// The fork shows its tabs inline in the header, so the upstream renderTabs and
// metrics-strip checks read the header tab renderers instead.
func TestUnknownStatusGetsItsOwnTab(t *testing.T) {
	apps := otherStatusApps()
	m := NewPipelineModel(theme.NewTheme(""), apps, data.ComputeMetrics(apps), t.TempDir(), 400, 40)

	tabs := ansi.Strip(m.renderHeaderTabsWithCounts(true))
	if !strings.Contains(tabs, "OTHER:1") {
		t.Fatalf("tabs = %q, want OTHER:1 for the status the canonical list does not name", tabs)
	}
	if !strings.Contains(tabs, "CLOSED:1") {
		t.Fatalf("tabs = %q, want Closed to stay on its own CLOSED tab, not OTHER", tabs)
	}

	narrow := m
	narrow.activeTab = tabIndexForFilter(t, filterOther)
	if got := ansi.Strip(narrow.renderPlainHeaderTabs(12)); !strings.Contains(got, "OTHER") {
		t.Fatalf("selected other tab on a narrow header = %q, want OTHER", got)
	}

	m.activeTab = tabIndexForFilter(t, filterEvaluated)
	m.applyFilterAndSort()
	sawHold := false
	for _, app := range m.filtered {
		if app.Status == "Paused" {
			t.Fatalf("open tab included status %q", app.Status)
		}
		if app.Company == "Fabrikam" {
			sawHold = true
		}
	}
	if !sawHold {
		t.Fatal("hold is an evaluated alias and left the open tab")
	}

	m.activeTab = tabIndexForFilter(t, filterOther)
	m.applyFilterAndSort()
	if len(m.filtered) != 1 || m.filtered[0].Company != "Contoso" {
		t.Fatalf("other tab = %#v, want only the paused row", m.filtered)
	}
}

func TestEveryRowLandsOnATab(t *testing.T) {
	apps := otherStatusApps()
	m := NewPipelineModel(theme.NewTheme(""), apps, data.ComputeMetrics(apps), t.TempDir(), 400, 40)
	total := 0
	for _, tab := range getPipelineTabs() {
		total += m.countForFilter(tab.filter)
	}
	if total != len(apps) {
		t.Fatalf("tab counts sum to %d, want %d rows", total, len(apps))
	}
}

func TestCleanTrackerHidesTheOtherTab(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Northwind", Role: "Designer", Status: "Evaluated", Score: 4, HasScore: true},
	}
	m := NewPipelineModel(theme.NewTheme(""), apps, data.ComputeMetrics(apps), t.TempDir(), 400, 40)
	if tabs := ansi.Strip(m.renderHeaderTabsWithCounts(true)); strings.Contains(tabs, "OTHER") {
		t.Fatalf("clean tracker showed %q", tabs)
	}
	if tabs := ansi.Strip(m.renderPlainHeaderTabs(400)); strings.Contains(tabs, "OTHER") {
		t.Fatalf("clean tracker plain tabs showed %q", tabs)
	}
	m.stepTab(-1)
	if got := getPipelineTabs()[m.activeTab].filter; got == filterOther {
		t.Fatal("stepping left from the first tab landed on an empty OTHER tab")
	}
}
