package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// The fork has no ALL tab, so every tab but OTHER holds one status and the
// STATUS column repeats the tab name. It renders only on OTHER.
func TestStatusColumnOnlyOnOtherTab(t *testing.T) {
	apps := []model.CareerApplication{
		{Number: 1, Company: "Northwind", Role: "Engineer", Status: "Evaluated", Score: 4, HasScore: true},
		{Number: 2, Company: "Contoso", Role: "Engineer", Status: "Paused", Score: 3, HasScore: true},
	}
	m := NewPipelineModel(theme.NewTheme(""), apps, model.PipelineMetrics{}, "", 160, 40)
	header := ansi.Strip(m.renderColumnHeader())
	if strings.Contains(header, i18n.Current.ColStatus) {
		t.Fatalf("OPEN tab header shows the STATUS column: %q", header)
	}

	tabs := getPipelineTabs()
	m.activeTab = len(tabs) - 1
	if tabs[m.activeTab].filter != filterOther {
		t.Fatalf("last tab is %q, want OTHER", tabs[m.activeTab].filter)
	}
	m.applyFilterAndSort()
	header = ansi.Strip(m.renderColumnHeader())
	if !strings.Contains(header, i18n.Current.ColStatus) {
		t.Fatalf("OTHER tab header lacks the STATUS column: %q", header)
	}
	if len(m.filtered) != 1 || !strings.Contains(strings.ToLower(ansi.Strip(m.renderAppLine(m.filtered[0], false))), "paused") {
		t.Fatalf("OTHER tab row does not show its raw status")
	}
}

func TestForkDefaultColumns(t *testing.T) {
	m := NewPipelineModel(theme.NewTheme(""), nil, model.PipelineMetrics{}, "", 200, 40)
	if !m.colVisible(ColPosted) {
		t.Fatal("POSTED is hidden by default")
	}
	if m.colVisible(ColDate) {
		t.Fatal("DATE is visible by default")
	}
}

// Tabs whose status has its own colour use it; neutral statuses stay muted.
func TestTabsCarryStatusColours(t *testing.T) {
	m := NewPipelineModel(theme.NewTheme(""), nil, model.PipelineMetrics{}, "", 200, 40)
	if c, own := m.tabColor(filterApplied); !own || c != m.theme.Sky {
		t.Fatalf("APPLIED tab colour = %v (own %v), want Sky", c, own)
	}
	if c, own := m.tabColor(filterSkip); !own || c != m.theme.Red {
		t.Fatalf("SKIP tab colour = %v (own %v), want Red", c, own)
	}
	if c, own := m.tabColor(filterEvaluated); own || c != m.theme.Subtext {
		t.Fatalf("OPEN tab colour = %v (own %v), want muted", c, own)
	}
	if c, own := m.tabColor(filterOther); own || c != m.theme.Subtext {
		t.Fatalf("OTHER tab colour = %v (own %v), want muted", c, own)
	}
}
