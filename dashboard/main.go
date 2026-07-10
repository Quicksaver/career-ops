package main

import (
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
	"github.com/santifer/career-ops/dashboard/internal/ui/screens"
)

var reUserID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

type viewState int

const (
	viewPipeline viewState = iota
	viewReport
	viewProgress
)

type appModel struct {
	pipeline        screens.PipelineModel
	viewer          screens.ViewerModel
	progress        screens.ProgressModel
	state           viewState
	careerOpsPath   string
	theme           theme.Theme
	progressMetrics model.ProgressMetrics
}

func (m *appModel) reloadPipelineData() {
	apps := data.ParseApplicationsForDashboard(m.careerOpsPath)
	metrics := data.ComputeMetrics(apps)
	m.progressMetrics = data.ComputeProgressMetrics(apps)
	m.pipeline = m.pipeline.WithReloadedData(apps, metrics)
}

func (m appModel) Init() tea.Cmd {
	return m.pipeline.LoadVisibleReports()
}

// Update manages global app state and routes incoming messages to active screens.
func (m appModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if keyMsg, ok := msg.(tea.KeyMsg); ok {
		switch keyMsg.String() {
		case "t", "T":
			// Toggle language globally, unless the user is actively typing in a text input field
			if !(m.state == viewPipeline && m.pipeline.IsTextInputActive()) {
				i18n.ToggleLang()
			}
		}
	}

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.pipeline.Resize(msg.Width, msg.Height)
		if m.state == viewReport {
			m.viewer.Resize(msg.Width, msg.Height)
		}
		if m.state == viewProgress {
			m.progress.Resize(msg.Width, msg.Height)
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		if m.state == viewPipeline {
			return m, tea.Batch(cmd, m.pipeline.LoadVisibleReports())
		}
		return m, cmd

	case screens.PipelineClosedMsg:
		return m, tea.Quit

	case screens.PipelineReportLoadedMsg:
		m.pipeline.EnrichReportDetails(msg.ReportPath, msg.Details)
		if msg.OpenURL && msg.Details.JobURL != "" {
			target := dashboardOpenTarget(m.careerOpsPath, msg.Details.JobURL)
			return m, func() tea.Msg {
				if err := openWithDefaultApp(target); err != nil {
					fmt.Fprintf(os.Stderr, "WARN: failed to open URL %q: %v\n", target, err)
				}
				return nil
			}
		}
		return m, nil

	case screens.PipelineUpdateStatusMsg:
		err := data.UpdateApplicationStatus(msg.CareerOpsPath, msg.App, msg.NewStatus)
		if err != nil {
			// Log the error but still reload data to keep UI consistent
			fmt.Fprintf(os.Stderr, "WARN: status update failed: %v\n", err)
		}
		m.reloadPipelineData()
		return m, m.pipeline.LoadVisibleReports()

	case screens.PipelineUpdateStatusAndNotesMsg:
		err := data.UpdateApplicationStatusAndNotes(msg.CareerOpsPath, msg.App, msg.NewStatus, msg.NewNotes)
		if err != nil {
			fmt.Fprintf(os.Stderr, "WARN: status and notes update failed: %v\n", err)
		}
		m.reloadPipelineData()
		return m, nil

	case screens.PipelineRefreshMsg:
		m.reloadPipelineData()
		return m, m.pipeline.LoadVisibleReports()

	case screens.PipelineOpenReportMsg:
		m.viewer = screens.NewViewerModelWithFileRoot(
			m.theme,
			msg.Path, msg.Title, m.careerOpsPath,
			m.pipeline.Width(), m.pipeline.Height(),
			msg.App, m.careerOpsPath,
		)
		m.state = viewReport
		return m, nil

	case screens.ViewerClosedMsg:
		m.state = viewPipeline
		return m, nil

	case screens.ViewerOpenCoverLetterMsg:
		path := msg.Path
		return m, func() tea.Msg {
			if err := openWithDefaultApp(path); err != nil {
				fmt.Fprintf(os.Stderr, "WARN: could not open cover letter: %v\n", err)
			}
			return nil
		}

	case screens.ViewerUpdateStatusMsg:
		normalized := data.NormalizeStatus(msg.NewStatus)
		if normalized == "hired" {
			err := data.UpdateApplicationStatus(m.careerOpsPath, msg.App, msg.NewStatus)
			if err != nil {
				fmt.Fprintf(os.Stderr, "WARN: status update failed: %v\n", err)
				m.reloadPipelineData()
				return m, nil
			}
			m.state = viewPipeline
			m.pipeline, _ = m.pipeline.StartHiredFlow(msg.App)
			m.reloadPipelineData()
			return m, nil
		}
		if normalized == "discarded" || normalized == "skip" {
			m.state = viewPipeline
			m.pipeline, _ = m.pipeline.StartDiscardReasonFlow(msg.App, msg.NewStatus)
			m.reloadPipelineData()
			return m, nil
		}

		err := data.UpdateApplicationStatus(m.careerOpsPath, msg.App, msg.NewStatus)
		if err != nil {
			fmt.Fprintf(os.Stderr, "WARN: status update failed: %v\n", err)
		}
		m.viewer.UpdateAppStatus(msg.NewStatus)
		m.reloadPipelineData()
		return m, m.pipeline.LoadVisibleReports()

	case screens.PipelineOpenProgressMsg:
		m.progress = screens.NewProgressModel(
			theme.NewTheme("catppuccin-mocha"),
			m.progressMetrics,
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewProgress
		return m, nil

	case screens.ProgressClosedMsg:
		m.state = viewPipeline
		return m, nil

	case screens.PipelineOpenURLMsg:
		return m, openCmd(dashboardOpenTarget(m.careerOpsPath, msg.URL))

	case screens.PipelineOpenPDFMsg:
		return m, openCmd(msg.Path)

	case screens.PipelineGeneratePDFMsg:
		return m, runGeneratePDF(msg)

	default:
		if m.state == viewReport {
			vm, cmd := m.viewer.Update(msg)
			m.viewer = vm
			return m, cmd
		}
		if m.state == viewProgress {
			pg, cmd := m.progress.Update(msg)
			m.progress = pg
			return m, cmd
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd
	}
}

// openCmd wraps openWithDefaultApp (OS-specific) as a tea.Cmd. Shared by the
// job-URL (`o`) and CV-PDF (`d`) actions.
func openCmd(target string) tea.Cmd {
	return func() tea.Msg {
		if err := openWithDefaultApp(target); err != nil {
			fmt.Fprintf(os.Stderr, "WARN: failed to open %q: %v\n", target, err)
		}
		return nil
	}
}

// runGeneratePDF shells out to node generate-pdf.mjs in the career-ops root,
// opens the resulting PDF on success, and reports the outcome back to the
// pipeline screen as a PipelinePDFGeneratedMsg. Runs in a tea.Cmd goroutine,
// so the UI stays responsive while Chromium renders.
func runGeneratePDF(msg screens.PipelineGeneratePDFMsg) tea.Cmd {
	return func() tea.Msg {
		projectRoot, err := inferProjectRootForUserRoot(msg.CareerOpsPath)
		if err != nil {
			return screens.PipelinePDFGeneratedMsg{Err: err.Error()}
		}
		userID := filepath.Base(msg.CareerOpsPath)
		htmlPath := filepath.Join(msg.CareerOpsPath, filepath.FromSlash(msg.HTMLPath))
		pdfPath := filepath.Join(msg.CareerOpsPath, filepath.FromSlash(msg.PDFPath))
		args := []string{
			filepath.Join(projectRoot, "generate-pdf.mjs"),
			"--user", userID,
			htmlPath,
			pdfPath,
		}
		if msg.Format != "" {
			args = append(args, "--format="+msg.Format)
		}
		if msg.ReportNumber != "" {
			args = append(args, "--report="+msg.ReportNumber)
		}
		cmd := exec.Command("node", args...)
		cmd.Dir = projectRoot
		cmd.Env = append(os.Environ(), "CAREER_OPS_USERS_DIR="+filepath.Dir(msg.CareerOpsPath))
		out, err := cmd.CombinedOutput()
		if err != nil {
			return screens.PipelinePDFGeneratedMsg{Err: summarizeCmdError(err, out)}
		}
		if err := openWithDefaultApp(pdfPath); err != nil {
			return screens.PipelinePDFGeneratedMsg{Err: fmt.Sprintf("PDF generated but could not open: %v", err)}
		}
		return screens.PipelinePDFGeneratedMsg{Path: pdfPath}
	}
}

// summarizeCmdError condenses a failed command into one help-bar-sized line:
// the last non-empty output line when there is one (generate-pdf.mjs prints
// its error there), otherwise the exec error itself.
func summarizeCmdError(err error, out []byte) string {
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			return line
		}
	}
	return err.Error()
}

func inferProjectRootForUserRoot(userRoot string) (string, error) {
	candidates := []string{}
	if userRoot != "" {
		candidates = append(candidates, filepath.Dir(filepath.Dir(userRoot)))
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, cwd)
		if filepath.Base(cwd) == "dashboard" {
			candidates = append(candidates, filepath.Dir(cwd))
		}
	}
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates, exeDir)
		if filepath.Base(exeDir) == "dashboard" {
			candidates = append(candidates, filepath.Dir(exeDir))
		}
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(candidate, "generate-pdf.mjs")); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("could not find career-ops repo root for PDF regeneration")
}

func (m appModel) View() string {
	switch m.state {
	case viewReport:
		return m.viewer.View()
	case viewProgress:
		return m.progress.View()
	default:
		return m.pipeline.View()
	}
}

func hasApplicationsFile(path string) bool {
	for _, rel := range []string{"applications.md", filepath.Join("data", "applications.md")} {
		if _, err := os.Stat(filepath.Join(path, rel)); err == nil {
			return true
		}
	}
	return false
}

func appendUniquePath(paths []string, path string) []string {
	if path == "" {
		return paths
	}
	if abs, err := filepath.Abs(path); err == nil {
		path = abs
	}
	for _, existing := range paths {
		if existing == path {
			return paths
		}
	}
	return append(paths, path)
}

func inferUserPath(userID, usersDirFlag string) string {
	var candidates []string

	if cwd, err := os.Getwd(); err == nil {
		candidates = appendUniquePath(candidates, cwd)
		if userID != "" {
			usersDir := usersDirFlag
			if usersDir == "" {
				usersDir = os.Getenv("CAREER_OPS_USERS_DIR")
			}
			if usersDir != "" {
				if filepath.IsAbs(usersDir) {
					candidates = appendUniquePath(candidates, filepath.Join(usersDir, userID))
				} else {
					candidates = appendUniquePath(candidates, filepath.Join(cwd, usersDir, userID))
				}
			}
			candidates = appendUniquePath(candidates, filepath.Join(cwd, "users", userID))
			if filepath.Base(cwd) == "dashboard" {
				candidates = appendUniquePath(candidates, filepath.Join(filepath.Dir(cwd), "users", userID))
			}
		}
	}

	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		candidates = appendUniquePath(candidates, exeDir)
		if userID != "" {
			candidates = appendUniquePath(candidates, filepath.Join(exeDir, "users", userID))
			if filepath.Base(exeDir) == "dashboard" {
				candidates = appendUniquePath(candidates, filepath.Join(filepath.Dir(exeDir), "users", userID))
			}
		}
	}

	for _, candidate := range candidates {
		if hasApplicationsFile(candidate) && (userID == "" || filepath.Base(candidate) == userID) {
			return candidate
		}
	}
	return ""
}

func dashboardFileURL(path string) string {
	absPath, err := filepath.Abs(path)
	if err != nil {
		absPath = path
	}
	pathSlash := filepath.ToSlash(absPath)
	if !strings.HasPrefix(pathSlash, "/") {
		pathSlash = "/" + pathSlash
	}
	return (&url.URL{Scheme: "file", Path: pathSlash}).String()
}

func dashboardOpenTarget(userRoot, target string) string {
	trimmed := strings.TrimSpace(target)
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "http://") ||
		strings.HasPrefix(lower, "https://") ||
		strings.HasPrefix(lower, "file://") ||
		strings.HasPrefix(lower, "mailto:") {
		return trimmed
	}
	if filepath.IsAbs(trimmed) {
		return dashboardFileURL(trimmed)
	}
	relPath := strings.TrimPrefix(filepath.ToSlash(trimmed), "./")
	if strings.HasPrefix(relPath, "output/") && strings.HasSuffix(strings.ToLower(relPath), ".pdf") && userRoot != "" {
		return dashboardFileURL(filepath.Join(userRoot, filepath.FromSlash(relPath)))
	}
	return target
}

func resolveCareerOpsPath(pathFlag, usersDirFlag, userID string) (string, string, error) {
	if userID != "" && !reUserID.MatchString(userID) {
		return "", "", fmt.Errorf("invalid career-ops user %q. Use letters, numbers, dots, underscores, or hyphens", userID)
	}

	if pathFlag == "" {
		if inferred := inferUserPath(userID, usersDirFlag); inferred != "" {
			if userID == "" {
				userID = filepath.Base(inferred)
			}
			return inferred, userID, nil
		}
		if userID == "" {
			return "", "", fmt.Errorf("no career-ops user folder found. Run the binary from users/<user>/, store the binary there, or pass --path")
		}
		return "", "", fmt.Errorf("could not find user folder for %q. Run from the repo root, run the binary stored in users/%s/, or pass --path", userID, userID)
	}

	projectPath := pathFlag
	if abs, err := filepath.Abs(projectPath); err == nil {
		projectPath = abs
	}
	if hasApplicationsFile(projectPath) {
		if userID == "" {
			userID = filepath.Base(projectPath)
		}
		return projectPath, userID, nil
	}
	if userID == "" {
		return "", "", fmt.Errorf("--path points to a project directory; pass --user ID, or point --path at users/<user>")
	}

	usersDir := usersDirFlag
	if usersDir == "" {
		usersDir = os.Getenv("CAREER_OPS_USERS_DIR")
	}
	if usersDir == "" {
		usersDir = filepath.Join(projectPath, "users")
	} else if !filepath.IsAbs(usersDir) {
		usersDir = filepath.Join(projectPath, usersDir)
	}

	return filepath.Join(usersDir, userID), userID, nil
}

func main() {
	pathFlag := flag.String("path", "", "Optional path to career-ops project directory or users/<user> folder")
	userFlag := flag.String("user", "", "Optional career-ops user ID under users/")
	usersDirFlag := flag.String("users-dir", "", "Override users directory (defaults to {path}/users or CAREER_OPS_USERS_DIR)")
	langFlag := flag.String("lang", "", "Language for UI (en, tr). Defaults to auto-detect/en.")
	flag.Parse()

	if *langFlag != "" {
		i18n.SetLang(*langFlag)
	} else if os.Getenv("LANG") != "" {
		i18n.SetLang(os.Getenv("LANG"))
	}

	userID := *userFlag
	if userID == "" {
		userID = os.Getenv("CAREER_OPS_USER")
	}

	careerOpsPath, resolvedUserID, err := resolveCareerOpsPath(*pathFlag, *usersDirFlag, userID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Load applications
	apps := data.ParseApplicationsForDashboard(careerOpsPath)
	if apps == nil {
		fmt.Fprintf(os.Stderr, "Error: could not find applications.md for user %q in %s or %s/data/\n", resolvedUserID, careerOpsPath, careerOpsPath)
		os.Exit(1)
	}

	// Compute metrics
	metrics := data.ComputeMetrics(apps)
	progressMetrics := data.ComputeProgressMetrics(apps)

	t := theme.NewTheme("auto")
	pm := screens.NewPipelineModel(t, apps, metrics, careerOpsPath, 120, 40)

	m := appModel{
		pipeline:        pm,
		careerOpsPath:   careerOpsPath,
		theme:           t,
		progressMetrics: progressMetrics,
	}

	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
