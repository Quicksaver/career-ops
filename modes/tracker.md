# Mode: tracker — Applications Tracker

Lee y muestra `users/{USER}/data/applications.md`.

**Tracker Format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
```

Possible states: `Evaluated` → `Applied` → `Responded` → `Interview` → `Offer` / `Rejected` / `Closed` / `Discarded` / `SKIP`

- `Evaluated` = offer evaluated with report, pending decision
- `Applied` = the candidate submitted their application
- `Responded` = Company has responded (not yet interview)
- `Interview` = active interview process
- `Offer` = job offer received
- `Rejected` = rejected by company
- `Closed` = posting closed before application
- `Discarded` = discarded by candidate
- `SKIP` = doesn't fit, don't apply

If the user asks to update a state, edit the corresponding row.

Also show statistics:
- Total applications
- Breakdown by state
- Average score
- % with PDF generated
- % with report generated
