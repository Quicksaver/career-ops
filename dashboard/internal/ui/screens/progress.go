package screens

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/i18n"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// ProgressClosedMsg is emitted when the progress screen is dismissed.
type ProgressClosedMsg struct{}

// ProgressModel implements the progress analytics screen.
type ProgressModel struct {
	metrics      model.ProgressMetrics
	scrollOffset int
	width        int
	height       int
	theme        theme.Theme
}

// NewProgressModel creates a new progress screen.
func NewProgressModel(t theme.Theme, metrics model.ProgressMetrics, width, height int) ProgressModel {
	return ProgressModel{
		metrics: metrics,
		width:   width,
		height:  height,
		theme:   t,
	}
}

// Init implements tea.Model.
func (m ProgressModel) Init() tea.Cmd {
	return nil
}

// Resize updates dimensions.
func (m *ProgressModel) Resize(width, height int) {
	m.width = width
	m.height = height
}

// Update handles input for the progress screen.
func (m ProgressModel) Update(msg tea.Msg) (ProgressModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc":
			return m, func() tea.Msg { return ProgressClosedMsg{} }
		case "down", "j":
			m.scrollOffset++
		case "up", "k":
			if m.scrollOffset > 0 {
				m.scrollOffset--
			}
		case "pgdown", "ctrl+d":
			m.scrollOffset += m.height / 2
		case "pgup", "ctrl+u":
			m.scrollOffset -= m.height / 2
			if m.scrollOffset < 0 {
				m.scrollOffset = 0
			}
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

// View renders the progress screen.
func (m ProgressModel) View() string {
	header := m.renderHeader()
	funnel := m.renderFunnel()
	scores := m.renderScoreDistribution()
	rates := m.renderRates()
	weekly := m.renderWeeklyActivity()
	help := m.renderHelp()

	// Combine panels
	body := lipgloss.JoinVertical(lipgloss.Left,
		funnel,
		"",
		scores,
		"",
		rates,
		"",
		weekly,
	)

	// Apply scroll
	bodyLines := strings.Split(body, "\n")
	offset := m.scrollOffset
	if offset >= len(bodyLines) {
		offset = len(bodyLines) - 1
	}
	if offset < 0 {
		offset = 0
	}
	if offset > 0 {
		bodyLines = bodyLines[offset:]
	}

	// Clamp to available height
	availHeight := m.height - 4 // header + help + padding
	if availHeight < 3 {
		availHeight = 3
	}
	if len(bodyLines) > availHeight {
		bodyLines = bodyLines[:availHeight]
	}

	body = strings.Join(bodyLines, "\n")

	return lipgloss.JoinVertical(lipgloss.Left, header, body, help)
}

func (m ProgressModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Padding(0, 2)

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Mauve).Render(i18n.Current.ProgressTitle)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	total := len(m.metrics.FunnelStages)
	totalCount := 0
	if total > 0 {
		totalCount = m.metrics.FunnelStages[0].Count
	}
	info := right.Render(fmt.Sprintf(i18n.Current.ProgressSummary, totalCount, avgScoreLabel(m.metrics.AvgScore)))
	return oneLine(m.width, style, fitTitleBar(m.width, title, info))
}

func (m ProgressModel) renderFunnel() string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	sectionTitle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Sky)

	var lines []string
	lines = append(lines, padStyle.Render(sectionTitle.Render(i18n.Current.FunnelTitle)))

	if len(m.metrics.FunnelStages) == 0 {
		dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
		lines = append(lines, padStyle.Render(dimStyle.Render(i18n.Current.NoData)))
		return strings.Join(lines, "\n")
	}

	// Find max count for bar scaling
	maxCount := 0
	for _, s := range m.metrics.FunnelStages {
		if s.Count > maxCount {
			maxCount = s.Count
		}
	}

	labelW := 10
	barMaxW := m.width - labelW - 20 // room for label, count, pct
	if barMaxW < 10 {
		barMaxW = 10
	}

	// Colors for funnel stages (gradient from cool to warm)
	stageColors := []lipgloss.Color{
		m.theme.Blue,
		m.theme.Sky,
		m.theme.Green,
		m.theme.Yellow,
		m.theme.Peach,
	}

	for i, stage := range m.metrics.FunnelStages {
		barW := 0
		if maxCount > 0 {
			barW = stage.Count * barMaxW / maxCount
		}
		if barW < 1 && stage.Count > 0 {
			barW = 1
		}

		color := m.theme.Text
		if i < len(stageColors) {
			color = stageColors[i]
		}

		barStyle := lipgloss.NewStyle().Foreground(color)
		labelStyle := lipgloss.NewStyle().Foreground(m.theme.Text).Width(labelW)
		countStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

		bar := barStyle.Render(strings.Repeat("\u2588", barW))
		label := labelStyle.Render(stage.Label)

		pctStr := ""
		// Same denominator, same rule as the rates below: safePct returns 0 when
		// nothing was applied, so " (0%)" beside every stage would be reporting a
		// share that was never computed. With no denominator the count alone is
		// the honest answer.
		if i > 0 && m.metrics.RatesDenominator > 0 {
			pctStr = fmt.Sprintf(" (%.0f%%)", stage.Pct)
		}
		count := countStyle.Render(fmt.Sprintf("  %d%s", stage.Count, pctStr))

		lines = append(lines, padStyle.Render(label+bar+count))
	}

	return strings.Join(lines, "\n")
}

func (m ProgressModel) renderScoreDistribution() string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	sectionTitle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Sky)

	var lines []string
	lines = append(lines, padStyle.Render(sectionTitle.Render(i18n.Current.ScoresTitle)))

	if len(m.metrics.ScoreBuckets) == 0 {
		dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
		lines = append(lines, padStyle.Render(dimStyle.Render(i18n.Current.NoData)))
		return strings.Join(lines, "\n")
	}

	// Find max count for bar scaling
	maxCount := 0
	for _, b := range m.metrics.ScoreBuckets {
		if b.Count > maxCount {
			maxCount = b.Count
		}
	}

	labelW := 8
	barMaxW := m.width - labelW - 14
	if barMaxW < 10 {
		barMaxW = 10
	}

	// Colors for score ranges (green to red)
	bucketColors := []lipgloss.Color{
		m.theme.Green,
		m.theme.Green,
		m.theme.Yellow,
		m.theme.Peach,
		m.theme.Red,
	}

	for i, bucket := range m.metrics.ScoreBuckets {
		barW := 0
		if maxCount > 0 {
			barW = bucket.Count * barMaxW / maxCount
		}
		if barW < 1 && bucket.Count > 0 {
			barW = 1
		}

		color := m.theme.Text
		if i < len(bucketColors) {
			color = bucketColors[i]
		}

		barStyle := lipgloss.NewStyle().Foreground(color)
		labelStyle := lipgloss.NewStyle().Foreground(m.theme.Text).Width(labelW)
		countStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

		bar := barStyle.Render(strings.Repeat("\u2588", barW))
		label := labelStyle.Render(bucket.Label)
		count := countStyle.Render(fmt.Sprintf("  %d", bucket.Count))

		lines = append(lines, padStyle.Render(label+bar+count))
	}

	return strings.Join(lines, "\n")
}

// rateUnavailable stands in for a rate with nothing to divide by. An em dash
// rather than "0.0%" or "n/a": it reads as "not measured yet" and cannot be
// mistaken for a measurement, which is the whole point.
const rateUnavailable = "   —  "

func (m ProgressModel) renderRates() string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	sectionTitle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Sky)

	var lines []string
	lines = append(lines, padStyle.Render(sectionTitle.Render(i18n.Current.RatesTitle)))

	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	valueStyle := lipgloss.NewStyle().Bold(true)
	sepStyle := lipgloss.NewStyle().Foreground(m.theme.Overlay)

	sep := sepStyle.Render("  |  ")

	// Nothing applied means the three rates were never computed, so they are
	// ABSENT rather than 0%. Printing the zero value put the user's search in
	// the worst colour band before they had sent a single application; the em
	// dash says "not yet" where "0.0%" said "failing". Same rule as
	// rateOrNull() on the web side, which gates each rate on the count it was
	// taken over rather than on its own value.
	renderRate := func(label string, rate float64) string {
		if m.metrics.RatesDenominator == 0 {
			return labelStyle.Render(label) +
				valueStyle.Foreground(m.theme.Overlay).Render(rateUnavailable)
		}
		return labelStyle.Render(label) +
			valueStyle.Foreground(m.rateColor(rate)).Render(fmt.Sprintf("%.1f%%", rate))
	}

	rates := renderRate(i18n.Current.RateResponse, m.metrics.ResponseRate) +
		sep +
		renderRate(i18n.Current.RateInterview, m.metrics.InterviewRate) +
		sep +
		renderRate(i18n.Current.RateOffer, m.metrics.OfferRate)

	lines = append(lines, padStyle.Render(rates))

	// Active summary
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	activeInfo := dimStyle.Render(fmt.Sprintf(
		i18n.Current.ActiveInfo,
		m.metrics.ActiveApps, m.metrics.TotalOffers,
	))
	lines = append(lines, padStyle.Render(activeInfo))

	return strings.Join(lines, "\n")
}

func (m ProgressModel) renderWeeklyActivity() string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	sectionTitle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Sky)

	var lines []string
	lines = append(lines, padStyle.Render(sectionTitle.Render(i18n.Current.WeeklyTitle)))

	if len(m.metrics.WeeklyActivity) == 0 {
		dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
		lines = append(lines, padStyle.Render(dimStyle.Render(i18n.Current.NoData)))
		return strings.Join(lines, "\n")
	}

	// Each week's bar is stacked by the statuses rows were added with or moved
	// to that week, in pipeline tab order, and followed by the total and a
	// "6 open \u00b7 2 applied" breakdown.
	colors := statusColors(m.theme)
	type part struct {
		status string
		count  int
	}
	weeks := make([][]part, len(m.metrics.WeeklyActivity))
	breakdowns := make([]string, len(m.metrics.WeeklyActivity))
	maxCount, breakdownW := 0, 0
	for i, week := range m.metrics.WeeklyActivity {
		maxCount = max(maxCount, week.Count)
		byStatus := map[string]int{}
		for status, n := range week.ByStatus {
			if _, known := colors[status]; !known {
				status = filterOther
			}
			byStatus[status] += n
		}
		var texts []string
		for _, tab := range getPipelineTabs() {
			n := byStatus[tab.filter]
			if n == 0 {
				continue
			}
			weeks[i] = append(weeks[i], part{tab.filter, n})
			texts = append(texts, lipgloss.NewStyle().Foreground(m.weekColor(colors, tab.filter)).
				Render(fmt.Sprintf("%d %s", n, strings.ToLower(tab.label))))
		}
		breakdowns[i] = strings.Join(texts, lipgloss.NewStyle().Foreground(m.theme.Overlay).Render(" \u00b7 "))
		breakdownW = max(breakdownW, lipgloss.Width(breakdowns[i]))
	}

	labelW := 13 // "28/07–03/08" plus a gap
	countW := len(fmt.Sprint(maxCount)) + 2
	// The bar keeps at least 10 cells; a breakdown that no longer fits is
	// clipped at the terminal edge rather than wrapped.
	barMaxW := max(10, m.width-4-labelW-countW-2-breakdownW)
	lineStyle := padStyle.MaxWidth(max(1, m.width)).MaxHeight(1)
	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(labelW)
	countStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(countW).Align(lipgloss.Right)

	for i, week := range m.metrics.WeeklyActivity {
		barW := 0
		if maxCount > 0 {
			barW = week.Count * barMaxW / maxCount
		}
		counts := make([]int, len(weeks[i]))
		for j, p := range weeks[i] {
			counts[j] = p.count
		}
		var bar strings.Builder
		cells := stackSegments(counts, barW)
		for j, p := range weeks[i] {
			bar.WriteString(lipgloss.NewStyle().Foreground(m.weekColor(colors, p.status)).
				Render(strings.Repeat("\u2588", cells[j])))
		}
		barText := bar.String()
		barText += strings.Repeat(" ", max(0, barMaxW-lipgloss.Width(barText)))

		lines = append(lines, lineStyle.Render(labelStyle.Render(weekRange(week))+barText+
			countStyle.Render(fmt.Sprint(week.Count))+"  "+breakdowns[i]))
	}

	return strings.Join(lines, "\n")
}

// weekRange labels a week by its Monday-to-Sunday day/month range, e.g.
// "28/07–03/08", falling back to the ISO week ("W31") without a start date.
func weekRange(week model.WeekActivity) string {
	start, err := time.Parse("2006-01-02", week.Start)
	if err != nil {
		if idx := strings.Index(week.Week, "-"); idx >= 0 {
			return week.Week[idx+1:]
		}
		return week.Week
	}
	return start.Format("02/01") + "–" + start.AddDate(0, 0, 6).Format("02/01")
}

// weekColor is a status's colour in the weekly activity, with non-canonical
// statuses muted.
func (m ProgressModel) weekColor(colors map[string]lipgloss.Color, status string) lipgloss.Color {
	if c, ok := colors[status]; ok {
		return c
	}
	return m.theme.Subtext
}

// stackSegments splits cells across counts in proportion, giving every
// non-zero count at least one cell so no status vanishes from its bar. The
// result sums to cells, or to the number of non-zero counts when that is more.
func stackSegments(counts []int, cells int) []int {
	out := make([]int, len(counts))
	total, nonZero, largest := 0, 0, -1
	for i, n := range counts {
		total += n
		if n > 0 {
			nonZero++
			if largest < 0 || n > counts[largest] {
				largest = i
			}
		}
	}
	if total == 0 {
		return out
	}
	cells = max(cells, nonZero)
	sum := 0
	for i, n := range counts {
		if n > 0 {
			out[i] = max(1, (n*cells+total/2)/total)
			sum += out[i]
		}
	}
	// Rounding and the one-cell minimum can miss the target; the largest
	// segment absorbs the difference while keeping its own cell.
	out[largest] = max(1, out[largest]+cells-sum)
	return out
}

func (m ProgressModel) renderHelp() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	brandPlain := "career-ops by santifer.io"
	brand := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render(brandPlain)
	budget := m.width - 2
	if budget < 1 {
		budget = 1
	}
	keys := joinHelp(budget, []helpPiece{
		{keyStyle.Render("↑↓") + descStyle.Render(i18n.Current.HelpScroll), false},
		{keyStyle.Render("PgUp/Dn") + descStyle.Render(i18n.Current.HelpPage), false},
		{keyStyle.Render("t") + descStyle.Render(i18n.Current.HelpLanguage), false},
		{keyStyle.Render("Esc") + descStyle.Render(i18n.Current.HelpBack), true},
	}, brandPlain, brand)
	return oneLine(m.width, style, keys)
}

// rateColor returns a color based on the rate value.
func (m ProgressModel) rateColor(rate float64) lipgloss.Color {
	switch {
	case rate >= 30:
		return m.theme.Green
	case rate >= 15:
		return m.theme.Yellow
	case rate >= 5:
		return m.theme.Peach
	default:
		return m.theme.Red
	}
}
