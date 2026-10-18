package screens

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func pdfViewerFixture(t *testing.T, value string, create bool) (ViewerModel, string) {
	t.Helper()
	root := t.TempDir()
	for _, dir := range []string{"reports", "output"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	pdf := filepath.Join(root, "output", "11729-example CV-é.pdf")
	if create {
		if err := os.WriteFile(pdf, []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	report := filepath.Join(root, "reports", "11729-example.md")
	content := "# Example\n\n**PDF:** " + value + "\n\n## Evaluation\nReadable report.\n"
	if err := os.WriteFile(report, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	m := NewViewerModelWithFileRoot(theme.NewTheme("catppuccin-mocha"), report, "Example", root, 100, 20)
	unchanged, _ := os.ReadFile(report)
	if string(unchanged) != content {
		t.Fatal("viewer rewrote the report source")
	}
	return m, pdf
}

func TestPDFHeaderReplacesGenericLabelWithClickableFilename(t *testing.T) {
	for _, value := range []string{
		"[Two-page A4 CV](../output/11729-example%20CV-%C3%A9.pdf)",
		"[CV](<../output/11729-example CV-é.pdf>)",
		"`output/11729-example CV-é.pdf`",
		"./output/11729-example CV-é.pdf",
	} {
		m, pdf := pdfViewerFixture(t, value, true)
		view := m.View()
		if !strings.Contains(ansi.Strip(view), "output/11729-example CV-é.pdf") || strings.Contains(ansi.Strip(view), "Two-page A4 CV") {
			t.Fatalf("PDF header did not show its filename: %q", ansi.Strip(view))
		}
		if got := linkTargets(view); len(got) != 1 || got[0] != fileURLForPath(pdf) {
			t.Fatalf("PDF header links = %q, want selected user's PDF", got)
		}
	}
}

func TestPDFHeaderRegistersActualFileForBrowserViewing(t *testing.T) {
	m, pdf := pdfViewerFixture(t, "[Two-page A4 CV](../output/11729-example%20CV-%C3%A9.pdf)", true)
	var remote string
	m = m.WithPDFLinker(func(target string) string {
		remote = target
		return "http://workstation.example.ts.net:12345/opaque-token"
	})
	links := linkTargets(m.View())
	if len(links) != 1 {
		t.Fatalf("want one PDF link, got %q", links)
	}
	redirect, err := url.Parse(links[0])
	if err != nil || redirect.Scheme != "http" || redirect.Host != "workstation.example.ts.net:12345" || redirect.Path != "/opaque-token" || redirect.RawQuery != "" {
		t.Fatalf("PDF link must use the dashboard's browser PDF link, got %q", links[0])
	}
	if remote != pdf {
		t.Fatalf("PDF server received %q, want actual file %q", remote, pdf)
	}
	m.Resize(30, 20)
	for i, line := range m.renderedLines {
		assertBalanced(t, i, line)
	}
}

func TestRemotePDFWithoutServerShowsUnavailable(t *testing.T) {
	m, _ := pdfViewerFixture(t, "[CV](../output/11729-example%20CV-%C3%A9.pdf)", true)
	m = m.WithPDFLinker(nil)
	if len(linkTargets(m.View())) != 0 || !strings.Contains(ansi.Strip(m.View()), "remote link unavailable") {
		t.Fatal("remote PDF needs a working PDF server")
	}
}

func TestPDFHeaderDoesNotTrustReportSuppliedSchemesOrPaths(t *testing.T) {
	for _, value := range []string{
		"[CV](vscode://vscode-remote/ssh-remote+attacker/etc/private.pdf)",
		"[CV](file:///etc/private.pdf)",
		"[CV](../../another-user/output/private.pdf)",
		"[CV](../output/not-a-pdf.txt)",
	} {
		m, _ := pdfViewerFixture(t, value, true)
		called := false
		m = m.WithPDFLinker(func(string) string { called = true; return "http://host.example.ts.net/pdf" })
		if got := linkTargets(m.View()); len(got) != 0 || called {
			t.Fatalf("unsafe report header produced links: %q", got)
		}
	}
}

func TestMissingPDFShowsPathWithoutPretendingItCanBeOpened(t *testing.T) {
	m, _ := pdfViewerFixture(t, "[Two-page A4 CV](../output/11729-example%20CV-%C3%A9.pdf)", false)
	if len(linkTargets(m.View())) != 0 || !strings.Contains(ansi.Strip(m.View()), "(missing)") {
		t.Fatal("missing PDF should be named without a clickable target")
	}
}
