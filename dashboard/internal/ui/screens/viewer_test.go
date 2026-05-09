package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestWrapTableCellWrapsLongContentWithoutTruncation(t *testing.T) {
	original := "Software Engineer (Rust) / Platform Engineer (cross-platform libraries)"
	wrapped := wrapTableCell(original, 20)

	if len(wrapped) < 2 {
		t.Fatalf("expected wrapped cell to span multiple lines, got %v", wrapped)
	}

	for _, line := range wrapped {
		if strings.Contains(line, "...") {
			t.Fatalf("expected wrapped cell to preserve content instead of truncating, got %v", wrapped)
		}
	}

	got := strings.Join(strings.Fields(strings.Join(wrapped, " ")), " ")
	want := strings.Join(strings.Fields(original), " ")
	if got != want {
		t.Fatalf("expected wrapped content to preserve original text, got %q want %q", got, want)
	}
}

func TestRenderTableBlockWrapsRowsInsteadOfTruncating(t *testing.T) {
	m := ViewerModel{
		theme: theme.NewTheme("catppuccin-mocha"),
		width: 50,
	}

	lines := []string{
		"| Field | Value |",
		"|-------|-------|",
		"| **Archetype** | Software Engineer (Rust) / Platform Engineer (cross-platform libraries) |",
	}

	rendered := m.renderTableBlock(lines, []int{14, 20}, 0)
	joined := strings.Join(rendered, "\n")

	if strings.Contains(joined, "...") {
		t.Fatalf("expected rendered table to wrap long cells instead of truncating, got %q", joined)
	}

	if len(rendered) <= 5 {
		t.Fatalf("expected wrapped row to add visual lines, got %d lines", len(rendered))
	}
	if !strings.Contains(joined, "Software Engineer") || !strings.Contains(joined, "(cross-platform") {
		t.Fatalf("expected wrapped table to keep long content visible across wrapped lines, got %q", joined)
	}
}

func TestRenderBodyStaysWithinViewportHeightWhenTablesWrap(t *testing.T) {
	m := ViewerModel{
		theme:  theme.NewTheme("catppuccin-mocha"),
		width:  50,
		height: 10,
		lines: []string{
			"# Evaluation",
			"",
			"| Field | Value |",
			"|-------|-------|",
			"| **Archetype** | Software Engineer (Rust) / Platform Engineer (cross-platform libraries) |",
			"",
			"After table",
		},
	}

	body := m.renderBody()
	lineCount := len(strings.Split(body, "\n"))
	if lineCount != m.bodyHeight() {
		t.Fatalf("expected body to render exactly %d lines, got %d", m.bodyHeight(), lineCount)
	}
}

func TestMaxScrollUsesRenderedHeightForWrappedTables(t *testing.T) {
	m := ViewerModel{
		theme:  theme.NewTheme("catppuccin-mocha"),
		width:  50,
		height: 10,
		lines: []string{
			"# Evaluation",
			"",
			"| Field | Value |",
			"|-------|-------|",
			"| **Archetype** | Software Engineer (Rust) / Platform Engineer (cross-platform libraries) |",
			"",
			"After table",
			"Final line",
		},
	}

	if got, rawBased := m.maxScroll(), len(m.lines)-m.bodyHeight(); got <= rawBased {
		t.Fatalf("expected wrapped rendering to increase scroll range, got maxScroll=%d rawBased=%d", got, rawBased)
	}

	m.scrollOffset = m.maxScroll()
	body := m.renderBody()
	if !strings.Contains(body, "Final line") {
		t.Fatalf("expected bottom of wrapped document to be reachable, got %q", body)
	}
}

func TestRenderedLinesWrapLongPlainTextWithoutTruncation(t *testing.T) {
	m := ViewerModel{
		theme: theme.NewTheme("catppuccin-mocha"),
		width: 60,
		lines: []string{
			"    Response: I bring extreme optimization experience from outside trading like speeding up 400M-plus-row data processing by 20x, and strong systems design that carries across domains.",
		},
	}

	rendered := m.renderedLines()
	if len(rendered) < 2 {
		t.Fatalf("expected long plain text to wrap into multiple visual lines, got %d", len(rendered))
	}

	joined := strings.Join(strings.Fields(ansi.Strip(strings.Join(rendered, " "))), " ")
	want := strings.Join(strings.Fields(m.lines[0]), " ")
	if joined != want {
		t.Fatalf("expected wrapped plain text to preserve full content, got %q want %q", joined, want)
	}
}

func TestMaxScrollUsesRenderedHeightForWrappedPlainText(t *testing.T) {
	m := ViewerModel{
		theme:  theme.NewTheme("catppuccin-mocha"),
		width:  60,
		height: 8,
		lines: []string{
			"Short intro",
			"Response: I bring extreme optimization experience from outside trading like speeding up 400M-plus-row data processing by 20x, and strong systems design that carries across domains.",
			"Final line",
		},
	}

	if got, rawBased := m.maxScroll(), len(m.lines)-m.bodyHeight(); got <= rawBased {
		t.Fatalf("expected wrapped plain text to increase scroll range, got maxScroll=%d rawBased=%d", got, rawBased)
	}

	m.scrollOffset = m.maxScroll()
	body := ansi.Strip(m.renderBody())
	if !strings.Contains(body, "Final line") {
		t.Fatalf("expected bottom of wrapped plain text to be reachable, got %q", body)
	}
}

func TestComputeColumnWidthsKeepsNumericIndexColumnTight(t *testing.T) {
	lines := []string{
		"| # | Gap | Type | Mitigation |",
		"|---|-----|------|------------|",
		"| 1 | Missing Rust | Hard | Build and ship more Rust projects |",
		"| 234 | Mobile gap | Medium | Show transferable cross-platform work |",
	}

	widths := computeColumnWidths(lines, 120)
	if got, want := widths[0], 3; got != want {
		t.Fatalf("expected numeric index column to stay tight at width %d, got %d", want, got)
	}
	if widths[1] > 45 {
		t.Fatalf("expected first descriptive column to stay capped at 45, got %d", widths[1])
	}
}

func TestComputeColumnWidthsUsesRemainingWidthForFlexibleColumns(t *testing.T) {
	lines := []string{
		"| Field | Value |",
		"|-------|-------|",
		"| **Archetype** | Software Engineer (Rust) / Platform Engineer (cross-platform libraries) |",
	}

	widths := computeColumnWidths(lines, 100)
	if got, want := widths[0], 13; got != want {
		t.Fatalf("expected short first descriptive column to keep natural width %d, got %d", want, got)
	}
	if got, want := widths[1], 80; got != want {
		t.Fatalf("expected remaining column to absorb available width %d, got %d", want, got)
	}

	total := 1
	for _, w := range widths {
		total += w + 3
	}
	if total != 100 {
		t.Fatalf("expected table to use full available width 100, got %d", total)
	}
}

func TestComputeColumnWidthsSplitsExtraWidthAcrossRemainingColumns(t *testing.T) {
	lines := []string{
		"| # | Gap | Type | Mitigation |",
		"|---|-----|------|------------|",
		"| 1 | Missing Rust | Hard requirement | Build and ship more Rust projects |",
	}

	widths := computeColumnWidths(lines, 80)
	if diff := widths[2] - widths[3]; diff < -1 || diff > 1 {
		t.Fatalf("expected remaining columns to flex nearly equally, got %v", widths)
	}
	if got, want := widths[1], 12; got != want {
		t.Fatalf("expected first descriptive column to keep natural width %d, got %v", want, widths)
	}
	if widths[2] < 20 || widths[3] < 20 {
		t.Fatalf("expected flexible columns to receive most of the remaining width, got %v", widths)
	}

	total := 1
	for _, w := range widths {
		total += w + 3
	}
	if total != 80 {
		t.Fatalf("expected table to use full available width 80, got %d", total)
	}
}

func TestComputeColumnWidthsKeepsFirstDescriptiveColumnReadableInMultiColumnTables(t *testing.T) {
	lines := []string{
		"| Requirement | Evidence | Status |",
		"|-------------|----------|--------|",
		"| Proven Rust experience | Personal Rust CLI and systems work | Mitigable gap |",
	}

	widths := computeColumnWidths(lines, 90)
	if widths[0] < 20 || widths[0] > 45 {
		t.Fatalf("expected first descriptive column to stay within natural/capped range, got %v", widths)
	}

	total := 1
	for _, w := range widths {
		total += w + 3
	}
	if total != 90 {
		t.Fatalf("expected table to use full available width 90, got %d", total)
	}
}

func TestComputeColumnWidthsCapsLongFirstDescriptiveColumnBeforeWrapping(t *testing.T) {
	lines := []string{
		"| Requirement | Evidence | Status |",
		"|-------------|----------|--------|",
		"| This is a very long first-column value that should cap instead of collapsing | Personal Rust CLI and systems work | Mitigable gap |",
	}

	widths := computeColumnWidths(lines, 90)
	if got, want := widths[0], 45; got != want {
		t.Fatalf("expected long first descriptive column to cap at %d, got %v", want, widths)
	}
	if diff := widths[1] - widths[2]; diff < -1 || diff > 1 {
		t.Fatalf("expected remaining columns to split leftover width nearly equally, got %v", widths)
	}
}
