# Scripts Reference

All scripts live in the project root as `.mjs` modules and are exposed via `npm run <name>`.

Scripts that read or write user data require `--user {USER}` or `CAREER_OPS_USER={USER}`. User data lives under `users/{USER}/`.

## Quick Reference

| Command | Script | Purpose |
|---------|--------|---------|
| `npm run go -- --user {USER}` | `go-runner.mjs` | Deterministic end-to-end sourcing coordinator with streamed human output (`--json` for machines) |
| `node resolve-parallel.mjs --profile users/{USER}/config/profile.yml --json` | `resolve-parallel.mjs` | Resolve argument/profile/default batch parallelism |
| `npm run doctor` | `doctor.mjs` | Validate setup prerequisites |
| `npm run verify -- --user {USER}` | `verify-runner.mjs` | Review every integrity finding, apply bounded actions, remember accepted exceptions, and reverify |
| `npm run verify:raw -- --user {USER}` | `verify-pipeline.mjs` | Emit every raw deterministic integrity finding without review suppression |
| `node resolve-verify-warnings.mjs` | `resolve-verify-warnings.mjs` | Apply schema-validated duplicate-only warning resolutions |
| `node apply-verification-review.mjs` | `apply-verification-review.mjs` | Apply schema-validated seen, orphan, and bounded tracker decisions |
| `npm run normalize` | `normalize-statuses.mjs` | Fix non-canonical statuses |
| `npm run dedup` | `dedup-tracker.mjs` | Remove duplicate tracker entries |
| `npm run merge` | `merge-tracker.mjs` | Merge batch TSVs into applications.md |
| `npm run pdf` | `generate-pdf.mjs` | Convert HTML to ATS-optimized PDF |
| `npm run img-to-pdf` | `img-to-pdf.mjs` | Convert a single screenshot/image into a single-page PDF |
| `node build-cv-html.mjs` | `build-cv-html.mjs` | Build deterministic HTML from a structured CV payload under the active user's output root |
| `npm run build:latex` | `build-cv-latex.mjs` | Build .tex from structured JSON payload |
| `npm run sync-check` | `cv-sync-check.mjs` | Validate CV/profile consistency |
| `npm run patterns` | `analyze-patterns.mjs` | Analyze tracker outcomes and report patterns |
| `npm run upskill` | `upskill.mjs` | Aggregate skill-gap map from tracked reports |
| `npm run add` | `add-entry.mjs` | Dedup + insert a `/career-ops add` entry into `users/{USER}/cv.md` / `users/{USER}/article-digest.md` |
| `npm run update:check` | `update-system.mjs check` | Check for upstream updates |
| `npm run update` | `update-system.mjs apply` | Apply upstream update |
| `npm run rollback` | `update-system.mjs rollback` | Rollback last update |
| `npm run liveness` | `check-liveness.mjs` | Test if job URLs are still active |
| `npm run pipeline:liveness -- --user {USER}` | `pipeline-liveness.mjs` | Bulk-check Pending URLs and move confirmed expired rows |
| `npm run pipeline:sync-batch -- --user {USER}` | `sync-pipeline-batch.mjs` | Idempotently append live Pending rows to the resumable batch input |
| `npm run extract` | `browser-extract.mjs` | Headless read-only page extractor (opt-in `scan.extractor: cli`) — compact JSON for scan/JD |
| `npm run scan` | `scan.mjs` | Zero-token portal scanner |
| `npm run scan:full` | `scan-ats-full.mjs` | Reverse ATS discovery scanner |
| `npm run validate:portals` | `validate-portals.mjs` | Validate portals.yml shape before scanning |
| `npm run tracker` | `tracker.mjs` | SQLite derived index over applications.md — sync/query/history/export |
| `npm run find` | `find.mjs` | Resolve a report#/tracker#/company query to its full pipeline identity |
| `npm run invite-match -- --user {USER}` | `invite-match.mjs` | Fuzzy-match a pasted interview-invite email against `users/{USER}/data/applications.md` |
| `npm run paste-reply -- --user {USER}` | `paste-reply.mjs` | Manual/no-Gmail input into the active user's reply-watch pipeline |
| `node jd-skill-gap.mjs --user {USER} <jd-file>` | `jd-skill-gap.mjs` | Zero-LLM JD requirements check against the active user's CV |
| `npm run openai:tailor` | `openai-tailor.mjs` | Tailor a CV via any OpenAI-compatible endpoint (headless companion to `openai-eval.mjs`) |

---

## CLI output contract

Public commands default to operator-friendly output: progress is streamed to
stdout as work happens, then only a compact summary of information not already
shown is printed. On failure, the tail contains the actual error rather than a
copy of the complete run state. Full structured payloads are opt-in with
`--json`; in that mode stdout contains only JSON and any live progress uses
stderr, so callers can parse stdout deterministically. Internal orchestration
always passes `--json` when it consumes a child command's result.

`doctor.mjs` and `batch/batch-runner.sh` already follow the human-output side of
this contract. The batch runner persists its machine state in user-scoped batch
artifacts rather than dumping it at process exit.

---

## doctor

Validates that all prerequisites are in place: Node.js >= 18, dependencies installed, Playwright chromium, required user files (`users/{USER}/cv.md`, `users/{USER}/config/profile.yml`, `users/{USER}/modes/_profile.md`, `users/{USER}/portals.yml`), fonts directory, and auto-creates `users/{USER}/data/`, `users/{USER}/output/`, `users/{USER}/reports/` if missing.

```bash
npm run doctor -- --user <username>
```

**Exit codes:** `0` all checks passed, `1` one or more checks failed (fix messages printed).

## go

Runs the deterministic sourcing coordinator:

```bash
npm run go -- --user <username> --batch-cli codex
```

Optional Codex overrides apply to every Codex CLI call made by the run:

```bash
npm run go -- --user <username> \
  --codex-model gpt-5.3-codex \
  --codex-reasoning-effort high
```

Each setting resolves independently as command argument, then
`users/{USER}/config/profile.yml` under `codex.model` or
`codex.reasoning_effort`, then the global Codex configuration. Global fallback
is implemented by omitting the corresponding CLI override.

Batch and verification-review parallelism resolve as an explicit `--parallel N` override, then
`batch.parallel` in `users/{USER}/config/profile.yml`, then the system default
of `1`. The resolved value and its source are included as `parallel` and
`parallel_source` in the `--json` result. The same hierarchy applies when
`batch/batch-runner.sh` or `verify-runner.mjs` is invoked directly. The go runner
passes its resolved parallel value to both stages.

The final phase invokes `verify-runner.mjs`, the same reviewed lifecycle exposed
by `npm run verify`. Its schema-constrained Codex reviewer reads every new error
and warning without mutation. Deterministic scripts then apply only confirmed
duplicate/orphan actions or bounded tracker patches, append action ledgers, and
run `verify-pipeline.mjs` again. Verified false positives, legitimate exceptions,
and informational findings are stored by exact payload fingerprint under the
active user, so unchanged findings do not resurface while changed evidence does.

---

## verify

Reviewed health check for pipeline data integrity. The raw checker still validates twelve areas and emits every possible finding: canonical statuses, duplicate company+role pairs, report links, score format, row structure, pending tracker-addition TSVs, bold scores, stale report reservations, same-role duplicate reports, orphan reports, Via/channel consistency, and unique tracker numbers.

```bash
npm run verify -- --user <username>
npm run verify -- --user <username> --parallel 4
npm run verify -- --user <username> --review-retries 2
npm run verify -- --user <username> --resume-run <run-id>
npm run verify -- --user <username> --json
npm run verify:raw -- --user <username> --json
```

At startup, the runner prints `run-id: <RUN_ID>` and the matching `logs:` directory before the first verification phase. Copy that ID into `--resume-run` if the process is interrupted. If terminal output is unavailable, the ID is also the directory name under `users/<username>/data/verify-runs/`; `basename "$(ls -1dt users/<username>/data/verify-runs/*/ | head -1)"` returns the newest one.

`verify-runner.mjs` reviews findings in calls of at most five. Independent dependency lanes run concurrently according to `--parallel`/`batch.parallel`; overlapping tracker, report, and orphan identities remain in one sequential lane so prior decisions stay binding. Every reviewer is read-only with separate input/output/log files. Only the parent applies supported deterministic actions or writes ledgers, serially, after all lanes and aggregate consistency checks succeed. After each review call, human mode emits one compact stdout line per finding: `reviewed X/Y, job(s) #{related IDs}, {issue code} → {classification}`. Tracker IDs are preferred, with report IDs used for report-only and orphan findings. Full rationale, evidence, and action details stay in run artifacts. The terminal tail is a compact count summary and, on failure, only the actual error. With `--json`, stdout is the complete machine result and progress—including the early run ID—moves to stderr. `--quiet` suppresses terminal progress; the final human summary still prints the logs directory. Seen records match the finding level, stable ID, and full-payload SHA-256 fingerprint; changed findings therefore resurface automatically. It reports `completed` when all raw findings are resolved or seen, `partial` when human decisions remain, and `failed` for operational/schema/mutation failures.

Semantic validation aggregates every invalid item in a five-finding response and retries only that chunk, supplying the full error list to the reviewer. `--review-retries N` defaults to `2` and accepts `0` through `5`. For orphan archives, the model chooses the classification/disposition while the runner mechanically derives the exact report path from the raw finding and sets `tracker_tsv` to `null`; the model cannot redirect the mutation to another file. A validated chunk is written as an atomic checkpoint, but actions remain pass-atomic and begin only after all lanes and cross-chunk consistency checks pass.

A normal invocation always performs a fresh review and ignores old run artifacts. `--resume-run RUN_ID` is an explicit recovery option for an interrupted run: it reuses only validated checkpoints whose signature exactly matches the active user, chunk findings, and prior lane decisions. Raw output, invalid responses, and mismatched checkpoints are rerun. The `--json` result records semantic retry limit/usage, reused checkpoints, and mechanical normalizations under `review_resilience`.

Confirmed tracker duplicates preserve lifecycle order as `Hired > Offer > Interview > Responded > Rejected > Applied > Evaluated > Skip/Closed`. The deterministic resolver makes the most advanced row the keeper; reviewer-selected canonical identity is only the equal-status tiebreaker. The keeper retains its original tracker ID, report, PDF, HTML, and links without renaming. Losing rows contribute their notes, then their reports/output artifacts are backed up and archived. `data/duplicate-resolutions.jsonl` records the reviewer-selected keeper, effective lifecycle keeper, override flag, rationale, evidence, and backup root.

The raw command preserves the low-level contract: exit `0` with zero errors and exit `1` when errors exist; warnings alone remain exit `0`.

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

## validate:portals

Validates `portals.yml` before running the scanner. The validator is offline: it reads YAML, loads local provider IDs from `providers/*.mjs`, and checks common configuration mistakes without fetching any job boards.

It reports errors for invalid YAML shape, unknown explicit providers, malformed URLs, empty filter keywords, and invalid local parser blocks. Duplicate enabled company names are warnings because they may be intentional during migrations, but they are worth reviewing.

```bash
npm run validate:portals
npm run validate:portals -- --file templates/portals.example.yml
node validate-portals.mjs --self-test
```

**Exit codes:** `0` no errors (warnings allowed), `1` one or more errors found.

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

## img-to-pdf

Converts a single screenshot or image (PNG, JPEG, GIF, WEBP, BMP, SVG) into a single-page PDF via headless Chromium — for ATS upload fields that require a PDF specifically and reject images. Embeds the image as a base64 `data:` URI in a minimal HTML page and renders it with `page.pdf()`, sized to the image's own pixel dimensions so the page is neither cropped nor padded. Zero new dependencies — reuses the `playwright` dependency `generate-pdf.mjs` already uses, and is a deliberately standalone script: it does not go through `generate-pdf.mjs`, so it is never subject to that script's cv.md section-order validation.

```bash
npm run img-to-pdf -- --user <username> screenshot.png users/<username>/output/screenshot.pdf
npm run img-to-pdf -- --user <username> screenshot.png users/<username>/output/screenshot.pdf --force   # overwrite an existing output file
node img-to-pdf.mjs --self-test
```

MVP scope: one image in, one PDF page out. Multi-image/multi-page conversion is not implemented.

**Exit codes:** `0` PDF generated, `1` missing arguments, unsupported image type, missing input file, existing output without `--force`, or generation failure.

---

## build-cv-html

Builds deterministic ATS-safe HTML from a structured JSON payload and a selected system template. The renderer owns markup and HTML escaping, requires an active user for normal CLI use, and refuses to write outside `users/{USER}/`. The optional template path must remain inside `templates/`; use `cv-templates.mjs --user <username> resolve cv` to select it.

```bash
node build-cv-html.mjs --user <username> /tmp/cv-payload.json users/<username>/output/001-company-YYYY-MM-DD.html templates/cv-template.html
node build-cv-html.mjs --test
```

**Exit codes:** `0` HTML generated, `1` missing/invalid input, unresolved placeholders, unsafe output/template path, or render failure.

---

## build:latex

Builds a `.tex` file from a structured JSON payload, handling template merge and LaTeX escaping automatically. The JSON is produced by the agent during evaluation — this script replaces the manual LaTeX generation step in `modes/latex.md`.

```bash
node build-cv-latex.mjs --user <username> input.json users/<username>/output/cv.tex
node build-cv-latex.mjs --test
```

**Exit codes:** `0` file generated, `1` missing inputs, invalid JSON, unresolved placeholders, or template not found.

---

## sync-check

Validates that the career-ops setup is internally consistent: `users/{USER}/cv.md` exists and is not too short, `users/{USER}/config/profile.yml` and `users/{USER}/modes/_profile.md` exist, no hardcoded metrics in `modes/_shared.md` or `batch/batch-prompt.md`, and `users/{USER}/article-digest.md` freshness (warns if older than 30 days).

```bash
npm run sync-check -- --user <username>
```

**Exit codes:** `0` no errors (warnings allowed), `1` errors found.

---

## patterns

Analyzes application outcomes, scores, archetypes, blockers, remote policy, company size, and discard reasons from `users/{USER}/data/applications.md` and linked reports. New reports should include `## Machine Summary` YAML; `analyze-patterns.mjs` uses it first and falls back to legacy markdown parsing for older reports.

```bash
npm run patterns -- --user <username>
npm run patterns -- --user <username> --json
npm run patterns -- --user <username> --min-threshold 3
node analyze-patterns.mjs --self-test
```

**Exit codes:** `0` analysis succeeded, `1` insufficient data or parser self-test failure.

---

## upskill

Aggregates skill gaps across every tracked report or analyzes one target JD. It removes skills already present in `users/{USER}/cv.md` and `users/{USER}/config/profile.yml` (exact-alias matching only — an umbrella term never suppresses a specific skill). Aggregate mode weights each gap by inverse report score (`5.0 − score`, counted once per report); targeted mode accepts a URL or local JD file and applies an SSRF egress guard before fetching.

```bash
npm run upskill -- --user <username>
npm run upskill -- --user <username> --json
npm run upskill -- --user <username> --min-reports 3
node upskill.mjs --user <username> --url-text path/to/jd.md
node upskill.mjs --user <username> https://company.example/jobs/123
node upskill.mjs --self-test
```

**Exit codes:** `0` analysis succeeded (including a graceful insufficient-data result), `1` self-test failure.

---

## salary-gap

Folds compensation observations into per-application desired/advertised/actual values and gap aggregates. Sources: `reports/*.md` Machine Summary `advertised_comp` (advertised, source `jd` — historical reports backfill automatically), `data/salary-observations.tsv` (desired/actual, append-only), and `config/profile.yml` `compensation.target_range` (desired default). Fold precedence: highest trust tier wins, then latest date (`actual`: contract > offer-letter > recruiter-verbal > user). Aggregates group by (company, role) and per currency — no FX conversion. Unparseable amounts, orphaned tracker numbers, sample sizes, and staleness are always reported.

```bash
node salary-gap.mjs             # table + data-quality section
node salary-gap.mjs --json      # machine-readable result
node salary-gap.mjs --self-test
```

Observation line format (TSV, one per line, `#`-prefixed lines are comments):

```text
{tracker#}\t{YYYY-MM-DD}\t{desired|advertised|actual}\t{amount}\t{currency}\t{source}\t{note}
```

Amounts: number + optional k/K suffix, ranges allowed ("80-90k"), annual gross unless noted. Sources: jd | profile | user | recruiter-verbal | offer-letter | contract.

**Exit codes:** `0` always (missing sources produce an explanatory empty result), `1` self-test failure.

---

## funnel-velocity

Funnel calibration vs market benchmarks + stage velocity. Three payloads, decreasing availability: **calibration** — your funnel rates (canonical `ever*` definition imported from `stats.mjs`) vs candidate-side benchmark ranges from `templates/benchmarks.yml` (override: `config/benchmarks.yml` or `--benchmarks <path>`); **waiting** — in-flight Applied rows and elapsed days vs the typical first-response window (per-row factual reporting; applied-date priority: status-log observation > `Applied YYYY-MM-DD` in tracker notes > unknown, never guessed); **velocity** — median/p75 days per stage hop (Applied→Responded→Interview→Offer, Applied→Rejected separate) folded from `data/status-log.tsv`.

Statistical honesty is enforced in code: right-censored counts printed next to every median ("n still waiting, excluded"), same-day catch-up hops excluded and counted, no comparative multiplier claims below n=20 applied, above-range output carries a selection-bias note, every benchmark mention carries its year + "directional". Coverage, orphaned tracker numbers, unparseable lines, and unknown sources are always reported.

```bash
node funnel-velocity.mjs             # human-readable
node funnel-velocity.mjs --json      # machine-readable result
node funnel-velocity.mjs --self-test
node funnel-velocity.mjs --benchmarks path/to/benchmarks.yml
```

Ledger line format (TSV, appended by `set-status.mjs`, `#`-prefixed lines are comments):

```text
{tracker#}\t{YYYY-MM-DD}\t{from}\t{to}\t{source}\t{note}
```

`from` may be `-` (unknown prior state); `to` = `-` retracts the row's latest observation; a later `correction`-source line with the same (tracker#, to) replaces the earlier observation's date. Sources: set-status | correction | backfill | manual (only set-status/correction feed day-math).

**Exit codes:** `0` always (missing tracker/ledger produce an explanatory empty result), `1` self-test or benchmarks-load failure.

---

## assessment-log

Logs "received a skills assessment" as a structured per-application event (eSkill, HackerRank, Criteria, Predictive Index, ...) instead of burying it in free-text notes. Each event records platform, subject tested, pass threshold vs score achieved (both optional — vendors often hide them), and a candidate-observed staleness note (e.g. "test content references Adobe Acrobat 9, a 2008-era version"; empty = no staleness observed). Events append to `users/{USER}/data/assessments.tsv` (user layer, created on first `add`, never rewritten). Aggregates count events, pass/fail (only when both threshold and score are known), and stale-flagged events per platform; malformed lines are always reported, never dropped silently.

```bash
node assessment-log.mjs --user <username> add --company Acme --report 042 --platform eSkill --subject "MS Office" --threshold 70 --score 92 --stale "references Adobe Acrobat 9 (2008-era)"
node assessment-log.mjs --user <username>             # per-event + per-platform table
node assessment-log.mjs --user <username> --json      # machine-readable result
node assessment-log.mjs --self-test
```

Log line format (TSV, one per line, `#`-prefixed lines are comments; for `report#`, `threshold%`, and `score%`, `-` or an absent trailing cell = unknown; an empty `stale_note` means no staleness was observed, not unknown):

```text
{YYYY-MM-DD}\t{company}\t{report#|-}\t{platform}\t{subject}\t{threshold%|-}\t{score%|-}\t{stale_note}
```

**Exit codes:** `0` success (a missing log produces an explanatory empty result), `1` invalid `add` arguments or self-test failure.

---

## update:check

Checks whether a newer version of career-ops is available upstream. Human-readable output is the default; pass `--json` for the complete machine result:

```bash
npm run update:check
node update-system.mjs check --json
```

Possible machine statuses:

| `status` | Meaning |
|----------|---------|
| `up-to-date` | Local version matches remote |
| `update-available` | Newer version exists (includes `local`, `remote`, `changelog`) |
| `dismissed` | User dismissed the update prompt |
| `offline` | Could not reach GitHub |

**Exit codes:** `0` always.

---

## update

Applies the upstream update. Creates a timestamped backup branch (`backup-pre-update-<version>-<YYYYMMDDTHHMMSSZ>`), fetches from the canonical repo, checks out only system-layer files, runs `npm install`, and commits. The timestamp is derived from UTC ISO time with separators and milliseconds removed (for example, `backup-pre-update-1.8.1-20260608T071302Z`). User-layer files (`cv.md`, `config/profile.yml`, `data/`, etc.) are never touched.

```bash
npm run update
```

**Exit codes:** `0` success, `1` lock conflict or safety violation.

---

## rollback

Restores system-layer files from the most recent backup branch created during an update. Rollback prefers the newest timestamped branch matching `backup-pre-update-<version>-<YYYYMMDDTHHMMSSZ>` and still accepts legacy `backup-pre-update-<version>` branches for older installs.

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

`scan_history.recheck_after_days` in `portals.yml` lets old `added` URLs become eligible for recheck after the configured number of days. If absent, scan-history dedup keeps the historical behavior and dedups forever. Permanent invalid statuses such as blocked host and malformed URL remain permanent.

For custom SSR pages, configure a tracked company with `scan_method: local_parser` and a `parser` block. The parser can be written in JavaScript, Python, or any language available as a local executable. Company-specific parsers usually already know their source URL and only need to print JSON jobs to stdout:

```yaml
parser:
  command: node
  script: scripts/parsers/example-company-jobs.js
  format: jobs-json-v1
```

Use `args` only for reusable parsers that intentionally accept runtime parameters such as `{careers_url}` or `{company}`.

If a parser writes full extraction artifacts for debugging or audit, store them under `users/{USER}/data/parser-output/{company}/`. `scan.mjs` reads stdout and does not require those JSON files after parsing. Keep generated JSON artifacts out of git.

When the ATS provider's list API returns a description, each new offer is fingerprinted for cross-listing detection. See [Cross-listing detection](#cross-listing-detection) under `scan:full` for details.

**Company blacklist (#1742):** if `users/{USER}/data/blacklist.md` exists (user layer, opt-in — see `templates/blacklist.example.md`), postings from listed companies are skipped, matched case- and punctuation-insensitively with the same company normalization the tracker scripts share. Skips are never silent: the run summary reports `N skipped (blacklist)` and the count is persisted to `users/{USER}/data/scan-runs.tsv` as `filtered_blacklist`. Pass `--include-blacklisted` to bypass the filter for auditing — matching postings flow through annotated (`note: blacklisted: {reason}` in `users/{USER}/data/pipeline.md`). No blacklist file = no filtering; nothing ever adds a company to the list automatically.

```bash
npm run scan -- --user <username>
node scan.mjs --user <username> --include-blacklisted   # audit: let blacklisted companies through, annotated
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

---

---

## scan:full

Reverse ATS discovery scanner. Where `scan.mjs` scans the companies you track in `users/{USER}/portals.yml`, this inverts the direction: it walks public directories of companies per ATS (Greenhouse, Lever, Ashby, Workday) and surfaces fresh postings matching your `portals.yml` `title_filter` / `location_filter` — no manual company curation. Company directories come from the public [job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator) dataset, cached in `users/{USER}/data/cache/` for 24 hours.

Postings without a usable publish date are skipped — a reverse scan is only useful for fresh postings. New matches are appended to `users/{USER}/data/pipeline.md` and `users/{USER}/data/scan-history.tsv` in the same format as `scan.mjs`.

### Cross-listing detection

`users/{USER}/data/scan-history.tsv` carries a **SimHash fingerprint** of the JD text in its 8th column (`jd_fingerprint`), and the original posting date in its 9th column (`postedAt`). The fingerprint column exists to catch a specific double-submission hazard: the same role posted by the direct employer **and** by a recruitment agency, often with the employer name stripped from the agency listing. URL dedup and company+role dedup both miss this pair because the URLs and company names are different — but agencies rarely rewrite the requirements text, so a near-identical JD body is a reliable signal.

How it works:

- When the ATS provider's list API returns a description field (e.g. Lever's `descriptionPlain`), the scanner computes a **64-bit SimHash** of the normalized text and stores it as the 8th column.
- SimHash is locality-sensitive: near-duplicate texts land within a few bits of each other. The scanner flags any two rows from **different companies** whose fingerprints are ≥ 92 % similar (at most 5 of 64 bits differ) and that appeared within a 90-day window.
- The check is **warn-only**: nothing is dropped automatically. If one side is an agency, apply through ONE channel only — a double submission burns the candidate with both parties.
- Postings without a usable description get an **empty fingerprint** and are never flagged. No body → no signal, no false positives.
- The fingerprint is computed **locally** from the text already returned by the API. No extra network request is made and the JD body itself is not stored in the TSV.

Same detection logic applies to `scan.mjs` (the standard portal scanner) — the sub-section above is shared between both commands.

```bash
npm run scan:full -- --user <username>                              # all ATS directories, last 3 days
node scan-ats-full.mjs --user <username> --since 7                  # postings from the last 7 days
node scan-ats-full.mjs --user <username> --ats greenhouse,workday   # subset of sources
node scan-ats-full.mjs --user <username> --limit 200                # max companies per ATS
node scan-ats-full.mjs --user <username> --dry-run                  # preview without writing
node scan-ats-full.mjs --user <username> --liveness                 # Playwright-verify matches first
node scan-ats-full.mjs --user <username> --md-out users/<username>/reports/scans # also write a dated markdown digest
```

**Exit codes:** `0` scan completed, `1` configuration error (no `users/{USER}/portals.yml`, unknown `--ats` source) or fatal scan error.

---

## tracker

SQLite **derived index** for the applications tracker (RFC #918, phase 1). `users/{USER}/data/applications.md` stays the source of truth; `users/{USER}/data/applications.db` is built from it by `sync` and is safe to delete at any time — it regenerates on the next sync. All writes keep going to the markdown exactly as today (`merge-tracker.mjs`, hand edits); the index is read-only infrastructure.

Why: at hundreds of rows a markdown table degrades structurally (encoding corruption, column drift, `|` inside cells shifting columns), and agents grepping it get model-dependent results. The index normalizes on sync, so a query returns the same rows for every model on every CLI — and corruption is detected at sync time instead of propagating silently.

Zero new dependencies — uses `node:sqlite`, built into Node ≥ 22.5.

```bash
node tracker.mjs sync --user <username>                     # (re)build users/<username>/data/applications.db
node tracker.mjs sync --user <username> --check             # diagnose corruption only, no write (exit 1 if issues found)
node tracker.mjs query --user <username> --status Applied --since 2026-05-01
node tracker.mjs query --user <username> --company acme --json
node tracker.mjs history --user <username> --id 42          # status transitions observed across syncs (Applied → Interview → ...)
node tracker.mjs export --user <username>                   # inverse: index → canonical markdown table on stdout
node tracker.mjs export --user <username> --out repaired.md # write to a file (existing file backed up to .bak first)
```

`query` and `history` auto-resync when the markdown changed since the last sync, so the index can never serve stale reads.

`sync` detects and reports the corruption classes markdown accumulates — mojibake placeholder cells, scores stranded in the status column, non-canonical statuses (resolved via `templates/states.yml` aliases), missing/duplicate ids, stray pipes — and normalizes them **in the index only**; the markdown is never modified. Fix at the source with `normalize-statuses.mjs` / `dedup-tracker.mjs`, then re-sync. Status changes between syncs accumulate in a `status_events` table, which gives `analyze-patterns.mjs` a real funnel instead of only the current snapshot.

`export` is the inverse of `sync` (round-trip `md → db → md` is lossless for clean input — enforced by `test-all.mjs`). It writes to stdout by default and never touches `applications.md` unless you explicitly pass it as `--out`. Phase 2 of #918 (DB becomes source of truth, markdown becomes a rendered view) is a separate, explicit per-user opt-in — not part of this script yet.

**Exit codes:** `0` success, `1` validation error, missing prerequisites (Node < 22.5, no `users/{USER}/data/applications.md` to index), or corruption found by `sync --check`.

---

## find

Resolves a report number, tracker number, or company/role fragment to its full pipeline identity: company, role, tracker#, report#, canonical status, PDF path (from `users/{USER}/data/pdf-index.tsv`), and report path. "Apply to #13" is ambiguous — report numbers and tracker row numbers diverge — and answering it used to require opening three files; this does it in one read-only lookup.

Zero dependencies, strictly read-only. Numeric queries match **both** the tracker # column and the report number from the Report link (`012` and `12` are the same number), so collisions between the two numbering schemes surface as multiple rows instead of a silent wrong pick. Text queries match company/role by case-insensitive substring, with the shared fuzzy matcher (`role-matcher.mjs`) as fallback for multi-word phrases.

```bash
node find.mjs --user <username> 13                # report# OR tracker# 13 — shows both if they differ
node find.mjs --user <username> acme              # company fragment
node find.mjs --user <username> "data engineer"   # role phrase (fuzzy via role-matcher)
node find.mjs --user <username> acme --json       # machine-readable output
```

Multiple matches print as a table; zero matches print a clean message.

**Exit codes:** `0` at least one match, `1` no match, missing query, or no `users/{USER}/data/applications.md`.

---

## paste-reply

Manual, no-Gmail input path into `reply-watch.mjs`'s classification pipeline (#1802). `paste-reply.mjs` normalizes a pasted (or file-provided) email's subject/from/body into the exact candidate shape `reply-watch.mjs` expects and appends it to `users/{USER}/data/reply-candidates.json` — existing candidates are never overwritten. It does not classify the reply itself and never touches `users/{USER}/data/applications.md`.

```bash
npm run paste-reply -- --user <username>                    # interactive
node paste-reply.mjs --user <username> --file email.txt      # file input
```

`--file` format (header lines optional, blank line separates headers from body):

```text
Subject: <subject line>
From: <sender>

<body text...>
```

If no `Subject:`/`From:` header lines are found, the whole file is treated as the body. After appending, run `node reply-watch.mjs --user <username>` to classify the new candidate and review suggested tracker updates.

**Exit codes:** `0` candidate appended, `1` missing `--file` argument, input file not found, or no subject/body text found.

---

## stats.mjs

Aggregates lifetime pipeline stats. Stats include tracker, scanner, portals, follow-ups and runs. Reads from `users/{USER}/data/applications.md`, `users/{USER}/data/scan-history.tsv`, `users/{USER}/portals.yml`, `users/{USER}/data/follow-ups.md`, and `users/{USER}/data/scan-runs.tsv`. If a file doesn't exist yet, the section turns into null.

```bash
node stats.mjs --user <username>            # human-readable table
node stats.mjs --user <username> --json     # machine-readable result
```
On a fresh clone, with no data yet, the JSON format is as follows:

```
{
  "metadata": {
    "generatedAt": "2026-07-07",
    "sources": {
      "tracker": false,
      "scanHistory": false,
      "followups": false,
      "portals": false,
      "scanRuns": false
    }
  },
  "tracker": null,
  "funnel": null,
  "scan": null,
  "portals": null,
  "followups": null,
  "runs": null
}
```

With --summary it returns:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pipeline Stats — 2026-07-07
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tracker:    — no data (users/{USER}/data/applications.md missing)
Scanner:    — no data (users/{USER}/data/scan-history.tsv missing)
Portals:    — no data (users/{USER}/portals.yml missing)
Follow-ups: — no data (users/{USER}/data/follow-ups.md missing)
Runs:       — no data (users/{USER}/data/scan-runs.tsv missing; created by the next scan)
```

---

## users/{USER}/data/scan-runs.tsv

`scan.mjs` appends one row to this file after each non-dry scan run, recording how many companies/boards it checked, how many postings it found vs. filtered out vs. flagged as duplicates vs. added, and how many errors occurred. `--dry-run` scans never write to this file. Stats appended include:

* `timestamp` — ISO timestamp of the scan
* `status` — always `completed` for now
* `companies` — number of companies scanned this run
* `boards` — number of job boards scanned this run
* `found` — total postings found
* `filtered_title` — filtered out by title mismatch
* `filtered_tier` — filtered out by tier
* `filtered_location` — filtered out by location
* `filtered_salary` — filtered out by salary
* `filtered_content` — filtered out by content
* `filtered_cooldown` — skipped because you recently applied to the same company + role and are still in the waiting period
* `dupes` — duplicate postings skipped
* `new_added` — new postings actually added to the pipeline
* `errors` — number of errors during the run
* `filtered_blacklist` — skipped because the company is on your `users/{USER}/data/blacklist.md` do-not-apply list (#1742)

As the project is in continuous development, to parse for a stat we recommend doing it by column header instead of position.
