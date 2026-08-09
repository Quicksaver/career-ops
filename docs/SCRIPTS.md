# Scripts Reference

All scripts live in the project root as `.mjs` modules. Most are exposed via
`npm run <name>`; agent-invoked utilities (bottom section) run via
`node <script>` directly.

Scripts that read or write user data require `--user {USER}` or `CAREER_OPS_USER={USER}`. User data lives under `users/{USER}/`.

## Quick Reference

| Command | Script | Purpose |
|---------|--------|---------|
| `npm run go -- --user {USER}` | `go-runner.mjs` | Deterministic end-to-end sourcing coordinator with streamed human output (`--json` for machines) |
| `npm run cleanup:runs -- --user {USER}` | `cleanup-runs.mjs` | Delete timestamped verify/go run directories older than 10 days |
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
| `npm run jd:similarity` | `jd-similarity.mjs` | Compare a new JD with a previous JD/CV and recommend reuse, edits, or regeneration |
| `npm run img-to-pdf` | `img-to-pdf.mjs` | Convert a single screenshot/image into a single-page PDF |
| `node build-cv-html.mjs` | `build-cv-html.mjs` | Build deterministic HTML from a structured CV payload under the active user's output root |
| `node build-cv-latex.mjs` | `build-cv-latex.mjs` | Build .tex from structured JSON payload |
| `npm run sync-check` | `cv-sync-check.mjs` | Validate CV/profile consistency |
| `npm run patterns` | `analyze-patterns.mjs` | Analyze tracker outcomes and report patterns |
| `npm run upskill` | `upskill.mjs` | Aggregate skill-gap map from tracked reports or targeted analysis with `--url-text <url|file>` |
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
| `npm run company:funded` | `company-funded.mjs` | Review-first discovery of recently funded companies |
| `npm run validate:portals` | `validate-portals.mjs` | Validate portals.yml shape before scanning |
| `npm run tracker` | `tracker.mjs` | SQLite derived index over applications.md — sync/query/history/export |
| `npm run find` | `find.mjs` | Resolve a report#/tracker#/company query to its full pipeline identity |
| `npm run invite-match -- --user {USER}` | `invite-match.mjs` | Fuzzy-match a pasted interview-invite email against `users/{USER}/data/applications.md` |
| `npm run application:init -- --user {USER}` | `application-artifacts.mjs` | Initialize one versioned application-scoped JD/CV/PDF artifact bundle under the active user's output root |
| `npm run paste-reply -- --user {USER}` | `paste-reply.mjs` | Manual/no-Gmail input into the active user's reply-watch pipeline |
| `npm run freshness` | `check-table-freshness.mjs` | Staleness validator for jurisdiction data tables (`as_of` / `next_effective` watchdog) |
| `node jd-skill-gap.mjs --user {USER} <jd-file>` | `jd-skill-gap.mjs` | Zero-LLM JD requirements check against the active user's CV |
| `npm run openai:tailor` | `openai-tailor.mjs` | Tailor a CV via any OpenAI-compatible endpoint (headless companion to `openai-eval.mjs`) |
| `npm run or` | `openrouter-runner.mjs` | Run scan/evaluate/pipeline/apply on OpenRouter free models — no Claude CLI required |
| `npm run reconcile` | `reconcile-pipeline.mjs` | Remove batch-evaluated offers from pipeline.md "Pendientes" |
| `npm run cover-letter` | `generate-cover-letter.mjs` | Render a cover-letter JSON payload to PDF |
| `npm run verify:portals` | `verify-portals.mjs` | Probe ATS endpoints to confirm portals.yml slugs resolve (network) |
| `node fix-slugs.mjs --user {USER}` | `fix-slugs.mjs` | Write `verify-portals.mjs`'s suggested ATS slug fixes back to the active user's portals.yml (dry run by default, `--fix` to write) |
| `npm run reposts` | `detect-reposts.mjs` | Flag re-listed (ghost) postings from scan history |
| `npm run gemini:eval` | `gemini-eval.mjs` | Evaluate a JD with Google Gemini (free-tier alternative) |
| `npm run ollama:eval` | `ollama-eval.mjs` | Evaluate a JD with a local Ollama model |
| `npm run openai:eval` | `openai-eval.mjs` | Evaluate a JD via any OpenAI-compatible endpoint |
| `npm run star` | `match-star.mjs` | Match a behavioural question to your best STAR story (zero-LLM) |
| `npm run archive` | `archive-posting.mjs` | Save a live job posting as PDF before it disappears |
| `npm run prepare:application` | `prepare-application.mjs` | Print an ATS prefill summary (read-only, never POSTs) |
| `npm run build:dashboard` | `build-dashboard.mjs` | Build the Go TUI dashboard binary cross-platform |
| `node upgrade-tests.mjs --pr-gate` | `upgrade-tests.mjs` | Upgrade an install seeded from the newest old release to this commit and prove user data survived (CI gate; `--canary` proves the gate can fail) |

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

At startup, `go-runner.mjs` applies the same 10-day run-artifact cleanup exposed
by `npm run cleanup:runs`. A fully completed go run is immediately compacted to
one `summary.json` file. Failed, interrupted, partial, and blocked runs retain
their detailed artifacts until the 10-day cleanup removes the whole run
directory.

---

## cleanup:runs

Deletes timestamped run directories strictly older than 10 days from both
`users/{USER}/data/verify-runs/` and `users/{USER}/data/go-runs/`:

```bash
npm run cleanup:runs -- --user <username>
npm run cleanup:runs -- --user <username> --json
```

Cleanup is applied immediately; there is no dry-run mode. It is skipped while
another go or verify runner is active for the same user. Non-timestamped
directories are ignored.

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

`verify-runner.mjs` reviews findings in calls of at most five. Independent dependency lanes run concurrently according to `--parallel`/`batch.parallel`; overlapping tracker, report, and orphan identities remain in one sequential lane so prior decisions stay binding. Every reviewer is read-only with separate input/output/log files. Only the parent applies supported deterministic actions or writes ledgers, serially, after all lanes and aggregate consistency checks succeed. After each review call, human mode emits one compact stdout line per finding: `reviewed X/Y, job(s) #{related IDs}, {issue code} → {classification}`. Tracker IDs are preferred, with report IDs used for report-only and orphan findings. At the end, every still-unresolved non-manual finding is repeated as `unresolved {level}, job(s) #{related IDs}, {issue code}`, followed by a separate compact block for still-active `manual_review` decisions. This keeps all remaining work visible without scrolling and does not print manual items twice. Full rationale, evidence, and action details remain available when a run does not complete. A completed run is immediately compacted to `summary.json`; failed, interrupted, or partial runs keep their detailed artifacts. The terminal tail is a compact count summary and, on failure, only the actual error. With `--json`, stdout is the complete machine result and progress—including the early run ID—moves to stderr; both recaps are human mode only and do not alter the machine JSON contract. `--quiet` suppresses terminal progress; the final human summary still prints the run directory. Seen records match the finding level, stable ID, and full-payload SHA-256 fingerprint; changed findings therefore resurface automatically. It reports `completed` when all raw findings are resolved or seen, `partial` when human decisions remain, and `failed` for operational/schema/mutation failures.

Semantic validation aggregates every invalid item in a five-finding response and retries only that chunk, supplying the full error list to the reviewer. `--review-retries N` defaults to `2` and accepts `0` through `5`. For orphan archives, the model chooses the classification/disposition while the runner mechanically derives the exact report path from the raw finding and sets `tracker_tsv` to `null`; the model cannot redirect the mutation to another file. Orphan restores canonicalize project-relative reviewer paths to the exact user-root-relative `reports/...` and `batch/tracker-additions/merged/...` forms before validation. Restoration accepts legacy merged files containing literal `\t` separators, while current batch artifact validation still requires real tabs. Duplicate plans are also type-specific: tracker warnings retain only tracker IDs, report warnings retain only report files, and both exact candidate partitions are validated before checkpointing. Cross-finding disposition/keeper consistency is required only when tracker and report warnings describe the same exact report set; a broader report warning containing extra orphan reports does not invalidate a proven tracker-backed subset. A validated chunk is written as an atomic checkpoint, but actions remain pass-atomic and begin only after all lanes and cross-chunk consistency checks pass.

A normal invocation always performs a fresh review and ignores old run artifacts. `--resume-run RUN_ID` is an explicit recovery option for an interrupted or operationally failed run: it reuses only checkpoints whose signature exactly matches the active user, chunk findings, and prior lane decisions, then mechanically normalizes and revalidates each decision under the current contract. When a duplicate phase completed but its following apply phase failed, exact-fingerprint-matched apply artifacts are resumed directly and the completed duplicate action result is retained; the remaining findings are not sent through review again. Once apply and its raw recheck complete, the exact post-review verification is checkpointed too; a matching resume starts at the next pass and reuses the committed action results instead of replaying that pass. Raw output, invalid responses, and mismatched checkpoints are rerun. The `--json` result records semantic retry limit/usage, reused checkpoints, and mechanical normalizations under `review_resilience`.

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

## upgrade-tests

The dynamic upgrade regression harness (#2358). `update-system.mjs` has the
largest blast radius in the repo — it rewrites system files in place on someone
else's install — and this is the only test that exercises a *real* upgrade
against a seeded user install instead of asserting on the updater's source.

It is hermetic: a temporary `GIT_CONFIG_GLOBAL` rewrites the canonical GitHub
URL to a local bare mirror whose `main` ref is forced to the commit under test,
so no leg ever reaches the network. The old install runs its own `apply`, which
self-reexecs into the target updater — so the migration code being tested is the
one the PR ships, not the one already installed.

Two modes:

```bash
node upgrade-tests.mjs --pr-gate    # newest release tag that is an ancestor of HEAD -> this commit
node upgrade-tests.mjs --canary     # plant a user-file clobber; the harness MUST report it
```

`--pr-gate` picks the newest release tag that is an ancestor of `HEAD`, seeds an
install from that era's fixture state, and upgrades it to the commit under
review. The leg is red unless all of it holds: `apply` exits 0; a system file
that genuinely changed between the two revisions now carries the target's blob
(the non-vacuity oracle — VERSION is never used, since `apply` has no version
gate); every user file is byte-identical; every path the new manifest adds is
present; `data/applications.md` still parses with the expected row and status
counts; `data/salary-observations.tsv` still parses; and `doctor.mjs --json`
reports `onboardingNeeded: false`. It needs the release tags, which is why CI
checks out with `fetch-depth: 0`.

`--canary` exists because a gate never seen red proves nothing. It commits a
poisoned mirror — `cv.md` tracked and added to `SYSTEM_PATHS`, so the old
updater checks it out over the user's CV — and then requires the harness to
report that clobber. A canary that comes back green means the harness detected
the planted damage; a red canary means the gate is incapable of failing and its
green runs are worthless.

Both modes run on every PR, as the `upgrade-gate` job in
`.github/workflows/test.yml`.

---

## fix-slugs

Write-side twin of `verify-portals.mjs` (#1703). `verify-portals` already probes every tracked company's ATS slug and, for a failing Greenhouse/Ashby/Lever entry, cross-probes slug variants across all three ATSes and attaches `suggested: { ats, slug }` when one resolves. That tool is read-only; this one patches the matching `tracked_companies` entry in `portals.yml`. It imports the same probe and suggestion logic rather than re-implementing it, so the two can never disagree about what a broken slug is (network, like `verify-portals`).

**It is a dry run by default: writing requires an explicit `--fix` (or its alias `--apply`).** A bare `node fix-slugs.mjs` prints the diff it *would* apply and changes nothing, so the safe invocation is also the shortest one. `--dry-run` exists only to say that out loud.

Only entries `verify-portals` classifies as `missing` **and** for which it found a `suggested` alternate are touched. Live entries, empty entries, and entries whose slug genuinely could not be resolved are left completely alone.

The file is edited as text — line-level surgery inside the matching company's block — rather than through a YAML parse-and-dump round trip, because `portals.yml` carries hand-written comments and documentation blocks that `yaml.dump()` would silently discard.

```bash
node fix-slugs.mjs --user {USER}                            # dry run (default, safe): print the diff, write nothing
node fix-slugs.mjs --user {USER} --dry-run                  # same as above, explicit
node fix-slugs.mjs --user {USER} --fix                      # write the resolved slugs back to portals.yml
node fix-slugs.mjs --user {USER} --apply                    # alias for --fix
node fix-slugs.mjs --file templates/portals.example.yml
```

The default path is `portals.yml`, overridable with `--file` or the `CAREER_OPS_PORTALS` environment variable. A missing portals file is reported and treated as nothing to do, not as an error.

**Exit codes:** `0` on every normal run, `1` only if the run itself fails. Unlike `check-table-freshness`, pending fixes in a dry run do **not** fail the run, so this is a maintenance tool rather than a CI gate.

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

## build-cv-latex.mjs

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

Aggregates skill gaps across every tracked report or analyzes one target JD. It extracts skill tokens from each report's Machine Summary `hard_stops`/`soft_gaps` and Gap table, removes skills already present in `users/{USER}/cv.md` and `users/{USER}/config/profile.yml` (exact-alias matching only — an umbrella term never suppresses a specific skill), and weights each aggregate gap by inverse report score (`5.0 − score`, counted once per report). Tiers use the share of low-fit reports naming the gap; schema and coverage metadata keep comparisons honest. Targeted mode accepts a URL or local JD file and applies an SSRF egress guard before fetching. The script emits data only; the `upskill` mode may layer a web-searched, free-first learning plan onto the aggregate result.

```bash
npm run upskill -- --user <username>
npm run upskill -- --user <username> --json
npm run upskill -- --user <username> --min-reports 3
node upskill.mjs --user <username> --url-text path/to/jd.md
node upskill.mjs --user <username> --url-text https://boards.greenhouse.io/acme/jobs/123
node upskill.mjs --user <username> https://company.example/jobs/123
node upskill.mjs --self-test
```

**Exit codes:** `0` analysis succeeded (including a graceful insufficient-data result), `1` self-test failure.

---

## salary-gap

Folds compensation observations into per-application desired/advertised/actual values and gap aggregates. Sources: `users/{USER}/reports/*.md` Machine Summary `advertised_comp` (advertised, source `jd` — historical reports backfill automatically), `users/{USER}/data/salary-observations.tsv` (desired/actual/stated, append-only), and `users/{USER}/config/profile.yml` `compensation.target_range` (desired default). Fold precedence: highest trust tier wins, then latest date (`actual`: contract > offer-letter > recruiter-verbal > user). Aggregates group by (company, role) and per currency — no FX conversion. Unparseable amounts, orphaned tracker numbers, sample sizes, and staleness are always reported.

```bash
node salary-gap.mjs --user {USER}                          # table + data-quality section
node salary-gap.mjs --user {USER} --json                   # machine-readable result
node salary-gap.mjs --user {USER} --stated-for <tracker#>  # prior `stated` observations for one tracker#, JSON
node salary-gap.mjs --self-test
```

Observation line format (TSV, one per line, `#`-prefixed lines are comments):

```text
{tracker#}\t{YYYY-MM-DD}\t{desired|advertised|actual|stated}\t{amount}\t{currency}\t{source}\t{note}\t{round}\t{interviewer}
```

Amounts: number + optional k/K suffix, ranges allowed ("80-90k"), annual gross unless noted. Sources: jd | profile | user | recruiter-verbal | offer-letter | contract.

**`stated` observations** are a narrower-purpose addition (#1852): a specific compensation number the candidate verbally committed to, in a specific interview round, to a specific interviewer — so a later round doesn't accidentally contradict it. `round` and `interviewer` are two optional trailing columns, meaningful only for `stated` rows (existing rows without them still parse — they default to `''`). `stated` observations carry no trust tier and never participate in the desired/advertised/actual fold or gap math; look them up with `getStatedObservations(observations, num)` or `--stated-for`. Interview-prep modes (`modes/interview/plan.md`, `modes/interview-prep.md`) check this before generating comp-related prep content — see their Inputs sections.

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

## company-history

Read-only per-company evidence-card aggregator. Joins `users/{USER}/data/applications.md` (tracker), `users/{USER}/data/follow-ups.md`, and `users/{USER}/data/scan-history.tsv` per company (and a `funnel-velocity.mjs` status-log source, loaded defensively via dynamic `import()` — probed for optional applied-date/median helpers and degrading to `false` when they are absent). Companies are joined on a normalized key (`normalizeCompany`); rows whose company normalizes to an empty key (e.g. non-Latin names that strip to nothing) are never merged into another company's card — they are excluded and counted in `dataQuality.unjoinable` instead.

Each card covers two independent fact axes, never combined into a single verdict:

- **`responsiveness`** — has this company ever responded to you, or gone silent on an Applied row past the silence window? A rejection counts as a response (it's an answer, not silence). Labels: `responded-before`, `silent-on-you`, `mixed`, `no-history`. Rows younger than the silence window are **pending** — right-censored, never labeled silent. Facts older than 365 days are **stale** and excluded from label computation unless `--include-stale` is passed. Follow-ups sent never change the label — they only annotate a silent fact's `confidence` (`confirmed-by-followups` vs `unconfirmed`).
- **`postingChurn`** — does this company repost the same role repeatedly (evergreen requisition / re-opened search), sourced from `detect-reposts.mjs` clusters over `users/{USER}/data/scan-history.tsv`. Labels: `reposts-detected`, `none-detected`, `no-scan-data`.

The script deliberately reports **facts, not verdicts** — output is always descriptive and past-tense ("silent 34d since 2026-05-01"), never "ghosted" or "risk". Every silent fact carries a dated `clearInstruction` (the exact `set-status.mjs` command to run if the company actually did respond and it just wasn't logged), and every card with a silent fact is accompanied by an innocent-explanations line: high-volume inboxes, evergreen requisitions, re-opened searches, and the candidate's own unlogged responses all produce the same raw signals as genuine silence. Before trusting the output against real data, run a dry read (`node company-history.mjs --user {USER} --summary`) and sanity-check a few cards where you already know the real story.

```bash
node company-history.mjs --user {USER}                        # full JSON evidence cards to stdout
node company-history.mjs --user {USER} --summary               # human-readable cards (hygiene nudge, then silent-first, window caveat printed once)
node company-history.mjs --user {USER} --company "Acme"         # single-card lookup (unknown company returns the minimal no-history/no-scan-data shape)
node company-history.mjs --user {USER} --silence-window 21      # override the default silence window in days
node company-history.mjs --user {USER} --include-stale          # include facts older than 365d in label computation
node company-history.mjs --self-test
```

Default silence window: `templates/benchmarks.yml` `days_first_response.range_days[1] * 2` when that file exists, else `28` days.

**Exit codes:** `0` success, including empty/no-data runs (a missing tracker, follow-ups, or scan-history source degrades gracefully rather than failing), `1` unrecognized CLI flag or an unexpected runtime error.

---

## contacts

Your job-search phonebook, exportable to your phone. Reads `data/contacts.tsv` (one contact per line — the schema is the vCard fields, nothing more) and emits vCard 3.0 (`VERSION:3.0` for iOS/Android import compatibility) with CRLF line endings, byte-safe 75-octet line folding, and a stable deterministic UID `careerops-{uidPart(name)}--{uidPart(company)}` (double-dash boundary between the two parts). Each `uidPart` is the lowercase slug of the raw value (non-alphanumeric runs collapsed to single dashes, ends trimmed) suffixed with an 8-hex sha1 of the *raw* value — e.g. `jane-doe-cac7bbb6`; when the slug is empty — a fully non-ASCII value such as a CJK name — the part is the bare 8-hex hash. Hashing the raw value (not the lossy slug) keeps distinct inputs that slug identically — e.g. `José` and `Josè` both slug to `jos` (the accented char drops out), and `Acme Inc` and `Acme, Inc.` both to `acme-inc` — from colliding into one UID. Re-importing updates existing entries instead of duplicating them on platforms that honor vCard UID (iOS fallback: assign imports to a group, delete the group to bulk-remove). `--caller-id` renders the display name as `Jane Doe (Acme recruiter)` so the lock screen tells you which recruiter is calling — useful when a phone number is known (often it isn't). Malformed rows are reported in a `quality` block, never dropped silently.

```bash
node contacts.mjs --user {USER}                    # JSON (contacts + quality + total)
node contacts.mjs --user {USER} --summary          # human-readable table
node contacts.mjs --user {USER} --vcf [path]       # write vCard file (default users/{USER}/output/contacts.vcf)
node contacts.mjs --user {USER} --vcf --caller-id  # FN as "Jane Doe (Acme recruiter)"
node contacts.mjs --self-test
```

Contact line format (TSV, one per line, `#`-prefixed lines are comments):

```text
{name}\t{company}\t{type}\t{title}\t{phone}\t{email}\t{linkedin}\t{tracker#|-}\t{notes}
```

`type`: recruiter | hiring-manager | peer | interviewer | other — optional; when present it must be one of the enum, else it is flagged in `quality`. Only name + company are required (>= 4 cells); all channels are optional; `-` for the tracker number when the contact precedes an application. Lines are updated in place when a contact's details change — unlike the append-only salary log. If two lines resolve to the same generated UID (`careerops-{uidPart(name)}--{uidPart(company)}` — normally rows with the same name + company), the LAST one wins the `--vcf` export (JSON keeps all rows and reports the clash in `quality.duplicates`). Import: send the `.vcf` to your phone (AirDrop/email/messaging) and open it — iOS Contacts offers "Add All Contacts", Android imports via Contacts → Fix & manage → Import.

**Exit codes:** `0` always (an empty/missing store prints an explanatory message and writes no file), `1` self-test failure or a `--vcf` path escaping the project directory.

---

## weekly-digest

Rolls up `interview-prep/sessions/*.md` — the structured, machine-readable transcripts `interview/debrief` and `interview/practice` already write (schema in `interview-prep/sessions/README.md`) — into a single digest for a date range (default: the current ISO week, Monday–Sunday). Groups sessions by company/role into a per-company round rollup (round type + date per round), counts `<!-- competency: tag[, tag...] -->` annotations across all sessions in range and flags any tag appearing 2+ times as recurring, and — best-effort, since `interview-prep/question-bank.md` has no fixed schema — attributes 🔴-tagged lines to whichever in-range company's heading they fall under. Purely mechanical: front-matter parsing, date filtering, and tag counting, no LLM judgment calls.

```bash
node weekly-digest.mjs --user {USER}                                   # JSON, current ISO week
node weekly-digest.mjs --user {USER} --summary                          # human-readable digest
node weekly-digest.mjs --user {USER} --from 2026-07-13 --to 2026-07-19  # explicit date range
node weekly-digest.mjs --dir path/to/sessions             # override sessions dir (test isolation)
node weekly-digest.mjs --self-test
```

`interview-prep/sessions/` is gitignored, and session content contains real interviewer names and companies — see the "Privacy — important" section of `interview-prep/sessions/README.md` for the source of that statement. A fresh clone or a week with no interviews reports "no interviews recorded in this range" and exits `0`, never an error.

**Exit codes:** `0` always (missing sessions dir/question bank, or an empty range, produce an explanatory empty result), `1` invalid `--from`/`--to` or self-test failure.
## check-table-freshness

Staleness validator for the jurisdiction data tables (umbrella #2026). The tables' correctness decays on a schedule — minimum wages adjust annually, pre-announced legal changes land on known dates — and every row already carries the metadata to watch: a mandatory `as_of` verification date and, for rate-style rows, `next_effective`. This script is the watchdog: zero LLM, zero network, zero writes.

Discovery is schema-agnostic: any `templates/*.yml` (non-recursive) whose parsed YAML contains at least one object row with an `as_of` field is treated as a jurisdiction table — rows may sit in a top-level array or in an array under any top-level key (e.g. `covenants:`). Files without `as_of` rows (`states.yml`, `portals.example.yml`, `benchmarks.yml`) are silently skipped, so new tables are picked up automatically with no per-table registration. On a checkout with no jurisdiction tables yet, the script reports zero tables and exits `0` — that is the designed empty state, not an error.

Two finding types:

- **`expired`** (hard) — the row has a `next_effective` date, today ≥ `next_effective`, and the row was not re-verified on or after that date (`as_of` < `next_effective`): the pre-announced change has arrived and the table hasn't been updated.
- **`review-due`** (soft) — `as_of` is older than the review threshold (default 12 months): nobody has re-verified the row in a legal cycle. Threshold precedence: `--max-age-months` flag > `config/profile.yml` `table_freshness.max_age_months` > default. Thresholds are strict positive integers — an invalid flag value is a usage error (exit 1, fail-fast, never a silent fallback); an invalid config value is reported as a warning and the default applies.

Each finding copies the row's `sources`, so whoever picks it up knows exactly where to re-verify. Malformed or missing dates produce a warning entry and the row is skipped — never a crash: once an array qualifies as a row-set (≥1 row with `as_of`), a sibling row that *forgot* its mandatory `as_of` warns too, instead of silently vanishing from validation. All date math is UTC-midnight calendar math (no time-of-day drift); dates in tables are quoted `YYYY-MM-DD` strings.

```bash
npm run freshness
node check-table-freshness.mjs --user {USER}                    # JSON
node check-table-freshness.mjs --user {USER} --summary          # human-readable table
node check-table-freshness.mjs --user {USER} --max-age-months 6 # override review threshold
node check-table-freshness.mjs --user {USER} --today 2026-10-02 # deterministic date for tests
node check-table-freshness.mjs --self-test
```

**Exit codes (CI-friendly):** `1` if any `expired` finding or on invalid usage (bad `--max-age-months` / `--today` values), `0` otherwise — `review-due` alone never fails the run, so a scheduled job only goes red when a known legal change has actually landed unaddressed.

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

Tests whether job posting URLs are still live. Two rungs: a zero-token ATS API check first (`liveness-api.mjs` — Greenhouse, Lever, Ashby, Workday), falling back to headless Chromium (`liveness-browser.mjs`) for non-ATS pages or when the API is inconclusive. The browser rung detects expired patterns (e.g. "job no longer available"), HTTP 404/410, ATS redirect patterns, and apply-button presence, and supports multi-language expired patterns (English, German, French).

Per-job ATS endpoints (Greenhouse, Lever, Workday) treat a 200 as proof the posting is live; Ashby's public API is org-level (the whole job board), so that rung parses the board and confirms the specific job id is still listed. A definitive 404/410 from any ATS API is authoritative and short-circuits the browser check entirely — zero tokens, no browser launch.

```bash
npm run liveness -- https://example.com/job/123
npm run liveness -- https://a.com/job/1 https://b.com/job/2
npm run liveness -- --file urls.txt
npm run liveness -- --no-fallback https://a.com/job/1   # stay fully headless (no headed retry on anti-bot walls)
npm run liveness -- --throttle=5000 --file urls.txt      # jittered wait between checks (rate-based WAFs)
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

**Parallel search lanes (#2271):** all four of `scan.mjs`'s files are overridable by environment variable, so a second search with different targeting (a bridge/income track, a career-change track, or a partner sharing the checkout) can be fully self-contained in one clone:

| Variable | Default |
|---|---|
| `CAREER_OPS_PORTALS` | `users/{USER}/portals.yml` |
| `CAREER_OPS_PROFILE` | `users/{USER}/config/profile.yml` |
| `CAREER_OPS_PIPELINE` | `users/{USER}/data/pipeline.md` |
| `CAREER_OPS_SCAN_HISTORY` | `users/{USER}/data/scan-history.tsv` |

```bash
CAREER_OPS_PORTALS=users/{USER}/portals.bridge.yml \
CAREER_OPS_PIPELINE=users/{USER}/data/pipeline.bridge.md \
CAREER_OPS_SCAN_HISTORY=users/{USER}/data/scan-history.bridge.tsv \
  node scan.mjs --user {USER}
```

Give a lane its own `CAREER_OPS_SCAN_HISTORY`, not just its own pipeline. That file is the dedup source, so lanes sharing it silently suppress each other: a posting surfaced in one lane counts as a duplicate in the other and never appears there, with only the `Duplicates: skipped` counter to show for it.

Defaults are unchanged, so a single-lane setup needs none of this. Note that the remaining outputs (`users/{USER}/data/scan-runs.tsv`, `users/{USER}/data/portal-health.tsv`, `users/{USER}/data/applications.md`) are still shared across that user's lanes, so `stats.mjs` and the other analytics scripts pool the lanes together.

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

Reverse ATS discovery scanner. Where `scan.mjs` scans the companies you track in `users/{USER}/portals.yml`, this inverts the direction: it walks public directories of companies per ATS (Greenhouse, Lever, Ashby, Workday, iCIMS) and surfaces fresh postings matching your `portals.yml` `title_filter` / `location_filter` — no manual company curation. Company directories come from public datasets and are cached in `users/{USER}/data/cache/`.

Postings without a usable publish date are skipped — a reverse scan is only useful for fresh postings. New matches are appended to `users/{USER}/data/pipeline.md` and `users/{USER}/data/scan-history.tsv` in the same format as `scan.mjs`.

`data/blacklist.md` is respected here too: blacklisted companies are skipped by default and reported in the summary. Pass `--include-blacklisted` to audit them instead; matching postings flow through annotated (`note: blacklisted: {reason}` in `data/pipeline.md`).

### Cross-listing detection

`users/{USER}/data/scan-history.tsv` carries a **SimHash fingerprint** of the JD text in its 8th column (`jd_fingerprint`), and the original posting date in its 9th column (`postedAt`). The fingerprint column exists to catch a specific double-submission hazard: the same role posted by the direct employer **and** by a recruitment agency, often with the employer name stripped from the agency listing. URL dedup and company+role dedup both miss this pair because the URLs and company names are different — but agencies rarely rewrite the requirements text, so a near-identical JD body is a reliable signal.

The 12th column (`normalized_company`) stores the **canonical company key** — the raw company (col 5) run through the shared `normalizeCompanyName` (lowercased, punctuation/whitespace folded, trailing legal-entity suffixes stripped), so `Acme Inc.`, `Acme, Inc.` and `ACME  Inc` all resolve to `acme`. It is written at scan time so repost/name matching (`detect-reposts.mjs`) keys on a stable value instead of re-deriving it or routing a legitimacy signal through script execution. The column is **additive and trailing**: rows written before it existed simply omit it, and consumers normalize the raw company on the fly for those rows (backward-compatible). All columns beyond col 7 are append-only — index-based readers (including the web parser, which reads only cols 0-6) are unaffected.

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
node scan-ats-full.mjs --user <username> --include-blacklisted      # audit blacklist matches instead of skipping
node scan-ats-full.mjs --user <username> --md-out users/<username>/reports/scans # also write a dated markdown digest
npm run scan:seeds -- --user <username>                             # probe VC portfolios (--seeds yc,a16z)
npm run scan:yc -- --user <username>                                # Y Combinator portfolio only
```

`--seeds <list>` fetches comma-separated VC portfolio sources and probes those companies through the ATS providers instead of, or in addition to, the directory walk. Other flags include `--resume`, `--verbose`, `--json`, `--include-undated`, and `--shuffle`.

### DNS pacing

A full sweep resolves one hostname per Workday and iCIMS tenant — 13,889 distinct hostnames across the current datasets (3,781 Workday + 10,108 iCIMS), against 3 for Greenhouse, Lever and Ashby combined. Those lookups are irreducible (nothing to cache: every hostname is distinct), and issued unpaced they trip the per-client rate limit on a resolver like Pi-hole, which then refuses queries for the whole machine — the scan reports thousands of misleading `fetch failed` lines while the boards themselves are fine (#2229).

Uncached, non-coalesced lookups are therefore paced at **400 per minute** by default. The token is spent *before* `dns.lookup()` runs, so a name answered locally — from `/etc/hosts`, say — still costs one; the ceiling meters what the process asks to resolve, not what leaves the machine.

How many upstream queries that becomes depends on the OS resolver: `dns.lookup()` delegates to `getaddrinfo`, which may answer without any query at all, but on a typical glibc host with `autoSelectFamily` it emits an A **and** an AAAA query — roughly 800 queries/minute, measured against a Pi-hole. That is under a stock Pi-hole's 1,000/minute with headroom for the rest of the machine; size it against your own resolver's limit.

Cache hits and lookups that coalesce onto an in-flight one are free, so only uncached, non-coalesced lookup keys count against the ceiling — a hostname not in the cache, or a cached one requested with different resolver options (the cache key is hostname plus `family`/`all`/`hints`/`verbatim`).

```bash
CAREER_OPS_DNS_LOOKUPS_PER_MIN=800 npm run scan:full -- --user <username>   # raise the ceiling
CAREER_OPS_DNS_LOOKUPS_PER_MIN=0 npm run scan:full -- --user <username>     # no pacing (pre-#2229 behaviour)
CAREER_OPS_NO_DNS_CACHE=1 npm run scan:full -- --user <username>            # no DNS cache AND no pacing
```

The cost is real: a full Workday + iCIMS sweep becomes DNS-bound at roughly 35 minutes. Raise the ceiling if your resolver has the budget — but if you see `fetch failed` in bulk from one ATS section, suspect the resolver before the boards.

**Exit codes:** `0` scan completed, `1` configuration error (no `users/{USER}/portals.yml`, unknown `--ats` source) or fatal scan error.

---

## company:funded

Review-first discovery for companies that recently raised funding. It reads structured public RSS/API sources and prints a candidate report for manual review. It never edits `portals.yml` and does not probe company websites.

```bash
npm run company:funded -- --dry-run --limit 20
npm run company:funded -- --dry-run --limit 20 --months 3 --json
npm run company:funded -- --dry-run --sort score --limit 20
npm run company:funded -- --sources techcrunch,prnewswire,guardian,hn
npm run company:funded -- --self-test
```

Defaults: last 3 months, `--sort date`, sources `techcrunch,prnewswire,guardian,hn`. `--sort score` ranks by source and funding-detail confidence instead.

Runs without `--dry-run` write JSON under `output/` and a Markdown report under `reports/`.

Source diagnostics are included in JSON output and surfaced in human output when a source has errors, is blocked, returns no items, or when no candidates are found.

**Exit codes:** `0` discovery completed, `1` invalid arguments or fatal runtime error.

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

## or (OpenRouter runner)

Runs the pipeline on OpenRouter free models with automatic fallback — no
Claude Code CLI required.

```bash
npm run or:scan                 # scan configured companies for new listings
npm run or:eval -- <url>        # evaluate a job by URL (no URL: paste interactively)
npm run or:pipeline             # process pending URLs
npm run or:apply                # application assistance
```

---

## reconcile

Syncs the `users/{USER}/data/pipeline.md` "Pendientes" section with `users/{USER}/batch/batch-state.tsv`.
`batch-runner.sh` records evaluated offers in the state file but never writes
back to `users/{USER}/data/pipeline.md`, so batch-processed offers would otherwise be
re-surfaced by every later scan or pipeline run.

```bash
node reconcile-pipeline.mjs --user {USER}
```

---

## cover-letter

Renders a cover-letter JSON payload to PDF: fills
`templates/cover-letter-template.html` with the payload, then renders via the
same Playwright pipeline as CVs.

```bash
npm run cover-letter -- payload.json
node generate-cover-letter.mjs --payload payload.json --out output/slug-cover.pdf
```

---

## verify:portals

Online ATS-slug validator — complements the offline `validate:portals`. A
wrong slug in `careers_url` 404s silently on every future scan, so this
probes the public Greenhouse / Ashby / Lever endpoints to confirm each slug
actually resolves.

```bash
npm run verify:portals
```

---

## reposts

Repost detector. Reads `users/{USER}/data/scan-history.tsv`, fuzzy-matches role titles per
company, and flags any company+role listed 2+ times with different URLs
within a 90-day window — a strong ghost-job / re-listing signal.

```bash
node detect-reposts.mjs --user {USER} --json
node detect-reposts.mjs --user {USER}
```

---

## gemini:eval / ollama:eval / openai:eval

Standalone evaluators — run the same evaluation logic
(`modes/oferta.md` + `modes/_shared.md` + `users/{USER}/cv.md`) without an interactive AI
CLI:

- `gemini:eval` — Google Gemini free tier (`GEMINI_API_KEY` in `.env`)
- `ollama:eval` — fully local and private via Ollama
- `openai:eval` — any OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq,
  DeepSeek, LM Studio, llama.cpp, vLLM, ...)

```bash
node gemini-eval.mjs --user {USER} "We are looking for a Senior AI Engineer..."
node gemini-eval.mjs --user {USER} --file users/{USER}/jds/my-job.txt
node ollama-eval.mjs --user {USER} "JD text"
node openai-eval.mjs --user {USER} "JD text"
```

---

## star

Zero-LLM, zero-browser behavioural question matcher. Parses
`users/{USER}/interview-prep/story-bank.md`, scores each STAR story against the question
text (optionally plus a JD file), and returns the top matches formatted to
ATS paste length (250-500 words).

```bash
node match-star.mjs --user {USER} "Tell me about a time you disagreed with a decision"
```

---

## archive

Saves a live job posting as PDF via Playwright before it disappears —
postings vanish once filled, and the original requirements matter for
interview prep and salary negotiation evidence.

```bash
npm run archive -- https://example.com/job/123
```

---

## prepare:application

ATS auto-fill helper for Greenhouse, Ashby, and Lever. Detects the ATS from
the apply URL, reads candidate data from `users/{USER}/config/profile.yml`, and prints a
prefill summary to stdout. **Never POSTs anything** — you review the output,
open the apply URL, and submit yourself. See
[APPLY_AUTOFILL.md](APPLY_AUTOFILL.md).

```bash
node prepare-application.mjs --user {USER} --url https://boards.greenhouse.io/acme/jobs/123
```

---

## build:dashboard

Cross-platform build wrapper for the Go TUI dashboard: picks the
platform-correct output name (`career-dashboard.exe` on Windows, else
`career-dashboard`), since a bare `go build -o` writes an extension-less
binary on Windows. Requires Go 1.24+.

```bash
npm run build:dashboard
npm run serve:dashboard    # or run the TUI directly without building
```

---

## Agent-invoked utilities

These have no `npm run` binding — modes and agents call them with
`node <script>` directly. Each script's header comment documents its flags.

| Invocation | Purpose |
|------------|---------|
| `node set-status.mjs --user {USER} <report#\|company> <State> [--note]` | Canonical tracker write path: strict states.yml validation, shared lock, atomic write. Modes call this instead of hand-editing `applications.md` |
| `node mark-pdf-ready.mjs --user {USER} <report#> [--dry-run] [--json]` | Mark the matched tracker's PDF cell ready after the web PDF render path finishes; resolves the report number, uses the shared tracker lock, and writes atomically |
| `node followup-cadence.mjs --user {USER} [--summary]` | Follow-up cadence per active application; flags overdue entries |
| `node followup-seed.mjs --user {USER} [--backfill]` | Seed `users/{USER}/data/follow-ups.md` with a pinned first follow-up date when a row turns Applied |
| `node reply-watch.mjs --user {USER}` | Classify employer replies from `users/{USER}/data/reply-candidates.json`, match to tracker rows, print a review digest |
| `node process-quality.mjs --user {USER} [--summary]` | Aggregate `[process-friction]` tags from `users/{USER}/data/active-interviews.md` per company |
| `node reserve-report-num.mjs --user {USER} [--count N]` | Atomically reserve report numbers for parallel workers (fixes the #749 race) |
| `node agent-inbox.mjs --user {USER} add "..."` | Append a request to the queue the agent drains at the next session start |
| `node generate-latex.mjs <input.tex> [output.pdf]` | Validate and compile a generated `.tex` CV via tectonic or pdflatex |
| `node classify-tier.mjs` | Classify a job title into intern / entry / mid / senior |
| `node plugins.mjs list\|run <id> [hook]` | CLI host for non-provider plugin hooks (see [PLUGINS.md](PLUGINS.md)) |
| `node plugin-install.mjs` | Clone/scaffold/validate community plugins (allowlisted URLs, pinned SHA) |
| `node plugin-audit.mjs` | Static safety scan for community/registry plugins |
| `node validate-plugin-registry.mjs` | Shape gate for `plugins-registry/<id>.json` files |

---

## set-status.mjs

Canonical tracker write path: strict `states.yml` validation, shared lock, atomic write. Modes and agents call this instead of hand-editing `applications.md`.

```bash
node set-status.mjs <report#|company> <state> [--note "..."] [--on YYYY-MM-DD] [--force] [--dry-run] [--json]
node set-status.mjs --row N <state> [--note "..."]          # explicit tracker row ID
node set-status.mjs --report N <state> [--note "..."]       # row whose Report cell links report #N
node set-status.mjs "Company Name" Applied --role "Role"    # narrow match by role fragment
node set-status.mjs --row 12 Applied
node set-status.mjs --report 345 Applied --on 2026-08-01
```

A bare number or company name is convenient, but becomes ambiguous when multiple tracker rows exist for a company or when tracker row IDs and report IDs diverge. That divergence is permanent once it starts: `reserve-report-num.mjs` treats tracker row IDs as occupied when it allocates a report number, so a row that never got a report still consumes a number the report sequence then skips — the two counters leapfrog each other and never realign. On a diverged tracker "5" may mean tracker row #5 or report #5, which are different applications. Base selectors resolve the main target, while explicit selectors and filters disambiguate the target row:

- `--row N`: Selects the row whose `#` cell is `N`.
- `--report N`: Selects the row whose `Report` cell links report `N`.
- `--role <role>`: Narrowing selector that refines a company, report, row, or bare-number match when multiple tracker rows exist for a single target.
- `--on <date>`: Specifies an explicit transition date (YYYY-MM-DD) for status logs and notes.
- `--json`: Formats command output as structured JSON.

`--row` and `--report` are mutually exclusive. Because an explicit selector answers the report-mismatch guard rather than overriding it, `--row` bypasses that guard without needing `--force` (which silences the check while the ambiguity is still real).

This is worth preferring in practice, not just in principle. Once the counters have diverged, a bare number trips the guard whenever the row it matches links a report number other than its own `#`, or links no report at all while a different row claims that number as its report — so on a tracker with a wide gap the check keeps firing, and a check that keeps firing teaches callers to pass `--force` by reflex, which disables it everywhere including the cases it was written to catch. Reach for a selector (or the company name) instead.

### Bare numbers vs. explicit selectors

- **Use a bare number** when tracker row IDs and report IDs are identical or when querying interactively.
- **Use `--row N` or `--report N`** in automated scripts, modes, or whenever row IDs and report IDs have diverged to avoid triggering report-number mismatch guards or ambiguous updates. Use `--role` alongside a base selector to narrow down multiple matching roles for a company.

Exit codes (the shared `CLI_EXIT` contract in `tracker-utils.mjs`, so these values are stable across every canonical tracker writer):

- `0` success, including an idempotent no-op re-run that changed nothing.
- `1` for an invalid or conflicting selector, or a non-canonical state.
- `2` when the selector matches no tracker row.
- `3` when a bare numeric selector triggers the report-number mismatch guard (`report-number-mismatch`), or a company matches several rows.
- `4` when the shared tracker lock is busy — retryable, unlike the others.

Nothing is written on any non-zero exit.

To identify a row before writing to it, [find](#find) resolves a number, company, or role fragment to its full identity and surfaces collisions between the two numbering schemes rather than picking one silently.

## mark-pdf-ready.mjs

The web PDF render path calls this utility after a CV PDF has been generated so
the matching tracker row can be marked ready. It is not normally a manual
day-to-day command. The argument is the report number from the `reports/NNN-...`
filename or Report cell, not the tracker row's `#` value.

```bash
node mark-pdf-ready.mjs <report#>                  # mark the matching row
node mark-pdf-ready.mjs <report#> --dry-run       # validate without writing
node mark-pdf-ready.mjs <report#> --json          # emit machine-readable output
```

The script resolves the report-to-row link, refuses ambiguous matches, and
leaves an already-ready row unchanged. Writes use the same shared tracker lock
and atomic replacement as `set-status.mjs`, so concurrent tracker updates do
not overwrite one another. Exit status `0` covers a successful mark and an
idempotent no-op; `1` is a usage, column, or write error; `2` means the tracker
or report row was not found; `3` means the report matched more than one row;
and `4` means the tracker lock timed out and the operation should be retried.

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
