package main

import (
	"errors"
	"flag"
	"fmt"
	"io/fs"
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
	viewStats
)

type appModel struct {
	pipeline        screens.PipelineModel
	viewer          screens.ViewerModel
	progress        screens.ProgressModel
	stats           screens.StatsModel
	state           viewState
	careerOpsPath   string
	userID          string
	pdfLinker       func(string) string
	theme           theme.Theme
	progressMetrics model.ProgressMetrics
	statsMetrics    model.StatsMetrics
	evaluatedCount  int
}

func (m *appModel) reloadPipelineData() {
	apps, trackerErr := data.ParseApplicationsForDashboard(m.careerOpsPath)
	if trackerErr != nil {
		// Retain every derived value and surface the failure, the same way the
		// status-ledger read below does. Rebuilding from a failed read would
		// empty the pipeline AND drop every rate to 0% through
		// ComputeProgressMetrics, so the screen would report an empty, failing
		// search because a file could not be opened.
		m.pipeline, _ = m.pipeline.Update(screens.PipelineTrackerFailedMsg{Err: trackerErr.Error()})
		return
	}
	metrics := data.ComputeMetrics(apps)
	ledger, historyErr := data.ReadStatusLedger(m.careerOpsPath)
	if historyErr == nil {
		m.progressMetrics = data.ComputeProgressMetrics(apps, ledger.Reached)
	}
	// After a failed ledger read LatestDate is nil, so the DATE column falls
	// back to each row's tracker date while current statuses still refresh.
	data.ApplyStatusDates(apps, ledger.LatestDate)
	m.pipeline = m.pipeline.WithReloadedData(apps, metrics)
	m.statsMetrics = data.ComputeStatsMetrics(apps)
	// Count only apps with a score so the header reflects evaluated offers.
	m.evaluatedCount = 0
	for _, a := range apps {
		if a.Score > 0 {
			m.evaluatedCount++
		}
	}
	if historyErr != nil {
		// Refresh current statuses, but retain historical metrics and surface
		// the failed history read in the TUI after rebuilding the pipeline.
		m.pipeline, _ = m.pipeline.Update(screens.PipelineHistoryFailedMsg{Err: historyErr.Error()})
	}
}

// enrichArchetypes lazy-loads each app's report-derived archetype (used by
// the stats screen's breakdown table) and, as a side effect, primes the
// pipeline model's report preview cache the same way main()'s startup loop
// does — so a manual refresh doesn't blank out report previews.
func enrichArchetypes(careerOpsPath string, apps []model.CareerApplication, pm *screens.PipelineModel) {
	for i := range apps {
		if apps[i].ReportPath == "" {
			continue
		}
		archetype, tldr, remote, comp := data.LoadReportSummary(careerOpsPath, apps[i].ReportPath)
		// Only overwrite when the report actually supplies a non-empty archetype;
		// preserve any value already derived from the tracker.
		if archetype != "" {
			apps[i].Archetype = archetype
		}
		if archetype != "" || tldr != "" || remote != "" || comp != "" {
			pm.EnrichReport(apps[i].ReportPath, archetype, tldr, remote, comp, "", "")
		}
	}
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
		if m.state == viewStats {
			m.stats.Resize(msg.Width, msg.Height)
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
		err := data.UpdateApplicationStatus(msg.CareerOpsPath, msg.App, msg.NewStatus, m.userID)
		m.reloadPipelineData()
		if err != nil {
			m.pipeline, _ = m.pipeline.Update(screens.StatusUpdateFailedMsg{Err: err.Error()})
		} else if data.NormalizeStatus(msg.NewStatus) == "hired" {
			m.pipeline, _ = m.pipeline.StartHiredFlow(msg.App)
		}
		return m, m.pipeline.LoadVisibleReports()

	case screens.PipelineUpdateStatusAndNotesMsg:
		// Issue 1380: atomic status + notes write from the discard reason picker.
		err := data.UpdateApplicationStatusAndNotes(msg.CareerOpsPath, msg.App, msg.NewStatus, msg.NotesAppend, m.userID)
		m.reloadPipelineData()
		if err != nil {
			m.pipeline, _ = m.pipeline.Update(screens.StatusUpdateFailedMsg{Err: err.Error()})
		}
		return m, nil

	case screens.PipelineRefreshMsg:
		m.pipeline.InvalidateReportCache()
		m.reloadPipelineData()
		return m, m.pipeline.LoadVisibleReports()

	case screens.PipelineOpenReportMsg:
		m.viewer = screens.NewViewerModelWithFileRoot(
			m.theme,
			msg.Path, msg.Title, m.careerOpsPath,
			m.pipeline.Width(), m.pipeline.Height(),
			msg.App, m.careerOpsPath,
		).WithPDFLinker(m.pdfLinker)
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
		if normalized == "discarded" || normalized == "skip" {
			m.state = viewPipeline
			m.pipeline, _ = m.pipeline.StartDiscardReasonFlow(msg.App, msg.NewStatus)
			m.reloadPipelineData()
			return m, nil
		}

		err := data.UpdateApplicationStatus(m.careerOpsPath, msg.App, msg.NewStatus, m.userID)
		m.reloadPipelineData()
		if err != nil {
			// A sidecar failure can follow a successful tracker write. Reflect
			// the persisted status, retaining the old one if it cannot be read
			// or the report identity is no longer unique.
			if msg.App.ReportNumber != "" {
				savedStatus, matches := "", 0
				// A failed re-read leaves matches at 0, so the displayed status
				// stays as it was — which is what the comment above promises.
				saved, _ := data.ParseApplications(m.careerOpsPath)
				for _, app := range saved {
					if app.ReportNumber == msg.App.ReportNumber {
						savedStatus = app.Status
						matches++
					}
				}
				if matches == 1 {
					m.viewer.UpdateAppStatus(savedStatus)
				}
			}
			m.viewer, _ = m.viewer.Update(screens.StatusUpdateFailedMsg{Err: err.Error()})
			return m, nil
		}
		m.viewer.UpdateAppStatus(msg.NewStatus)
		if normalized == "hired" {
			m.state = viewPipeline
			m.pipeline, _ = m.pipeline.StartHiredFlow(msg.App)
		}
		m.reloadPipelineData()
		return m, m.pipeline.LoadVisibleReports()

	case screens.PipelineOpenProgressMsg:
		m.progress = screens.NewProgressModel(
			m.theme,
			m.progressMetrics,
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewProgress
		return m, nil

	case screens.ProgressClosedMsg:
		m.state = viewPipeline
		return m, nil

	case screens.PipelineOpenStatsMsg:
		if apps, err := data.ParseApplicationsForDashboard(m.careerOpsPath); err == nil {
			enrichArchetypes(m.careerOpsPath, apps, &m.pipeline)
			m.statsMetrics = data.ComputeStatsMetrics(apps)
		}
		m.stats = screens.NewStatsModel(
			m.theme,
			m.statsMetrics,
			m.evaluatedCount,
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewStats
		return m, nil

	case screens.StatsClosedMsg:
		m.state = viewPipeline
		return m, nil

	case screens.PipelineOpenURLMsg:
		return m, openCmd(dashboardOpenTarget(m.careerOpsPath, msg.URL))

	case screens.PipelineOpenPDFMsg:
		return m, openCmd(msg.Path)

	case screens.PipelineCopyPDFPathMsg:
		return m, copyPathCmd(msg.Path)

	case screens.PipelineClipboardResultMsg:
		// The copy runs asynchronously and the user may have left the pipeline
		// meanwhile; the flash belongs to the pipeline whatever screen is shown.
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd

	case screens.PipelineGeneratePDFMsg:
		msg.UserID = m.userID
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
		if m.state == viewStats {
			sm, cmd := m.stats.Update(msg)
			m.stats = sm
			return m, cmd
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd
	}
}

// openCmd wraps openWithDefaultApp (OS-specific) as a tea.Cmd. Shared by the
// job-URL (`o`, pipeline and report viewer) and CV-PDF (`d`) actions.
func openCmd(target string) tea.Cmd {
	return func() tea.Msg {
		if err := openWithDefaultApp(target); err != nil {
			// Issue 3913: the dashboard runs with tea.WithAltScreen(), so a
			// message on stderr is never visible. Report the failure back to
			// the pipeline screen, which flashes it in the help bar.
			return screens.PipelineOpenFailedMsg{Target: target, Err: err.Error()}
		}
		return nil
	}
}

// runGeneratePDF runs the checkout's generate-pdf.mjs against the selected data root,
// opens the resulting PDF on success, and reports the outcome back to the
// pipeline screen as a PipelinePDFGeneratedMsg. Runs in a tea.Cmd goroutine,
// so the UI stays responsive while Chromium renders.
func runGeneratePDF(msg screens.PipelineGeneratePDFMsg) tea.Cmd {
	return func() tea.Msg {
		script, err := data.CheckoutScriptPath("generate-pdf.mjs")
		projectRoot := filepath.Dir(script)
		if err != nil {
			return screens.PipelinePDFGeneratedMsg{Err: err.Error()}
		}
		userID := msg.UserID
		if !reUserID.MatchString(userID) {
			return screens.PipelinePDFGeneratedMsg{Err: "PDF regeneration requires the selected career-ops user"}
		}
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
		cmd.Env = append(cmd.Environ(), "CAREER_OPS_USER="+userID, "CAREER_OPS_USERS_DIR="+filepath.Dir(msg.CareerOpsPath), "CAREER_OPS_ROOT="+msg.CareerOpsPath, "CAREER_OPS_DATA_DIR="+msg.CareerOpsPath)
		// Preserve relative overrides before changing the child's working directory.
		if tracker := resolveEnvPath(os.Getenv("CAREER_OPS_TRACKER")); tracker != "" {
			cmd.Env = append(cmd.Env, "CAREER_OPS_TRACKER="+tracker)
		}
		if index := os.Getenv("CAREER_OPS_PDF_INDEX"); index != "" {
			absolute, err := filepath.Abs(index)
			if err != nil {
				return screens.PipelinePDFGeneratedMsg{Err: err.Error()}
			}
			cmd.Env = append(cmd.Env, "CAREER_OPS_PDF_INDEX="+absolute)
		}
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
	case viewStats:
		return m.stats.View()
	default:
		return m.pipeline.View()
	}
}

// getRepoRoot defers to internal/data, which already walks up from cwd looking
// for path-resolver.mjs and is the function a relative CAREER_OPS_TRACKER
// resolves through.
//
// This used to be a second, shorter search — cwd and cwd's PARENT, then a
// silent fallback to cwd — so from anywhere deeper the data root and the
// tracker could anchor to different directories. One walker, one answer.
func getRepoRoot() string {
	root, err := data.FindRepoRoot()
	if err != nil {
		// The checkout could not be examined, which is not the same as not
		// being there. Say so: everything below resolves against this.
		fmt.Fprintf(os.Stderr, "Warning: %v\n", err)
	}
	if root != "" {
		return root
	}
	cwd, wdErr := os.Getwd()
	if wdErr != nil {
		return "."
	}
	return cwd
}

func resolveEnvPath(envVal string) string {
	trimmed := strings.TrimSpace(envVal)
	if trimmed == "" {
		return ""
	}
	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed)
	}
	root, err := data.FindRepoRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: %v\n", err)
	}
	if root == "" {
		// Anchoring to cwd here is a guess, and what is being guessed at is
		// which tracker to read. Getting it wrong is invisible: the dashboard
		// shows one file while every .mjs writer uses another, and neither side
		// reports anything. The guess is still made — exiting would be worse
		// for a user whose layout we cannot see — but it is said out loud, with
		// the absolute path the reader can check.
		cwd, wdErr := os.Getwd()
		if wdErr != nil {
			return filepath.Clean(trimmed)
		}
		resolved := filepath.Clean(filepath.Join(cwd, trimmed))
		fmt.Fprintf(os.Stderr,
			"Warning: no career-ops checkout found above the working directory or the executable, "+
				"so the relative path %q was resolved against the working directory: %s\n"+
				"         The .mjs scripts resolve it against the repository root, so they may be using a "+
				"different tracker. Pass an absolute path or --path to be sure.\n",
			trimmed, resolved)
		return resolved
	}
	return filepath.Clean(filepath.Join(root, trimmed))
}

func isSystemCheckout(path string) bool {
	info, err := os.Stat(filepath.Join(path, "path-resolver.mjs"))
	return err == nil && !info.IsDir()
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
	return inferUserPathWithExecutable(userID, usersDirFlag, os.Executable)
}

func inferUserPathWithExecutable(userID, usersDirFlag string, executable func() (string, error)) string {
	var candidates []string
	// A per-user executable identifies its owner even when launched from another user's folder.
	if userID == "" {
		if exe, err := executable(); err == nil {
			candidates = appendUniquePath(candidates, filepath.Dir(exe))
		}
	}

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

	if exe, err := executable(); err == nil {
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
		if hasApplicationsFile(candidate) && !isSystemCheckout(candidate) && reUserID.MatchString(filepath.Base(candidate)) && (userID == "" || filepath.Base(candidate) == userID) {
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
	userID = strings.TrimSpace(userID)
	if userID != "" && !reUserID.MatchString(userID) {
		return "", "", fmt.Errorf("invalid career-ops user %q. Use letters, numbers, dots, underscores, or hyphens", userID)
	}

	if pathFlag == "" && userID == "" {
		if inferred := inferUserPath("", usersDirFlag); inferred != "" {
			userID = filepath.Base(inferred)
		}
	}
	if pathFlag == "" && userID != "" {
		if override := os.Getenv("CAREER_OPS_ROOT"); strings.TrimSpace(override) != "" {
			return resolveEnvPath(override), userID, nil
		}
		if override := os.Getenv("CAREER_OPS_DATA_DIR"); strings.TrimSpace(override) != "" {
			return resolveEnvPath(override), userID, nil
		}
		if usersDirFlag == "" && os.Getenv("CAREER_OPS_USERS_DIR") == "" {
			if marker, err := os.ReadFile(filepath.Join(getRepoRoot(), ".career-ops-data")); err == nil && strings.TrimSpace(string(marker)) != "" {
				return resolveEnvPath(string(marker)), userID, nil
			}
		}
		usersDir := usersDirFlag
		if usersDir == "" {
			usersDir = os.Getenv("CAREER_OPS_USERS_DIR")
		}
		if strings.TrimSpace(usersDir) != "" {
			return filepath.Join(resolveEnvPath(usersDir), userID), userID, nil
		}
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
	if hasApplicationsFile(projectPath) && !isSystemCheckout(projectPath) {
		if userID == "" {
			userID = filepath.Base(projectPath)
		}
		if !reUserID.MatchString(userID) {
			return "", "", fmt.Errorf("cannot infer a user from --path; pass --user ID")
		}
		return projectPath, userID, nil
	}
	if userID == "" {
		return "", "", fmt.Errorf("--path points to a project directory; pass --user ID, or point --path at users/<user>")
	}
	if isSystemCheckout(projectPath) {
		rootPath := func(value string) string {
			if filepath.IsAbs(value) {
				return filepath.Clean(value)
			}
			return filepath.Join(projectPath, value)
		}
		if value := strings.TrimSpace(os.Getenv("CAREER_OPS_ROOT")); value != "" {
			return rootPath(value), userID, nil
		}
		if value := strings.TrimSpace(os.Getenv("CAREER_OPS_DATA_DIR")); value != "" {
			return rootPath(value), userID, nil
		}
		if usersDirFlag == "" && os.Getenv("CAREER_OPS_USERS_DIR") == "" {
			if marker, err := os.ReadFile(filepath.Join(projectPath, ".career-ops-data")); err == nil && strings.TrimSpace(string(marker)) != "" {
				return rootPath(strings.TrimSpace(string(marker))), userID, nil
			}
		}
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

	careerOpsPath, resolvedUser, err := resolveCareerOpsPath(*pathFlag, *usersDirFlag, userID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Load applications
	apps, trackerErr := data.ParseApplicationsForDashboard(careerOpsPath)
	if trackerErr != nil {
		// Absent is a first run and keeps the original wording. Anything else is
		// a file that IS there and could not be opened, and saying "could not
		// find" sent the user looking for a file sitting in front of them.
		if errors.Is(trackerErr, fs.ErrNotExist) {
			fmt.Fprintf(os.Stderr, "Error: could not find applications.md in %s or %s/data/\n", careerOpsPath, careerOpsPath)
		} else {
			fmt.Fprintf(os.Stderr, "Error: %v\n", trackerErr)
		}
		os.Exit(1)
	}

	// Compute metrics
	ledger, err := data.ReadStatusLedger(careerOpsPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	data.ApplyStatusDates(apps, ledger.LatestDate)
	metrics := data.ComputeMetrics(apps)
	progressMetrics := data.ComputeProgressMetrics(apps, ledger.Reached)

	t := theme.NewTheme("auto")
	pm := screens.NewPipelineModel(t, apps, metrics, careerOpsPath, 120, 40)

	statsMetrics := data.ComputeStatsMetrics(apps)
	bindIP, dnsName := discoverViewerRemoteAddress()
	var pdfLinker func(string) string
	if bindIP != "" {
		links, err := startPDFLinkServer(bindIP, dnsName, filepath.Join(careerOpsPath, "output"))
		if err != nil {
			fmt.Fprintf(os.Stderr, "Remote PDF links unavailable: %v\n", err)
		} else {
			defer links.close()
			pdfLinker = links.link
		}
	}
	m := appModel{
		pipeline:        pm,
		careerOpsPath:   careerOpsPath,
		userID:          resolvedUser,
		pdfLinker:       pdfLinker,
		theme:           t,
		progressMetrics: progressMetrics,
		statsMetrics:    statsMetrics,
		evaluatedCount: func() int {
			n := 0
			for _, a := range apps {
				if a.Score > 0 {
					n++
				}
			}
			return n
		}(),
	}

	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
