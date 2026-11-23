package main

import (
	"context"
	"os/exec"
	"runtime"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

// cv2macTimeout bounds one copy, so an unreachable Mac ends in a flash
// instead of a send that never reports back.
const cv2macTimeout = 2 * time.Minute

// findCV2Mac returns the command line that runs the cv2mac tool, which copies
// a CV PDF to the MacBook's Downloads folder, or nil when it is not installed.
// It is a fork-local tool on PATH: an executable named cv2mac, or on Windows
// the PowerShell script cv2mac.ps1. The PDF path is appended per call.
func findCV2Mac() []string {
	return findCV2MacWith(exec.LookPath, runtime.GOOS)
}

func findCV2MacWith(lookPath func(string) (string, error), goos string) []string {
	if path, err := lookPath("cv2mac"); err == nil {
		return []string{path}
	}
	if goos != "windows" {
		return nil
	}
	script, err := lookPath("cv2mac.ps1")
	if err != nil {
		return nil
	}
	for _, shell := range []string{"pwsh", "powershell"} {
		if exe, err := lookPath(shell); err == nil {
			return []string{exe, "-NoProfile", "-NonInteractive", "-File", script}
		}
	}
	return nil
}

// runCV2Mac runs cv2mac on pdfPath and reports the outcome to the viewer.
func runCV2Mac(argv []string, pdfPath string) tea.Cmd {
	return func() tea.Msg {
		if len(argv) == 0 {
			return screens.ViewerCV2MacDoneMsg{Err: "cv2mac was not found on PATH"}
		}
		ctx, cancel := context.WithTimeout(context.Background(), cv2macTimeout)
		defer cancel()
		args := append(append([]string{}, argv[1:]...), pdfPath)
		out, err := exec.CommandContext(ctx, argv[0], args...).CombinedOutput()
		if ctx.Err() != nil {
			return screens.ViewerCV2MacDoneMsg{Err: "timed out after " + cv2macTimeout.String()}
		}
		last := lastOutputLine(out)
		if err != nil {
			if last == "" {
				last = err.Error()
			}
			return screens.ViewerCV2MacDoneMsg{Err: last}
		}
		if last == "" {
			last = "Sent to the Mac"
		}
		return screens.ViewerCV2MacDoneMsg{Output: last}
	}
}

// lastOutputLine returns the last non-blank line of out. PowerShell colors an
// error record even into a pipe and prefixes its lines with "| ", so both the
// escape sequences and the prefix are dropped.
func lastOutputLine(out []byte) string {
	lines := strings.Split(strings.TrimSpace(ansi.Strip(string(out))), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(lines[i]), "|")); line != "" {
			return line
		}
	}
	return ""
}
