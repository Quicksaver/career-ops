package screens

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/termenv"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func tabIndexForFilter(t *testing.T, filter string) int {
	t.Helper()

	for i, tab := range pipelineTabs {
		if tab.filter == filter {
			return i
		}
	}

	t.Fatalf("expected pipeline tabs to include filter %q", filter)
	return -1
}

func TestPipelineTabsPrioritizeEvaluatedAndHideAll(t *testing.T) {
	if len(pipelineTabs) == 0 {
		t.Fatal("expected pipeline tabs")
	}
	if pipelineTabs[0].filter != filterEvaluated {
		t.Fatalf("expected first tab to be Evaluated, got %+v", pipelineTabs[0])
	}
	if pipelineTabs[0].label != "OPEN" {
		t.Fatalf("expected first tab label to be Open, got %+v", pipelineTabs[0])
	}
	if pipelineTabs[len(pipelineTabs)-1].filter != filterSkip {
		t.Fatalf("expected last tab to be Skip, got %+v", pipelineTabs[len(pipelineTabs)-1])
	}
	if tabIndexForFilter(t, filterClosed) >= tabIndexForFilter(t, filterDiscarded) {
		t.Fatal("expected Closed tab to appear before Discarded")
	}
	for _, tab := range pipelineTabs {
		if tab.filter == filterAll || tab.label == "ALL" {
			t.Fatalf("All tab should not be rendered, found %+v", tab)
		}
		if tab.label == "TOP ≥4" {
			t.Fatalf("Top tab should not be rendered, found %+v", tab)
		}
	}
}

func TestPipelineDefaultColumns(t *testing.T) {
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, "..", 120, 40)

	if !pm.colVisible(ColDate) {
		t.Fatal("expected Date column to be visible by default")
	}
	if !pm.colVisible(ColHasPDF) {
		t.Fatal("expected PDF column to be visible by default")
	}
	if !pm.colVisible(ColLastContact) {
		t.Fatal("expected Contact column to be visible by default")
	}
	if pm.colVisible(ColHasReport) {
		t.Fatal("expected RPT column to stay hidden by default")
	}

	header := pm.renderColumnHeader()
	if !strings.Contains(header, "DATE") {
		t.Fatalf("expected header to contain DATE, got %q", header)
	}
	if strings.Contains(header, "APPLIED") {
		t.Fatalf("expected header not to contain APPLIED, got %q", header)
	}
	if !strings.Contains(header, "CONTACT") {
		t.Fatalf("expected header to contain CONTACT, got %q", header)
	}
	if strings.Contains(header, "LAST") {
		t.Fatalf("expected header not to contain LAST, got %q", header)
	}
}

func TestPipelineChromeRowsDoNotUseBackgroundHighlight(t *testing.T) {
	previousProfile := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(termenv.TrueColor)
	t.Cleanup(func() {
		lipgloss.SetColorProfile(previousProfile)
	})

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		nil,
		model.PipelineMetrics{
			Total:    3,
			AvgScore: 4.2,
			ByStatus: map[string]int{
				"applied":  2,
				"rejected": 1,
			},
		},
		"..",
		120,
		40,
	)

	rendered := strings.Join([]string{
		pm.renderHeader(),
		pm.renderHelp(),
	}, "\n")

	if strings.Contains(rendered, "48;2;") {
		t.Fatalf("expected passive dashboard chrome rows without background highlights, got %q", rendered)
	}
}

func TestPipelineHelpShowsSortWithoutViewMode(t *testing.T) {
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), nil, model.PipelineMetrics{}, "..", 160, 40)
	pm.sortMode = sortCompany

	help := ansi.Strip(pm.renderHelp())

	if !strings.Contains(help, "Sort: company") {
		t.Fatalf("expected help row to include current sort, got %q", help)
	}
	if strings.Contains(strings.ToLower(help), "view") {
		t.Fatalf("expected help row not to mention view mode, got %q", help)
	}
}

func TestPipelineHeaderRendersTabsInline(t *testing.T) {
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		nil,
		model.PipelineMetrics{
			Total:    12,
			AvgScore: 4.1,
			ByStatus: map[string]int{
				"evaluated": 3,
				"applied":   2,
				"closed":    1,
				"skip":      1,
			},
		},
		"..",
		160,
		40,
	)

	header := pm.renderHeader()
	plain := ansi.Strip(header)

	if strings.Contains(header, "\n") {
		t.Fatalf("expected header tabs to stay inline, got %q", header)
	}
	for _, want := range []string{"CAREER PIPELINE", "OPEN", "APPLIED", "CLOSED", "SKIP", "12 offers | Avg 4.1/5"} {
		if !strings.Contains(plain, want) {
			t.Fatalf("expected inline header to contain %q, got %q", want, plain)
		}
	}
	if strings.Contains(plain, "TOP") {
		t.Fatalf("expected top tab to be removed from header, got %q", plain)
	}
	if got := lipgloss.Width(header); got != pm.width {
		t.Fatalf("expected header width %d, got %d for %q", pm.width, got, plain)
	}
}

func TestWithReloadedDataPreservesStateAndSelection(t *testing.T) {
	initialApps := []model.CareerApplication{
		{
			Company:    "Acme",
			Role:       "Backend Engineer",
			Status:     "Evaluated",
			Score:      4.2,
			ReportPath: "reports/001-acme.md",
		},
		{
			Company:    "Beta",
			Role:       "Platform Engineer",
			Status:     "Applied",
			Score:      4.6,
			ReportPath: "reports/002-beta.md",
		},
	}

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		initialApps,
		model.PipelineMetrics{Total: len(initialApps)},
		"..",
		120,
		40,
	)
	pm.sortMode = sortCompany
	pm.activeTab = tabIndexForFilter(t, filterApplied)
	pm.applyFilterAndSort()
	pm.cursor = 0
	pm.reportCache["reports/002-beta.md"] = reportSummary{tldr: "cached"}

	refreshedApps := []model.CareerApplication{
		initialApps[0],
		initialApps[1],
		{
			Company:    "Gamma",
			Role:       "AI Engineer",
			Status:     "Interview",
			Score:      4.8,
			ReportPath: "reports/003-gamma.md",
		},
	}

	reloaded := pm.WithReloadedData(refreshedApps, model.PipelineMetrics{Total: len(refreshedApps)})

	if reloaded.sortMode != sortCompany {
		t.Fatalf("expected sort mode %q, got %q", sortCompany, reloaded.sortMode)
	}
	if got := len(reloaded.filtered); got != 1 {
		t.Fatalf("expected 1 filtered app after refresh, got %d", got)
	}
	if app, ok := reloaded.CurrentApp(); !ok || app.ReportPath != "reports/002-beta.md" {
		t.Fatalf("expected selection to stay on beta app, got %+v (ok=%v)", app, ok)
	}
	if reloaded.reportCache["reports/002-beta.md"].tldr != "cached" {
		t.Fatal("expected cached report summaries to survive refresh")
	}
}

func TestRenderAppLineIncludesDateColumn(t *testing.T) {
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		nil,
		model.PipelineMetrics{},
		"..",
		160,
		40,
	)

	line := pm.renderAppLine(model.CareerApplication{
		Number:  42,
		Date:    "2026-04-13",
		Company: "Anthropic",
		Role:    "Forward Deployed Engineer",
		Status:  "Applied",
		Score:   4.5,
	}, false)

	if !strings.Contains(line, "2026-04-13") {
		t.Fatalf("expected rendered line to include date column, got %q", line)
	}
	if !strings.Contains(line, "#42") {
		t.Fatalf("expected rendered line to include tracker number marker, got %q", line)
	}
}

func TestSelectedAppLineHighlightsFullRow(t *testing.T) {
	previousProfile := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(termenv.TrueColor)
	t.Cleanup(func() {
		lipgloss.SetColorProfile(previousProfile)
	})

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		nil,
		model.PipelineMetrics{},
		"..",
		160,
		40,
	)

	line := pm.renderAppLine(model.CareerApplication{
		Number:      42,
		Date:        "2026-04-13",
		Company:     "Anthropic",
		Role:        "Forward Deployed Engineer",
		Status:      "Applied",
		Score:       4.5,
		HasPDF:      true,
		LastContact: "2026-04-20",
	}, true)

	if got := lipgloss.Width(line); got != pm.width {
		t.Fatalf("expected selected row to fill width %d, got %d for %q", pm.width, got, ansi.Strip(line))
	}
	if bgCount := strings.Count(line, "48;2;"); bgCount < 6 {
		t.Fatalf("expected selected row background across multiple cells, got %d background markers in %q", bgCount, line)
	}
}

func TestSearchFiltersByCompanyRoleAndNotes(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6, Notes: "payments infra"},
		{Company: "Anthropic", Role: "AI Safety Engineer", Status: "Evaluated", Score: 4.8, Notes: "policy work"},
		{Company: "Acme Corp", Role: "Senior PM, Voice AI", Status: "Evaluated", Score: 4.2, Notes: "Series B in Madrid"},
		{Company: "Globex", Role: "Platform Engineer", Status: "Evaluated", Score: 4.0, Notes: "remote-first"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.activeTab = tabIndexForFilter(t, filterEvaluated)

	// Match by company substring (case-insensitive).
	pm.searchQuery = "stripe"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Stripe" {
		t.Fatalf("expected 1 match for 'stripe', got %+v", pm.filtered)
	}

	// Match by role substring.
	pm.searchQuery = "voice ai"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Acme Corp" {
		t.Fatalf("expected 1 match for 'voice ai', got %+v", pm.filtered)
	}

	// Match by notes substring.
	pm.searchQuery = "madrid"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Acme Corp" {
		t.Fatalf("expected 1 match for notes 'madrid', got %+v", pm.filtered)
	}

	// Empty query restores everything.
	pm.searchQuery = ""
	pm.applyFilterAndSort()
	if len(pm.filtered) != len(apps) {
		t.Fatalf("expected empty query to restore all rows, got %d/%d", len(pm.filtered), len(apps))
	}
}

func TestSearchComposesWithActiveTab(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
		{Company: "Stripe", Role: "Frontend Engineer", Status: "Applied", Score: 4.5},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Applied", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.activeTab = tabIndexForFilter(t, filterApplied)
	pm.searchQuery = "stripe"
	pm.applyFilterAndSort()

	if len(pm.filtered) != 1 || pm.filtered[0].Role != "Frontend Engineer" {
		t.Fatalf("expected applied+stripe to leave only Frontend Engineer, got %+v", pm.filtered)
	}
}

func TestSearchIsCaseInsensitive(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	for _, q := range []string{"anthropic", "ANTHROPIC", "AnThRoPiC"} {
		pm.searchQuery = q
		pm.applyFilterAndSort()
		if len(pm.filtered) != 1 {
			t.Fatalf("expected case-insensitive match for %q, got %d rows", q, len(pm.filtered))
		}
	}
}

func TestSearchEnterCommitsAndEscClearsCommittedQuery(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)

	// Open input and type "stripe".
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	if !pm.searchInput {
		t.Fatal("expected `/` to open search input")
	}
	for _, r := range "stripe" {
		pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	if pm.searchQuery != "stripe" {
		t.Fatalf("expected query to live-update to 'stripe', got %q", pm.searchQuery)
	}
	if len(pm.filtered) != 1 || pm.filtered[0].Company != "Stripe" {
		t.Fatalf("expected live filter to leave only Stripe, got %+v", pm.filtered)
	}

	// Enter commits — input closes, query stays.
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if pm.searchInput {
		t.Fatal("expected Enter to close input")
	}
	if pm.searchQuery != "stripe" {
		t.Fatalf("expected Enter to keep committed query, got %q", pm.searchQuery)
	}

	// Esc on a committed query clears the search and restores the full list.
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if pm.searchQuery != "" {
		t.Fatalf("expected Esc to clear committed query, got %q", pm.searchQuery)
	}
	if len(pm.filtered) != len(apps) {
		t.Fatalf("expected Esc to restore full list, got %d/%d", len(pm.filtered), len(apps))
	}
}

func TestSearchEscInInputCancelsAndClears(t *testing.T) {
	// Use multiple rows so the test catches a regression where Esc clears the query
	// but forgets to re-apply the filter — the visible count would stay at 1
	// otherwise even though the underlying state went stale.
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
		{Company: "Globex", Role: "Platform Engineer", Status: "Evaluated", Score: 4.0},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.searchInput = true
	pm.searchQuery = "stri"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 {
		t.Fatalf("setup expected 1 row matching 'stri', got %d", len(pm.filtered))
	}

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if pm.searchInput {
		t.Fatal("expected Esc in input mode to close input")
	}
	if pm.searchQuery != "" {
		t.Fatalf("expected Esc in input mode to clear in-progress query, got %q", pm.searchQuery)
	}
	if len(pm.filtered) != len(apps) {
		t.Fatalf("expected Esc to re-expand filtered list to %d rows, got %d", len(apps), len(pm.filtered))
	}
}

func TestSearchResetsCursorOnQueryChange(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Acme", Role: "Backend Engineer", Status: "Evaluated", Score: 4.0},
		{Company: "Beta", Role: "Frontend Engineer", Status: "Evaluated", Score: 4.1},
		{Company: "Gamma", Role: "AI Engineer", Status: "Evaluated", Score: 4.2},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	pm.cursor = 2

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})

	if pm.cursor != 0 {
		t.Fatalf("expected cursor to reset to 0 on query change, got %d", pm.cursor)
	}
	if pm.scrollOffset != 0 {
		t.Fatalf("expected scrollOffset to reset to 0 on query change, got %d", pm.scrollOffset)
	}
}

func TestSearchStatePreservedAcrossReload(t *testing.T) {
	initial := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend", Status: "Evaluated", Score: 4.6},
		{Company: "Acme", Role: "AI", Status: "Evaluated", Score: 4.0},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), initial, model.PipelineMetrics{Total: len(initial)}, "..", 120, 40)
	pm.searchQuery = "stripe"
	pm.applyFilterAndSort()

	refreshed := append([]model.CareerApplication{}, initial...)
	refreshed = append(refreshed, model.CareerApplication{Company: "Globex", Role: "Platform", Status: "Applied", Score: 4.3})

	reloaded := pm.WithReloadedData(refreshed, model.PipelineMetrics{Total: len(refreshed)})

	if reloaded.searchQuery != "stripe" {
		t.Fatalf("expected refresh to preserve search query, got %q", reloaded.searchQuery)
	}
	if len(reloaded.filtered) != 1 || reloaded.filtered[0].Company != "Stripe" {
		t.Fatalf("expected refresh+search to keep filter applied, got %+v", reloaded.filtered)
	}
}

func TestRejectedClosedAndDiscardedTabsFilterCorrectly(t *testing.T) {
	apps := []model.CareerApplication{
		{
			Company:    "Acme",
			Role:       "Backend Engineer",
			Status:     "Rejected",
			Score:      3.4,
			ReportPath: "reports/001-acme.md",
		},
		{
			Company:    "Beta",
			Role:       "Platform Engineer",
			Status:     "Closed",
			Score:      4.8,
			ReportPath: "reports/002-beta.md",
		},
		{
			Company:    "Delta",
			Role:       "Platform Engineer",
			Status:     "Discarded",
			Score:      2.1,
			ReportPath: "reports/004-delta.md",
		},
		{
			Company:    "Gamma",
			Role:       "AI Engineer",
			Status:     "Applied",
			Score:      4.6,
			ReportPath: "reports/003-gamma.md",
		},
	}

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		apps,
		model.PipelineMetrics{Total: len(apps)},
		"..",
		120,
		40,
	)

	pm.activeTab = tabIndexForFilter(t, filterRejected)
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Status != "Rejected" {
		t.Fatalf("expected rejected tab to isolate rejected rows, got %+v", pm.filtered)
	}

	pm.activeTab = tabIndexForFilter(t, filterClosed)
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Status != "Closed" {
		t.Fatalf("expected closed tab to isolate closed rows, got %+v", pm.filtered)
	}

	pm.activeTab = tabIndexForFilter(t, filterDiscarded)
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Status != "Discarded" {
		t.Fatalf("expected discarded tab to isolate discarded rows, got %+v", pm.filtered)
	}

}

// Regression: with no committed search query, Esc must NOT close the screen.
// The help bar advertises only `q quit`, so Esc quitting silently was a bug
// that surfaced as accidental exits when users hit Esc to "back out" of the UI.
func TestEscWithoutQueryIsNoOp(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	if pm.searchQuery != "" {
		t.Fatalf("setup expected empty search query, got %q", pm.searchQuery)
	}

	pm, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if cmd != nil {
		// PipelineClosedMsg used to fire here; ensure it doesn't anymore.
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineClosedMsg); ok {
				t.Fatalf("expected Esc with no query to be a no-op, got PipelineClosedMsg")
			}
			t.Fatalf("expected Esc with no query to return nil cmd, got %T", msg)
		}
	}
	if pm.searchInput {
		t.Fatal("Esc with no query should not toggle searchInput")
	}
}

// Regression: typing during search input must not synchronously fan out to
// loadCurrentReport. Reading reports per keystroke caused visible UI lag, so
// the load is deferred to commit (Enter) / cancel (Esc) instead.
func TestSearchTypingDoesNotLoadReports(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Stripe", Role: "Backend Engineer", Status: "Evaluated", Score: 4.6, ReportPath: "reports/001-stripe.md"},
		{Company: "Anthropic", Role: "AI Engineer", Status: "Evaluated", Score: 4.8, ReportPath: "reports/002-anthropic.md"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	if !pm.searchInput {
		t.Fatal("expected `/` to open search input")
	}

	// Typing must not trigger report loading.
	for _, r := range "stri" {
		var cmd tea.Cmd
		pm, cmd = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		if cmd != nil {
			if msg := cmd(); msg != nil {
				if _, ok := msg.(PipelineReportLoadedMsg); ok {
					t.Fatalf("typing rune %q should not emit PipelineReportLoadedMsg", string(r))
				}
			}
		}
	}

	// Backspace must not trigger report loading either.
	pm, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyBackspace})
	if cmd != nil {
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineReportLoadedMsg); ok {
				t.Fatal("Backspace during search input should not emit PipelineReportLoadedMsg")
			}
		}
	}

	// Ctrl+U must not trigger report loading either.
	pm, cmd = pm.Update(tea.KeyMsg{Type: tea.KeyCtrlU})
	if cmd != nil {
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineReportLoadedMsg); ok {
				t.Fatal("Ctrl+U during search input should not emit PipelineReportLoadedMsg")
			}
		}
	}
}

func TestVisibleReportLoadingOnlyQueuesViewportRows(t *testing.T) {
	apps := make([]model.CareerApplication, 0, 40)
	for i := 0; i < 40; i++ {
		apps = append(apps, model.CareerApplication{
			Company:    "Company",
			Role:       "Engineer",
			Status:     "Evaluated",
			Score:      4.0,
			ReportPath: fmt.Sprintf("reports/%03d.md", i),
		})
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 20)
	pm.cursor = 20
	pm.scrollOffset = 18
	pm.reportCache["reports/018.md"] = reportSummary{tldr: "already loaded"}

	paths := pm.visibleReportPathsForLoad()

	if len(paths) == 0 {
		t.Fatal("expected visible report paths to be queued")
	}
	if len(paths) >= len(apps) {
		t.Fatalf("expected a bounded viewport load, got %d paths for %d apps", len(paths), len(apps))
	}
	for _, path := range paths {
		if path == "reports/018.md" {
			t.Fatal("cached report should not be queued again")
		}
	}
	wantCurrent := apps[20].ReportPath
	foundCurrent := false
	for _, path := range paths {
		if path == wantCurrent {
			foundCurrent = true
			break
		}
	}
	if !foundCurrent {
		t.Fatalf("expected current report %q to be queued, got %+v", wantCurrent, paths)
	}
}

func TestVisibleReportLoadingMarksPendingReports(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "Acme", Role: "Backend", Status: "Evaluated", Score: 4.2, ReportPath: "reports/001.md"},
		{Company: "Beta", Role: "Platform", Status: "Evaluated", Score: 4.4, ReportPath: "reports/002.md"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 20)
	cmd := pm.LoadVisibleReports()
	if cmd == nil {
		t.Fatal("expected initial visible report load command")
	}
	if len(pm.reportLoading) == 0 {
		t.Fatal("expected visible report loads to be marked pending")
	}
	if paths := pm.visibleReportPathsForLoad(); len(paths) != 0 {
		t.Fatalf("expected pending reports not to be queued again, got %+v", paths)
	}

	pm.EnrichReportDetails("reports/001.md", data.ReportDetails{TlDr: "loaded"})
	if pm.reportLoading["reports/001.md"] {
		t.Fatal("expected loaded report to be removed from pending set")
	}
}

func TestOpenURLLazyLoadsReportOnDemand(t *testing.T) {
	tempDir := t.TempDir()
	reportsDir := filepath.Join(tempDir, "reports")
	if err := os.MkdirAll(reportsDir, 0o755); err != nil {
		t.Fatalf("mkdir reports dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(reportsDir, "001.md"), []byte("**URL:** https://example.com/jobs/1\n**TL;DR:** Strong fit\n"), 0o644); err != nil {
		t.Fatalf("write report: %v", err)
	}

	app := model.CareerApplication{
		Company:    "Acme",
		Role:       "Backend",
		Status:     "Evaluated",
		Score:      4.2,
		ReportPath: filepath.Join("reports", "001.md"),
	}
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), []model.CareerApplication{app}, model.PipelineMetrics{Total: 1}, tempDir, 120, 20)

	pm, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'o'}})
	if cmd == nil {
		t.Fatal("expected o to lazy-load the report URL when JobURL is missing")
	}
	msg := cmd()
	loaded, ok := msg.(PipelineReportLoadedMsg)
	if !ok {
		t.Fatalf("expected PipelineReportLoadedMsg, got %T", msg)
	}
	if !loaded.OpenURL {
		t.Fatal("expected URL lazy load to request opening after load")
	}
	if loaded.Details.JobURL != "https://example.com/jobs/1" {
		t.Fatalf("expected report URL to load on demand, got %q", loaded.Details.JobURL)
	}
}

func TestEnrichReportUpdatesVisibleApplicationMetadata(t *testing.T) {
	app := model.CareerApplication{
		Company:    "LazyCo",
		Role:       "Staff Engineer",
		Status:     "Evaluated",
		Score:      4.3,
		ReportPath: "reports/003-lazyco.md",
	}
	pm := previewModelWith(t, app)

	pm.EnrichReport(app.ReportPath, "Platform", "Strong fit", "Remote", "$180K", "https://example.com/jobs/3", "2026-03-18")

	current, ok := pm.CurrentApp()
	if !ok {
		t.Fatal("expected current app")
	}
	if current.JobURL != "https://example.com/jobs/3" {
		t.Fatalf("expected lazy report URL to update current app, got %q", current.JobURL)
	}
	if current.ListingDate != "2026-03-18" {
		t.Fatalf("expected lazy listing date to update current app, got %q", current.ListingDate)
	}
	if pm.reportCache[app.ReportPath].tldr != "Strong fit" {
		t.Fatal("expected report summary to be cached")
	}
}

func previewModelWith(t *testing.T, app model.CareerApplication) PipelineModel {
	t.Helper()

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		[]model.CareerApplication{app},
		model.PipelineMetrics{Total: 1},
		"..",
		120,
		40,
	)
	switch data.NormalizeStatus(app.Status) {
	case filterSkip:
		pm.activeTab = tabIndexForFilter(t, filterSkip)
	case filterRejected:
		pm.activeTab = tabIndexForFilter(t, filterRejected)
	case filterClosed:
		pm.activeTab = tabIndexForFilter(t, filterClosed)
	case filterDiscarded:
		pm.activeTab = tabIndexForFilter(t, filterDiscarded)
	case filterApplied:
		pm.activeTab = tabIndexForFilter(t, filterApplied)
	case filterInterview:
		pm.activeTab = tabIndexForFilter(t, filterInterview)
	default:
		pm.activeTab = tabIndexForFilter(t, filterEvaluated)
	}
	pm.applyFilterAndSort()
	pm.cursor = 0
	return pm
}

func TestPreviewKeepsDiscardReasonWhenTlDrIsCached(t *testing.T) {
	app := model.CareerApplication{
		Company:    "Acme",
		Role:       "Backend Engineer",
		Status:     "Descartado 2026-03-12",
		Notes:      "took too long to respond",
		ReportPath: "reports/001-acme.md",
	}
	pm := previewModelWith(t, app)
	pm.reportCache[app.ReportPath] = reportSummary{tldr: "great team, fast pace"}

	preview := pm.renderPreview()

	if !strings.Contains(preview, "great team, fast pace") {
		t.Fatalf("expected preview to keep the cached TL;DR, got %q", preview)
	}
	// Regression for #787: before the Outcome line, a cached TL;DR replaced the
	// notes entirely and the discard reason disappeared from the preview.
	if !strings.Contains(preview, "took too long to respond") {
		t.Fatalf("expected preview to keep the discard reason alongside the TL;DR, got %q", preview)
	}
	if !strings.Contains(preview, "Descartado 2026-03-12") {
		t.Fatalf("expected preview to show the closing status, got %q", preview)
	}
}

func TestPreviewOutcomeShownWithoutReportSummary(t *testing.T) {
	pm := previewModelWith(t, model.CareerApplication{
		Company: "Beta",
		Role:    "Platform Engineer",
		Status:  "SKIP",
		Notes:   "geo blocker",
	})

	preview := pm.renderPreview()

	if !strings.Contains(preview, "Outcome:") || !strings.Contains(preview, "geo blocker") {
		t.Fatalf("expected outcome line with notes for skipped app, got %q", preview)
	}
	if strings.Count(preview, "geo blocker") != 1 {
		t.Fatalf("expected notes to appear exactly once, got %q", preview)
	}
}

func TestPreviewOutcomeShownForClosedApps(t *testing.T) {
	pm := previewModelWith(t, model.CareerApplication{
		Company: "Beta",
		Role:    "Platform Engineer",
		Status:  "Closed",
		Notes:   "posting expired before applying",
	})

	preview := pm.renderPreview()

	if !strings.Contains(preview, "Outcome:") || !strings.Contains(preview, "posting expired before applying") {
		t.Fatalf("expected outcome line with notes for closed app, got %q", preview)
	}
}

func TestPreviewOutcomeOmittedForActiveApps(t *testing.T) {
	app := model.CareerApplication{
		Company:    "Gamma",
		Role:       "AI Engineer",
		Status:     "Applied 2026-04-01",
		Notes:      "warm intro via referral",
		ReportPath: "reports/003-gamma.md",
	}
	pm := previewModelWith(t, app)
	pm.reportCache[app.ReportPath] = reportSummary{tldr: "strong fit"}

	preview := pm.renderPreview()

	if strings.Contains(preview, "Outcome:") {
		t.Fatalf("expected no outcome line for an active app, got %q", preview)
	}
}

func TestPreviewOutcomeForStatusWithoutNotes(t *testing.T) {
	pm := previewModelWith(t, model.CareerApplication{
		Company: "Delta",
		Role:    "SRE",
		Status:  "**Rejected** 2026-05-02",
	})

	preview := pm.renderPreview()

	if !strings.Contains(preview, "Rejected 2026-05-02") {
		t.Fatalf("expected outcome to show the bare closing status, got %q", preview)
	}
	if strings.Contains(preview, "Loading preview...") {
		t.Fatalf("expected outcome line to replace the loading placeholder, got %q", preview)
	}
}

func TestWithReloadedDataPreservesCursorWhenAppRemoved(t *testing.T) {
	initialApps := []model.CareerApplication{
		{
			Company:    "Acme",
			Role:       "Backend Engineer",
			Status:     "Applied",
			Score:      4.2,
			ReportPath: "reports/001-acme.md",
		},
		{
			Company:    "Beta",
			Role:       "Platform Engineer",
			Status:     "Applied",
			Score:      4.6,
			ReportPath: "reports/002-beta.md",
		},
		{
			Company:    "Gamma",
			Role:       "AI Engineer",
			Status:     "Applied",
			Score:      4.8,
			ReportPath: "reports/003-gamma.md",
		},
	}

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		initialApps,
		model.PipelineMetrics{Total: len(initialApps)},
		"..",
		120,
		40,
	)
	pm.activeTab = tabIndexForFilter(t, filterApplied)
	pm.applyFilterAndSort()
	pm.cursor = 1

	refreshedApps := []model.CareerApplication{
		initialApps[0],
		{
			Company:    "Beta",
			Role:       "Platform Engineer",
			Status:     "Rejected", // Changed!
			Score:      4.6,
			ReportPath: "reports/002-beta.md",
		},
		initialApps[2],
	}

	reloaded := pm.WithReloadedData(refreshedApps, model.PipelineMetrics{Total: len(refreshedApps)})

	if got := len(reloaded.filtered); got != 2 {
		t.Fatalf("expected 2 filtered apps after refresh, got %d", got)
	}
	if reloaded.cursor < 0 || reloaded.cursor >= len(reloaded.filtered) {
		t.Fatalf("expected cursor to be within [0, %d], got %d", len(reloaded.filtered)-1, reloaded.cursor)
	}
}
