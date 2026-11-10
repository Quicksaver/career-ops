package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestStackSegmentsKeepEveryStatusVisible(t *testing.T) {
	for _, tc := range []struct {
		counts []int
		cells  int
		want   int
	}{
		{[]int{380, 20, 6, 2}, 60, 60},
		{[]int{1, 1, 1}, 0, 3},
		{[]int{500, 1}, 10, 10},
		{[]int{0, 7, 0}, 5, 5},
	} {
		got := stackSegments(tc.counts, tc.cells)
		sum := 0
		for i, n := range got {
			sum += n
			if tc.counts[i] > 0 && n < 1 {
				t.Errorf("%v into %d: status %d got no cell: %v", tc.counts, tc.cells, i, got)
			}
			if tc.counts[i] == 0 && n != 0 {
				t.Errorf("%v into %d: empty status %d got %d cells", tc.counts, tc.cells, i, n)
			}
		}
		if sum != tc.want {
			t.Errorf("%v into %d: cells sum to %d, want %d (%v)", tc.counts, tc.cells, sum, tc.want, got)
		}
	}
	if got := stackSegments(nil, 10); len(got) != 0 {
		t.Errorf("no counts gave %v", got)
	}
}

func TestWeeklyActivityShowsStatusBreakdown(t *testing.T) {
	m := ProgressModel{width: 120, theme: theme.NewTheme("catppuccin-mocha"), metrics: model.ProgressMetrics{
		WeeklyActivity: []model.WeekActivity{
			{Week: "2026-W44", Start: "2026-10-26", Count: 412, ByStatus: map[string]int{"skip": 380, "closed": 20, "evaluated": 10, "applied": 2}},
			{Week: "2026-W45", Count: 9, ByStatus: map[string]int{"evaluated": 8, "paused": 1}},
		},
	}}
	out := m.renderWeeklyActivity()
	lines := strings.Split(ansi.Strip(out), "\n")
	if len(lines) != 3 {
		t.Fatalf("got %d lines, want title plus 2 weeks:\n%s", len(lines), ansi.Strip(out))
	}
	if !strings.Contains(lines[1], "412  10 open · 2 applied · 20 closed · 380 skip") {
		t.Errorf("W44 breakdown missing or out of tab order: %q", lines[1])
	}
	if !strings.HasPrefix(strings.TrimSpace(lines[1]), "26/10–01/11 ") {
		t.Errorf("W44 not labelled by its day/month range: %q", lines[1])
	}
	if !strings.HasPrefix(strings.TrimSpace(lines[2]), "W45 ") {
		t.Errorf("week without a start date should fall back to its ISO label: %q", lines[2])
	}
	if !strings.Contains(lines[2], "8 open · 1 other") {
		t.Errorf("non-canonical status not folded into other: %q", lines[2])
	}
	// The totals and breakdowns line up in one column.
	col := func(line, sub string) int { return lipgloss.Width(line[:strings.Index(line, sub)]) }
	if col(lines[1], "10 open") != col(lines[2], "8 open") {
		t.Errorf("count columns misaligned:\n%s\n%s", lines[1], lines[2])
	}
	for _, width := range []int{40, 80, 120} {
		m.width = width
		for _, line := range strings.Split(m.renderWeeklyActivity(), "\n") {
			if got := lipgloss.Width(line); got > width {
				t.Errorf("width %d: line is %d cells wide: %q", width, got, ansi.Strip(line))
			}
		}
	}
}
