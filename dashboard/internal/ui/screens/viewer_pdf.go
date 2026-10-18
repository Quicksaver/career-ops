package screens

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

type viewerPDFLink struct {
	path, label string
	exists      bool
}

// WithPDFLinker registers a validated PDF path with the dashboard's PDF server.
func (m ViewerModel) WithPDFLinker(linker func(string) string) ViewerModel {
	m.pdfLinker = linker
	m.pdfConfigured = true
	m.rebuildRender()
	return m
}

func withinDirectory(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func resolveViewerPDFLink(content, reportPath, userRoot string) viewerPDFLink {
	if userRoot == "" {
		return viewerPDFLink{}
	}
	var target string
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "## ") {
			break
		}
		if strings.HasPrefix(line, "**PDF:**") {
			target = strings.TrimSpace(strings.TrimPrefix(line, "**PDF:**"))
			break
		}
	}
	if link := reLink.FindStringSubmatch(target); link != nil {
		target = markdownLinkTarget(link[2])
	} else {
		target = strings.Trim(target, "`")
	}
	if strings.HasPrefix(target, "file:") {
		uri, err := url.Parse(target)
		if err != nil || uri.Host != "" || uri.User != nil || uri.RawQuery != "" || uri.Fragment != "" {
			return viewerPDFLink{}
		}
		target = uri.Path
		// file:///E:/... stores a Windows drive behind a URI-leading slash.
		if len(target) > 3 && target[0] == '/' && target[2] == ':' {
			target = target[1:]
		}
	} else if strings.Contains(target, "://") {
		return viewerPDFLink{}
	} else if decoded, err := url.PathUnescape(target); err == nil {
		target = decoded
	} else {
		return viewerPDFLink{}
	}
	if !strings.EqualFold(filepath.Ext(target), ".pdf") {
		return viewerPDFLink{}
	}
	for _, r := range target {
		if r < 0x20 || r >= 0x7f && r <= 0x9f {
			return viewerPDFLink{}
		}
	}
	root, err := filepath.Abs(userRoot)
	if err != nil {
		return viewerPDFLink{}
	}
	outputRoot := filepath.Join(root, "output")
	target = filepath.FromSlash(target)
	if !filepath.IsAbs(target) {
		if strings.HasPrefix(filepath.ToSlash(filepath.Clean(target)), "output/") {
			target = filepath.Join(root, target)
		} else {
			target = filepath.Join(filepath.Dir(reportPath), target)
		}
	}
	target, err = filepath.Abs(target)
	if err != nil || !withinDirectory(outputRoot, target) {
		return viewerPDFLink{}
	}
	label, _ := filepath.Rel(root, target)
	link := viewerPDFLink{path: target, label: filepath.ToSlash(label)}
	info, err := os.Stat(target)
	if os.IsNotExist(err) {
		return link
	}
	if err != nil || !info.Mode().IsRegular() {
		return viewerPDFLink{}
	}
	actualOutput, rootErr := filepath.EvalSymlinks(outputRoot)
	actualTarget, targetErr := filepath.EvalSymlinks(target)
	if rootErr != nil || targetErr != nil || !withinDirectory(actualOutput, actualTarget) {
		return viewerPDFLink{}
	}
	link.exists = true
	return link
}

func (m ViewerModel) renderPDFHeader(width int) string {
	header := lipgloss.NewStyle().Foreground(m.theme.Yellow).Bold(true).Render("PDF:")
	label := lipgloss.NewStyle().Foreground(m.theme.Blue).Underline(true).Render(m.pdf.label)
	if m.pdf.exists {
		target := fileURLForPath(m.pdf.path)
		if m.pdfConfigured {
			target = ""
			if m.pdfLinker != nil {
				target = m.pdfLinker(m.pdf.path)
			}
		}
		if target != "" {
			label = hyperlink(target, label)
		} else {
			label += lipgloss.NewStyle().Foreground(m.theme.Subtext).Render(" (remote link unavailable)")
		}
	} else {
		label += lipgloss.NewStyle().Foreground(m.theme.Subtext).Render(" (missing)")
	}
	return ansi.Wrap(header+" "+label, width, "")
}
