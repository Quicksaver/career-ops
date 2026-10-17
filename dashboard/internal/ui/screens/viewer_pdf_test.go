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

func TestPDFHeaderLinksToVSCodeThroughTrustedSSHHost(t *testing.T) {
	m, pdf := pdfViewerFixture(t, "[Two-page A4 CV](../output/11729-example%20CV-%C3%A9.pdf)", true)
	m = m.WithRemoteSSHHost("operator@workstation.example.ts.net")
	links := linkTargets(m.View())
	if len(links) != 1 {
		t.Fatalf("want one PDF link, got %q", links)
	}
	uri, err := url.Parse(links[0])
	if err != nil || uri.Scheme != "vscode" || uri.Host != "vscode-remote" {
		t.Fatalf("invalid VS Code URI: %q", links[0])
	}
	wantPath := "/ssh-remote+operator@workstation.example.ts.net/" + strings.TrimPrefix(filepath.ToSlash(pdf), "/")
	if uri.Path != wantPath || uri.RawQuery != "" || uri.Fragment != "" {
		t.Fatalf("remote PDF target = %q, want %q", uri.Path, wantPath)
	}
	if !strings.Contains(links[0], "%20") || !strings.Contains(links[0], "%C3%A9") {
		t.Fatalf("file path was not URI-encoded: %q", links[0])
	}
	m.Resize(30, 20)
	for i, line := range m.renderedLines {
		assertBalanced(t, i, line)
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
		m = m.WithRemoteSSHHost("operator@workstation.example.ts.net")
		if got := linkTargets(m.View()); len(got) != 0 {
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

func TestInvalidSSHHostCannotInjectRemoteURI(t *testing.T) {
	m, pdf := pdfViewerFixture(t, "[CV](../output/11729-example%20CV-%C3%A9.pdf)", true)
	for _, host := range []string{"operator@host/path", "host?query", "host\x1b[2J", "https://host"} {
		bad := m.WithRemoteSSHHost(host)
		if got := linkTargets(bad.View()); len(got) != 1 || got[0] != fileURLForPath(pdf) {
			t.Fatalf("invalid host %q changed link to %q", host, got)
		}
	}
}
