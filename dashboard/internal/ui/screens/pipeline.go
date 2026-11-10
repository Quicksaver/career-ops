package screens

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// PipelineClosedMsg is emitted when the pipeline screen is dismissed.
type PipelineClosedMsg struct{}

// PipelineOpenReportMsg is emitted when a report should be opened in FileViewer.
type PipelineOpenReportMsg struct {
	Path   string
	Title  string
	JobURL string
	App    model.CareerApplication
}

// PipelineOpenURLMsg is emitted when a job URL should be opened in browser.
type PipelineOpenURLMsg struct {
	URL string
}

// PipelineReportLoadedMsg carries report metadata loaded by a command. The file
// read happens inside the command, not the Update loop, so navigation stays
// responsive while details hydrate in place.
type PipelineReportLoadedMsg struct {
	ReportPath string
	Details    data.ReportDetails
	OpenURL    bool
}

// PipelineOpenPDFMsg is emitted when a generated CV PDF should be opened
// with the OS default handler. Path is absolute.
type PipelineOpenPDFMsg struct {
	Path string
}

// PipelineCopyPDFPathMsg asks the host to copy a CV PDF's absolute path to the
// OS clipboard (`y`). Path is absolute.
type PipelineCopyPDFPathMsg struct {
	Path string
}

// PipelineClipboardResultMsg reports the outcome of a PipelineCopyPDFPathMsg.
// Err is empty on success.
type PipelineClipboardResultMsg struct {
	Path string
	Err  string
}

// noPDFFlash is shown by `d` and `y` when no CV PDF matches the application.
const noPDFFlash = "No CV PDF found for this application — generate one with /career-ops pdf"

// PipelineOpenFailedMsg reports that an external open (job URL, manifesto or
// CV PDF) failed. The dashboard runs under an alt-screen, so the failure has to
// travel back to the pipeline screen as a flash: anything written to stderr is
// never seen. Target is the URL or path that could not be opened.
type PipelineOpenFailedMsg struct {
	Target string
	Err    string
}

// PipelineGeneratePDFMsg requests a PDF regeneration via generate-pdf.mjs
// from the application's recorded source HTML. Paths are relative to
// CareerOpsPath (as recorded in the manifest).
type PipelineGeneratePDFMsg struct {
	CareerOpsPath string
	UserID        string
	ReportNumber  string
	HTMLPath      string
	PDFPath       string
	Format        string
}

// PipelinePDFGeneratedMsg reports the outcome of a regeneration. On success
// Err is empty and Path holds the absolute path of the (already opened) PDF.
type PipelinePDFGeneratedMsg struct {
	Err  string
	Path string
}

// PipelineUpdateStatusMsg requests a status update for an application.
type PipelineUpdateStatusMsg struct {
	CareerOpsPath string
	App           model.CareerApplication
	NewStatus     string
}

// StatusUpdateFailedMsg exposes a failed tracker write in the active screen.
// Stderr is hidden while the dashboard occupies the terminal's alt-screen.
type StatusUpdateFailedMsg struct {
	Err string
}

// PipelineUpdateStatusAndNotesMsg requests an atomic status + notes update.
// Used by the discard reason picker (Issue 1380) to commit both changes in a
// single tracker write.
type PipelineUpdateStatusAndNotesMsg struct {
	CareerOpsPath string
	App           model.CareerApplication
	NewStatus     string
	NotesAppend   string // text to append to the Notes cell, e.g. "DISCARD: salary_too_low"
}

// PipelineRefreshMsg requests a full tracker reload from disk.
type PipelineRefreshMsg struct{}

// PipelineHistoryFailedMsg reports that progress still uses the previous data.
type PipelineHistoryFailedMsg struct {
	Err string
}

// PipelineTrackerFailedMsg reports that the tracker could not be read and the
// screen is still showing the previous applications.
//
// Sibling of PipelineHistoryFailedMsg, for the more consequential of the two
// files: rebuilding the pipeline from a failed tracker read empties it, and
// ComputeProgressMetrics then reports every rate as 0% — an empty pipeline and
// a search that looks like it is failing, because a file could not be opened.
type PipelineTrackerFailedMsg struct {
	Err string
}

// PipelineOpenProgressMsg is emitted when the progress screen should open.
type PipelineOpenProgressMsg struct{}

// PipelineOpenStatsMsg is emitted when the stats (dimension breakdown) screen should open.
type PipelineOpenStatsMsg struct{}

// Mirrors the ids in templates/discard-reasons.yml, in order.
// tests/discard-reasons-vocabulary.test.mjs fails when the two drift.
var canonicalDiscardReasons = []string{
	"salary_too_low",
	"hybrid_required",
	"tech_stack_mismatch",
	"seniority_mismatch",
	"geo_restriction",
	"size_mismatch",
	"company_culture",
}

type reportSummary struct {
	archetype   string
	tldr        string
	remote      string
	comp        string
	jobURL      string
	listingDate string
}

const storyTemplateURL = "https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml"

// Sort modes
const (
	sortScore    = "score"
	sortID       = "id"
	sortDate     = "date"
	sortCompany  = "company"
	sortStatus   = "status"
	sortLocation = "location"
	sortPay      = "pay"
	sortLast     = "last"
	sortPosted   = "posted"
)

// Filter modes
const (
	filterAll        = "all"
	filterEvaluated  = "evaluated"
	filterApplied    = "applied"
	filterInterview  = "interview"
	filterOffer      = "offer"
	filterHired      = "hired"
	filterResponded  = "responded"
	filterSkip       = "skip"
	filterRejected   = "rejected"
	filterClosed     = "closed"
	filterDiscarded  = "discarded"
	filterAssessment = "assessment"
	filterTop        = "top"
	filterOther      = "other"
)

type pipelineTab struct {
	filter string
	label  string
}

func getPipelineTabs() []pipelineTab {
	return []pipelineTab{
		{filterEvaluated, i18n.Current.TabOpen},
		{filterApplied, i18n.Current.TabApplied},
		{filterResponded, i18n.Current.TabResponded},
		{filterAssessment, i18n.Current.TabAssessment},
		{filterInterview, i18n.Current.TabInterview},
		{filterOffer, i18n.Current.TabOffer},
		{filterHired, i18n.Current.TabHired},
		{filterRejected, i18n.Current.TabRejected},
		{filterClosed, i18n.Current.TabClosed},
		{filterDiscarded, i18n.Current.TabDiscarded},
		{filterSkip, i18n.Current.TabSkip},
		{filterOther, i18n.Current.TabOther},
	}
}

var sortCycle = []string{sortScore, sortID, sortDate, sortCompany, sortStatus, sortLocation, sortPay, sortLast, sortPosted}

// ColumnID identifies an optional table column in the pipeline view.
type ColumnID int

const (
	// Optional columns — user-toggleable via the column picker (C key).
	ColDate        ColumnID = iota // DATE: listing date or tracker date
	ColLocation                    // LOCATION city+state
	ColPay                         // PAY range
	ColHasReport                   // RPT: ✓/—
	ColHasPDF                      // PDF: ✓/—
	ColLastContact                 // CONTACT date
	ColPosted                      // POSTED: how long the req has been open
)

// colDef describes one optional column for the picker UI.
type colDef struct {
	id          ColumnID
	header      string
	hint        string
	width       int
	onByDefault bool
}

func getOptionalCols() []colDef {
	return []colDef{
		{ColDate, i18n.Current.ColDate, "", 10, false},
		{ColLocation, i18n.Current.ColLocation, "", 20, true},
		{ColPay, i18n.Current.ColPay, "", 16, true},
		{ColHasReport, i18n.Current.ColReport, "✓/—", 4, false},
		{ColHasPDF, i18n.Current.ColPDF, "✓/—", 4, true},
		{ColLastContact, i18n.Current.ColContact, "", 10, true},
		{ColPosted, i18n.Current.ColPosted, "", 10, true},
	}
}

type StatusPair struct {
	Display   string
	Canonical string
}

// getStatusPairs returns the status-change picker's options in their static
// display order. When currentNormalized is non-empty and matches one of the
// entries (compared via data.NormalizeStatus), that entry is pulled to the
// front so the row's own current status always leads the list, with the
// remaining options kept in their original relative order behind it.
func getStatusPairs(currentNormalized string) []StatusPair {
	base := []StatusPair{
		{i18n.Current.StatusEvaluated, "Evaluated"},
		{i18n.Current.StatusApplied, "Applied"},
		{i18n.Current.StatusResponded, "Responded"},
		{i18n.Current.StatusAssessment, "Assessment"},
		{i18n.Current.StatusInterview, "Interview"},
		{i18n.Current.StatusOffer, "Offer"},
		{i18n.Current.StatusHired, "Hired"},
		{i18n.Current.StatusRejected, "Rejected"},
		{i18n.Current.StatusClosed, "Closed"},
		{i18n.Current.StatusDiscarded, "Discarded"},
		{i18n.Current.StatusSkip, "Skip"},
	}

	if currentNormalized == "" {
		return base
	}

	var current *StatusPair
	rest := make([]StatusPair, 0, len(base))
	for _, pair := range base {
		if current == nil && data.NormalizeStatus(pair.Canonical) == currentNormalized {
			p := pair
			current = &p
			continue
		}
		rest = append(rest, pair)
	}

	if current == nil {
		// Unrecognized/unmapped status -- fall back to the static order.
		return base
	}

	ordered := make([]StatusPair, 0, len(base))
	ordered = append(ordered, *current)
	ordered = append(ordered, rest...)
	return ordered
}

// currentStatusPairs resolves the status-change picker options for whichever
// application is currently selected in the main list, so the picker reflects
// that row's own status rather than always assuming "Evaluated".
func (m PipelineModel) currentStatusPairs() []StatusPair {
	if app, ok := m.CurrentApp(); ok {
		return getStatusPairs(data.NormalizeStatus(app.Status))
	}
	return getStatusPairs("")
}

// statusGroupOrder defines display order for grouped view.
var statusGroupOrder = []string{"hired", "interview", "offer", "assessment", "responded", "applied", "evaluated", "skip", "rejected", "closed", "discarded"}

// PipelineModel implements the career pipeline dashboard screen.
type PipelineModel struct {
	apps          []model.CareerApplication
	filtered      []model.CareerApplication
	metrics       model.PipelineMetrics
	cursor        int
	scrollOffset  int
	sortMode      string
	activeTab     int
	width, height int
	theme         theme.Theme
	careerOpsPath string
	reportCache   map[string]reportSummary
	reportLoading map[string]bool
	// Status picker sub-state
	statusPicker bool
	statusCursor int
	// Discard reason picker sub-state (Issue 1380) — opens when status
	// transitions to Discarded or SKIP, pre-populated from the report's
	// predicted discard_reasons, plus canonical fallback options.
	discardPicker         bool
	discardCursor         int
	discardOptions        []string                // predicted + canonical options shown to user
	discardCustomInput    bool                    // true when "Other…" is selected and user is typing
	discardCustomText     string                  // free-text typed for "Other…" reason
	discardPendingApp     model.CareerApplication // app awaiting the reason pick
	discardPendingStatus  string                  // new status to commit with the reason
	discardPredictedCount int                     // count of predicted reasons (from report)

	// PDF picker sub-state — shown when one application matches several
	// generated CVs (role variants from the same company).
	pdfPicker  bool
	pdfCursor  int
	pdfChoices []string // root-relative paths, newest first
	// flash is a one-shot notice rendered in place of the help bar; any
	// keypress clears it.
	flash string
	// Search sub-state — narrows the active tab by substring on company/role/notes.
	searchInput bool   // true while the user is typing the query
	searchQuery string // committed (or in-progress) lowercased query
	// Column picker sub-state — opened with C, closed with esc.
	colPicker    bool
	colPickerIdx int
	visibleCols  map[ColumnID]bool
	// keysHelp is the full binding list. The footer cannot show every key once
	// the terminal is narrower than the shortcut sentence, so `?` opens this
	// in place of the table and `q` closes it instead of quitting.
	keysHelp       bool
	keysHelpOffset int

	// Hired win flow sub-state (Issue 1447)
	hiredApp  model.CareerApplication
	hiredStep int // 0 = inactive, 1 = celebration, 2 = story invite, 3 = anonymous stat
}

// IsTextInputActive returns true if the search or any other text input is currently focused
func (m PipelineModel) IsTextInputActive() bool {
	return m.searchInput || m.discardCustomInput
}

// NewPipelineModel creates a new pipeline screen.
func NewPipelineModel(t theme.Theme, apps []model.CareerApplication, metrics model.PipelineMetrics, careerOpsPath string, width, height int) PipelineModel {
	visible := make(map[ColumnID]bool)
	for _, col := range getOptionalCols() {
		visible[col.id] = col.onByDefault
	}
	m := PipelineModel{
		apps:          apps,
		metrics:       metrics,
		sortMode:      sortScore,
		activeTab:     0,
		width:         width,
		height:        height,
		theme:         t,
		careerOpsPath: careerOpsPath,
		reportCache:   make(map[string]reportSummary),
		reportLoading: make(map[string]bool),
		visibleCols:   visible,
	}
	m.applyFilterAndSort()
	return m
}

// Init implements tea.Model.
func (m PipelineModel) Init() tea.Cmd {
	return nil
}

// Resize updates dimensions.
func (m *PipelineModel) Resize(width, height int) {
	m.width = width
	m.height = height
}

// Width returns the current width.
func (m PipelineModel) Width() int { return m.width }

// Height returns the current height.
func (m PipelineModel) Height() int { return m.height }

// CopyReportCache copies the report cache from another pipeline model.
func (m *PipelineModel) CopyReportCache(other *PipelineModel) {
	for k, v := range other.reportCache {
		m.reportCache[k] = v
	}
	for k, v := range other.reportLoading {
		m.reportLoading[k] = v
	}
}

// EnrichReportDetails caches lazily loaded report data for preview and row metadata.
func (m *PipelineModel) EnrichReportDetails(reportPath string, details data.ReportDetails) {
	if details.ReadError != nil {
		delete(m.reportLoading, reportPath)
		return
	}
	m.EnrichReport(reportPath, details.Archetype, details.TlDr, details.Remote, details.Comp, details.JobURL, details.ListingDate)
}

// InvalidateReportCache makes an explicit refresh retry reads, including reports
// that changed since their metadata was loaded. Ordinary tracker reloads keep it.
func (m *PipelineModel) InvalidateReportCache() {
	m.reportCache = make(map[string]reportSummary)
	m.reportLoading = make(map[string]bool)
}

// EnrichReport caches report summary data for preview.
func (m *PipelineModel) EnrichReport(reportPath, archetype, tldr, remote, comp, jobURL, listingDate string) {
	if m.reportLoading != nil {
		delete(m.reportLoading, reportPath)
	}
	m.reportCache[reportPath] = reportSummary{
		archetype:   archetype,
		tldr:        tldr,
		remote:      remote,
		comp:        comp,
		jobURL:      jobURL,
		listingDate: listingDate,
	}
	m.applyReportDetails(reportPath, jobURL, listingDate)
}

func (m *PipelineModel) applyReportDetails(reportPath, jobURL, listingDate string) {
	if reportPath == "" || (jobURL == "" && listingDate == "") {
		return
	}
	apply := func(app *model.CareerApplication) {
		if app.ReportPath != reportPath {
			return
		}
		if jobURL != "" && (app.JobURL == "" || app.JobURLFallback) {
			app.JobURL = jobURL
			app.JobURLFallback = false
		}
		if listingDate != "" {
			app.ListingDate = listingDate
		}
	}
	for i := range m.apps {
		apply(&m.apps[i])
	}
	for i := range m.filtered {
		apply(&m.filtered[i])
	}
	if m.sortMode == sortDate {
		selected, ok := m.CurrentApp()
		m.applyFilterAndSort()
		if ok {
			for i, app := range m.filtered {
				if app.Number == selected.Number && app.ReportPath == selected.ReportPath && app.Company == selected.Company && app.Role == selected.Role {
					m.cursor = i
					m.adjustScroll()
					break
				}
			}
		}
	}
}

// WithReloadedData rebuilds the pipeline with fresh tracker data while preserving
// the current UI state so manual refresh feels seamless.
func (m PipelineModel) WithReloadedData(apps []model.CareerApplication, metrics model.PipelineMetrics) PipelineModel {
	selectedReportPath := ""
	selectedCompany := ""
	selectedRole := ""
	if app, ok := m.CurrentApp(); ok {
		selectedReportPath = app.ReportPath
		selectedCompany = app.Company
		selectedRole = app.Role
	}

	reloaded := NewPipelineModel(m.theme, apps, metrics, m.careerOpsPath, m.width, m.height)
	reloaded.sortMode = m.sortMode
	reloaded.activeTab = m.activeTab
	// Preserve search state across refresh — otherwise pressing `r` silently drops a
	// committed query and the user loses their place mid-investigation.
	reloaded.searchQuery = m.searchQuery
	reloaded.searchInput = m.searchInput
	// Preserve user's column visibility choices across refresh.
	reloaded.visibleCols = m.visibleCols
	// Preserve in-progress interactive flows. The viewer status path starts
	// the hired celebration / discard reason picker on the pipeline model and
	// then immediately triggers a data reload; rebuilding the model here used
	// to wipe that state, so picking Discarded/SKIP from the report viewer
	// silently never asked for a reason and never wrote the status.
	reloaded.hiredApp = m.hiredApp
	reloaded.hiredStep = m.hiredStep
	reloaded.discardPicker = m.discardPicker
	reloaded.discardCursor = m.discardCursor
	reloaded.discardOptions = m.discardOptions
	reloaded.discardCustomInput = m.discardCustomInput
	reloaded.discardCustomText = m.discardCustomText
	reloaded.discardPendingApp = m.discardPendingApp
	reloaded.discardPendingStatus = m.discardPendingStatus
	reloaded.discardPredictedCount = m.discardPredictedCount
	reloaded.keysHelp = m.keysHelp
	reloaded.keysHelpOffset = m.keysHelpOffset
	reloaded.CopyReportCache(&m)
	for report, summary := range reloaded.reportCache {
		reloaded.applyReportDetails(report, summary.jobURL, summary.listingDate)
	}
	reloaded.applyFilterAndSort()

	for i, app := range reloaded.filtered {
		if selectedReportPath != "" && app.ReportPath == selectedReportPath {
			reloaded.cursor = i
			reloaded.adjustScroll()
			return reloaded
		}
		if selectedReportPath == "" && app.Company == selectedCompany && app.Role == selectedRole {
			reloaded.cursor = i
			reloaded.adjustScroll()
			return reloaded
		}
	}

	if len(reloaded.filtered) == 0 {
		reloaded.cursor = 0
		reloaded.scrollOffset = 0
		return reloaded
	}

	if m.cursor >= len(reloaded.filtered) {
		reloaded.cursor = len(reloaded.filtered) - 1
	} else if m.cursor > 0 {
		reloaded.cursor = m.cursor
	}
	reloaded.adjustScroll()
	return reloaded
}

// CurrentApp returns the currently selected application, if any.
func (m PipelineModel) CurrentApp() (model.CareerApplication, bool) {
	if m.cursor < 0 || m.cursor >= len(m.filtered) {
		return model.CareerApplication{}, false
	}
	return m.filtered[m.cursor], true
}

// Update handles input for the pipeline screen.
func (m PipelineModel) Update(msg tea.Msg) (PipelineModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		m.flash = ""
		if m.hiredStep > 0 {
			return m.handleHiredFlow(msg)
		}
		if m.colPicker {
			return m.handleColPicker(msg)
		}
		if m.statusPicker {
			return m.handleStatusPicker(msg)
		}
		if m.discardPicker {
			return m.handleDiscardPicker(msg)
		}
		if m.pdfPicker {
			return m.handlePDFPicker(msg)
		}
		if m.searchInput {
			return m.handleSearchInput(msg)
		}
		return m.handleKey(msg)
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case PipelinePDFGeneratedMsg:
		if msg.Err != "" {
			m.flash = "PDF regeneration failed: " + msg.Err
		} else {
			m.flash = "PDF regenerated and opened: " + filepath.Base(msg.Path)
		}
		return m, nil
	case PipelineOpenFailedMsg:
		m.flash = "Could not open " + msg.Target + ": " + msg.Err
		return m, nil
	case PipelineClipboardResultMsg:
		if msg.Err != "" {
			m.flash = "Could not copy CV PDF path to clipboard: " + msg.Err
		} else {
			m.flash = "Copied CV PDF path to clipboard: " + msg.Path
		}
		return m, nil
	case StatusUpdateFailedMsg:
		m.flash = "Could not update status: " + msg.Err
	case PipelineHistoryFailedMsg:
		m.flash = "Status history unavailable; progress uses previous data: " + msg.Err
		return m, nil
	case PipelineTrackerFailedMsg:
		m.flash = "Tracker unavailable; showing previous applications: " + msg.Err
		return m, nil
	case pipelineStartDiscardPickerMsg:
		// Issue 1380: initialise the discard reason picker state.
		// Merge predicted reasons (from report) with canonical fallback options.
		seen := make(map[string]bool)
		var opts []string
		numPredicted := 0
		for _, r := range msg.predictedReasons {
			if !seen[r] {
				opts = append(opts, r)
				seen[r] = true
				numPredicted++
			}
		}
		for _, c := range canonicalDiscardReasons {
			if !seen[c] {
				opts = append(opts, c)
				seen[c] = true
			}
		}
		opts = append(opts, "Other…")
		m.discardPicker = true
		m.discardCursor = 0
		m.discardOptions = opts
		m.discardPredictedCount = numPredicted
		m.discardCustomInput = false
		m.discardCustomText = ""
		m.discardPendingApp = msg.app
		m.discardPendingStatus = msg.newStatus
		return m, nil
	}
	return m, nil
}

func (m PipelineModel) handleKey(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	if m.keysHelp {
		return m.handleKeysHelp(msg)
	}
	switch msg.String() {
	case "?":
		m.keysHelp = true
		m.keysHelpOffset = 0
		return m, nil

	case "esc":
		// While a search is committed, Esc clears the search (matches vim's `:nohl`
		// ergonomics). With no query, Esc is a no-op — q is the only quit key, which
		// keeps the help bar honest and avoids accidental exits.
		if m.searchQuery != "" {
			m.searchQuery = ""
			m.applyFilterAndSort()
			m.cursor = 0
			m.scrollOffset = 0
			return m, m.LoadVisibleReports()
		}
		return m, nil

	case "q":
		return m, func() tea.Msg { return PipelineClosedMsg{} }

	case "/":
		// Open search input. Pre-fill with the current query so refining is one keystroke away.
		m.searchInput = true
		return m, nil

	case "down", "j":
		if len(m.filtered) > 0 {
			m.cursor++
			if m.cursor >= len(m.filtered) {
				m.cursor = len(m.filtered) - 1
			}
			m.adjustScroll()
			return m, m.LoadVisibleReports()
		}

	case "up", "k":
		if len(m.filtered) > 0 {
			m.cursor--
			if m.cursor < 0 {
				m.cursor = 0
			}
			m.adjustScroll()
			return m, m.LoadVisibleReports()
		}

	case "s":
		// Cycle sort mode
		for i, s := range sortCycle {
			if s == m.sortMode {
				m.sortMode = sortCycle[(i+1)%len(sortCycle)]
				break
			}
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, m.LoadVisibleReports()

	case "f", "right", "l":
		m.stepTab(1)
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, m.LoadVisibleReports()

	case "left", "h":
		m.stepTab(-1)
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, m.LoadVisibleReports()

	case "enter":
		if app, ok := m.CurrentApp(); ok && app.ReportPath != "" {
			fullPath := filepath.Join(m.careerOpsPath, app.ReportPath)
			title := fmt.Sprintf("%s — %s", app.Company, app.Role)
			jobURL := app.JobURL
			return m, func() tea.Msg {
				return PipelineOpenReportMsg{Path: fullPath, Title: title, JobURL: jobURL, App: app}
			}
		}

	case "o":
		if app, ok := m.CurrentApp(); ok {
			if app.JobURL != "" && !app.JobURLFallback {
				return m, func() tea.Msg { return PipelineOpenURLMsg{URL: app.JobURL} }
			}
			if app.ReportPath != "" {
				root, report := m.careerOpsPath, app.ReportPath
				return m, func() tea.Msg {
					details := data.LoadReportDetails(root, report, true)
					if details.JobURL == "" {
						details.JobURL = app.JobURL
					}
					return PipelineReportLoadedMsg{ReportPath: report, Details: details, OpenURL: true}
				}
			}
			if app.JobURL != "" {
				return m, func() tea.Msg { return PipelineOpenURLMsg{URL: app.JobURL} }
			}
			m.flash = "No URL found for this application"
		}

	case "m":
		return m, func() tea.Msg {
			return PipelineOpenURLMsg{URL: "https://career-ops.org/manifesto?utm_source=dashboard-shortcut"}
		}

	case "d":
		if app, ok := m.CurrentApp(); ok {
			if rel, found := m.newestPDF(app); !found {
				m.flash = noPDFFlash
			} else {
				return m, m.openPDFCmd(rel)
			}
		}

	case "y":
		if app, ok := m.CurrentApp(); ok {
			if rel, found := m.newestPDF(app); !found {
				m.flash = noPDFFlash
			} else {
				fullPath, err := m.pdfAbsPath(rel)
				if err != nil {
					m.flash = "Could not resolve CV PDF path: " + err.Error()
					return m, nil
				}
				return m, func() tea.Msg {
					return PipelineCopyPDFPathMsg{Path: fullPath}
				}
			}
		}

	case "D":
		if app, ok := m.CurrentApp(); ok {
			workspaceRoot := data.PDFWorkspaceRoot(m.careerOpsPath)
			manifest := data.LoadPDFManifest(m.careerOpsPath)
			entry, found := manifest.Lookup(app)
			// Manifest lookup requires a report number; fall back to PDF-path
			// index when the manifest was written without --report (common case).
			if !found || entry.HTMLPath == "" {
				byPath := data.LoadPDFEntriesByPath(m.careerOpsPath)
				candidates := data.ResolvePDFs(workspaceRoot, app, manifest)
				for _, c := range candidates {
					if e, ok := byPath[c]; ok && e.HTMLPath != "" {
						entry = e
						found = true
						break
					}
				}
			}
			if !found || entry.HTMLPath == "" {
				m.flash = "No source HTML found for this application — run /career-ops pdf first"
				return m, nil
			}
			if _, err := os.Stat(filepath.Join(workspaceRoot, filepath.FromSlash(entry.HTMLPath))); err != nil {
				m.flash = "Source HTML missing: " + entry.HTMLPath
				return m, nil
			}
			m.flash = "Regenerating PDF via generate-pdf.mjs — this takes a few seconds..."
			path, report := workspaceRoot, entry.ReportNumber
			html, pdf, format := entry.HTMLPath, entry.PDFPath, entry.Format
			return m, func() tea.Msg {
				return PipelineGeneratePDFMsg{
					CareerOpsPath: path,
					ReportNumber:  report,
					HTMLPath:      html,
					PDFPath:       pdf,
					Format:        format,
				}
			}
		}

	case "p":
		return m, func() tea.Msg { return PipelineOpenProgressMsg{} }

	case "S":
		return m, func() tea.Msg { return PipelineOpenStatsMsg{} }

	case "r":
		return m, func() tea.Msg { return PipelineRefreshMsg{} }

	case "C":
		m.colPicker = true
		m.colPickerIdx = 0
		return m, nil

	case "c":
		if len(m.filtered) > 0 {
			m.statusPicker = true
			m.statusCursor = 0
		}

	case "g":
		if len(m.filtered) > 0 {
			m.cursor = 0
			m.scrollOffset = 0
			return m, m.LoadVisibleReports()
		}

	case "G":
		if len(m.filtered) > 0 {
			m.cursor = len(m.filtered) - 1
			m.adjustScroll()
			return m, m.LoadVisibleReports()
		}

	case "pgdown", "ctrl+d":
		if len(m.filtered) > 0 {
			halfPage := m.height / 2
			if halfPage < 1 {
				halfPage = 1
			}
			m.cursor += halfPage
			if m.cursor >= len(m.filtered) {
				m.cursor = len(m.filtered) - 1
			}
			m.adjustScroll()
			return m, m.LoadVisibleReports()
		}

	case "pgup", "ctrl+u":
		if len(m.filtered) > 0 {
			halfPage := m.height / 2
			if halfPage < 1 {
				halfPage = 1
			}
			m.cursor -= halfPage
			if m.cursor < 0 {
				m.cursor = 0
			}
			m.adjustScroll()
			return m, m.LoadVisibleReports()
		}
	}

	return m, nil
}

// handleKeysHelp scrolls the binding list. q and Esc leave it; they do not
// quit, because the footer told the user q was the way out of this list.
func (m PipelineModel) handleKeysHelp(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q", "?":
		m.keysHelp = false
		m.keysHelpOffset = 0
		return m, nil
	case "down", "j":
		m.keysHelpOffset++
	case "up", "k":
		if m.keysHelpOffset > 0 {
			m.keysHelpOffset--
		}
	}
	visible := m.height - m.chromeRowsFixed() + 1
	if visible < 1 {
		visible = 1
	}
	maxOffset := m.keyHelpRowCount() - visible
	if maxOffset < 0 {
		maxOffset = 0
	}
	if m.keysHelpOffset > maxOffset {
		m.keysHelpOffset = maxOffset
	}
	if m.keysHelpOffset < 0 {
		m.keysHelpOffset = 0
	}
	return m, nil
}

func (m PipelineModel) keyHelpRowCount() int {
	const bindings = 19
	if m.width >= 56 {
		return (bindings + 1) / 2
	}
	return bindings
}

// handleSearchInput consumes keys while the search input bar is open.
// Esc cancels (closes input AND clears query). Enter commits (closes input,
// keeps query, refreshes filtered list). Backspace + printable chars edit
// the query and live-update the filter so the user sees results as they type.
//
// Report previews are NOT lazy-loaded on every keystroke — that would trigger
// a synchronous os.ReadFile per rune/backspace/ctrl+u and stutter live
// typing. Instead the load fires once when the user commits (Enter) or
// cancels (Esc); subsequent cursor movement in handleKey loads as before.
func (m PipelineModel) handleSearchInput(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.searchInput = false
		m.searchQuery = ""
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, m.LoadVisibleReports()

	case "enter":
		m.searchInput = false
		// Query already applied during typing; load the preview for the
		// committed first match (skipped during typing for perf).
		return m, m.LoadVisibleReports()

	case "backspace":
		if len(m.searchQuery) > 0 {
			// Drop the last UTF-8 rune so multi-byte characters delete cleanly.
			runes := []rune(m.searchQuery)
			m.searchQuery = string(runes[:len(runes)-1])
			m.applyFilterAndSort()
			m.cursor = 0
			m.scrollOffset = 0
		}
		return m, nil

	case "ctrl+u":
		// vim-flavored: clear the in-progress query without leaving search mode.
		m.searchQuery = ""
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, nil
	}

	// Append printable runes (ignore other special keys like arrows / ctrl-combos).
	if r := msg.Runes; len(r) > 0 {
		m.searchQuery += strings.ToLower(string(r))
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, nil
	}
	return m, nil
}

func (m PipelineModel) handleStatusPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.statusPicker = false
		return m, nil

	case "down", "j":
		m.statusCursor++
		if m.statusCursor >= len(m.currentStatusPairs()) {
			m.statusCursor = len(m.currentStatusPairs()) - 1
		}

	case "up", "k":
		m.statusCursor--
		if m.statusCursor < 0 {
			m.statusCursor = 0
		}

	case "enter":
		m.statusPicker = false
		if app, ok := m.CurrentApp(); ok {
			newStatus := m.currentStatusPairs()[m.statusCursor].Canonical
			norm := data.NormalizeStatus(newStatus)
			if norm == "discarded" || norm == "skip" {
				return m, func() tea.Msg {
					return m.startDiscardFlow(app, newStatus)
				}
			}
			return m, func() tea.Msg {
				return PipelineUpdateStatusMsg{
					CareerOpsPath: m.careerOpsPath,
					App:           app,
					NewStatus:     newStatus,
				}
			}
		}
	}
	return m, nil
}

// startDiscardFlow loads predicted reasons from the report (if any), merges
// them with the canonical fallback list, and returns a message that triggers
// the discard picker overlay. Called synchronously inside a Cmd so it can do
// file I/O without blocking the Bubble Tea event loop.
func (m PipelineModel) startDiscardFlow(app model.CareerApplication, newStatus string) tea.Msg {
	predicted := data.LoadReportDiscardReasons(m.careerOpsPath, app.ReportPath)
	return pipelineStartDiscardPickerMsg{
		app:              app,
		newStatus:        newStatus,
		predictedReasons: predicted,
	}
}

// pipelineStartDiscardPickerMsg is an internal message that initialises the
// discard reason picker state on the model. It is dispatched from startDiscardFlow.
type pipelineStartDiscardPickerMsg struct {
	app              model.CareerApplication
	newStatus        string
	predictedReasons []string
}

// handlePDFPicker consumes keys while the PDF picker overlay is open.
func (m PipelineModel) handlePDFPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.pdfPicker = false
		return m, nil

	case "down", "j":
		m.pdfCursor++
		if m.pdfCursor >= len(m.pdfChoices) {
			m.pdfCursor = len(m.pdfChoices) - 1
		}

	case "up", "k":
		m.pdfCursor--
		if m.pdfCursor < 0 {
			m.pdfCursor = 0
		}

	case "enter", "d":
		m.pdfPicker = false
		if m.pdfCursor >= 0 && m.pdfCursor < len(m.pdfChoices) {
			return m, m.openPDFCmd(m.pdfChoices[m.pdfCursor])
		}
	}
	return m, nil
}

// handleDiscardPicker consumes keys while the discard reason picker is open
// (Issue 1380). When "Other…" is focused and Enter is pressed, it enters a
// free-text sub-mode where the user types a custom reason and confirms with
// Enter again. Esc at any point skips tagging and just commits the status.
func (m PipelineModel) handleDiscardPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	// Free-text sub-mode for "Other…"
	if m.discardCustomInput {
		switch msg.String() {
		case "enter":
			reason := strings.TrimSpace(m.discardCustomText)
			reason = strings.ReplaceAll(reason, ",", " ")
			reason = strings.ReplaceAll(reason, ";", " ")
			reason = strings.ReplaceAll(reason, "\n", " ")
			reason = strings.ReplaceAll(reason, "\r", " ")
			reason = strings.ReplaceAll(reason, "\t", " ")
			reason = strings.Join(strings.Fields(reason), " ")
			reason = strings.TrimSpace(reason)
			if reason == "" {
				reason = "other"
			}
			return m.commitDiscardReason(reason)
		case "esc":
			m.discardCustomInput = false
			m.discardCustomText = ""
		case "backspace", "ctrl+h":
			runes := []rune(m.discardCustomText)
			if len(runes) > 0 {
				m.discardCustomText = string(runes[:len(runes)-1])
			}
		default:
			if len(msg.Runes) > 0 {
				m.discardCustomText += string(msg.Runes)
			}
		}
		return m, nil
	}

	switch msg.String() {
	case "esc":
		// Skip reason tagging — still commit the status change.
		m.discardPicker = false
		return m, func() tea.Msg {
			return PipelineUpdateStatusMsg{
				CareerOpsPath: m.careerOpsPath,
				App:           m.discardPendingApp,
				NewStatus:     m.discardPendingStatus,
			}
		}

	case "down", "j":
		m.discardCursor++
		if m.discardCursor >= len(m.discardOptions) {
			m.discardCursor = len(m.discardOptions) - 1
		}

	case "up", "k":
		m.discardCursor--
		if m.discardCursor < 0 {
			m.discardCursor = 0
		}

	case "enter":
		if m.discardCursor < 0 || m.discardCursor >= len(m.discardOptions) {
			break
		}
		chosen := m.discardOptions[m.discardCursor]
		if chosen == "Other…" {
			m.discardCustomInput = true
			m.discardCustomText = ""
			return m, nil
		}
		return m.commitDiscardReason(chosen)
	}
	return m, nil
}

func (m PipelineModel) StartHiredFlow(app model.CareerApplication) (PipelineModel, tea.Cmd) {
	m.hiredApp = app
	m.hiredStep = 1
	return m, nil
}

func (m PipelineModel) StartDiscardReasonFlow(app model.CareerApplication, status string) (PipelineModel, tea.Cmd) {
	predicted := data.LoadReportDiscardReasons(m.careerOpsPath, app.ReportPath)
	seen := make(map[string]bool)
	var opts []string
	numPredicted := 0
	for _, r := range predicted {
		if !seen[r] {
			opts = append(opts, r)
			seen[r] = true
			numPredicted++
		}
	}
	for _, c := range canonicalDiscardReasons {
		if !seen[c] {
			opts = append(opts, c)
			seen[c] = true
		}
	}
	opts = append(opts, "Other…")
	m.discardPicker = true
	m.discardCursor = 0
	m.discardOptions = opts
	m.discardPredictedCount = numPredicted
	m.discardCustomInput = false
	m.discardCustomText = ""
	m.discardPendingApp = app
	m.discardPendingStatus = status
	return m, nil
}

func (m PipelineModel) handleHiredFlow(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch m.hiredStep {
	case 1: // win screen
		if msg.String() == "enter" {
			m.hiredStep = 2
		}
	case 2: // story invite
		switch msg.String() {
		case "y", "Y":
			m.hiredStep = 3
			return m, func() tea.Msg {
				return PipelineOpenURLMsg{URL: storyTemplateURL}
			}
		case "n", "N", "enter", "esc":
			m.hiredStep = 3
		}
	case 3: // anonymous stat
		switch msg.String() {
		case "y", "Y":
			weeks := m.calculateWeeksToHire()
			if err := data.SaveAnonymousStat(m.careerOpsPath, m.hiredApp.Role, weeks); err != nil {
				m.flash = "Could not record anonymous stat: " + err.Error()
			}
			m.hiredStep = 0
		case "n", "N", "enter", "esc":
			m.hiredStep = 0
		}
	}
	return m, nil
}

// commitDiscardReason closes the picker and emits PipelineUpdateStatusAndNotesMsg
// to atomically persist the new status plus a DISCARD/SKIP tag in Notes.
func (m PipelineModel) commitDiscardReason(reason string) (PipelineModel, tea.Cmd) {
	m.discardPicker = false
	m.discardCustomInput = false
	app := m.discardPendingApp
	newStatus := m.discardPendingStatus
	prefix := "DISCARD"
	if strings.ToLower(newStatus) == "skip" {
		prefix = "SKIP"
	}
	notesTag := fmt.Sprintf("%s: %s", prefix, reason)
	return m, func() tea.Msg {
		return PipelineUpdateStatusAndNotesMsg{
			CareerOpsPath: m.careerOpsPath,
			App:           app,
			NewStatus:     newStatus,
			NotesAppend:   notesTag,
		}
	}
}

func (m PipelineModel) calculateWeeksToHire() int {
	if m.hiredApp.Date == "" {
		return 1
	}
	appDate, err := time.Parse("2006-01-02", m.hiredApp.Date)
	if err != nil {
		return 1
	}
	days := int(time.Since(appDate).Hours() / 24)
	weeks := (days + 3) / 7
	if weeks < 1 {
		weeks = 1
	}
	return weeks
}

// handleColPicker consumes keys while the column picker overlay is open.
func (m PipelineModel) handleColPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q", "C":
		m.colPicker = false
		return m, nil

	case "down", "j":
		m.colPickerIdx++
		if m.colPickerIdx >= len(getOptionalCols()) {
			m.colPickerIdx = len(getOptionalCols()) - 1
		}

	case "up", "k":
		m.colPickerIdx--
		if m.colPickerIdx < 0 {
			m.colPickerIdx = 0
		}

	case " ":
		col := getOptionalCols()[m.colPickerIdx]
		m.visibleCols[col.id] = !m.visibleCols[col.id]
	}
	return m, nil
}

// LoadVisibleReports returns commands to hydrate report summaries for the rows
// in and just around the current viewport. This keeps startup/refresh cheap
// while avoiding blank previews as the user scrolls.
func (m *PipelineModel) LoadVisibleReports() tea.Cmd {
	paths := m.visibleReportPathsForLoad()
	if len(paths) == 0 {
		return nil
	}
	cmds := make([]tea.Cmd, 0, len(paths))
	for _, report := range paths {
		if m.reportLoading == nil {
			m.reportLoading = make(map[string]bool)
		}
		m.reportLoading[report] = true
		path := m.careerOpsPath
		reportPath := report
		cmds = append(cmds, func() tea.Msg {
			details := data.LoadReportDetails(path, reportPath, false)
			return PipelineReportLoadedMsg{ReportPath: reportPath, Details: details}
		})
	}
	if len(cmds) == 1 {
		return cmds[0]
	}
	return tea.Batch(cmds...)
}

// newestPDF resolves the newest CV PDF for app (root-relative). Shared by `d`
// and `y` so both act on the same file.
func (m PipelineModel) newestPDF(app model.CareerApplication) (string, bool) {
	manifest := data.LoadPDFManifest(m.careerOpsPath)
	candidates := data.ResolvePDFs(data.PDFWorkspaceRoot(m.careerOpsPath), app, manifest)
	if len(candidates) == 0 {
		return "", false
	}
	return candidates[0], true // newest first
}

// pdfAbsPath turns a root-relative PDF path into an absolute one. The
// workspace root follows --path, which may be relative, so the joined path is
// resolved against the working directory: a copied path must still work when
// pasted into another app.
func (m PipelineModel) pdfAbsPath(relPath string) (string, error) {
	return filepath.Abs(filepath.Join(data.PDFWorkspaceRoot(m.careerOpsPath), filepath.FromSlash(relPath)))
}

// openPDFCmd emits a PipelineOpenPDFMsg for a root-relative PDF path.
func (m PipelineModel) openPDFCmd(relPath string) tea.Cmd {
	fullPath, err := m.pdfAbsPath(relPath)
	return func() tea.Msg {
		if err != nil {
			return PipelineOpenFailedMsg{Target: "CV PDF", Err: err.Error()}
		}
		return PipelineOpenPDFMsg{Path: fullPath}
	}
}

func (m PipelineModel) visibleReportPathsForLoad() []string {
	if len(m.filtered) == 0 {
		return nil
	}

	availHeight := m.height - m.chromeRowsFixed() - previewBudgetApprox
	if availHeight < 5 {
		availHeight = 5
	}
	const preloadMargin = 4
	startLine := m.scrollOffset - preloadMargin
	if startLine < 0 {
		startLine = 0
	}
	endLine := m.scrollOffset + availHeight + preloadMargin

	seen := make(map[string]bool)
	var paths []string
	add := func(app model.CareerApplication) {
		if app.ReportPath == "" || seen[app.ReportPath] {
			return
		}
		if _, cached := m.reportCache[app.ReportPath]; cached {
			return
		}
		if m.reportLoading != nil && m.reportLoading[app.ReportPath] {
			return
		}
		seen[app.ReportPath] = true
		paths = append(paths, app.ReportPath)
	}

	if app, ok := m.CurrentApp(); ok {
		add(app)
	}

	for i, app := range m.filtered {
		if i >= startLine && i <= endLine {
			add(app)
		}
	}
	return paths
}

// matchesSearch reports whether app contains the query as a case-insensitive
// substring of its company, role, or notes. Empty query matches everything.
// Lowercases both sides so callers don't have to remember the contract.
func matchesSearch(app model.CareerApplication, query string) bool {
	if query == "" {
		return true
	}
	q := strings.ToLower(query)
	if strings.Contains(strings.ToLower(app.Company), q) {
		return true
	}
	if strings.Contains(strings.ToLower(app.Role), q) {
		return true
	}
	if strings.Contains(strings.ToLower(app.Notes), q) {
		return true
	}
	return false
}

// stepTab moves the active tab by delta, wrapping, and skips Other when that
// bucket is empty so a clean tracker never lands on a blank tab.
func (m *PipelineModel) stepTab(delta int) {
	tabs := getPipelineTabs()
	n := len(tabs)
	if n == 0 || delta == 0 {
		return
	}
	next := m.activeTab
	for range n {
		next += delta
		if next >= n {
			next = 0
		} else if next < 0 {
			next = n - 1
		}
		if tabs[next].filter == filterOther && m.countForFilter(filterOther) == 0 {
			continue
		}
		m.activeTab = next
		return
	}
}

// clampActiveTab keeps the selection on a tab the tracker can show.
func (m *PipelineModel) clampActiveTab() {
	tabs := getPipelineTabs()
	if len(tabs) == 0 {
		m.activeTab = 0
		return
	}
	if m.activeTab < 0 || m.activeTab >= len(tabs) {
		m.activeTab = 0
	}
	if tabs[m.activeTab].filter == filterOther && m.countForFilter(filterOther) == 0 {
		m.activeTab = 0
	}
}

// applyFilterAndSort rebuilds the filtered list from apps.
func (m *PipelineModel) applyFilterAndSort() {
	m.clampActiveTab()
	var filtered []model.CareerApplication

	currentFilter := getPipelineTabs()[m.activeTab].filter
	for _, app := range m.apps {
		if !matchesSearch(app, m.searchQuery) {
			continue
		}
		norm := data.NormalizeStatus(app.Status)
		switch currentFilter {
		case filterAll:
			filtered = append(filtered, app)
		case filterOther:
			if !data.IsCanonicalStatusName(norm) {
				filtered = append(filtered, app)
			}
		default:
			if norm == currentFilter {
				filtered = append(filtered, app)
			}
		}
	}

	// Sort
	less := m.sortLess()
	sort.SliceStable(filtered, func(i, j int) bool {
		return less(filtered[i], filtered[j])
	})

	m.filtered = filtered
}

// effectiveDate is what the DATE column shows and what the date sort orders
// by: the row's latest status transition from status-log.tsv when it has one,
// otherwise the tracker's own Date cell (the evaluation date). Other readers
// of app.Date — the hired-flow weeks math, the LAST column's "same as date"
// elision — mean the evaluation date on purpose and do not go through here.
func effectiveDate(app model.CareerApplication) string {
	if app.StatusDate != "" {
		return app.StatusDate
	}
	return app.Date
}

// sortLess returns the comparator for the active sort mode. Shared by the flat
// sort and the within-group tiebreaker in grouped view.
func (m PipelineModel) sortLess() func(a, b model.CareerApplication) bool {
	switch m.sortMode {
	case sortID:
		// Highest tracker ID first, matching the newest-first date sort.
		return func(a, b model.CareerApplication) bool { return a.Number > b.Number }
	case sortDate:
		return func(a, b model.CareerApplication) bool { return dashboardDate(a) > dashboardDate(b) }
	case sortCompany:
		return func(a, b model.CareerApplication) bool {
			return strings.ToLower(a.Company) < strings.ToLower(b.Company)
		}
	case sortStatus:
		return func(a, b model.CareerApplication) bool {
			return data.StatusPriority(a.Status) < data.StatusPriority(b.Status)
		}
	case sortLocation:
		// Remote-first, then hybrid, then onsite; alphabetical city as tiebreaker.
		return func(a, b model.CareerApplication) bool {
			ra, rb := workModeRank(a.WorkMode), workModeRank(b.WorkMode)
			if ra != rb {
				return ra < rb
			}
			return a.Location < b.Location
		}
	case sortPay:
		// Highest band ceiling first; unknown pay (0) sinks to the bottom.
		return func(a, b model.CareerApplication) bool { return a.PayMax > b.PayMax }
	case sortLast:
		// Most recent contact first; empty dates sink to the bottom.
		return func(a, b model.CareerApplication) bool { return a.LastContact > b.LastContact }
	case sortPosted:
		// Freshest requisition first; rows with no posted date sink to the bottom.
		return func(a, b model.CareerApplication) bool {
			if (a.PostedOn == "") != (b.PostedOn == "") {
				return a.PostedOn != ""
			}
			return a.PostedOn > b.PostedOn
		}
	default: // sortScore
		// Unevaluated rows float to the TOP, not the bottom. Their Score is
		// Go's zero value, so a plain `a.Score > b.Score` ranks them below the
		// worst-scoring role in the pipeline — which reads as "these are the
		// weakest" when it means "these have not been looked at yet".
		// "Needs evaluating" is more actionable than "scored badly".
		return func(a, b model.CareerApplication) bool {
			if a.HasScore != b.HasScore {
				return !a.HasScore
			}
			return a.Score > b.Score
		}
	}
}

// workModeRank orders work modes remote-first for the location sort.
func workModeRank(mode string) int {
	// Internal language-neutral representations.
	switch mode {
	case "Remote":
		return 0
	case "RemoteFlex":
		return 1
	case "Hybrid":
		return 2
	case "Full":
		return 3
	default:
		return 4
	}
}

// chromeRowsFixed returns the number of fixed chrome rows above/below the body
// (header + column header + help + 1 search bar when active). Shared by View()
// and adjustScroll() so additions stay in sync.
func (m PipelineModel) chromeRowsFixed() int {
	rows := 4 // header + column header + help + preview baseline
	if m.searchInput || m.searchQuery != "" {
		rows++
	}
	return rows
}

// previewBudgetApprox is the approximate row count reserved for the preview block
// when computing scroll positioning. View() measures the actual rendered preview
// height; adjustScroll uses this constant to avoid re-rendering on every keystroke.
const previewBudgetApprox = 6

// adjustScroll updates scrollOffset so the cursor stays visible.
func (m *PipelineModel) adjustScroll() {
	availHeight := m.height - m.chromeRowsFixed() - previewBudgetApprox
	if availHeight < 5 {
		availHeight = 5
	}
	line := m.cursorLineEstimate()
	margin := 3

	if line >= m.scrollOffset+availHeight-margin {
		m.scrollOffset = line - availHeight + margin + 1
	}
	if line < m.scrollOffset+margin {
		m.scrollOffset = line - margin
	}
	if m.scrollOffset < 0 {
		m.scrollOffset = 0
	}
}

func (m PipelineModel) cursorLineEstimate() int {
	return m.cursor
}

// -- View --

// View renders the pipeline screen.
func (m PipelineModel) View() string {
	if m.hiredStep > 0 {
		return m.overlayHiredFlow()
	}

	header := m.renderHeader()
	searchBar := m.renderSearchBar()
	help := m.renderHelp()

	// A picker or the key list already fills the bottom of the screen. Leaving
	// the preview up and then appending the overlay pushes the title past the
	// top of the terminal.
	overlay := m.keysHelp || m.statusPicker || m.colPicker || m.pdfPicker || m.discardPicker
	preview := ""
	if !overlay {
		preview = m.renderPreview()
	}

	previewLines := 0
	if preview != "" {
		previewLines = strings.Count(preview, "\n") + 1
	}
	// chromeRowsFixed includes a one-row preview baseline. Keep that only while
	// the preview is actually on screen; the old formula then still applies.
	availHeight := m.height - m.chromeRowsFixed() - previewLines - m.pickerExtraLines()
	if preview == "" {
		availHeight++
	}
	if availHeight < 1 {
		availHeight = 1
	}

	var body string
	if m.keysHelp {
		body = m.renderKeysHelp(availHeight)
	} else {
		// Render only the rows that will be shown. An offset past the end shows the
		// body from the top, as slicing the fully rendered body used to.
		bodyLines := m.renderBodyWindow(m.scrollOffset, availHeight)
		if len(bodyLines) == 0 {
			bodyLines = m.renderBodyWindow(0, availHeight)
		}
		body = strings.Join(bodyLines, "\n")

		if m.colPicker {
			body = m.overlayColPicker(body)
		}
		if m.statusPicker {
			body = m.overlayStatusPicker(body)
		}
		if m.pdfPicker {
			body = m.overlayPDFPicker(body)
		}
		if m.discardPicker {
			body = m.overlayDiscardPicker(body)
		}
	}

	sections := []string{header}
	if searchBar != "" {
		sections = append(sections, searchBar)
	}
	sections = append(sections, m.renderColumnHeader(), body)
	if preview != "" {
		sections = append(sections, preview)
	}
	sections = append(sections, help)
	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// pickerExtraLines is how many rows the open overlay appends under the body.
// Counting the rendered overlay (and dropping the blank line Split inserts for
// an empty body) keeps a wrapped picker row from blowing the height budget.
func (m PipelineModel) pickerExtraLines() int {
	if m.keysHelp {
		return 0
	}
	var rendered string
	switch {
	case m.colPicker:
		rendered = m.overlayColPicker("")
	case m.statusPicker:
		rendered = m.overlayStatusPicker("")
	case m.pdfPicker:
		rendered = m.overlayPDFPicker("")
	case m.discardPicker:
		rendered = m.overlayDiscardPicker("")
	default:
		return 0
	}
	n := strings.Count(rendered, "\n") + 1
	if n > 0 {
		n--
	}
	return n
}

// renderSearchBar returns an empty string when there is no active or in-progress
// search; otherwise it renders a vim-style status line showing the query and the
// match count. While in input mode, a trailing cursor is appended.
func (m PipelineModel) renderSearchBar() string {
	if !m.searchInput && m.searchQuery == "" {
		return ""
	}

	style := lipgloss.NewStyle().
		Foreground(m.theme.Text).
		Padding(0, 2)

	prompt := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render("/")
	queryStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	hintStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	display := queryStyle.Render(m.searchQuery)
	if m.searchInput {
		display += lipgloss.NewStyle().Foreground(m.theme.Blue).Render("█")
	}

	tabFiltered := m.countForFilter(getPipelineTabs()[m.activeTab].filter)
	matchInfo := hintStyle.Render(fmt.Sprintf(i18n.Current.SearchMatching, len(m.filtered), tabFiltered))

	hint := ""
	if m.searchInput {
		hint = hintStyle.Render(i18n.Current.SearchHintInput)
	} else {
		hint = hintStyle.Render(i18n.Current.SearchHintNormal)
	}

	return oneLine(m.width, style, prompt+" "+display+matchInfo+hint)
}

// avgScoreLabel is the header's average score, or "—" when no row has a
// score. AvgScore is averaged over scored rows only and every score is above
// zero, so it is positive exactly when there is one; printed as "0.0" it read
// as a pipeline that had been scored and scored nothing, a mean taken over no
// values.
func avgScoreLabel(avg float64) string {
	if avg > 0 {
		return fmt.Sprintf("%.1f", avg)
	}
	return "—"
}

func (m PipelineModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Padding(0, 2)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	info := right.Render(fmt.Sprintf(i18n.Current.OffersSummary, m.metrics.Total, avgScoreLabel(m.metrics.AvgScore)))
	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render(i18n.Current.AppTitle)
	inner := m.width - 4
	if inner < 1 {
		inner = 1
	}
	titleWidth := lipgloss.Width(title)
	// The inline tabs are the navigation, so they outrank the summary: drop the
	// summary once it leaves no room for at least the active tab.
	minTabs := lipgloss.Width("["+getPipelineTabs()[m.activeTab].label+"]") + 2
	gapWidth := inner - titleWidth - lipgloss.Width(info)
	if gapWidth < minTabs {
		info = ""
		gapWidth = inner - titleWidth
	}
	if gapWidth < 1 {
		gapWidth = 1
	}
	tabs := m.renderHeaderTabs(gapWidth)
	tabsWidth := lipgloss.Width(tabs)
	if tabsWidth > gapWidth {
		tabs = m.renderPlainHeaderTabs(gapWidth)
		tabsWidth = lipgloss.Width(tabs)
	}
	leftGap := 0
	rightGap := 0
	if remaining := gapWidth - tabsWidth; remaining > 0 {
		leftGap = remaining / 2
		rightGap = remaining - leftGap
	}

	return oneLine(m.width, style, title+strings.Repeat(" ", leftGap)+tabs+strings.Repeat(" ", rightGap)+info)
}

func (m PipelineModel) renderHeaderTabs(maxWidth int) string {
	withCounts := m.renderHeaderTabsWithCounts(true)
	if lipgloss.Width(withCounts) <= maxWidth {
		return withCounts
	}
	return m.renderHeaderTabsWithCounts(false)
}

func (m PipelineModel) renderPlainHeaderTabs(maxWidth int) string {
	tabs := getPipelineTabs()
	labels := make([]string, 0, len(tabs))
	active := ""
	for i, tab := range tabs {
		if m.tabHidden(i) {
			continue
		}
		label := tab.label
		if i == m.activeTab {
			label = "[" + label + "]"
			active = label
		}
		labels = append(labels, label)
	}
	joined := strings.Join(labels, " ")
	if lipgloss.Width(joined) <= maxWidth {
		return joined
	}
	return truncateCells(active, maxWidth)
}

// tabHidden reports whether tab i stays off the header: an empty Other tab is
// not a place to land, so it shows only while it has rows or is selected.
func (m PipelineModel) tabHidden(i int) bool {
	return getPipelineTabs()[i].filter == filterOther && i != m.activeTab && m.countForFilter(filterOther) == 0
}

func (m PipelineModel) renderHeaderTabsWithCounts(showCounts bool) string {
	var tabs []string

	for i, tab := range getPipelineTabs() {
		if m.tabHidden(i) {
			continue
		}
		label := tab.label
		if showCounts {
			label = fmt.Sprintf("%s:%d", tab.label, m.countForFilter(tab.filter))
		}

		color, own := m.tabColor(tab.filter)
		style := lipgloss.NewStyle().Foreground(color)
		if i == m.activeTab {
			if !own {
				color = m.theme.Blue
			}
			style = style.Foreground(color).Bold(true).Underline(true)
		}
		tabs = append(tabs, style.Render(label))
	}

	return strings.Join(tabs, "  ")
}

// tabColor is the colour a status tab's label takes: the status's own colour
// from statusColorMap when it has a distinct one (Applied, Interview, Skip...),
// so the hue the removed STATUS column carried stays visible in the header.
// Statuses drawn in plain text or the muted tone report own=false and keep the
// muted tab colour.
func (m PipelineModel) tabColor(filter string) (color lipgloss.Color, own bool) {
	c, ok := m.statusColorMap()[filter]
	if !ok || c == m.theme.Text || c == m.theme.Subtext {
		return m.theme.Subtext, false
	}
	return c, true
}

func (m PipelineModel) countForFilter(filter string) int {
	count := 0
	for _, app := range m.apps {
		norm := data.NormalizeStatus(app.Status)
		switch filter {
		case filterAll:
			count++
		case filterOther:
			if !data.IsCanonicalStatusName(norm) {
				count++
			}
		default:
			if norm == filter {
				count++
			}
		}
	}
	return count
}

func (m PipelineModel) renderBody() string {
	return strings.Join(m.renderBodyWindow(0, math.MaxInt), "\n")
}

// renderBodyWindow returns the body's display lines from line `start`, at most
// `height` of them: the same lines as rendering the whole body and slicing it,
// without rendering the rows outside the window. View used to render every
// filtered row on each keypress and then keep a screenful.
//
// A row or group header counts as one line. Cells are truncated to their
// column, and column widths shrink until the row fits the terminal, so the
// selected row stays one line too. The split below still counts a real wrap
// if one ever slips through.
func (m PipelineModel) renderBodyWindow(start, height int) []string {
	lines := make([]string, 0, min(height, len(m.filtered)+8))
	line := 0 // index of the next display line
	emit := func(s string) bool {
		for _, l := range strings.Split(s, "\n") {
			if line >= start && len(lines) < height {
				lines = append(lines, l)
			}
			line++
		}
		return len(lines) < height
	}

	if len(m.filtered) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(m.theme.Subtext).
			Padding(1, 2)
		emit(emptyStyle.Render(i18n.Current.NoOffersMatch))
		return lines
	}

	for i, app := range m.filtered {
		selected := i == m.cursor
		if line < start && !selected {
			line++
			continue
		}
		if !emit(m.renderAppLine(app, selected)) {
			break
		}
	}

	return lines
}

// colWidths holds per-column rune budgets for the table.
type colWidths struct {
	num, score, company, status, role int
	// optional columns — 0 means the column is hidden
	date, loc, pay, rpt, pdf, last, posted int
}

func (m PipelineModel) colVisible(id ColumnID) bool {
	if m.visibleCols == nil {
		// Fall back to default for callers before init (tests, etc.)
		for _, col := range getOptionalCols() {
			if col.id == id {
				return col.onByDefault
			}
		}
		return false
	}
	return m.visibleCols[id]
}

// showStatusCol reports whether the STATUS column is rendered. Every tab but
// OTHER holds a single canonical status, which the selected tab already names,
// so the column appears only on OTHER, where the raw statuses differ per row.
func (m PipelineModel) showStatusCol() bool {
	tabs := getPipelineTabs()
	return m.activeTab >= 0 && m.activeTab < len(tabs) && tabs[m.activeTab].filter == filterOther
}

func (m PipelineModel) columnWidths() colWidths {
	company, status, roleFloor := 16, 0, 15
	if m.showStatusCol() {
		status = 16
	}
	show := map[ColumnID]bool{}
	for _, col := range getOptionalCols() {
		if m.colVisible(col.id) {
			show[col.id] = true
		}
	}
	// A non-positive width cannot be fitted; keep the historical floor so a
	// caller that has not been resized yet still renders something.
	if m.width <= 0 {
		c := m.widthsFor(show, company, status)
		if c.role < roleFloor {
			c.role = roleFloor
		}
		return c
	}
	// Drop the least identifying columns first (the fork keeps its default
	// POSTED, CONTACT and PDF columns ahead of PAY and LOCATION, and the
	// optional DATE goes early), then give company and status back to the role
	// column, then lower the role floor. Stopping at a role that still meets the
	// floor keeps the row on one line.
	dropOrder := []ColumnID{ColHasReport, ColDate, ColPay, ColLocation, ColPosted, ColLastContact, ColHasPDF}
	for {
		c := m.widthsFor(show, company, status)
		if c.role >= roleFloor {
			return c
		}
		dropped := false
		for _, id := range dropOrder {
			if show[id] {
				show[id] = false
				dropped = true
				break
			}
		}
		if dropped {
			continue
		}
		switch {
		case company > 8:
			company--
		case status > 8:
			status--
		case roleFloor > 6:
			roleFloor--
		default:
			if c.role < 1 {
				c.role = 1
			}
			return c
		}
	}
}

func (m PipelineModel) widthsFor(show map[ColumnID]bool, company, status int) colWidths {
	c := colWidths{num: 6, score: 5, company: company, status: status} // # plus a five-digit tracker ID
	if show[ColDate] {
		c.date = 10
	}
	if show[ColLocation] {
		c.loc = 20
	}
	if show[ColPay] {
		c.pay = 16
	}
	if show[ColHasReport] {
		c.rpt = 4
	}
	if show[ColHasPDF] {
		c.pdf = 4
	}
	if show[ColLastContact] {
		c.last = 10
	}
	if show[ColPosted] {
		c.posted = 10
	}
	fixed := c.num + c.score + c.date + c.company + c.status + c.loc + c.pay + c.rpt + c.pdf + c.last + c.posted
	c.role = m.width - fixed - m.rowOverhead(c)
	return c
}

// rowOverhead is everything a rendered row costs beyond the column widths
// themselves. It is NOT a constant: renderAppLine and renderColumnHeader join
// the segments with one space each, so the cost grows by one for every optional
// column turned on.
//
// It used to be a fixed 14, which is the value for all seven optional columns
// visible — so the full layout landed exactly on the terminal edge while every
// narrower layout was left up to 7 runes short of the width it had been given.
// Deriving it from the visible segments keeps the row the same width in every
// combination, and keeps a future eighth column from silently taking it over.
func (m PipelineModel) rowOverhead(c colWidths) int {
	segments := 4 // #, score, company, role — always rendered
	for _, w := range []int{c.status, c.date, c.loc, c.pay, c.rpt, c.pdf, c.last, c.posted} {
		if w > 0 {
			segments++
		}
	}
	const (
		leadingSpace = 1 // the " " prefixed before the join
		outerPadding = 4 // lipgloss Padding(0, 2) — two runes on each side
		// The score segment is budgeted c.score above but rendered unpadded, so
		// the budget gets the difference back. Measured against the DATA row,
		// where the score is always fmt.Sprintf("%.1f") — three runes. The
		// header uses the ColFit label instead, which is wider in some locales
		// ("UYUM", "AJUSTE"); that pre-existing header/row drift is not
		// something the role width can fix for both at once.
		renderedScoreWidth = 3
	)
	return (segments - 1) + leadingSpace + outerPadding - (c.score - renderedScoreWidth)
}

func (m PipelineModel) workModeColor(mode string) lipgloss.Color {
	switch mode {
	case "Remote":
		return m.theme.Green
	case "RemoteFlex":
		return m.theme.Sky
	case "Hybrid":
		return m.theme.Yellow
	case "Full":
		return m.theme.Red
	default:
		return m.theme.Subtext
	}
}

func (m PipelineModel) rowCellStyle(width int, color lipgloss.Color, selected bool) lipgloss.Style {
	style := lipgloss.NewStyle().Width(width)
	if color != "" {
		style = style.Foreground(color)
	}
	if selected {
		style = style.Background(m.theme.Overlay)
	}
	return style
}

func (m PipelineModel) renderLocCell(app model.CareerApplication, width int, selected bool) string {
	text := i18n.Current.WorkModeLabel(app.WorkMode)
	if app.Location != "" {
		if text != "" {
			text += " · " + app.Location
		} else {
			text = app.Location
		}
	}
	if text == "" {
		text = "—"
	}
	return m.rowCellStyle(width, m.workModeColor(app.WorkMode), selected).Render(truncateRunes(text, width))
}

func (m PipelineModel) renderCheckCell(yes bool, width int, selected bool) string {
	text := "—"
	color := m.theme.Subtext
	if yes {
		text = "✓"
		color = m.theme.Green
	}
	return m.rowCellStyle(width, color, selected).Render(text)
}

// postedAgeThresholds bound the POSTED column's colour bands, in days since the
// requisition went live. A req posted this week is plausibly still being worked;
// one open past a quarter is often a pipeline-filler or an abandoned listing.
const (
	postedFreshDays = 7
	postedWarmDays  = 30
	postedStaleDays = 90
)

// renderPostedCell shows how long a requisition has been open, colour-coded by
// age: green within a week, yellow within a month, peach within a quarter, red
// beyond. Rows whose notes carry no "posted <date>" render a subtle dash.
func (m PipelineModel) renderPostedCell(app model.CareerApplication, width int, selected bool) string {
	dash := m.rowCellStyle(width, m.theme.Subtext, selected).Render("—")
	if app.PostedOn == "" {
		return dash
	}
	// Local calendar days against the dashboard's own clock, the way
	// FormatTimeAgo counts them for the label in this same cell. time.Parse
	// read the date as UTC midnight and compared it with the real time.Now(),
	// so east of UTC a posting dated today was "in the future" until the UTC
	// date caught up, and got the dash meant for bad data, while its label
	// would have said "today".
	posted, err := time.ParseInLocation("2006-01-02", app.PostedOn, time.Local)
	if err != nil {
		return dash
	}
	now := i18n.NowFunc()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	// A requisition cannot have gone live in the future. Such a date is bad data
	// (a typo, or a provider field that isn't the posting date at all), and it
	// would otherwise read as the freshest possible req: a negative age lands in
	// the first case below and paints it green — the one colour that says "act
	// on this now".
	if posted.After(today) {
		return dash
	}
	days := int(math.Round(today.Sub(posted).Hours() / 24))
	color := m.theme.Red
	switch {
	case days <= postedFreshDays:
		color = m.theme.Green
	case days <= postedWarmDays:
		color = m.theme.Yellow
	case days <= postedStaleDays:
		color = m.theme.Peach
	}
	return m.rowCellStyle(width, color, selected).
		Render(truncateRunes(formatTimeAgo(app.PostedOn), width-1))
}

// renderPayCell prefers the pay range parsed from notes and falls back to the
// report-cache comp estimate (the pre-column behavior). POSTED bands render
// green; estimates stay yellow.
func (m PipelineModel) renderPayCell(app model.CareerApplication, width int, selected bool) string {
	text := app.PayRange
	color := m.theme.Yellow
	if app.PaySource == "POSTED" {
		color = m.theme.Green
	}
	if text == "" {
		if summary, ok := m.reportCache[app.ReportPath]; ok && summary.comp != "" {
			text = summary.comp
		}
	}
	if text == "" {
		return m.rowCellStyle(width, "", selected).Render("")
	}
	return m.rowCellStyle(width, color, selected).Render(truncateRunes(text, width-1))
}

// renderColumnHeader labels the table columns; widths mirror renderAppLine.
func (m PipelineModel) renderColumnHeader() string {
	cw := m.columnWidths()
	h := lipgloss.NewStyle().Foreground(m.theme.Subtext).Bold(true)
	cell := func(label string, width int) string {
		return h.Width(width).Render(truncateRunes(label, width))
	}

	segments := []string{
		cell("#", cw.num),
		h.Render(i18n.Current.ColFit), // score cell is unpadded, always 3 runes wide
	}
	if cw.date != 0 {
		segments = append(segments, cell(i18n.Current.ColDate, cw.date))
	}
	segments = append(segments, cell(i18n.Current.ColCompany, cw.company))
	segments = append(segments, cell(i18n.Current.ColRole, cw.role))
	if cw.status > 0 {
		segments = append(segments, cell(i18n.Current.ColStatus, cw.status))
	}
	if cw.loc > 0 {
		segments = append(segments, cell(i18n.Current.ColLocation, cw.loc))
	}
	if cw.pay > 0 {
		segments = append(segments, cell(i18n.Current.ColPay, cw.pay))
	}
	if cw.rpt > 0 {
		segments = append(segments, cell(i18n.Current.ColReport, cw.rpt))
	}
	if cw.pdf > 0 {
		segments = append(segments, cell(i18n.Current.ColPDF, cw.pdf))
	}
	if cw.last > 0 {
		segments = append(segments, cell(i18n.Current.ColContact, cw.last))
	}
	if cw.posted > 0 {
		segments = append(segments, cell(i18n.Current.ColPosted, cw.posted))
	}

	padStyle := lipgloss.NewStyle().Padding(0, 2).MaxWidth(max(1, m.width)).MaxHeight(1)
	return padStyle.Render(" " + strings.Join(segments, " "))
}

func (m PipelineModel) renderAppLine(app model.CareerApplication, selected bool) string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	cw := m.columnWidths()
	cellStyle := func(style lipgloss.Style) lipgloss.Style {
		if selected {
			return style.Background(m.theme.Overlay)
		}
		return style
	}
	separator := " "
	if selected {
		separator = lipgloss.NewStyle().Background(m.theme.Overlay).Render(" ")
	}

	// Tracker number (fixed width)
	numText := "#—"
	if app.Number > 0 {
		numText = fmt.Sprintf("#%d", app.Number)
	}
	numStyle := cellStyle(lipgloss.NewStyle().Foreground(m.theme.Blue).Bold(true).Width(cw.num))

	// Score with color. An unevaluated row carries no number: print the
	// sentinel rather than %.1f of a zero value, which reads as a 0.0 fit.
	scoreStyle := m.scoreStyle(app.Score)
	scoreText := fmt.Sprintf("%.1f", app.Score)
	if !app.HasScore {
		// Show the tracker's own sentinel (— / N/A / -). Fall back to an em
		// dash when the cell is empty or too wide for the score column.
		scoreStyle = lipgloss.NewStyle().Foreground(m.theme.Subtext)
		scoreText = strings.TrimSpace(app.ScoreRaw)
		if scoreText == "" || lipgloss.Width(scoreText) > 3 {
			scoreText = "\u2014"
		}
	}
	// Width(3) so the sentinel occupies the same column as "4.2" and the
	// row keeps its measured width.
	score := cellStyle(scoreStyle).Width(3).Render(scoreText)

	// Company and role are measured in terminal cells. A rune count leaves a
	// wide character wider than the column, and the row wraps under MaxHeight(1).
	company := truncateCells(app.Company, cw.company)
	companyStyle := cellStyle(lipgloss.NewStyle().Foreground(m.theme.Text).Width(cw.company))

	// Listing date when known; processed date as fallback.
	dateText := dashboardDate(app)
	if dateText == "" {
		dateText = "—"
	}
	dateStyle := cellStyle(lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(cw.date))

	// Role (truncate)
	role := truncateCells(app.Role, cw.role)
	roleStyle := cellStyle(lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(cw.role))

	// Status with color -- fixed column
	norm := data.NormalizeStatus(app.Status)
	statusColor := m.statusColorMap()[norm]
	statusStyle := cellStyle(lipgloss.NewStyle().Foreground(statusColor).Width(cw.status))
	statusText := statusStyle.Render(truncateRunes(statusLabel(norm), cw.status))

	segments := []string{
		numStyle.Render(truncateRunes(numText, cw.num)),
		score,
	}
	if cw.date > 0 {
		segments = append(segments, dateStyle.Render(truncateRunes(dateText, cw.date)))
	}
	segments = append(segments, companyStyle.Render(company))
	segments = append(segments, roleStyle.Render(role))
	if cw.status > 0 {
		segments = append(segments, statusText)
	}

	if cw.loc > 0 {
		segments = append(segments, m.renderLocCell(app, cw.loc, selected))
	}
	if cw.pay > 0 {
		segments = append(segments, m.renderPayCell(app, cw.pay, selected))
	}
	if cw.rpt > 0 {
		segments = append(segments, m.renderCheckCell(app.ReportPath != "", cw.rpt, selected))
	}
	if cw.pdf > 0 {
		segments = append(segments, m.renderCheckCell(app.HasPDF, cw.pdf, selected))
	}
	if cw.last > 0 {
		lastText := "—"
		if app.LastContact != "" {
			lastText = formatTimeAgo(app.LastContact)
		}
		lastStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(cw.last)
		if app.LastContact != "" && app.LastContact != app.Date {
			lastStyle = lastStyle.Foreground(m.theme.Text)
		}
		lastStyle = cellStyle(lastStyle)
		segments = append(segments, lastStyle.Render(truncateRunes(lastText, cw.last)))
	}
	if cw.posted > 0 {
		segments = append(segments, m.renderPostedCell(app, cw.posted, selected))
	}

	// MaxWidth/MaxHeight keep the row on one line if a cell ever outgrows the
	// fitted column widths; the selected row's fill stops at the terminal edge.
	padStyle = padStyle.MaxWidth(max(1, m.width)).MaxHeight(1)
	if selected {
		line := separator + strings.Join(segments, separator)
		if fill := m.width - 4 - lipgloss.Width(line); fill > 0 {
			line += lipgloss.NewStyle().Background(m.theme.Overlay).Render(strings.Repeat(" ", fill))
		}
		return padStyle.Render(line)
	}
	line := " " + strings.Join(segments, " ")
	return padStyle.Render(line)
}

func dashboardDate(app model.CareerApplication) string {
	if app.ListingDate != "" {
		return app.ListingDate
	}
	return app.Date
}

// renderPreview renders the selected application's details within the current terminal width.
// @param None.
// @returns The newline-separated preview.
func (m PipelineModel) renderPreview() string {
	app, ok := m.CurrentApp()
	if !ok {
		return ""
	}

	padStyle := lipgloss.NewStyle().Padding(0, 2).MaxWidth(max(1, m.width)).MaxHeight(1)
	divider := lipgloss.NewStyle().Foreground(m.theme.Overlay)

	var lines []string
	dashes := m.width - 4
	if dashes < 0 {
		dashes = 0
	}
	lines = append(lines, padStyle.Render(divider.Render(strings.Repeat("─", dashes))))

	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Sky).Bold(true)
	valueStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	// Quick facts derived from notes — available even when there is no report,
	// and the only place narrow terminals see location/pay/last-contact.
	var facts []string
	if app.WorkMode != "" || app.Location != "" {
		loc := i18n.Current.WorkModeLabel(app.WorkMode)
		if app.Location != "" {
			if loc != "" {
				loc += " · " + app.Location
			} else {
				loc = app.Location
			}
		}
		facts = append(facts, labelStyle.Render(i18n.Current.LabelLoc)+valueStyle.Render(loc))
	}
	if app.PayRange != "" {
		pay := app.PayRange
		if app.PaySource != "" {
			pay += " (" + app.PaySource + ")"
		}
		facts = append(facts, labelStyle.Render(i18n.Current.LabelPay)+valueStyle.Render(pay))
	}
	if app.LastContact != "" {
		facts = append(facts, labelStyle.Render(i18n.Current.LabelLast)+
			valueStyle.Render(fmt.Sprintf("%s (%s)", app.LastContact, formatTimeAgo(app.LastContact))))
	}
	if len(facts) > 0 {
		lines = append(lines, padStyle.Render(strings.Join(facts, "   ")))
	}

	outcome := previewOutcome(app)

	// Check report cache
	if summary, ok := m.reportCache[app.ReportPath]; ok {
		if summary.archetype != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Archetype: ")+valueStyle.Render(summary.archetype)))
		}
		if summary.tldr != "" {
			label := "TL;DR: "
			value := summary.tldr
			valueWidth := max(0, m.width-4-ansi.StringWidth(label))
			if ansi.StringWidth(value) > valueWidth {
				if valueWidth <= ansi.StringWidth("...") {
					value = ansi.Truncate(value, valueWidth, "")
				} else {
					value = ansi.Truncate(value, valueWidth, "...")
				}
			}
			lines = append(lines, padStyle.Render(
				labelStyle.Render(label)+valueStyle.Render(value)))
		}
		if summary.comp != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Comp: ")+valueStyle.Render(summary.comp)))
		}
		if summary.remote != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render(i18n.Current.LabelRemote)+valueStyle.Render(summary.remote)))
		}
	} else if app.Notes != "" && outcome == "" {
		// Fallback: show notes (the outcome line below already carries them)
		notes := truncateRunes(app.Notes, m.width-10)
		lines = append(lines, padStyle.Render(dimStyle.Render(notes)))
	} else if outcome == "" {
		lines = append(lines, padStyle.Render(dimStyle.Render(i18n.Current.LoadingPreview)))
	}

	// Closed-out postings: surface what happened as the last preview line.
	// The notes-only fallback above disappears once a report summary is
	// cached, which is exactly when the discard reason got lost (#787).
	if outcome != "" {
		// Width budget: 4 cols padding + 9 for the i18n.Current.LabelOutcome label + slack,
		// mirroring the m.width-10 budget of the notes fallback above.
		lines = append(lines, padStyle.Render(
			labelStyle.Render(i18n.Current.LabelOutcome)+valueStyle.Render(truncateRunes(outcome, m.width-14))))
	}

	return strings.Join(lines, "\n")
}

// previewOutcome returns "what happened" to a closed-out application — the raw
// status (which often carries the decision date, e.g. "descartado 2026-03-12")
// plus the tracker notes holding the reason. Returns "" for apps still in play.
func previewOutcome(app model.CareerApplication) string {
	switch data.NormalizeStatus(app.Status) {
	case "discarded", "skip", "rejected", "closed":
	default:
		return ""
	}
	outcome := strings.TrimSpace(strings.ReplaceAll(app.Status, "**", ""))
	if app.Notes != "" {
		outcome += " — " + app.Notes
	}
	return outcome
}

// sanitizeFlash neutralizes control characters in the flash line.
//
// Every flash reaches the terminal through the single lipgloss.Render below,
// and lipgloss wraps the string it is given without escaping it. Most of what
// the flash line carries is not the program's own words: a tracker URL or a
// manifest path read out of a file, or the last line a failed child process
// printed. A control byte in any of those reaches the terminal as an
// instruction rather than as text, which is how a cell that renders correctly
// everywhere else can still move the cursor or repaint the help bar.
//
// The range is the one tracker-utils.mjs strips at the tracker write path
// (CONTROL_CHARS, #3892): C0, DEL and C1. It differs deliberately in one
// respect. cell() keeps \t, \r and \n because it has already folded them to a
// space and dropping them there would glue words together; the help bar is a
// single line, so they are folded to a space here instead of being kept.
//
// Stripping at the write path stops new bytes entering the tracker. It cannot
// speak for a report header, a scan TSV, or a child process's stderr, none of
// which pass through cell() -- and the flash renders all three.
//
// Text from those sources need not be valid UTF-8. strings.Map hands the
// mapping function utf8.RuneError for a byte it cannot decode and writes
// U+FFFD, so a raw 0x9b -- the byte an 8-bit terminal reads as CSI -- is
// replaced rather than passed through. That is the property the guard needs;
// it shows as a replacement character rather than disappearing, which is the
// honest rendering of a byte nothing can decode.
func sanitizeFlash(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == '\t' || r == '\n' || r == '\r':
			return ' '
		case r < 0x20, r == 0x7f, r >= 0x80 && r <= 0x9f:
			return -1
		}
		return r
	}, s)
}

func (m PipelineModel) renderHelp() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	budget := m.width - 2
	if budget < 1 {
		budget = 1
	}

	if m.flash != "" {
		flashStyle := lipgloss.NewStyle().
			Foreground(m.theme.Yellow).
			Background(m.theme.Surface).
			Padding(0, 1)
		return oneLine(m.width, flashStyle, fitPlain(budget, sanitizeFlash(m.flash)))
	}

	piece := func(key, desc string, pin bool) helpPiece {
		return helpPiece{text: keyStyle.Render(key) + descStyle.Render(desc), pin: pin}
	}

	// The key list takes q and Esc as "close", so the footer must not offer
	// q as quit while it is open.
	if m.keysHelp {
		return oneLine(m.width, style, joinHelp(budget, []helpPiece{
			piece("↑↓/jk", i18n.Current.HelpScroll, false),
			piece("q/Esc/?", i18n.Current.HelpClose, true),
		}, "", ""))
	}

	if m.colPicker {
		return oneLine(m.width, style, joinHelp(budget, []helpPiece{
			piece("↑↓/jk", i18n.Current.HelpNavigate, false),
			piece("SPACE", i18n.Current.HelpToggle, false),
			piece("Esc/C", i18n.Current.HelpClose, true),
		}, "", ""))
	}

	if m.statusPicker || m.pdfPicker {
		return oneLine(m.width, style, joinHelp(budget, []helpPiece{
			piece("↑↓/jk", i18n.Current.HelpNavigate, false),
			piece("Enter", i18n.Current.HelpConfirm, false),
			piece("Esc", i18n.Current.HelpCancel, true),
		}, "", ""))
	}

	if m.searchInput {
		return oneLine(m.width, style, joinHelp(budget, []helpPiece{
			piece("type", i18n.Current.HelpFilterLive, false),
			piece("Enter", i18n.Current.HelpKeep, false),
			piece("Ctrl+U", i18n.Current.HelpClear, false),
			piece("Esc", i18n.Current.HelpCancel, true),
		}, "", ""))
	}

	// The manifesto segment is an OSC 8 hyperlink (utm_source=dashboard);
	// terminals without support show the same text, just not clickable. The
	// gap math uses the plain text so the escapes never skew the layout.
	manifestoLink := "\x1b]8;;https://career-ops.org/manifesto?utm_source=dashboard\x1b\\built on the CareerOps Manifesto\x1b]8;;\x1b\\"
	brand := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render(manifestoLink + " · career-ops by santifer.io")

	const brandPlain = "built on the CareerOps Manifesto · career-ops by santifer.io"

	pieces := []helpPiece{
		piece("↑↓/jk", i18n.Current.HelpNav, false),
		piece("←→/hl", i18n.Current.HelpTabs, false),
		piece("/", i18n.Current.HelpSearch, false),
		piece("s", i18n.Current.HelpSort, false),
		piece("r", i18n.Current.HelpRefresh, false),
		piece("Enter", i18n.Current.HelpReport, false),
		piece("o", i18n.Current.HelpOpenURL, false),
		piece("d", i18n.Current.HelpOpenPDF, false),
		piece("c", i18n.Current.HelpChange, false),
		piece("y", i18n.Current.HelpCopyPDF, false),
		piece("D", i18n.Current.HelpRegenPDF, false),
		piece("C", i18n.Current.HelpColumns, false),
		piece("p", i18n.Current.HelpProgress, false),
		piece("S", i18n.Current.HelpStats, false),
		piece("t", i18n.Current.HelpLanguage, false),
		piece("m", i18n.Current.HelpManifesto, false),
		piece("g/G", i18n.Current.HelpTopEnd, false),
		piece("?", i18n.Current.HelpKeys, true),
		piece("q", i18n.Current.HelpQuit, true),
	}
	pinWidth := 0
	for _, p := range pieces {
		if p.pin {
			pinWidth += lipgloss.Width(p.text)
		}
	}

	// The active sort sits on the right, followed by the brand when there is
	// room. Keys give way to the sort label, but never the ? and q pins.
	sortPlain := "Sort: " + i18n.Current.SortModeLabel(m.sortMode)
	sortInfo := descStyle.Render("Sort: ") + keyStyle.Render(i18n.Current.SortModeLabel(m.sortMode))
	keyBudget := budget - lipgloss.Width(sortPlain) - 1
	if keyBudget < pinWidth {
		return oneLine(m.width, style, joinHelp(budget, pieces, "", ""))
	}
	keys := joinHelp(keyBudget, pieces, "", "")
	used := lipgloss.Width(keys)
	right := sortInfo
	rightWidth := lipgloss.Width(sortPlain)
	if withBrand := rightWidth + 2 + lipgloss.Width(brandPlain); used+1+withBrand <= budget {
		right = sortInfo + descStyle.Render("  ") + brand
		rightWidth = withBrand
	}
	gap := budget - used - rightWidth
	if gap < 1 {
		gap = 1
	}
	return oneLine(m.width, style, keys+strings.Repeat(" ", gap)+right)
}

// renderKeysHelp draws the bindings the footer had to drop. Two columns once
// the terminal is wide enough that a single column would waste the row.
func (m PipelineModel) renderKeysHelp(maxLines int) string {
	type kv struct{ key, desc string }
	items := []kv{
		{"↑↓/jk", strings.TrimSpace(i18n.Current.HelpNav)},
		{"←→/hl", strings.TrimSpace(i18n.Current.HelpTabs)},
		{"/", strings.TrimSpace(i18n.Current.HelpSearch)},
		{"s", strings.TrimSpace(i18n.Current.HelpSort)},
		{"r", strings.TrimSpace(i18n.Current.HelpRefresh)},
		{"Enter", strings.TrimSpace(i18n.Current.HelpReport)},
		{"o", strings.TrimSpace(i18n.Current.HelpOpenURL)},
		{"d", strings.TrimSpace(i18n.Current.HelpOpenPDF)},
		{"y", strings.TrimSpace(i18n.Current.HelpCopyPDF)},
		{"D", strings.TrimSpace(i18n.Current.HelpRegenPDF)},
		{"c", strings.TrimSpace(i18n.Current.HelpChange)},
		{"C", strings.TrimSpace(i18n.Current.HelpColumns)},
		{"p", strings.TrimSpace(i18n.Current.HelpProgress)},
		{"S", strings.TrimSpace(i18n.Current.HelpStats)},
		{"t", strings.TrimSpace(i18n.Current.HelpLanguage)},
		{"m", strings.TrimSpace(i18n.Current.HelpManifesto)},
		{"g/G", strings.TrimSpace(i18n.Current.HelpTopEnd)},
		{"?", strings.TrimSpace(i18n.Current.HelpKeys)},
		{"q", strings.TrimSpace(i18n.Current.HelpQuit)},
	}
	pad := lipgloss.NewStyle().Padding(0, 2).MaxWidth(max(1, m.width)).MaxHeight(1)
	var rows []string
	if m.width >= 56 {
		colW := (m.width - 4) / 2
		if colW < 8 {
			colW = 8
		}
		for i := 0; i < len(items); i += 2 {
			left := fitPlain(colW, items[i].key+"  "+items[i].desc)
			line := left
			if i+1 < len(items) {
				right := fitPlain(colW, items[i+1].key+"  "+items[i+1].desc)
				gap := colW - lipgloss.Width(left)
				if gap < 1 {
					gap = 1
				}
				line += strings.Repeat(" ", gap) + right
			}
			rows = append(rows, pad.Render(line))
		}
	} else {
		budget := m.width - 4
		if budget < 1 {
			budget = 1
		}
		for _, it := range items {
			rows = append(rows, pad.Render(fitPlain(budget, it.key+"  "+it.desc)))
		}
	}
	if maxLines < 1 {
		maxLines = 1
	}
	start := m.keysHelpOffset
	if start < 0 {
		start = 0
	}
	if len(rows) > maxLines && start > len(rows)-maxLines {
		start = len(rows) - maxLines
	}
	if start > len(rows) {
		start = 0
	}
	end := start + maxLines
	if end > len(rows) {
		end = len(rows)
	}
	return strings.Join(rows[start:end], "\n")
}

func (m PipelineModel) overlayStatusPicker(body string) string {
	// Render status picker inline at bottom of body
	bodyLines := strings.Split(body, "\n")

	pickerWidth := 30
	padStyle := lipgloss.NewStyle().Padding(0, 2).MaxWidth(max(1, m.width)).MaxHeight(1)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Blue).
		Bold(true)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render(i18n.Current.PickerChangeStatus)))

	for i, pair := range m.currentStatusPairs() {
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.statusCursor {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		prefix := "  "
		if i == m.statusCursor {
			prefix = " >"
		}
		picker = append(picker, padStyle.Render(prefix+style.Render(pair.Display)))
	}

	// Append picker to body
	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

func (m PipelineModel) overlayHiredFlow() string {
	borderStyle := lipgloss.NewStyle().
		Border(lipgloss.DoubleBorder()).
		BorderForeground(m.theme.Blue).
		Padding(1, 2)

	var winContent string
	switch m.hiredStep {
	case 1:
		winContent = lipgloss.JoinVertical(lipgloss.Center,
			lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true).Render("🎉 CONGRATULATIONS! 🎉"),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Text).Render("You landed the job!"),
			lipgloss.NewStyle().Foreground(m.theme.Text).Render(fmt.Sprintf("%s @ %s", m.hiredApp.Role, m.hiredApp.Company)),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Subtext).Render("This moment belongs entirely to you. Celebrate the win!"),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Blue).Render("Press [ Enter ] to continue..."),
		)
	case 2:
		winContent = lipgloss.JoinVertical(lipgloss.Center,
			lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true).Render("Share your story? 🚀"),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Text).Render("We'd love to hear your story on GitHub!"),
			lipgloss.NewStyle().Foreground(m.theme.Text).Render("Your story helps others in the community see what's possible."),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Blue).Render("Press [ Y ] to open template in browser / [ N ] to skip"),
		)
	case 3:
		weeks := m.calculateWeeksToHire()
		winContent = lipgloss.JoinVertical(lipgloss.Center,
			lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true).Render("Opt-in Anonymous Stat? 📊"),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Text).Render("Help us count community hires in the public README:"),
			lipgloss.NewStyle().Foreground(m.theme.Subtext).Render(fmt.Sprintf("- Role: %s", m.hiredApp.Role)),
			lipgloss.NewStyle().Foreground(m.theme.Subtext).Render(fmt.Sprintf("- Weeks to hire: %d", weeks)),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Text).Render("No names, no companies, and no salaries are shared."),
			"",
			lipgloss.NewStyle().Foreground(m.theme.Blue).Render("Press [ Y ] to opt-in / [ N ] to keep completely local"),
		)
	}

	box := borderStyle.Render(winContent)
	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, box)
}

// overlayPDFPicker renders the PDF chooser inline at the bottom of the body,
// mirroring overlayStatusPicker. Choices show the PDF filename only — the
// directory is always output/ and the role variant lives in the name.
func (m PipelineModel) overlayPDFPicker(body string) string {
	bodyLines := strings.Split(body, "\n")

	pickerWidth := m.width - 8
	if pickerWidth < 30 {
		pickerWidth = 30
	}
	padStyle := lipgloss.NewStyle().Padding(0, 2).MaxWidth(max(1, m.width)).MaxHeight(1)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Blue).
		Bold(true)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render("Open CV PDF:")))

	for i, choice := range m.pdfChoices {
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.pdfCursor {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		prefix := "  "
		if i == m.pdfCursor {
			prefix = "> "
		}
		name := truncateRunes(filepath.Base(filepath.FromSlash(choice)), pickerWidth-2)
		picker = append(picker, padStyle.Render(style.Render(prefix+name)))
	}

	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

// overlayColPicker renders the column visibility picker inline at the bottom
// of the body. SPACE toggles the focused column; ESC or C closes.
func (m PipelineModel) overlayColPicker(body string) string {
	bodyLines := strings.Split(body, "\n")
	pickerWidth := 36
	padStyle := lipgloss.NewStyle().Padding(0, 2).MaxWidth(max(1, m.width)).MaxHeight(1)
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Blue).Bold(true)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render(i18n.Current.PickerColumnsTitle)))

	for i, col := range getOptionalCols() {
		on := m.visibleCols[col.id]
		check := "[ ]"
		checkColor := m.theme.Subtext
		if on {
			check = "[✓]"
			checkColor = m.theme.Green
		}
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.colPickerIdx {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		checkStr := lipgloss.NewStyle().Foreground(checkColor).Render(check)
		label := col.header
		if col.hint != "" {
			label += "  " + dimStyle.Render(col.hint)
		}
		row := checkStr + " " + label
		picker = append(picker, padStyle.Render(style.Render(row)))
	}

	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

// -- Helpers --

func (m PipelineModel) scoreStyle(score float64) lipgloss.Style {
	switch {
	case score >= 4.2:
		return lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true)
	case score >= 3.8:
		return lipgloss.NewStyle().Foreground(m.theme.Yellow)
	case score >= 3.0:
		return lipgloss.NewStyle().Foreground(m.theme.Text)
	default:
		return lipgloss.NewStyle().Foreground(m.theme.Red)
	}
}

func (m PipelineModel) statusColorMap() map[string]lipgloss.Color {
	return map[string]lipgloss.Color{
		"hired":      m.theme.Green, // terminal success — never uncoloured (default) like an unknown status
		"interview":  m.theme.Green,
		"offer":      m.theme.Green,
		"applied":    m.theme.Sky,
		"responded":  m.theme.Blue,
		"evaluated":  m.theme.Text,
		"skip":       m.theme.Red,
		"rejected":   m.theme.Subtext,
		"closed":     m.theme.Subtext,
		"discarded":  m.theme.Subtext,
		"assessment": m.theme.Mauve,
	}
}

// formatTimeAgo renders an ISO date as a relative duration in calendar days:
// i18n.Current.TimeToday, i18n.Current.TimeYesterday, or "Nd ago". Tracker dates are day-granular (no
// time-of-day), so we never report sub-day hours — doing so would fabricate
// precision the data doesn't have (e.g. an entry dated today would otherwise
// read "13h ago" simply because it's 1pm, not because contact was 13h back).
func formatTimeAgo(dateStr string) string {
	return i18n.Current.FormatTimeAgo(dateStr)
}

// truncateCells cuts s to width terminal cells. Wide characters count as two.
func truncateCells(s string, width int) string {
	if width <= 0 {
		return ""
	}
	return ansi.Truncate(s, width, "...")
}

// truncateRunes truncates a string to at most maxRunes runes, appending "..." if truncated.
func truncateRunes(s string, maxRunes int) string {
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	if maxRunes <= 3 {
		return string(runes[:maxRunes])
	}
	return string(runes[:maxRunes-3]) + "..."
}

func statusLabel(norm string) string {
	return i18n.Current.StatusLabel(norm)
}

// overlayDiscardPicker renders the discard reason picker inline at the bottom
// of the body (Issue 1380). Predicted reasons (from the report) are listed
// first, followed by the canonical fallback options, with an "Other…" entry
// that switches to free-text input when selected.
func (m PipelineModel) overlayDiscardPicker(body string) string {
	bodyLines := strings.Split(body, "\n")

	pickerWidth := m.width - 8
	if pickerWidth < 36 {
		pickerWidth = 36
	}
	padStyle := lipgloss.NewStyle().Padding(0, 2).MaxWidth(max(1, m.width)).MaxHeight(1)
	titleStyle := lipgloss.NewStyle().Foreground(m.theme.Blue).Bold(true)
	hintStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	inputStyle := lipgloss.NewStyle().Foreground(m.theme.Yellow).Bold(true)

	var picker []string

	if m.discardCustomInput {
		// Free-text sub-mode
		picker = append(picker, padStyle.Render(titleStyle.Render("─── Reason (type + Enter) ───────────────")))
		cursor := lipgloss.NewStyle().Foreground(m.theme.Blue).Render("█")
		// Show the end of a long reason so the text being typed and the cursor
		// stay on screen. Room is the row minus padding, "> ", and the cursor.
		typed := m.discardCustomText
		if room := m.width - 4 - 2 - 1; room > 0 {
			if w := ansi.StringWidth(typed); w > room {
				typed = lastCells(typed, w, room)
			}
		}
		picker = append(picker, padStyle.Render(inputStyle.Render("> "+typed+cursor)))
		picker = append(picker, padStyle.Render(hintStyle.Render("Enter: confirm   Esc: back")))
	} else {
		numPredicted := m.discardPredictedCount

		heading := "─── Discard reason (↑↓ navigate · Enter confirm · Esc skip) ─"
		picker = append(picker, padStyle.Render(titleStyle.Render(heading)))
		if numPredicted > 0 {
			picker = append(picker, padStyle.Render(hintStyle.Render("  ★ Predicted by agent:")))
		}
		for i, opt := range m.discardOptions {
			if i == numPredicted && numPredicted > 0 {
				picker = append(picker, padStyle.Render(hintStyle.Render("  ── Other options:")))
			}
			style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
			if i == m.discardCursor {
				style = style.Background(m.theme.Overlay).Bold(true)
			}
			prefix := "  "
			if i == m.discardCursor {
				prefix = "> "
			}
			label := opt
			if i < numPredicted {
				label = "★ " + opt
			}
			// A label wider than the row would wrap, and MaxHeight(1) would keep
			// only its first line. Cut it to the row instead.
			label = ansi.Truncate(label, max(1, pickerWidth-2), "...")
			picker = append(picker, padStyle.Render(style.Render(prefix+label)))
		}
	}

	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}
