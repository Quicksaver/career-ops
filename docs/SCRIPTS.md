# Scripts Reference

All scripts live in the project root as `.mjs` modules and are exposed via `npm run <name>`.

Scripts that read or write user data require `--user {USER}` or `CAREER_OPS_USER={USER}`. User data lives under `users/{USER}/`.

## Quick Reference

| Command | Script | Purpose |
|---------|--------|---------|
| `npm run doctor` | `doctor.mjs` | Validate setup prerequisites |
| `npm run verify` | `verify-pipeline.mjs` | Check pipeline data integrity |
| `npm run normalize` | `normalize-statuses.mjs` | Fix non-canonical statuses |
| `npm run dedup` | `dedup-tracker.mjs` | Remove duplicate tracker entries |
| `npm run merge` | `merge-tracker.mjs` | Merge batch TSVs into applications.md |
| `npm run pdf` | `generate-pdf.mjs` | Convert HTML to ATS-optimized PDF |
| `npm run sync-check` | `cv-sync-check.mjs` | Validate CV/profile consistency |
| `npm run patterns` | `analyze-patterns.mjs` | Analyze tracker outcomes and report patterns |
| `npm run update:check` | `update-system.mjs check` | Check for upstream updates |
| `npm run update` | `update-system.mjs apply` | Apply upstream update |
| `npm run rollback` | `update-system.mjs rollback` | Rollback last update |
| `npm run liveness` | `check-liveness.mjs` | Test if job URLs are still active |
| `npm run scan` | `scan.mjs` | Zero-token portal scanner |

---

## doctor

Validates that all prerequisites are in place: Node.js >= 18, dependencies installed, Playwright chromium, required user files (`users/{USER}/cv.md`, `users/{USER}/config/profile.yml`, `users/{USER}/modes/_profile.md`, `users/{USER}/portals.yml`), fonts directory, and auto-creates `users/{USER}/data/`, `users/{USER}/output/`, `users/{USER}/reports/` if missing.

```bash
npm run doctor -- --user <username>
```

**Exit codes:** `0` all checks passed, `1` one or more checks failed (fix messages printed).

---

## verify

Health check for pipeline data integrity. Validates `users/{USER}/data/applications.md` against seven rules: canonical statuses (per `templates/states.yml`), no duplicate company+role pairs, all report links point to existing files, scores match `X.XX/5` / `N/A` / `DUP`, rows have proper pipe-delimited format, no pending TSVs in `users/{USER}/batch/tracker-additions/`, and no markdown bold in scores.

```bash
npm run verify -- --user <username>
```

**Exit codes:** `0` pipeline clean (zero errors), `1` errors found. Warnings (e.g. possible duplicates) do not cause a non-zero exit.

---

## normalize

Maps non-canonical statuses to their canonical equivalents and strips markdown bold and dates from the status column. Aliases like `Enviada` become `Aplicado`, `CERRADA` becomes `Descartado`, etc. DUPLICADO info is moved to the notes column.

```bash
npm run normalize -- --user <username>             # apply changes
npm run normalize -- --user <username> --dry-run   # preview without writing
```

Creates a `.bak` backup of `applications.md` before writing.

**Exit codes:** `0` always (changes or no changes).

---

## dedup

Removes duplicate entries from `users/{USER}/data/applications.md` by grouping on normalized company name + fuzzy role match. Keeps the entry with the highest score. If a removed entry had a more advanced pipeline status, that status is promoted to the keeper.

```bash
npm run dedup -- --user <username>             # apply changes
npm run dedup -- --user <username> --dry-run   # preview without writing
```

Creates a `.bak` backup before writing.

**Exit codes:** `0` always.

---

## merge

Merges batch tracker additions (`users/{USER}/batch/tracker-additions/*.tsv`) into `users/{USER}/data/applications.md`. Handles 9-column TSV, 8-column TSV, and pipe-delimited markdown formats. Detects duplicates by report number, entry number, and company+role fuzzy match. Higher-scored re-evaluations update existing entries in place.

```bash
npm run merge -- --user <username>                 # apply merge
npm run merge -- --user <username> --dry-run       # preview without writing
npm run merge -- --user <username> --verify        # merge then run verify-pipeline
```

Processed TSVs are moved to `users/{USER}/batch/tracker-additions/merged/`.

**Exit codes:** `0` success, `1` verification errors (with `--verify`).

---

## pdf

Renders an HTML file to a print-quality, ATS-parseable PDF via headless Chromium. Resolves font paths from `fonts/`, normalizes Unicode for ATS compatibility (em-dashes, smart quotes, zero-width characters), and reports page count and file size.

```bash
npm run pdf -- --user <username> input.html output.pdf
npm run pdf -- --user <username> input.html output.pdf --format=letter   # US letter
npm run pdf -- --user <username> input.html output.pdf --format=a4        # A4 (default)
```

**Exit codes:** `0` PDF generated, `1` missing arguments or generation failure.

---

## sync-check

Validates that the career-ops setup is internally consistent: `users/{USER}/cv.md` exists and is not too short, `users/{USER}/config/profile.yml` and `users/{USER}/modes/_profile.md` exist, no hardcoded metrics in `modes/_shared.md` or `batch/batch-prompt.md`, and `users/{USER}/article-digest.md` freshness (warns if older than 30 days).

```bash
npm run sync-check -- --user <username>
```

**Exit codes:** `0` no errors (warnings allowed), `1` errors found.

---

## patterns

Analyzes application outcomes, scores, archetypes, blockers, remote policy, and company size from `users/{USER}/data/applications.md` and linked reports. New reports should include `## Machine Summary` YAML; `analyze-patterns.mjs` uses it first and falls back to legacy markdown parsing for older reports.

```bash
npm run patterns -- --user <username>
npm run patterns -- --user <username> --summary
npm run patterns -- --user <username> --min-threshold 3
node analyze-patterns.mjs --self-test
```

**Exit codes:** `0` analysis succeeded, `1` insufficient data or parser self-test failure.

---

## update:check

Checks whether a newer version of career-ops is available upstream. Outputs JSON to stdout:

```bash
npm run update:check
```

Possible JSON responses:

| `status` | Meaning |
|----------|---------|
| `up-to-date` | Local version matches remote |
| `update-available` | Newer version exists (includes `local`, `remote`, `changelog`) |
| `dismissed` | User dismissed the update prompt |
| `offline` | Could not reach GitHub |

**Exit codes:** `0` always.

---

## update

Applies the upstream update. Creates a backup branch (`backup-pre-update-{version}`), fetches from the canonical repo, checks out only system-layer files, runs `npm install`, and commits. User-layer files (`cv.md`, `config/profile.yml`, `data/`, etc.) are never touched.

```bash
npm run update
```

**Exit codes:** `0` success, `1` lock conflict or safety violation.

---

## rollback

Restores system-layer files from the most recent backup branch created during an update.

```bash
npm run rollback
```

**Exit codes:** `0` success, `1` no backup branch found or git error.

---

## liveness

Tests whether job posting URLs are still live using headless Chromium. Detects expired patterns (e.g. "job no longer available"), HTTP 404/410, ATS redirect patterns, and apply-button presence. Supports multi-language expired patterns (English, German, French).

```bash
npm run liveness -- https://example.com/job/123
npm run liveness -- https://a.com/job/1 https://b.com/job/2
npm run liveness -- --file urls.txt
```

Each URL gets a verdict: `active`, `expired`, or `uncertain` with a reason.

**Exit codes:** `0` all URLs active, `1` any expired or uncertain.

---

## scan

Zero-token portal scanner. Runs configured local parsers for SSR/static career pages, hits ATS APIs (Greenhouse, Ashby, Lever, PCSX) directly, and supports structured providers such as Landing.jobs, EU Remote Jobs, ITJobs, SAPO Emprego, Portal Emprego, Dice, and other provider modules — no LLM tokens consumed. Reads `users/{USER}/portals.yml` for target companies, outputs matching listings to stdout, and optionally appends to `users/{USER}/data/pipeline.md`. Broad-discovery `search_queries` remain part of the agent/WebSearch flow for portals such as Indeed where direct bot-style access is unreliable.

For custom SSR pages, configure a tracked company with `scan_method: local_parser` and a `parser` block. The parser can be written in JavaScript, Python, or any language available as a local executable. Company-specific parsers usually already know their source URL and only need to print JSON jobs to stdout:

```yaml
parser:
  command: node
  script: scripts/parsers/example-company-jobs.js
  format: jobs-json-v1
```

Use `args` only for reusable parsers that intentionally accept runtime parameters such as `{careers_url}` or `{company}`.

If a parser writes full extraction artifacts for debugging or audit, store them under `users/{USER}/data/parser-output/{company}/`. `scan.mjs` reads stdout and does not require those JSON files after parsing. Keep generated JSON artifacts out of git.

```bash
npm run scan -- --user <username>
```

**Exit codes:** `0` scan completed, `1` configuration error or no `users/{USER}/portals.yml` found.

---

## scan-auth

Authenticated portal scanner for sources that need a browser login. Currently supports LinkedIn. It reads `users/{USER}/portals.yml`, writes JDs to `users/{USER}/jds/`, appends `local:jds/...` entries to `users/{USER}/data/pipeline.md`, and records history in `users/{USER}/data/scan-history.tsv`.

Each user gets a separate persistent browser profile outside the repo:

```text
~/.scan-auth/users/{USER}/{PORTAL}/profile/
```

Treat those profiles as credentials because they contain cookies and local storage.

```bash
npm run scan-auth -- --user <username> --login linkedin
npm run scan-auth -- --user <username> linkedin
```

**Exit codes:** `0` scan completed, `1` configuration, login, or portal error.
