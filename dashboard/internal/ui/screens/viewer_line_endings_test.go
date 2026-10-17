package screens

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestViewerLineEndingsRenderIdentically(t *testing.T) {
	root := t.TempDir()
	content := strings.Join([]string{
		"# Evaluation: Example — Senior Product Engineer (Go)", "",
		"**Date:** 2026-10-16",
		"**URL:** https://jobs.example.com/External/job/PRT---Porto/Senior-Product-Software-Engineer_R0060065",
		"**Batch ID:** 13902",
		"**Score:** 4.2/5", "",
		"The original queue URL identifies the opportunity. The employer URL is the direct application route.", "",
		"## Machine Summary", "", "```yaml",
		"company: Example", "role: Senior Product Engineer (Go)", "score: 4.2", "```", "",
		"## Role details", "",
		"| Requirement | Evidence |", "|---|---|",
		"| Go product engineering | Production experience |", "",
		strings.Repeat("A paragraph of role requirements and source evidence. ", 8), "",
	}, "\n")
	newViewer := func(t *testing.T, name, text string) ViewerModel {
		t.Helper()
		path := filepath.Join(root, name)
		if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
		m := NewViewerModelWithFileRoot(theme.NewTheme("catppuccin-mocha"), path,
			"Example — Senior Product Engineer (Go)", root, 100, 20,
			model.CareerApplication{Number: 11729}, root)
		unchanged, err := os.ReadFile(path)
		if err != nil || string(unchanged) != text {
			t.Fatal("viewing a report changed its source bytes")
		}
		return m
	}
	for _, ending := range []struct{ name, separator string }{
		{"CRLF", "\r\n"}, {"CR", "\r"},
	} {
		t.Run(ending.name, func(t *testing.T) {
			lf := newViewer(t, ending.name+"-lf.md", content)
			other := newViewer(t, ending.name+".md", strings.ReplaceAll(content, "\n", ending.separator))
			assertSame := func(stage string) {
				t.Helper()
				if strings.Contains(strings.Join(other.renderedLines, "\n"), "\r") {
					t.Fatalf("%s: carriage returns reached terminal output", stage)
				}
				if lf.View() != other.View() {
					t.Fatalf("%s: %s rendering differs from LF rendering", stage, ending.name)
				}
			}
			assertSame("initial view")
			for _, msg := range []tea.Msg{
				tea.KeyMsg{Type: tea.KeyPgDown},
				tea.KeyMsg{Type: tea.KeyEnd},
				tea.WindowSizeMsg{Width: 80, Height: 14},
				tea.KeyMsg{Type: tea.KeyHome},
			} {
				lf, _ = lf.Update(msg)
				other, _ = other.Update(msg)
				assertSame("scroll or resize")
			}
			_, close := other.Update(tea.KeyMsg{Type: tea.KeyEsc})
			if close == nil {
				t.Fatal("viewer no longer closes with Escape")
			}
			if _, ok := close().(ViewerClosedMsg); !ok {
				t.Fatal("Escape did not return to the pipeline")
			}
		})
	}
}
