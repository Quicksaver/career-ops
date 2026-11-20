package main

import (
	"context"
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
	"time"

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
		m.reloadPendingRows()
		m.pipeline, _ = m.pipeline.Update(screens.PipelineTrackerFailedMsg{Err: trackerErr.Error()})
		return
	}
	metrics := data.ComputeMetrics(apps)
	ledger, historyErr := data.ReadStatusLedger(m.careerOpsPath)
	// After a failed ledger read the ledger is empty, so the DATE column falls
	// back to each row's tracker date while current statuses still refresh.
	data.ApplyStatusLedger(apps, ledger)
	if historyErr == nil {
		m.progressMetrics = data.ComputeProgressMetrics(apps, ledger.Reached)
	}
	m.pipeline = m.pipeline.WithReloadedData(apps, metrics)
	m.reloadPendingRows()
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

// reloadPendingRows re-reads the Inbox tab's rows (#5269) from
// data/pipeline.md and the batch files. It runs only with a tracker reload
// (startup, `r`, after a status write): there is no timer. A failed read keeps
// the rows already shown and says why.
func (m *appModel) reloadPendingRows() {
	rows, err := data.LoadPendingRows(m.careerOpsPath)
	if err != nil {
		m.pipeline, _ = m.pipeline.Update(screens.PipelinePendingFailedMsg{Err: err.Error()})
		return
	}
	m.pipeline.SetPendingRows(rows)
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
			// or the row's identity is no longer unique. Re-find the row by the
			// same identity the write addressed it with, which for a row with no
			// report link is its tracker #.
			if data.HasTrackerIdentity(msg.App) {
				savedStatus, matches := "", 0
				// A failed re-read leaves matches at 0, so the displayed status
				// stays as it was — which is what the comment above promises.
				saved, _ := data.ParseApplications(m.careerOpsPath)
				for _, app := range saved {
					if data.SameTrackerRow(app, msg.App) {
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

	case screens.PipelineQueueEvalMsg:
		msg.UserID = m.userID
		return m, runQueueEval(msg)

	case screens.PipelineQueueEvalDoneMsg:
		// Re-read the Inbox first, so the row's status cell shows what
		// batch-input.tsv now records, then let the screen flash the outcome.
		m.reloadPendingRows()
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd

	case screens.PipelineSkipMsg:
		msg.UserID = m.userID
		return m, runInboxSkip(msg)

	case screens.PipelineRankMsg:
		msg.UserID = m.userID
		return m, runInboxRank(msg)

	case screens.PipelineRankDoneMsg:
		// Re-read the Inbox first, so the new scores show and the screen can
		// count what the run ranked, then let it flash the outcome.
		m.reloadPendingRows()
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd

	case screens.PipelineSkipDoneMsg:
		// Re-read the Inbox first, so a skipped row leaves it and a restored
		// row comes back, then let the screen flash the outcome.
		m.reloadPendingRows()
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd

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
		// A render over a warn-only page budget exits 0 but writes nothing to
		// the PDF path: the PDF went to a sibling .overflow.pdf draft (#6377).
		// Opening the path would then show the previous PDF, or nothing, as
		// "generated". A PDF this render wrote is a new file there.
		// Only a missing file is an expected absence; any other stat error is
		// reported as itself rather than read as "no previous PDF" (which
		// would open whatever the render left) or "wrote nothing".
		before, beforeErr := os.Stat(pdfPath)
		if beforeErr != nil && !errors.Is(beforeErr, fs.ErrNotExist) {
			return screens.PipelinePDFGeneratedMsg{Err: fmt.Sprintf("cannot read the PDF path: %v", beforeErr)}
		}
		out, err := cmd.CombinedOutput()
		if err != nil {
			return screens.PipelinePDFGeneratedMsg{Err: summarizeCmdError(err, out)}
		}
		after, afterErr := os.Stat(pdfPath)
		if afterErr != nil && !errors.Is(afterErr, fs.ErrNotExist) {
			return screens.PipelinePDFGeneratedMsg{Err: fmt.Sprintf("cannot read the PDF path: %v", afterErr)}
		}
		if afterErr != nil || !pdfWrittenBetween(before, after) {
			return screens.PipelinePDFGeneratedMsg{Err: summarizeUndelivered(out, pdfPath)}
		}
		if err := openWithDefaultApp(pdfPath); err != nil {
			return screens.PipelinePDFGeneratedMsg{Err: fmt.Sprintf("PDF generated but could not open: %v", err)}
		}
		return screens.PipelinePDFGeneratedMsg{Path: pdfPath}
	}
}

// Exit statuses the Inbox scripts give besides 0 and 1. They must equal
// URL_EXIT in sync-batch-input.mjs, SKIP_EXIT in inbox-skip.mjs and RANK_EXIT
// in rank-pipeline.mjs; inbox_exit_codes_test.go reads the scripts and fails
// when they differ.
const (
	queueExitAlreadyQueued = 3 // URL_EXIT.ALREADY_QUEUED
	queueExitNotPending    = 4 // URL_EXIT.NOT_PENDING
	skipExitUnchanged      = 3 // SKIP_EXIT.UNCHANGED
	skipExitNotPending     = 4 // SKIP_EXIT.NOT_PENDING
	rankExitNotPending     = 4 // RANK_EXIT.NOT_PENDING
)

// queueEvalTimeout bounds a queue request. The script takes the batch-input
// lock, which a running full sync can hold for a moment, and nothing else.
var queueEvalTimeout = 30 * time.Second

// runQueueEval queues one Inbox row (#5269) by running the checkout's
// sync-batch-input.mjs with --url. It appends that row to batch-input.tsv and
// nothing else: it starts no evaluation, and the dashboard never runs
// batch/batch-runner.sh. The script writes the selected user's
// batch/batch-input.tsv, the file the per-user runner reads, and reads the
// pipeline the Inbox shows (CAREER_OPS_PIPELINE).
func runQueueEval(msg screens.PipelineQueueEvalMsg) tea.Cmd {
	return func() tea.Msg {
		done := screens.PipelineQueueEvalDoneMsg{URL: msg.URL}
		script, err := data.CheckoutScriptPath("sync-batch-input.mjs")
		if err != nil {
			done.Err = err.Error()
			return done
		}
		if !reUserID.MatchString(msg.UserID) {
			done.Err = "queueing requires the selected career-ops user"
			return done
		}
		root, err := filepath.Abs(msg.CareerOpsPath)
		if err != nil {
			done.Err = err.Error()
			return done
		}
		// The equals form keeps a value that starts with "-" from being read
		// as a flag.
		args := []string{script, "--user", msg.UserID, "--url=" + msg.URL}
		ctx, cancel := context.WithTimeout(context.Background(), queueEvalTimeout)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", args...)
		cmd.Dir = filepath.Dir(script)
		cmd.Env = append(cmd.Environ(), "CAREER_OPS_USER="+msg.UserID, "CAREER_OPS_USERS_DIR="+filepath.Dir(root), "CAREER_OPS_ROOT="+root, "CAREER_OPS_DATA_DIR="+root, "CAREER_OPS_PIPELINE="+data.PendingPipelinePath(root))
		out, err := cmd.CombinedOutput()
		if ctx.Err() != nil {
			done.Err = "sync-batch-input.mjs timed out; reload to check whether the row was queued"
			return done
		}
		// The script's --url exit statuses (URL_EXIT in sync-batch-input.mjs):
		// 3 nothing to queue, 4 not a Pending row it can read.
		var exitErr *exec.ExitError
		switch {
		case err == nil:
		case errors.As(err, &exitErr) && exitErr.ExitCode() == queueExitAlreadyQueued:
			done.Already = true
		case errors.As(err, &exitErr) && exitErr.ExitCode() == queueExitNotPending:
			done.Unreadable = true
		default:
			done.Err = summarizeCmdError(err, out)
		}
		return done
	}
}

// inboxSkipTimeout bounds a skip or undo. The script waits for the pipeline
// lock, which a running scan can hold for a moment, and nothing else.
var inboxSkipTimeout = 30 * time.Second

// runInboxSkip skips one Inbox row (#5269), or with msg.Undo puts it back, by
// running the checkout's inbox-skip.mjs. Its write is lib/inbox-skip.mjs, the
// code the web inbox's Skip runs, so both change the selected user's
// data/pipeline.md the same way under the same lock. --pipeline is the file the
// Inbox shows.
func runInboxSkip(msg screens.PipelineSkipMsg) tea.Cmd {
	return func() tea.Msg {
		done := screens.PipelineSkipDoneMsg{URL: msg.URL, Undo: msg.Undo}
		script, err := data.CheckoutScriptPath("inbox-skip.mjs")
		if err != nil {
			done.Err = err.Error()
			return done
		}
		if !reUserID.MatchString(msg.UserID) {
			done.Err = "skipping requires the selected career-ops user"
			return done
		}
		root, err := filepath.Abs(msg.CareerOpsPath)
		if err != nil {
			done.Err = err.Error()
			return done
		}
		// The equals form keeps a value that starts with "-" from being read
		// as a flag.
		args := []string{script, "--user", msg.UserID, "--url=" + msg.URL, "--pipeline=" + data.PendingPipelinePath(root)}
		if msg.Undo {
			args = append(args, "--undo")
		}
		ctx, cancel := context.WithTimeout(context.Background(), inboxSkipTimeout)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", args...)
		cmd.Dir = filepath.Dir(script)
		cmd.Env = append(cmd.Environ(), "CAREER_OPS_USER="+msg.UserID, "CAREER_OPS_USERS_DIR="+filepath.Dir(root), "CAREER_OPS_ROOT="+root, "CAREER_OPS_DATA_DIR="+root)
		out, err := cmd.CombinedOutput()
		if ctx.Err() != nil {
			done.Err = "inbox-skip.mjs timed out; reload to check the row"
			return done
		}
		// The script's exit statuses (SKIP_EXIT in inbox-skip.mjs): 3 nothing
		// to change, 4 no Pending row with that URL as its first cell.
		var exitErr *exec.ExitError
		switch {
		case err == nil:
		case errors.As(err, &exitErr) && exitErr.ExitCode() == skipExitUnchanged:
			done.Unchanged = true
		case errors.As(err, &exitErr) && exitErr.ExitCode() == skipExitNotPending:
			done.Unreadable = true
		default:
			done.Err = summarizeCmdError(err, out)
		}
		return done
	}
}

// inboxRankTimeout bounds a rank run. rank-pipeline.mjs calls the CLI once per
// ten rows, each call bounded by CAREER_OPS_RANK_TIMEOUT_MS (180 s by
// default), so twenty rows take two calls.
var inboxRankTimeout = 15 * time.Minute

// runInboxRank ranks Inbox rows (#5269) by running the checkout's
// rank-pipeline.mjs: with --url the one row, otherwise up to msg.Limit
// unranked rows. The script asks the agent CLI for one answer, with tools
// off where the CLI has a switch for it, and writes each `rank:` cell into data/pipeline.md under the pipeline lock. The
// screen has asked before sending this, because the run spends tokens.
func runInboxRank(msg screens.PipelineRankMsg) tea.Cmd {
	return func() tea.Msg {
		done := screens.PipelineRankDoneMsg{URL: msg.URL}
		script, err := data.CheckoutScriptPath("rank-pipeline.mjs")
		if err != nil {
			done.Err = err.Error()
			return done
		}
		if !reUserID.MatchString(msg.UserID) {
			done.Err = "ranking requires the selected career-ops user"
			return done
		}
		root, err := filepath.Abs(msg.CareerOpsPath)
		if err != nil {
			done.Err = err.Error()
			return done
		}
		// The equals form keeps a value that starts with "-" from being read
		// as a flag. The script reads data/pipeline.md under the selected user's
		// data root, the file the Inbox shows.
		args := []string{script, "--user", msg.UserID}
		if msg.URL != "" {
			args = append(args, "--url="+msg.URL)
		} else {
			args = append(args, fmt.Sprintf("--limit=%d", msg.Limit))
		}
		ctx, cancel := context.WithTimeout(context.Background(), inboxRankTimeout)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", args...)
		cmd.Dir = filepath.Dir(script)
		cmd.Env = append(cmd.Environ(), "CAREER_OPS_USER="+msg.UserID, "CAREER_OPS_USERS_DIR="+filepath.Dir(root), "CAREER_OPS_ROOT="+root, "CAREER_OPS_DATA_DIR="+root)
		out, err := cmd.CombinedOutput()
		if ctx.Err() != nil {
			done.Err = "rank-pipeline.mjs timed out; reload to see which rows were ranked"
			return done
		}
		// The script's --url exit status (RANK_EXIT in rank-pipeline.mjs): 4
		// no unranked Pending row has that URL as its first cell.
		var exitErr *exec.ExitError
		switch {
		case err == nil:
		case msg.URL != "" && errors.As(err, &exitErr) && exitErr.ExitCode() == rankExitNotPending:
			done.NotPending = true
		default:
			done.Err = summarizeCmdError(err, out)
		}
		return done
	}
}

// pdfWrittenBetween reports whether the PDF at the path is a file the render
// left there: generate-pdf.mjs writes a temp file and renames it into place,
// so a delivered PDF is a different file (and has a new modification time and
// usually a new size), while a kept previous PDF is the same file as before.
// The identity check covers a filesystem whose timestamps are too coarse to
// tell a same-sized rerender apart.
func pdfWrittenBetween(before, after fs.FileInfo) bool {
	if after == nil {
		return false
	}
	if before == nil {
		return true
	}
	return !os.SameFile(before, after) || !after.ModTime().Equal(before.ModTime()) || after.Size() != before.Size()
}

// reOverflowDraftLine finds the draft generate-pdf.mjs names when a render
// ran over its page budget, so the help bar can point at the file to inspect.
var reOverflowDraftLine = regexp.MustCompile(`Overflow draft: (.*?\.overflow(?:-\d+)?\.pdf) \(`)

// rePageBudgetLine is the page-count sentence of the same warning.
var rePageBudgetLine = regexp.MustCompile(`CV is \d+ pages?; the allowed maximum is \d+ pages?\.`)

// summarizeUndelivered is the help-bar line for a render that exited 0 but
// wrote nothing to the PDF path. It leads with the page counts and the
// outcome, and names the draft this render wrote, so the user does not open an
// older one.
func summarizeUndelivered(out []byte, pdfAbs string) string {
	budget := rePageBudgetLine.FindString(string(out))
	draft := ""
	if m := reOverflowDraftLine.FindStringSubmatch(string(out)); m != nil {
		draft = filepath.Base(m[1])
	}
	if budget == "" && draft == "" {
		return fmt.Sprintf("generate-pdf.mjs reported success but wrote nothing to %s", filepath.Base(pdfAbs))
	}
	if budget == "" {
		budget = "The CV is over its page budget."
	}
	if draft == "" {
		return budget + " No PDF was written; the over-budget render was kept as an .overflow.pdf draft beside it."
	}
	return fmt.Sprintf("%s No PDF was written; the over-budget draft is %s.", budget, draft)
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
	data.ApplyStatusLedger(apps, ledger)
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
	m.reloadPendingRows()

	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
