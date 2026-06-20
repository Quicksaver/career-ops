package main

import (
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/career-ops/dashboard/internal/data"
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
	apps := data.ParseApplications(m.careerOpsPath)
	metrics := data.ComputeMetrics(apps)
	m.progressMetrics = data.ComputeProgressMetrics(apps)
	m.pipeline = m.pipeline.WithReloadedData(apps, metrics)
}

func (m appModel) Init() tea.Cmd {
	return nil
}

func (m appModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
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
		return m, cmd

	case screens.PipelineClosedMsg:
		return m, tea.Quit

	case screens.PipelineLoadReportMsg:
		archetype, tldr, remote, comp := data.LoadReportSummary(msg.CareerOpsPath, msg.ReportPath)
		m.pipeline.EnrichReport(msg.ReportPath, archetype, tldr, remote, comp)
		return m, nil

	case screens.PipelineUpdateStatusMsg:
		err := data.UpdateApplicationStatus(msg.CareerOpsPath, msg.App, msg.NewStatus)
		if err != nil {
			// Log the error but still reload data to keep UI consistent
			fmt.Fprintf(os.Stderr, "WARN: status update failed: %v\n", err)
		}
		m.reloadPipelineData()
		return m, nil

	case screens.PipelineRefreshMsg:
		m.reloadPipelineData()
		return m, nil

	case screens.PipelineOpenReportMsg:
		m.viewer = screens.NewViewerModelWithFileRoot(
			m.theme,
			msg.Path, msg.Title, m.careerOpsPath,
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewReport
		return m, nil

	case screens.ViewerClosedMsg:
		m.state = viewPipeline
		return m, nil

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
		url := dashboardOpenTarget(m.careerOpsPath, msg.URL)
		return m, func() tea.Msg {
			if err := openWithDefaultApp(url); err != nil {
				fmt.Fprintf(os.Stderr, "WARN: failed to open URL %q: %v\n", url, err)
			}
			return nil
		}

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
	flag.Parse()

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
	apps := data.ParseApplications(careerOpsPath)
	if apps == nil {
		fmt.Fprintf(os.Stderr, "Error: could not find applications.md for user %q in %s or %s/data/\n", resolvedUserID, careerOpsPath, careerOpsPath)
		os.Exit(1)
	}

	// Compute metrics
	metrics := data.ComputeMetrics(apps)
	progressMetrics := data.ComputeProgressMetrics(apps)

	// Batch-load all report summaries
	t := theme.NewTheme("auto")
	pm := screens.NewPipelineModel(t, apps, metrics, careerOpsPath, 120, 40)

	for _, app := range apps {
		if app.ReportPath == "" {
			continue
		}
		archetype, tldr, remote, comp := data.LoadReportSummary(careerOpsPath, app.ReportPath)
		if archetype != "" || tldr != "" || remote != "" || comp != "" {
			pm.EnrichReport(app.ReportPath, archetype, tldr, remote, comp)
		}
	}

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
