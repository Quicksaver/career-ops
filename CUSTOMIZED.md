# Fork Customizations

This file documents what this fork changes relative to `upstream/main` so future upstream updates can be merged without losing local behavior, and so local changes can be retired when upstream makes them redundant.

Generated from:

- Upstream ref: `upstream/main` at `831ef7ff3722fe510ab2b5168678bb4ba89bc03e`
- Fork ref: `main` at `6f2e9a9e71a0beba4de141a015bbc61a34a592af`
- Relationship when written: upstream-only commits `0`, fork-only commits `47`
- Diff size: `46 files changed, 5186 insertions(+), 325 deletions(-)`

## Merge Policy

Upstream changes are the baseline. When merging future `upstream/main`, keep the new upstream behavior by default and adapt the customizations below around it.

Do not place user-specific data in system-layer files. Candidate data, targeting, proof points, portals, reports, outputs, and interview prep belong in the per-user layer defined by `DATA_CONTRACT.md`.

Do not hardcode local user IDs in tracked/system files. Use placeholders such as `{USER}`, `<username>`, or `<id>` outside the ignored `users/{USER}/` folder.

After each upstream merge, re-run this inventory:

```bash
git fetch upstream main
git diff --stat upstream/main..main
git diff --name-status upstream/main..main
git log --oneline --left-right --cherry-pick upstream/main...main
```

Then update this file if a customization is added, removed, or made redundant.

## Multi-User User Layer

The fork centralizes all local candidate data under an ignored per-user folder and requires commands to resolve an active user before reading or writing user-layer files.

Files:

- `lib/user-context.mjs`
- `.agents/skills/career-ops/SKILL.md`
- `AGENTS.md`
- `DATA_CONTRACT.md`
- `.gitignore`
- `scan.mjs`
- `verify-pipeline.mjs`
- `merge-tracker.mjs`
- `normalize-statuses.mjs`
- `dedup-tracker.mjs`
- `cv-sync-check.mjs`
- `doctor.mjs`
- `analyze-patterns.mjs`
- `followup-cadence.mjs`
- `gemini-eval.mjs`
- `generate-pdf.mjs`
- `batch/batch-runner.sh`
- `dashboard/main.go`
- `modes/*.md`
- `modes/*/_shared.md`
- `batch/batch-prompt.md`
- `README.md`
- `docs/SETUP.md`
- `docs/SCRIPTS.md`
- `test-all.mjs`
- `update-system.mjs`

What this customizes:

- User-specific files now live under `users/{USER}/`, including `cv.md`, `config/profile.yml`, `modes/_profile.md`, `article-digest.md`, `portals.yml`, `data/`, `reports/`, `output/`, `interview-prep/`, `jds/`, `writing-samples/`, and user batch state.
- `users/` is gitignored. The older root-level user paths remain ignored only for migration safety; new work should use `users/{USER}/...`.
- Career-ops commands must have an active user before any user-layer access. Explicit user selection is accepted via command text such as `/career-ops scan <username>`, via `--user <id>` / `--user=<id>`, or via `CAREER_OPS_USER`.
- In agent conversations, an explicit user in one career-ops command establishes the active user for later commands in that same conversation. If no user has ever been specified in the conversation, the agent must stop immediately and ask which user to use.
- The script-level resolver validates user IDs, strips user flags before mode-specific argument handling, and supports `CAREER_OPS_USERS_DIR` for tests or alternate user roots.
- Docs and help text must use placeholders like `{USER}`, `<username>`, or `<id>`. Do not hardcode a real local username outside its own ignored `users/{USER}/` directory.

Future merge notes:

- Preserve the explicit-user requirement. Do not silently fall back to root `cv.md`, root `portals.yml`, or other legacy single-user paths.
- If upstream introduces its own profile/user abstraction, compare it against this flow before replacing it. Keep the conversation-context behavior unless upstream provides an equivalent.
- When adapting upstream script changes, route every read/write of user-layer data through `lib/user-context.mjs` or equivalent active-user resolution.
- Keep shared templates, modes, scripts, and provider code in the system layer; keep generated reports, CV outputs, trackers, portals, personal profile files, and interview prep in `users/{USER}/`.

## Batch Runner Multi-CLI Processing

The fork makes the batch runner usable with Codex as well as Claude, and adds smaller resumable processing controls for long pipeline runs.

File:

- `batch/batch-runner.sh`
- `batch/batch-output-schema.json`

What this customizes:

- Replaces the Claude-only worker assumption with a generic headless worker setting.
- Adds `--cli claude|codex`, defaulting to `claude`, and supports `CAREER_OPS_BATCH_CLI` so local runs can select Codex without editing the script.
- Keeps Claude behavior on `claude -p --dangerously-skip-permissions --append-system-prompt-file ...`.
- Adds Codex behavior through `codex exec --dangerously-bypass-approvals-and-sandbox -C "$PROJECT_DIR"`, passing the combined resolved prompt through stdin rather than a huge argv string.
- Requires Codex workers to write their final message through `--output-last-message` and validate it against `batch/batch-output-schema.json`.
- Treats clean Codex completion as `exit 0` plus valid final JSON with `status: "completed"` plus report and tracker artifacts. Timeout-based artifact recovery remains a fallback, not the primary success path.
- Records Codex contract failures explicitly when the final JSON, report, or tracker TSV is missing, instead of leaving the offer in `processing`.
- Recovers stale `processing` rows at the start of a new non-dry-run batch by marking them failed with `stale-processing-state`, so interrupted workers do not block or hide the next run.
- Uses the runner-reserved `REPORT_NUM` as the TSV first column, report link number, and artifact number so parallel workers do not race while calculating tracker numbers from `applications.md`.
- Adds `--limit N` so a batch run can process only the next N pending offers, useful for smoke tests, quota-aware batches, and resuming large queues in smaller chunks.
- Copies `local:jds/...` input rows from `users/{USER}/jds/...` into the temporary JD file passed to the worker. Missing local JD files intentionally become an empty temporary file so the worker can fail or recover using the URL/context path consistently.
- Logs the selected CLI and limit at run start so batch logs show which worker backend handled the run.

Future merge notes:

- If upstream changes `batch/batch-runner.sh`, preserve the CLI abstraction unless upstream adds equivalent multi-agent worker support.
- Keep the Codex command rooted at `PROJECT_DIR` so generated reports, tracker additions, and user-layer paths resolve the same way as normal career-ops commands.
- Preserve the schema-checked final JSON contract for Codex workers; do not regress to parsing the free-form transcript as the main completion signal.
- Preserve stale-state recovery and explicit missing-artifact failure reasons. They are needed because a headless worker can write partial artifacts or transcript JSON without producing the required final-message JSON.
- Preserve runner-reserved report numbering for tracker TSVs if upstream changes batch merge behavior. Worker-side `applications.md` max calculations are unsafe under parallelism.
- Keep `--limit` or an equivalent bounded-run mechanism; it is operationally useful when processing queues under usage limits.
- Preserve `local:jds/...` support because scan and pipeline flows can enqueue saved local JDs rather than only external URLs.

## Custom Provider Layer

The fork adds a large structured provider surface for zero-token scanning.

Files:

- `providers/_custom.mjs`
- `providers/_custom-fetch.mjs`
- `providers/pcsx.mjs`
- `providers/landingjobs.mjs`
- `providers/swissdevjobs.mjs`
- `providers/germantechjobs.mjs`
- `providers/devitjobs.mjs`
- `providers/devjobsde.mjs`
- `providers/itjobs.mjs`
- `providers/sapo.mjs`
- `providers/portalemprego.mjs`
- `providers/dice.mjs`
- `providers/euremotejobs.mjs`
- `providers/remoteineurope.mjs`
- `providers/workingnomads.mjs`
- `providers/nodesk.mjs`
- `providers/englishjobs.mjs`
- `providers/jobsinenglish.mjs`
- `providers/jobsch.mjs`
- `providers/makeitingermany.mjs`
- `providers/rustjobs.mjs`
- `templates/portals.example.yml`
- `test-all.mjs`

What this customizes:

- Adds structured parsers/fetchers for PCSX, Landing.jobs, DevITJobs-family boards, DEVjobs.de, jobs.ch, Jobs in English Denmark, Make it in Germany, EU Remote Jobs, ITJobs, SAPO Emprego, Portal Emprego, Dice, Remote in Europe, Working Nomads, NoDesk, RustJobs.dev, and related English Jobs boards.
- Keeps small provider adapter modules so `scan.mjs` can load these sources through the upstream provider plugin contract.
- Adds retry-aware JSON fetching with timeouts, exponential backoff, jitter, and a deliberately narrow retryable-status set.
- Extends the example portal config with these discovery sources and custom notes/parameters.
- Adds tests for the retry helper, Greenhouse URL safety, and the custom provider fetch wrapper.

Future merge notes:

- If upstream adds one of these providers, compare behavior before keeping both. Prefer upstream modules when they produce equivalent fields and filtering.
- If upstream adds a shared retry helper, consider replacing `providers/_custom-fetch.mjs` and reducing local tests to compatibility coverage.
- `templates/portals.example.yml` is high-conflict. Preserve upstream example improvements, then reapply only still-useful local source definitions.

## Scan Company Block Filter

The fork adds a generic company-name block filter to the zero-token scanner so per-user portal configs can reject forbidden employers before they are added to the pipeline.

Files:

- `scan.mjs`
- `test-all.mjs`
- `users/{USER}/portals.yml`

What this customizes:

- Adds exported `buildCompanyFilter(company_filter)` support in `scan.mjs`.
- Reads optional `company_filter.block` from the active user's `portals.yml`.
- Rejects provider results whose `job.company` contains a blocked company keyword, case-insensitively.
- Applies the company block before title, location, URL, and company-role dedupe checks, so forbidden employers do not consume dedupe slots or enter `data/pipeline.md`.
- Prints `Filtered by company: N removed` in scan summaries when a company block list is configured.
- Adds `test-all.mjs` coverage that checks the scanner advertises the company block path and verifies `buildCompanyFilter` rejects configured employers while passing unrelated companies.

Future merge notes:

- Preserve this hook while user profiles need hard employer exclusions such as direct partners, conflicts of interest, or blocked industries.
- If upstream adds first-class employer/company exclusion support, migrate `company_filter.block` configs to the upstream schema or keep this key as a compatibility alias.
- Keep the filter tolerant of missing or malformed company names; unknown company values should pass to downstream evaluation rather than being silently dropped.
- Keep LinkedIn authenticated scanning's `linkedin_searches.employer_blocklist` separate unless upstream unifies authenticated and zero-token scan filtering under one shared company-block schema.

## CV Output Naming

The fork standardizes generated CV artifacts around the report number.

Files:

- `modes/pdf.md`
- `modes/latex.md`
- `batch/batch-prompt.md`
- `templates/README.md`

What this customizes:

- Requires generated CV artifacts to use `output/{REPORT_NUM}-{company-slug}-{YYYY-MM-DD}.{html|pdf|tex}`.
- Removes candidate-name/ad-hoc CV output names from the instructions.
- Keeps report, tracker, PDF, HTML, and LaTeX artifact names aligned.

Future merge notes:

- Preserve this if local workflows rely on report-numbered artifacts.
- If upstream adopts the same naming contract, remove the local instruction patches and keep only any wording still needed for this fork.

## Batch PDF Gate

The fork prevents batch workers from generating tailored CV PDFs for low-fit or explicitly skipped roles.

File:

- `batch/batch-prompt.md`

What this customizes:

- Adds a PDF gate before the batch worker creates CV HTML or calls `generate-pdf.mjs`.
- Skips HTML/PDF generation when `score < 3.0`.
- Skips HTML/PDF generation when `final_decision` is `Skip`, even if the numeric score is higher.
- Skips HTML/PDF generation when `_profile.md` applies an explicit hard stop, such as a blocked company/domain or consultancy/staff-augmentation model.
- Requires the report header to say `**PDF:** Not generated - score below 3.0 or final decision is Skip` when the gate blocks PDF generation.
- Requires the tracker TSV PDF column to use `❌` and the worker JSON summary to use `"pdf": null` when no PDF is generated.

Future merge notes:

- Preserve this gate unless upstream adds an equivalent policy to avoid wasting time and artifacts on offers the candidate should not apply to.
- Keep the gate aligned with `modes/pipeline.md`, which says the full auto-pipeline only generates PDFs for offers scoring at least `3.0`.
- If upstream changes the batch worker prompt format, reapply the rule at the first point after score/final decision are known and before any HTML/PDF artifact is written.

## CV Theme Overrides

The fork makes the HTML/PDF CV palette configurable from `config/profile.yml`.

Files:

- `generate-pdf.mjs`
- `templates/cv-template.html`
- `config/profile.example.yml`
- `modes/pdf.md`
- `batch/batch-prompt.md`

What this customizes:

- Adds CSS variables to the HTML CV template.
- Reads optional `cv.theme` keys from `config/profile.yml`.
- Injects safe CSS variable overrides at PDF render time.
- Documents supported keys such as `primary`, `accent`, `background`, `text`, `muted`, `rule`, and related color tokens.

Future merge notes:

- If upstream changes the CV template, keep the variable names stable or provide a migration for existing `cv.theme` configs.
- If upstream introduces first-class theming, compare key names and remove this local implementation if upstream covers the same use case.

## Dashboard Improvements

The fork keeps dashboard data per-user and improves date display in the Go dashboard.

Files:

- `package.json`
- `AGENTS.md`
- `.agents/skills/career-ops/SKILL.md`
- `README.md`
- `README.*.md`
- `CONTRIBUTING.md`
- `docs/SETUP.md`
- `docs/ARCHITECTURE.md`
- `dashboard/main.go`
- `dashboard/main_test.go`
- `dashboard/internal/data/career.go`
- `dashboard/internal/data/career_test.go`
- `dashboard/internal/model/career.go`
- `dashboard/internal/ui/screens/pipeline.go`

What this customizes:

- Removes the root `npm run dashboard` wrapper and `run-dashboard.sh`.
- Dashboard binaries are built into `users/{USER}/`, e.g. `cd dashboard && go build -o ../users/{USER}/career-dashboard .`.
- Cross-compiled dashboard binaries are also written into `users/{USER}/`, e.g. Windows x64 uses `GOOS=windows GOARCH=amd64 go build -o ../users/{USER}/career-dashboard.exe .`.
- The dashboard infers the user folder from its own location or the current directory, so the per-user binary runs without `--path`; `--path` remains available for unusual layouts.
- Adds `ListingDate` to dashboard application data.
- Extracts listing/posting dates from reports when present.
- Reads `data/scan-history.tsv` before the old root-level fallback.
- Shows listing date in the dashboard, falling back to the tracker processed date when no listing date is known.

Future merge notes:

- If upstream changes dashboard models or table rendering, preserve the listing-date fallback behavior unless upstream provides a better equivalent.
- Do not reintroduce the root dashboard wrapper unless upstream provides a better per-user binary flow.

## Scanner Documentation And Defaults

The fork updates user-facing scanner descriptions to match the expanded structured provider surface.

Files:

- `README.md`
- `AGENTS.md`
- `docs/SCRIPTS.md`
- `docs/CUSTOMIZATION.md`
- `templates/README.md`
- `templates/portals.example.yml`

What this customizes:

- Describes direct scanning beyond Greenhouse/Ashby/Lever, including PCSX and structured job portals.
- Clarifies broad-discovery search queries for boards where direct access is unreliable.
- Keeps scanner documentation aligned with the fork's provider modules.

Future merge notes:

- Reconcile upstream copy edits first, then update only the provider lists and behavior statements that remain fork-specific.

## Authenticated Scan Sessions

The fork adds a Playwright-backed authenticated scanner and keeps its browser sessions per career-ops user.

Files:

- `scan-auth.mjs`
- `scan-auth/linkedin.mjs`
- `modes/scan-auth.md`
- `package.json`
- `DATA_CONTRACT.md`
- `AGENTS.md`
- `.agents/skills/career-ops/SKILL.md`
- `README.md`
- `docs/SCRIPTS.md`
- `test-all.mjs`

What this customizes:

- Adds `node scan-auth.mjs --user <id> [--login] linkedin` / `npm run scan-auth -- --user <id> ...`.
- Routes authenticated scan data through the active user layer: `users/{USER}/portals.yml`, `users/{USER}/jds/`, `users/{USER}/data/pipeline.md`, and `users/{USER}/data/scan-history.tsv`.
- Stores persistent browser sessions outside the repo under `~/.scan-auth/users/{USER}/{PORTAL}/profile/`, so different users can keep separate LinkedIn sessions.
- Refuses to silently reuse the older shared profile path `~/.scan-auth/{PORTAL}/profile/`; if that legacy profile exists, the scanner warns and asks for a per-user login.
- Treats browser profiles as credential material and keeps `.scan-auth/` ignored if someone overrides the auth directory into the checkout.
- Exports LinkedIn `randomDelay()` for test coverage and accepts both fixed numeric delays and `[min, max]` ranges, falling back to default page delays for malformed config.
- Extends `test-all.mjs` authenticated-scan coverage to verify fixed numeric delays and ranged delays, so future upstream merges do not regress LinkedIn delay config compatibility.

Future merge notes:

- If upstream adds authenticated scanning, preserve per-user session isolation unless upstream has an equivalent user-scoped profile model.
- Do not move browser profiles into tracked system paths. They contain cookies/local storage and should remain ignored credential data.
- Keep `scan-auth` aligned with `lib/user-context.mjs` whenever user resolution changes.
- Preserve numeric delay compatibility for LinkedIn scan throttling if upstream rewrites scan-auth timing helpers.

## LinkedIn Native Age Filter

The fork enforces authenticated LinkedIn search age limits through LinkedIn's native URL parameter rather than keyword text.

Files:

- `scan-auth/linkedin.mjs`
- `test-all.mjs`
- `users/{USER}/portals.yml`

What this customizes:

- Reads `linkedin_searches.date_posted` from the active user's `portals.yml`.
- Maps supported values to LinkedIn's native `f_TPR` search parameter: `24 -> r86400`, `Week -> r604800`, and `Month -> r2592000`.
- Builds URLs such as `https://www.linkedin.com/jobs/search-results/?keywords=Senior+Backend+Engineer&f_TPR=r604800`.
- Leaves the `keywords` query clean instead of appending text such as `posted in the past week`.
- Exports `buildLinkedInSearches(config)` so URL construction can be regression-tested without launching an authenticated browser session.
- Extends `test-all.mjs` coverage for `Week`, numeric YAML `24`, clean keyword text, and the unset case.

Future merge notes:

- Preserve URL-level age filtering while LinkedIn supports `f_TPR`; keyword suffixes are weaker and should not be restored as the primary filter.
- If upstream adds first-class LinkedIn age filtering, retire this local mapping only if upstream preserves the same `linkedin_searches.date_posted` contract or provides a clear migration for user portal configs.
- Keep the exported search builder or an equivalent testable boundary so future changes can verify generated URLs without touching per-user pipeline data.

## Quiet Long-Running Command Monitoring

The fork instructs agents to avoid routine 30-second "still running" messages during multi-minute `scan`, `scan-auth`, `pipeline`, and `batch` runs.

Files:

- `AGENTS.md`
- `.agents/skills/career-ops/SKILL.md`
- `modes/scan.md`
- `modes/scan-auth.md`
- `modes/pipeline.md`
- `modes/batch.md`

What this customizes:

- Keeps scanner and pipeline monitoring quiet after command start.
- Allows internal liveness polling, but limits normal user-visible status updates to at most once every 10 minutes.
- Requires Codex tool polling to stay silent and use the longest supported wait instead of narrating each `write_stdin` poll.
- Still requires immediate reporting for completion, failure, required login/CAPTCHA/user action, suspected hangs, or warnings that change what the user should do.
- Preserves one-off status answers when the user explicitly asks, then returns to quiet monitoring.

Future merge notes:

- Preserve the quiet long-running command monitoring rule unless upstream provides an equivalent low-noise policy.

## Local Maintenance Skill

The fork adds a repo-local skill for upstream merge maintenance.

File:

- `.agents/skills/update-main/SKILL.md`

What this customizes:

- Defines the local `update-main` workflow: fetch `upstream/main`, merge onto the current branch, adapt local work around upstream, and report behavior changes.

Future merge notes:

- Keep this if local agents use `$career-ops:update-main`.
- If upstream adds an equivalent workflow, either remove this file or reduce it to fork-specific conflict policy.

## Personal Data And Generated Artifact Hygiene

The fork expands ignored local/user artifacts.

Files:

- `.gitignore`
- `interview-prep/story-bank.md`

What this customizes:

- Ignores `data/scan-summary-*.md`, `interview-prep/*`, `article-digest.md`, and `.vscode/`.
- Removes the tracked `interview-prep/story-bank.md` document so interview prep remains user-layer data.

Future merge notes:

- Preserve the data-contract intent even if upstream reorganizes user-layer folders.
- If upstream starts tracking a generic story-bank template, keep the template outside ignored user-specific paths.

## Utility Extraction Scripts

The fork currently includes two small Playwright extraction helpers.

Files:

- `extract-jd.mjs`
- `extract-pdf.mjs`

What this customizes:

- `extract-jd.mjs` opens a hardcoded English Job Search clickout URL and prints the final page text.
- `extract-pdf.mjs` opens a hardcoded PDF URL and tries to read browser-rendered PDF text.

Future merge notes:

- Treat these as local debugging utilities, not core product surface.
- Remove or replace them if upstream adds generic JD/PDF extraction commands.
- If keeping them long-term, make them parameterized instead of hardcoded.

## Other Small Deltas

Files:

- `README.md`
- `docs/SCRIPTS.md`
- `templates/README.md`
- `AGENTS.md`

What this customizes:

- Keeps references to fork-added commands, providers, and behavior in sync with the code above.
- Adjusts one Gemini free-tier model reference in `README.md`.

Future merge notes:

- Treat documentation conflicts as a signal to check whether the underlying customization still exists.
- Remove local documentation lines when the corresponding code customization is removed.

## Redundancy Checklist For Future Upstream Updates

On every upstream update, explicitly check whether upstream now includes:

- Any provider currently implemented in `providers/_custom.mjs`.
- A shared retry/backoff helper for provider fetches.
- Report-numbered CV artifact naming.
- Config-driven CV theme tokens.
- Per-user dashboard binary build/run flow.
- Dashboard listing-date parsing/display.
- Batch runner support for both Claude and Codex workers.
- Schema-checked Codex batch worker final JSON via `--output-last-message`.
- Bounded batch runs through `--limit`.
- `local:jds/...` batch input handling.
- Conditional batch PDF generation for scores below `3.0`, `Skip` decisions, and profile hard stops.
- Generic JD/PDF extraction commands.
- Equivalent user-layer ignores for interview prep, scan summaries, `article-digest.md`, and editor folders.

If upstream covers one of these, prefer deleting the local customization over carrying duplicate behavior.
