package screens

import (
	"os"
	"regexp"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// ViewerClosedMsg is emitted when the viewer is dismissed.
type ViewerClosedMsg struct{}

// ViewerModel implements an integrated file viewer screen.
type ViewerModel struct {
	lines        []string
	title        string
	scrollOffset int
	width        int
	height       int
	theme        theme.Theme
}

// NewViewerModel creates a new file viewer for the given path.
func NewViewerModel(t theme.Theme, path, title string, width, height int) ViewerModel {
	content, err := os.ReadFile(path)
	if err != nil {
		content = []byte("Error reading file: " + err.Error())
	}

	return ViewerModel{
		lines:  strings.Split(string(content), "\n"),
		title:  title,
		width:  width,
		height: height,
		theme:  t,
	}
}

func (m ViewerModel) Init() tea.Cmd {
	return nil
}

func (m *ViewerModel) Resize(width, height int) {
	m.width = width
	m.height = height
}

func (m ViewerModel) Update(msg tea.Msg) (ViewerModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc":
			return m, func() tea.Msg { return ViewerClosedMsg{} }

		case "down", "j":
			maxScroll := m.maxScroll()
			if m.scrollOffset < maxScroll {
				m.scrollOffset++
			}

		case "up", "k":
			if m.scrollOffset > 0 {
				m.scrollOffset--
			}

		case "pgdown", "ctrl+d":
			jump := m.bodyHeight() / 2
			maxScroll := m.maxScroll()
			m.scrollOffset += jump
			if m.scrollOffset > maxScroll {
				m.scrollOffset = maxScroll
			}

		case "pgup", "ctrl+u":
			jump := m.bodyHeight() / 2
			m.scrollOffset -= jump
			if m.scrollOffset < 0 {
				m.scrollOffset = 0
			}

		case "home", "g":
			m.scrollOffset = 0

		case "end", "G":
			m.scrollOffset = m.maxScroll()
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		if m.scrollOffset > m.maxScroll() {
			m.scrollOffset = m.maxScroll()
		}
	}

	return m, nil
}

func (m ViewerModel) bodyHeight() int {
	h := m.height - 4 // header + footer + padding
	if h < 3 {
		h = 3
	}
	return h
}

func (m ViewerModel) maxScroll() int {
	maxScroll := len(m.renderedLines()) - m.bodyHeight()
	if maxScroll < 0 {
		return 0
	}
	return maxScroll
}

func (m ViewerModel) View() string {
	header := m.renderHeader()
	body := m.renderBody()
	footer := m.renderFooter()

	return lipgloss.JoinVertical(lipgloss.Left, header, body, footer)
}

func (m ViewerModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render(m.title)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	pos := right.Render(strings.TrimRight(
		strings.Repeat(" ", max(0, m.width-lipgloss.Width(m.title)-30)),
		" ",
	))

	lineInfo := right.Render(
		strings.Join([]string{
			"L",
			strings.TrimSpace(lipgloss.NewStyle().Render(
				strings.Join([]string{
					func() string {
						s := m.scrollOffset + 1
						if s > len(m.lines) {
							s = len(m.lines)
						}
						return string(rune('0'+s/100%10)) + string(rune('0'+s/10%10)) + string(rune('0'+s%10))
					}(),
				}, ""),
			)),
			"/",
			func() string {
				t := len(m.lines)
				return string(rune('0'+t/100%10)) + string(rune('0'+t/10%10)) + string(rune('0'+t%10))
			}(),
		}, ""),
	)
	_ = pos
	_ = lineInfo

	scroll := right.Render(func() string {
		rendered := m.renderedLines()
		if len(rendered) == 0 {
			return ""
		}
		pct := 0
		maxScroll := m.maxScroll()
		if maxScroll > 0 {
			pct = m.scrollOffset * 100 / maxScroll
		}
		if m.scrollOffset == 0 {
			return "Top"
		}
		if m.scrollOffset >= maxScroll {
			return "End"
		}
		return func() string {
			s := pct
			return string(rune('0'+s/10%10)) + string(rune('0'+s%10)) + "%"
		}()
	}())

	gap := m.width - lipgloss.Width(m.title) - lipgloss.Width(scroll) - 4
	if gap < 1 {
		gap = 1
	}

	return style.Render(title + strings.Repeat(" ", gap) + scroll)
}

func (m ViewerModel) renderBody() string {
	bh := m.bodyHeight()
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	rendered := m.renderedLines()
	if len(rendered) == 0 {
		emptyStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)
		return padStyle.Render(emptyStyle.Render("(empty file)"))
	}

	if m.scrollOffset > m.maxScroll() {
		m.scrollOffset = m.maxScroll()
	}

	end := m.scrollOffset + bh
	if end > len(rendered) {
		end = len(rendered)
	}
	styled := append([]string(nil), rendered[m.scrollOffset:end]...)

	// Pad to fill height
	for len(styled) < bh {
		styled = append(styled, "")
	}

	return padStyle.Render(strings.Join(styled, "\n"))
}

func (m ViewerModel) renderedLines() []string {
	if len(m.lines) == 0 {
		return nil
	}

	var styled []string
	for i := 0; i < len(m.lines); {
		if isTableLine(m.lines[i]) {
			tableStart := i
			for i < len(m.lines) && isTableLine(m.lines[i]) {
				i++
			}
			tableLines := m.lines[tableStart:i]
			colWidths := computeColumnWidths(tableLines, m.width-6)
			styled = append(styled, m.renderTableBlock(tableLines, colWidths, tableStart)...)
			continue
		}

		styled = append(styled, m.wrapStyledLine(m.styleLine(m.lines[i]))...)
		i++
	}

	return styled
}

func (m ViewerModel) contentWidth() int {
	w := m.width - 4
	if w < 1 {
		return 1
	}
	return w
}

func (m ViewerModel) wrapStyledLine(line string) []string {
	wrapped := ansi.Wrap(line, m.contentWidth(), " \t")
	if wrapped == "" {
		return []string{""}
	}
	return strings.Split(wrapped, "\n")
}

// isTableLine checks if a line is part of a markdown table.
func isTableLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	return len(trimmed) > 1 && trimmed[0] == '|'
}

// isTableSeparator checks if a line is a table separator (|---|---|).
func isTableSeparator(line string) bool {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "|") {
		return false
	}
	cleaned := strings.NewReplacer("|", "", "-", "", ":", "", " ", "").Replace(trimmed)
	return cleaned == ""
}

// parseTableCells splits a table line into trimmed cells.
func parseTableCells(line string) []string {
	trimmed := strings.TrimSpace(line)
	// Remove leading and trailing pipes
	if len(trimmed) > 0 && trimmed[0] == '|' {
		trimmed = trimmed[1:]
	}
	if len(trimmed) > 0 && trimmed[len(trimmed)-1] == '|' {
		trimmed = trimmed[:len(trimmed)-1]
	}
	parts := strings.Split(trimmed, "|")
	cells := make([]string, len(parts))
	for i, p := range parts {
		cells[i] = strings.TrimSpace(p)
	}
	return cells
}

// computeColumnWidths calculates max width per column across all table rows.
func computeColumnWidths(lines []string, maxTotal int) []int {
	maxCols := 0
	for _, line := range lines {
		if isTableSeparator(line) {
			continue
		}
		cells := parseTableCells(line)
		if len(cells) > maxCols {
			maxCols = len(cells)
		}
	}
	if maxCols == 0 {
		return nil
	}

	widths := make([]int, maxCols)
	for _, line := range lines {
		if isTableSeparator(line) {
			continue
		}
		cells := parseTableCells(line)
		for i, cell := range cells {
			if i < maxCols {
				w := lipgloss.Width(cell)
				if w > widths[i] {
					widths[i] = w
				}
			}
		}
	}

	for i := range widths {
		if widths[i] < 3 {
			widths[i] = 3
		}
	}

	// Cap the first descriptive column based on column count.
	// If column 0 is a numeric index column, column 1 becomes the first descriptive one.
	maxColW := 45
	if maxCols > 5 {
		maxColW = 30
	}
	if maxCols > 7 {
		maxColW = 22
	}
	firstNumeric := columnIsNumeric(lines, 0)
	descriptiveIdx := 0
	if firstNumeric && maxCols > 1 {
		descriptiveIdx = 1
	}

	contentBudget := maxTotal - (1 + 3*maxCols)
	minContentBudget := 3 * maxCols
	if contentBudget < minContentBudget {
		contentBudget = minContentBudget
	}

	numericWidth := 0
	if firstNumeric {
		numericWidth = widths[0]
	}
	descriptiveWidth := widths[descriptiveIdx]
	if descriptiveWidth > maxColW {
		descriptiveWidth = maxColW
	}

	flexCols := make([]int, 0, maxCols)
	for i := range widths {
		if i == descriptiveIdx {
			continue
		}
		if firstNumeric && i == 0 {
			continue
		}
		flexCols = append(flexCols, i)
	}

	remainingCols := maxCols
	if firstNumeric {
		remainingCols--
	}
	if remainingCols < 1 {
		remainingCols = 1
	}
	minFlexBudget := 3 * len(flexCols)
	maxDescriptive := contentBudget - numericWidth - minFlexBudget
	if maxDescriptive < 3 {
		maxDescriptive = 3
	}
	if descriptiveWidth > maxDescriptive {
		descriptiveWidth = maxDescriptive
	}
	widths[descriptiveIdx] = descriptiveWidth

	if len(flexCols) > 0 {
		remainingBudget := contentBudget - numericWidth - widths[descriptiveIdx]
		if remainingBudget < minFlexBudget {
			remainingBudget = minFlexBudget
		}

		share := remainingBudget / len(flexCols)
		remainder := remainingBudget % len(flexCols)
		for _, idx := range flexCols {
			widths[idx] = share
			if remainder > 0 {
				widths[idx]++
				remainder--
			}
		}
	}

	if sumInts(widths) > contentBudget {
		allCols := make([]int, 0, len(widths))
		for i := range widths {
			allCols = append(allCols, i)
		}
		shrinkBudget(widths, allCols, contentBudget)
	}

	if firstNumeric {
		widths[0] = numericWidth
	}

	return widths
}

func columnIsNumeric(lines []string, col int) bool {
	seenHeader := false
	seenData := false

	for _, line := range lines {
		if isTableSeparator(line) {
			continue
		}

		cells := parseTableCells(line)
		if col >= len(cells) {
			continue
		}

		if !seenHeader {
			seenHeader = true
			continue
		}

		cell := strings.TrimSpace(cells[col])
		if cell == "" {
			continue
		}
		seenData = true
		if !isNumericCell(cell) {
			return false
		}
	}

	return seenData
}

func isNumericCell(cell string) bool {
	for _, r := range cell {
		if r < '0' || r > '9' {
			return false
		}
	}
	return cell != ""
}

func sumInts(values []int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}

func shrinkBudget(widths, candidates []int, budget int) {
	for sumInts(widths) > budget {
		widestIdx := -1
		widestVal := 0
		for _, idx := range candidates {
			if idx < 0 || idx >= len(widths) {
				continue
			}
			if widths[idx] <= 3 {
				continue
			}
			if widths[idx] > widestVal {
				widestVal = widths[idx]
				widestIdx = idx
			}
		}
		if widestIdx == -1 {
			return
		}
		widths[widestIdx]--
	}
}

// wrapTableCell wraps a table cell to fit the target column width.
func wrapTableCell(cell string, width int) []string {
	if width <= 0 {
		return []string{""}
	}

	if lipgloss.Width(cell) <= width {
		return []string{cell}
	}

	words := strings.Fields(cell)
	if len(words) == 0 {
		return []string{""}
	}

	var lines []string
	current := ""

	for _, word := range words {
		if lipgloss.Width(word) > width {
			if current != "" {
				lines = append(lines, current)
				current = ""
			}

			for lipgloss.Width(word) > width {
				chunk, rest := splitTableToken(word, width)
				lines = append(lines, chunk)
				word = rest
			}

			current = word
			continue
		}

		candidate := word
		if current != "" {
			candidate = current + " " + word
		}

		if lipgloss.Width(candidate) <= width {
			current = candidate
			continue
		}

		if current != "" {
			lines = append(lines, current)
		}
		current = word
	}

	if current != "" {
		lines = append(lines, current)
	}

	if len(lines) == 0 {
		return []string{""}
	}

	return lines
}

func splitTableToken(token string, width int) (string, string) {
	runes := []rune(token)
	if len(runes) == 0 || width <= 0 {
		return "", ""
	}

	split := 0
	for i := 1; i <= len(runes); i++ {
		if lipgloss.Width(string(runes[:i])) > width {
			break
		}
		split = i
	}

	if split == 0 {
		split = 1
	}

	return string(runes[:split]), string(runes[split:])
}

// renderTableBlock renders table lines with aligned columns and box-drawing borders.
func (m ViewerModel) renderTableBlock(lines []string, colWidths []int, firstLineIdx int) []string {
	if len(lines) == 0 || len(colWidths) == 0 {
		// Fallback: render as plain text
		var result []string
		for _, line := range lines {
			result = append(result, m.wrapStyledLine(m.styleLine(line))...)
		}
		return result
	}

	maxCols := len(colWidths)
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Overlay)
	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Sky)
	dataStyle := lipgloss.NewStyle().Foreground(m.theme.Text)

	// Build top border
	var result []string
	var topParts []string
	for _, w := range colWidths {
		topParts = append(topParts, strings.Repeat("─", w+2))
	}
	result = append(result, borderStyle.Render("┌"+strings.Join(topParts, "┬")+"┐"))

	isFirstDataRow := true
	for _, line := range lines {
		if isTableSeparator(line) {
			// Render middle separator
			var sepParts []string
			for _, w := range colWidths {
				sepParts = append(sepParts, strings.Repeat("─", w+2))
			}
			result = append(result, borderStyle.Render("├"+strings.Join(sepParts, "┼")+"┤"))
			continue
		}

		cells := parseTableCells(line)
		wrappedCells := make([][]string, maxCols)
		rowHeight := 1
		for i := 0; i < maxCols; i++ {
			cell := ""
			if i < len(cells) {
				cell = cells[i]
			}
			colW := colWidths[i]
			wrappedCells[i] = wrapTableCell(cell, colW)
			if len(wrappedCells[i]) > rowHeight {
				rowHeight = len(wrappedCells[i])
			}
		}

		for lineIdx := 0; lineIdx < rowHeight; lineIdx++ {
			border := borderStyle.Render("│")
			var rowParts []string
			for i, cellLines := range wrappedCells {
				cellLine := ""
				if lineIdx < len(cellLines) {
					cellLine = cellLines[lineIdx]
				}
				padding := colWidths[i] - lipgloss.Width(cellLine)
				if padding < 0 {
					padding = 0
				}
				padded := " " + cellLine + strings.Repeat(" ", padding) + " "
				if isFirstDataRow {
					rowParts = append(rowParts, headerStyle.Render(padded))
				} else {
					rowParts = append(rowParts, dataStyle.Render(padded))
				}
			}
			row := border + strings.Join(rowParts, border) + border
			result = append(result, row)
		}

		isFirstDataRow = false
	}

	// Bottom border
	var bottomParts []string
	for _, w := range colWidths {
		bottomParts = append(bottomParts, strings.Repeat("─", w+2))
	}
	result = append(result, borderStyle.Render("└"+strings.Join(bottomParts, "┴")+"┘"))

	return result
}

var reBold = regexp.MustCompile(`\*\*([^*]+)\*\*`)

func (m ViewerModel) styleLine(line string) string {
	trimmed := strings.TrimSpace(line)

	// H1 — render without the "# " prefix
	if strings.HasPrefix(trimmed, "# ") && !strings.HasPrefix(trimmed, "## ") {
		content := strings.TrimPrefix(trimmed, "# ")
		return lipgloss.NewStyle().
			Bold(true).
			Foreground(m.theme.Blue).
			Render("  " + content)
	}
	// H2 — render without the "## " prefix
	if strings.HasPrefix(trimmed, "## ") && !strings.HasPrefix(trimmed, "### ") {
		content := strings.TrimPrefix(trimmed, "## ")
		return lipgloss.NewStyle().
			Bold(true).
			Foreground(m.theme.Mauve).
			Render("  " + content)
	}
	// H3 — render without the "### " prefix
	if strings.HasPrefix(trimmed, "### ") {
		content := strings.TrimPrefix(trimmed, "### ")
		return lipgloss.NewStyle().
			Bold(true).
			Foreground(m.theme.Sky).
			Render("  " + content)
	}
	// Horizontal rule
	if trimmed == "---" || trimmed == "***" {
		return lipgloss.NewStyle().
			Foreground(m.theme.Overlay).
			Render(strings.Repeat("─", m.width-4))
	}
	// Blockquote
	if strings.HasPrefix(trimmed, "> ") {
		content := strings.TrimPrefix(trimmed, "> ")
		border := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render("▎ ")
		text := lipgloss.NewStyle().Foreground(m.theme.Subtext).Italic(true).Render(content)
		return border + text
	}
	// Bold fields like **Score:** 4.0/5 — render with bold label, strip asterisks
	if strings.HasPrefix(trimmed, "**") && strings.Contains(trimmed, ":**") {
		return m.renderInlineBold(line, m.theme.Yellow)
	}
	// Bullet points and numbered lists
	if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") {
		return m.renderInlineBold(line, m.theme.Text)
	}
	if len(trimmed) > 2 && trimmed[0] >= '0' && trimmed[0] <= '9' && strings.Contains(trimmed[:3], ".") {
		return m.renderInlineBold(line, m.theme.Text)
	}

	// Default — still check for inline bold
	if strings.Contains(trimmed, "**") {
		return m.renderInlineBold(line, m.theme.Subtext)
	}

	return lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Render(line)
}

// renderInlineBold renders a line with **bold** segments highlighted.
func (m ViewerModel) renderInlineBold(line string, baseColor lipgloss.Color) string {
	baseStyle := lipgloss.NewStyle().Foreground(baseColor)
	boldStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Yellow)

	matches := reBold.FindAllStringIndex(line, -1)
	if len(matches) == 0 {
		return baseStyle.Render(line)
	}

	var result strings.Builder
	last := 0
	for _, loc := range matches {
		// Render text before the bold
		if loc[0] > last {
			result.WriteString(baseStyle.Render(line[last:loc[0]]))
		}
		// Extract bold content (without **)
		boldText := line[loc[0]+2 : loc[1]-2]
		result.WriteString(boldStyle.Render(boldText))
		last = loc[1]
	}
	// Render remaining text
	if last < len(line) {
		result.WriteString(baseStyle.Render(line[last:]))
	}

	return result.String()
}

func (m ViewerModel) renderFooter() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	return style.Render(
		keyStyle.Render("↑↓") + descStyle.Render(" scroll  ") +
			keyStyle.Render("PgUp/Dn") + descStyle.Render(" page  ") +
			keyStyle.Render("g/G") + descStyle.Render(" top/end  ") +
			keyStyle.Render("Esc") + descStyle.Render(" back"))
}
