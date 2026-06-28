# Fork Customizations

This file documents what this fork changes relative to `upstream/main` so future upstream updates can be merged without losing local behavior, and so local changes can be retired when upstream makes them redundant.

Generated from:

- Upstream ref: `upstream/main` at `39ea2d4324b1279737f7640e9d0b447a2608e159`
- Fork ref: current `main` at `3cd6a540814448cca305de1bd2ba9b9f9ae65b64`, before this inventory-only refresh
- Relationship baseline after merge, before this inventory-only refresh: upstream-only commits `0`, fork-only commits `92`
- Diff-size baseline after merge, before this inventory-only refresh: `113 files changed, 10199 insertions(+), 1890 deletions(-)`

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

## New Upstream Baseline Adopted In This Merge

This inventory incorporates upstream 1.9/1.10/1.11/1.12/1.13-era behavior and subsequent upstream fixes through `39ea2d4324b1279737f7640e9d0b447a2608e159` as the new baseline, with fork-specific routing restored where upstream still assumed a single root user.

New upstream features or behavior now present:

- Docker/scaffolder install surface: `Dockerfile`, `docker-compose.yml`, `DOCKER.md`, `cops`, and `scaffolder/` were adopted. They are system-layer tooling; do not let them write personal data outside `users/{USER}/`.
- New user-facing modes and docs: cover letters (`modes/cover.md`, `generate-cover-letter.mjs`, `templates/cover-letter-template.html`), interview onboarding (`modes/interview.md`), Arabic modes, and translated README updates were adopted. The cover-letter renderer was adapted so default output goes to `users/{USER}/output/`, while upstream's optional greeting/salutation placeholders and import-safe `buildHtml` behavior are preserved.
- Deterministic onboarding: upstream `doctor.mjs --json` is now the cold-start source of truth. The fork version still requires `--user {USER}` or `CAREER_OPS_USER` and checks `users/{USER}/cv.md`, `users/{USER}/config/profile.yml`, `users/{USER}/modes/_profile.md`, and `users/{USER}/portals.yml`.
- Atomic report-number reservation: upstream `reserve-report-num.mjs` was adopted and adapted to `--user {USER}` so sentinels live under `users/{USER}/reports/`, not root `reports/`.
- Scanner upgrades: upstream salary filtering, scan-history recheck TTL, 404/410 rediscovery, anti-bot headed fallback, throttle controls, Workday/SolidJobs support, `scan-ats-full.mjs`, and `validate-portals.mjs` were adopted. New scan utilities were adapted to active-user portal, pipeline, cache, and history paths.
- Batch runner upgrades: upstream session/rate-limit pause, `--resume-paused`, `--rate-limit-sleep`, skipped-offer summary behavior, Claude `--strict-mcp-config`, and runtime profile-context injection were adopted while preserving the fork's per-user batch state and Codex worker contract.
- Dashboard upgrades: upstream derived fields, sorting helpers, sort/time tests, and the last-contact calendar-day fix were adopted while preserving the fork's per-user dashboard path flow and listing-date fallback.
- Liveness/security/updater upgrades: upstream SSRF hardening, headed fallback behavior, updater migration tests, and release/version updates were adopted.
- Tracker safety upgrades: upstream now serializes concurrent `merge-tracker.mjs` runs with a filesystem lock and atomic writes. The fork keeps the lock but binds it to `users/{USER}/data/applications.md`, canonicalizes both tracker and user-root paths before report-link normalization, and keeps `CAREER_OPS_ADDITIONS` only as a test/non-standard additions-dir hook.
- Tracker index and column upgrades: upstream now includes `tracker.mjs`, a Node `node:sqlite` derived index over `applications.md`, header-name column mapping for tracker reads/writes, `tracker-columns-tests.mjs`, shared `role-matcher.mjs`, and safer dedup behavior that avoids deleting distinct same-company roles. The fork keeps those changes and routes normal tracker/index operations through `--user {USER}` so the index is `users/{USER}/data/applications.db`; `CAREER_OPS_TRACKER` remains only an explicit fixture/non-standard override.
- Evaluation gates: upstream `modes/oferta.md` and `modes/auto-pipeline.md` now gate URL inputs on liveness before scoring, so closed/dead postings should stop before Block A / Step 1 instead of producing misleading evaluations.
- Doctor warnings: upstream `doctor.mjs` now warns when Playwright MCP tools are not configured. The fork keeps this warning user-scoped through `doctor.mjs --user {USER} --json`.
- Runtime/tooling fixes: upstream PDF rendering now waits for `load` instead of `networkidle`, inlines local fonts as data URLs before Playwright rendering, adds `lang="ja"` CJK font fallbacks for Japanese HTML CVs, guards LaTeX generation against unsupported CJK content, `update-system.mjs` parses Release Please component-prefixed tags and applies the target updater manifest/runtime path list, the command menus expose `latex`, and the CV template aligns certification organization column widths while preserving fork theme CSS variables.
- OpenCode support: upstream added first-class OpenCode wrappers/skills (`OPENCODE.md` and `.opencode/skills/career-ops/SKILL.md`) and CLI docs. The fork keeps the OpenCode skill symlinked to the canonical agent skill and preserves active-user, `scan-auth`, and quiet-monitoring instructions there.
- Updater/dashboard behavior: upstream `update-system.mjs` now detects dashboard Go source changes and rebuilds the dashboard binary after updates. This should be preserved because this fork also builds per-user dashboard binaries under `users/{USER}/`.
- User-layer hygiene: upstream removed tracked `interview-prep/story-bank.md` and left `interview-prep/.gitkeep`. This aligns with the fork rule that story banks belong under `users/{USER}/interview-prep/story-bank.md`.
- Cover-letter docs: upstream fixed stale ReportLab wording; the fork keeps the HTML + Playwright cover-letter pipeline and user-scoped output behavior.
- Dependency/release baseline: upstream v1.11.0 release metadata and dependency bumps were merged into `VERSION`, `.release-please-manifest.json`, `package.json`, `scaffolder/package.json`, and `CHANGELOG.md`.
- README presentation: upstream decluttered the README hero and added the Built with Claude Code badge across translated READMEs. This is presentation-only and does not change fork runtime behavior.
- Follow-up report links: upstream fixed `followup-cadence.mjs` so report links are resolved relative to the tracker file directory, matching `merge-tracker.mjs --migrate` output such as `../reports/...`. The fork keeps that fix and also tolerates older user-root-relative links during migration.
- Ashby coverage: upstream now includes `secondaryLocations` when normalizing Ashby jobs, so EU-eligible or multi-location roles should surface more reliably through the existing scan filters.
- PDF text extraction: upstream changed `templates/cv-template.html` toward ATS-safe system fonts for cleaner CV text extraction. The fork keeps this template direction while preserving `cv.theme` CSS variable overrides in `generate-pdf.mjs`.
- Tracker dedup safety: upstream now requires company agreement before number-based merge-tracker dedup updates. The fork keeps that safety behavior on the user-scoped tracker path.
- Provider baseline: upstream now includes first-party `remoteok`, `remotive`, `ibm`, and `workingnomads` provider modules. The fork adopted these modules; `providers/workingnomads.mjs` now uses the upstream direct provider shape plus fork-preserved `api`, inferred region, `api_params.q/category/location/tags`, and `published_within_days` filtering, so the older thin `_custom` dispatcher wrapper is retired for this provider.
- v1.12 release baseline: upstream `VERSION`, Release Please manifest, and changelog now include v1.12.0 plus follow-up fixes. The fork adopted the release metadata while preserving user-layer update safeguards.
- CLI/runtime surface: upstream added Antigravity CLI support through `.antigravitycli/skills/career-ops/SKILL.md` and docs. The fork keeps that entrypoint as a symlink/pointer to the canonical `.agents/skills/career-ops/SKILL.md`, and extends updater materialization so Antigravity behaves like Claude/OpenCode on filesystems without symlink support.
- Pipeline/batch operations: upstream added `batch/batch-runner.sh --status` and `--watch`, replaced `bc` score math with `awk`, added `reconcile-pipeline.mjs` for inbox cleanup after batch runs, and added a pipeline liveness sweep for unconfirmed scan/batch entries. The fork keeps these behaviors on `users/{USER}/batch/` and `users/{USER}/data/pipeline.md`.
- Scanner/provider upgrades: upstream added content/description filtering, external metadata sanitization before pipeline/history writes, an in-process Arbeitsagentur provider, Indonesian Jobstreet and Glints providers, IBM provider tests, and hardened `local-parser` / `scan-ats-full` command and SSRF handling. The fork adopted the upstream providers and safety fixes while retaining the separate custom provider layer and company block filter.
- Portal verification: upstream added `verify-portals.mjs` for ATS slug validation and wired `doctor.mjs --strict` to probe portal slugs. The fork keeps this optional network check user-scoped through `users/{USER}/portals.yml`.
- Dashboard upgrades: upstream added customizable dashboard columns with a column picker, English/Spanish archetype parsing including YAML-style `archetype:`, and OS-specific open helpers that avoid shelling through Windows `cmd`. The fork preserves those while keeping per-user dashboard root inference and listing-date fallback.
- Voice DNA guardrail: upstream introduced optional `voice-dna.md` writing guardrails. In this fork it is treated as user-layer data at `users/{USER}/voice-dna.md`; the upstream root file was not kept as a tracked system file, and legacy root `voice-dna.md` is gitignored for migration safety.
- Resume/ATS assets: upstream added `examples/resume-example.md` and `templates/resume-template.html`, plus ATS-safe wording/template updates. The fork adopted these as system-layer examples/templates.
- Evaluation and tracker fixes: upstream hardened Gemini report-shape validation, preserved tracker notes when rows lack a trailing pipe, used the real application date from notes in follow-up cadence, auto-creates missing pipeline files, and added data-contract coverage for interview-prep outputs. The fork kept those fixes on the active user's files.
- Chinese modes: upstream added `modes/zh/` and related README updates for China-market job seekers. The fork adopted them as system-layer language modes.
- Current scanner filter follow-ups: the fork now supports per-target `location_filter` overrides in `scan.mjs`, so a specific tracked company or job board can narrow/relax location matching without changing the global portal filter. The Arbeitsagentur provider also marks remote-titled postings as `Remote, {location}`, ignores explicit no-remote/no-homeoffice titles for that remote marker, and defaults missing Arbeitsagentur locations to `Deutschland`.
- Current pipeline/report-number follow-ups: `reserve-report-num.mjs` now treats any numeric `{N}-` report prefix as occupied while still printing at least 3 digits, so users beyond report 999 do not recycle lower slots. `reconcile-pipeline.mjs` now accepts a validated `--reports <dir>` path and chooses the pending section that actually contains pending items when duplicate `Pending`/`Pendientes` headings exist.
- Current pipeline/user-routing follow-ups: `reconcile-pipeline.mjs` now honors the shared active-user resolver, so `node reconcile-pipeline.mjs --user {USER}` defaults to `users/{USER}/batch/batch-state.tsv`, `users/{USER}/data/pipeline.md`, and `users/{USER}/reports/`; explicit `--state`, `--pipeline`, and `--reports` overrides remain validated when used.
- Current tracker/report-ID follow-ups: `merge-tracker.mjs` now preserves the worker-reserved tracker/report number from each TSV instead of renumbering lower IDs to `max+1`, which keeps user-facing tracker IDs aligned with report/artifact IDs during parallel batches. If that TSV number is already used by a different entry, the TSV is left pending for manual repair instead of silently fabricating a different tracker ID. Tracker row writes also sanitize raw `|` characters in Markdown table cells to keep company/role/notes text from shifting score/status/report columns.
- Liveness upgrades: upstream added `liveness-api.mjs` so `check-liveness.mjs` can perform zero-token ATS API checks before Playwright, while preserving Playwright fallback semantics for inconclusive or non-ATS pages. This fits the fork's verification rule as long as WebSearch/WebFetch snippets still do not decide posting liveness.
- Provider upgrades: upstream added first-party BambooHR and Breezy providers, hardened Lever/Ashby/Workday redirect handling, fixed Recruitee custom-domain URLs, and added config-driven Arbeitsagentur `remoteMatch` / server-side homeoffice filtering. The fork adopted these upstream modules and kept its custom provider layer separate for sources upstream still does not cover.
- Scanner and reverse-discovery upgrades: upstream `scan-ats-full.mjs` now has `--json`, `--include-undated`, and `--shuffle`; the fork keeps those while preserving `--user {USER}` routing for `users/{USER}/portals.yml`, cache, pipeline, and scan history. Upstream also hardened malformed `title_filter` keyword normalization, which should reduce config-induced scanner crashes without changing the fork's company/location policy hooks.
- Batch runner upgrades: upstream added `--skip-pdf`, hardened status score handling by removing `bc`, and improved `--status` behavior. The fork keeps these while preserving active-user batch state under `users/{USER}/batch/`, Codex worker JSON contracts, `--limit`, worker timeouts, user prompt injection, and user-scoped post-batch reconcile/verify commands.
- Dashboard upgrades: upstream added in-viewer status editing, rewrites only the status cell on update, and derives EUR/GBP/CHF pay plus additional international cities from pipeline/report text. The fork keeps those while preserving per-user dashboard binary/root inference and report/PDF path normalization.
- Tracker upgrades: upstream added `tracker.mjs delete --num N` for safe row deletion. The fork keeps the command on the user-scoped markdown tracker and made the row-removal helper import-safe so tests/tools can use it without selecting a user.
- PDF/template upgrades: upstream changed `generate-pdf.mjs` to render a temporary `file://` HTML document via `page.goto(...)`, so relative images and other local resources render correctly; upstream also disabled `fi`/`fl` ligatures in CV, resume, and cover-letter templates for ATS-clean text extraction. The fork keeps those changes while preserving `cv.theme` injection and `users/{USER}/cv.md` section-order validation.
- Language and docs surface: upstream added Polish modes (`modes/pl/`) and localized README updates. These are system-layer language assets; user-specific Polish targeting still belongs in `users/{USER}/config/profile.yml` or `users/{USER}/modes/_profile.md`.
- v1.13 release baseline: upstream `VERSION`, Release Please manifest, and `CHANGELOG.md` now include v1.13.0. The fork adopted the release metadata while preserving updater safeguards for user-layer files.
- Language and docs surface: upstream added Danish modes (`modes/da/`), `README.da.md`, and update-system materialization for Danish locale paths. These are system-layer language assets; user-specific Danish targeting still belongs in `users/{USER}/config/profile.yml` or `users/{USER}/modes/_profile.md`.
- Batch budget guidance: upstream added `docs/RUNNING_ON_A_BUDGET.md`, linked it from batch docs/modes, and added a base `--limit` flag to `batch/batch-runner.sh`. The fork already had `--limit`; the merged runner keeps upstream's budget-facing documentation and limit semantics while preserving per-user batch state, Codex worker support, schema-checked final JSON, worker timeouts, prompt personalization, and user-scoped reconcile/verify commands.
- Repository hygiene: upstream added `.github/CODEOWNERS` for hosted entrypoint surfaces and universal ignore rules for nested `.env*.local` and `*.tsbuildinfo` files. The fork kept those while preserving `.scan-auth/` credential-profile hygiene.
- Source-of-truth boundary: upstream hardened `modes/_shared.md`, `AGENTS.md`, and related docs so candidate-facing text must come only from in-scope CV/profile/article/story/user files. The fork keeps that anti-fabrication rule and maps every user-owned source to `users/{USER}/...`, including interview prep.
- User custom instructions: upstream added `modes/_custom.template.md` and the `modes/_custom.md` concept. In this fork `_custom.md` is user-layer data at `users/{USER}/modes/_custom.md`; the template is system-layer.
- Application calibration and heuristics: upstream added `modes/regional/eu-swe.md` and `modes/heuristics/recruiter-side.md`. The fork exposes `eu-swe` in `.agents/skills/career-ops/SKILL.md` while preserving the active-user router, and PDF/interview-prep modes now use recruiter-side risk mapping without abandoning report-linked `users/{USER}/output` artifacts.
- Story-bank matching: upstream added `match-star.mjs` and `modes/apply.md` guidance for matching behavioral application questions to prepared STAR stories. The fork keeps this as a user-scoped feature that reads `users/{USER}/interview-prep/story-bank.md` rather than root interview-prep data.
- Job-archive workflow: upstream added `archive-posting.mjs` to capture live postings as local JD PDFs. The fork routes archived postings under `users/{USER}/jds/` and reads pipeline entries from `users/{USER}/data/pipeline.md`.
- Local evaluator: upstream added `ollama-eval.mjs` for local interactive evaluation. The fork routes CV input and report output through `--user {USER}` so local Ollama evaluation still reads `users/{USER}/cv.md` and writes `users/{USER}/reports/`.
- Scanner trust metadata: upstream added `providers/_trust-validator.mjs` and trust score/flag/level enrichment in `scan.mjs`. The fork keeps enrichment before filters, but preserves company block filtering, per-target `location_filter`, active-user pipeline/history paths, and the rule that trust flags annotate jobs rather than silently dropping them.
- Scanner duplicate reopen behavior: when a scan finds a live company/title duplicate whose only known tracker row is `Closed`, or whose tracker row was previously reopened from a closed duplicate, the fork keeps it as a duplicate rather than creating a new pipeline/tracker row. It reopens the original row as `Evaluated`, updates the row date, appends the fresh live URL to notes, records `reopened_closed_duplicate` in scan history, and makes dashboard URL opening prefer the latest reopened URL.
- Provider upgrades: upstream added first-party Personio, Comeet, and WeWorkRemotely providers and broadened provider config examples. The fork adopted these modules as system-layer providers, separate from the custom provider dispatcher.
- CLI/runtime surface: upstream added Grok Build CLI support via `.grok/skills/career-ops/SKILL.md` and extracted skill entrypoint materialization into `scaffolder/bin/skill-entrypoints.mjs`. The fork keeps Grok alongside Claude/OpenCode/Qwen/Antigravity and uses the shared helper from `update-system.mjs` instead of duplicating entrypoint constants.
- Batch robustness: upstream added a single-worker lock fallback and a Claude exit-127 shim-swap retry. The fork keeps both while preserving Codex stdin prompt delivery, schema-checked final JSON, per-user batch state, and worker-timeout behavior.
- Tracker row utilities: upstream extracted duplicated row rebuilding into `tracker-utils.mjs`. The fork uses that helper from `normalize-statuses.mjs` while preserving active-user path resolution and user-scoped backups.
- CV/template behavior: upstream added opt-in profile-photo support and scoped `break-inside` pagination rules in `templates/cv-template.html`. The fork keeps those template changes while preserving `cv.theme` CSS variable overrides and report-linked output naming.

Conflict notes from this merge:

- `.gitignore`: kept the fork's `.scan-auth/` credential-profile ignore and added upstream's universal nested local-env / TypeScript build-cache ignore rules.
- `batch/batch-runner.sh`: removed duplicate `--limit` help/parser entries, adopted upstream's limit-aware startup summary, and kept the fork's user banner plus CLI/worker-timeout logging so per-user Codex and Claude batch runs remain auditable.
- `CLAUDE.md`: kept the fork's short redirect to `AGENTS.md` because `AGENTS.md` is the merged canonical instruction surface with active-user and user-layer rules.
- `generate-cover-letter.mjs`: kept upstream's import-safe `buildHtml`, single-pass token replacement, optional greeting block, and lazy Playwright import, then restored user-scoped `--user` resolution and `users/{USER}/output` output paths inside `main()`.
- `generate-pdf.mjs`: in the current merge, kept upstream's temp-file `page.goto(file://...)` renderer and `randomUUID` cleanup path so local images/resources render, while retaining fork user resolution, `cv.theme` overrides, and `users/{USER}/cv.md` section-order validation. A focused smoke test confirmed `--user`, theme injection, ATS normalization, and PDF output together.
- `followup-cadence.mjs`: kept upstream's tracker-directory-relative report-link resolution and layered it onto the fork's active-user context, including a compatibility fallback for older `reports/...` links relative to `users/{USER}/`.
- `batch/batch-runner.sh`: combined upstream `--skip-pdf`, `awk`-based score arithmetic, and status-only behavior with the fork's explicit `--user` requirement, user-scoped batch files, Codex worker contract, `--limit`, worker timeout, and user-scoped reconcile/verify commands.
- `dashboard/internal/ui/screens/viewer.go` and `dashboard/main.go`: combined upstream's viewer status picker with the fork's user-root PDF link rewriting by keeping `NewViewerModelWithFileRoot(...)` and passing the selected application/status context through it.
- `scan-ats-full.mjs`: combined upstream `--json`, `--include-undated`, `--shuffle`, degraded-result metadata, and JSON-stdout discipline with fork user-scoped portal/cache/pipeline/history paths and user-visible active-user logging.
- `tracker.mjs`: kept upstream `delete --num N`, but changed module initialization so imported helpers such as `removeRowByNum` do not require an active user; direct CLI usage still requires `--user {USER}` unless a fixture override is explicitly set.
- `test-all.mjs`: kept upstream coverage for BambooHR, Breezy, liveness API, tracker delete, batch score hardening, status picker, and ligature suppression while adapting fixtures to `CAREER_OPS_USERS_DIR` and explicit `--user test` where this fork's active-user contract applies.
- `providers/workingnomads.mjs`: replaced the old fork wrapper around `providers/_custom.mjs` with an upstream-style direct provider, but preserved the fork's documented Working Nomads filters and inferred `/remote-europe-jobs` style region handling.
- `DATA_CONTRACT.md` and `modes/_shared.md`: kept upstream's new `voice-dna.md` writing guardrail concept but moved it to `users/{USER}/voice-dna.md`, preserving the fork rule that user voice/style data is never tracked at the root.
- `doctor.mjs`: kept upstream `--strict` portal slug probing and pipeline-file auto-creation, then routed both through `userPath(...)` so strict checks read `users/{USER}/portals.yml` and create `users/{USER}/data/pipeline.md`.
- `gemini-eval.mjs`: kept upstream's post-save tracker merge flow and report-shape validation, but restored `merge-tracker.mjs --user {USER}` and user-scoped report/tracker-addition messages.
- `modes/pipeline.md`: kept upstream's liveness sweep for unconfirmed batch/scan entries and rewrote the workflow commands for `users/{USER}/data/pipeline.md` plus `reserve-report-num.mjs --user {USER}`.
- `scan.mjs`: kept upstream's fresh-install `PIPELINE_SKELETON` and content filter while preserving the fork's `buildCompanyFilter(config.company_filter)` and active-user pipeline path.
- `update-system.mjs`: kept upstream user-file rollback safety and target manifest behavior, added `voice-dna.md` to the user-path guard, and extended materialized skill entrypoints to Antigravity.
- `dashboard/internal/data/career.go` and `dashboard/main.go`: combined upstream English/YAML archetype parsing and cross-platform open helpers with the fork's listing-date regexes and user-root PDF target normalization.
- `voice-dna.md`: upstream added this as a tracked root user file; the fork deleted it from the merge result, added it to legacy root ignores, and documents `users/{USER}/voice-dna.md` as the supported location.
- `.agents/skills/career-ops/SKILL.md`: combined upstream `eu-swe` routing with the fork's `scan-auth` mode and active-user router.
- `DATA_CONTRACT.md`, `modes/_shared.md`, `modes/interview-prep.md`, and `modes/pdf.md`: combined upstream `_custom.md`, source-of-truth, recruiter-risk, and story-bank rules with user-scoped paths under `users/{USER}/...`.
- `batch/batch-runner.sh`: combined upstream lock-fallback and Claude shim-swap retry with the fork's Codex stdin prompt path and per-user batch state.
- `scan.mjs`: combined upstream trust enrichment and location-preserving pipeline data with fork company-block filtering, per-target location filters, and active-user pipeline/history paths.
- `normalize-statuses.mjs`: adopted upstream `tracker-utils.mjs` row rebuilding while keeping user-context initialization and `users/{USER}/data/applications.md` routing.
- `update-system.mjs`: adopted upstream's shared skill-entrypoint materializer, including Grok, while preserving the fork's user-path safety guard list.
- `test-all.mjs`: kept upstream coverage for archive posting, trust validation, new providers, Grok/materialized skills, tracker row utilities, and template pagination while preserving fork checks for scan-auth and explicit-user fixtures.
- `archive-posting.mjs`, `match-star.mjs`, and `ollama-eval.mjs`: adopted upstream tools but added active-user resolution so archived JDs, story-bank reads, CV reads, and report writes use `users/{USER}/...`.

Future merge notes:

- Treat these as baseline behavior on later merges. Only carry local patches where the behavior still needs active-user routing, Codex batch support, custom provider compatibility, or user-layer hygiene.
- When upstream adds new scripts, check for root `cv.md`, `portals.yml`, `data/`, `reports/`, `output/`, or `batch/` assumptions before considering the merge done.
- Keep `test-all.mjs` fixtures aligned with the explicit-user contract; upstream tests that create root `data/` or `reports/` fixtures usually need `CAREER_OPS_USERS_DIR` plus `--user test` in this fork.
- When upstream adds process-level coordination around user files, preserve the coordination but bind locks, temp files, and canonical paths to `users/{USER}` rather than root `data/`.

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
- `tracker.mjs`
- `cv-sync-check.mjs`
- `doctor.mjs`
- `analyze-patterns.mjs`
- `followup-cadence.mjs`
- `gemini-eval.mjs`
- `generate-pdf.mjs`
- `generate-cover-letter.mjs`
- `reserve-report-num.mjs`
- `scan-ats-full.mjs`
- `validate-portals.mjs`
- `verify-portals.mjs`
- `reconcile-pipeline.mjs`
- `archive-posting.mjs`
- `match-star.mjs`
- `ollama-eval.mjs`
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

- User-specific files now live under `users/{USER}/`, including `cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `voice-dna.md`, `article-digest.md`, `portals.yml`, `data/`, `reports/`, `output/`, `interview-prep/`, `jds/`, `writing-samples/`, and user batch state.
- `users/` is gitignored. The older root-level user paths remain ignored only for migration safety; new work should use `users/{USER}/...`.
- Career-ops commands must have an active user before any user-layer access. Explicit user selection is accepted via command text such as `/career-ops scan <username>`, via `--user <id>` / `--user=<id>`, or via `CAREER_OPS_USER`.
- In agent conversations, an explicit user in one career-ops command establishes the active user for later commands in that same conversation. If no user has ever been specified in the conversation, the agent must stop immediately and ask which user to use.
- The script-level resolver validates user IDs, strips user flags before mode-specific argument handling, and supports `CAREER_OPS_USERS_DIR` for tests or alternate user roots.
- Upstream helper scripts adopted in this merge have been adapted to the same resolver: report reservations use `users/{USER}/reports/`, reverse ATS scans use `users/{USER}/portals.yml` plus `users/{USER}/data/`, portal validation defaults to `users/{USER}/portals.yml`, and cover-letter PDFs default to `users/{USER}/output/`.
- Report-number reservation scans all numeric report prefixes under `users/{USER}/reports/`, not only 3-digit prefixes. Keep this when users cross report 999; the printed value remains zero-padded to at least 3 digits for compatibility with existing artifact names.
- `reconcile-pipeline.mjs` remains path-overridable for batch/user layouts: use `--state users/{USER}/batch/batch-state.tsv --pipeline users/{USER}/data/pipeline.md --reports users/{USER}/reports` when invoking it directly for a per-user batch cleanup. The script validates those paths stay inside the repository and rejects file/directory type mismatches before reading or writing.
- The upstream SQLite tracker index is adapted to the same resolver: `node tracker.mjs sync --user {USER}` reads `users/{USER}/data/applications.md` and writes the derived `users/{USER}/data/applications.db`. The database is disposable derived state, not a replacement for the markdown source of truth.
- Upstream tracker merge locking is preserved, but the lock key is derived from the active user's canonical `users/{USER}/data/applications.md` path. Report-link normalization also canonicalizes the user root so symlinked temp/user directories do not produce bogus relative links.
- Preserve tracker/report ID parity in future `merge-tracker.mjs` changes: do not renumber a new TSV entry away from its worker-reserved report number, and do not let raw table-cell pipes corrupt the Markdown tracker row shape.
- Docs and help text must use placeholders like `{USER}`, `<username>`, or `<id>`. Do not hardcode a real local username outside its own ignored `users/{USER}/` directory.

Future merge notes:

- Preserve the explicit-user requirement. Do not silently fall back to root `cv.md`, root `portals.yml`, or other legacy single-user paths.
- If upstream introduces its own profile/user abstraction, compare it against this flow before replacing it. Keep the conversation-context behavior unless upstream provides an equivalent.
- When adapting upstream script changes, route every read/write of user-layer data through `lib/user-context.mjs` or equivalent active-user resolution.
- New upstream scripts are high-risk until checked for root-path assumptions. Search for bare `portals.yml`, `data/`, `reports/`, `output/`, `batch/`, `cv.md`, and `config/profile.yml`.
- Treat upstream voice/style additions such as `voice-dna.md` as user-layer data unless they are explicitly templates or documentation; user-specific writing voice belongs under `users/{USER}/`.
- If upstream changes `merge-tracker.mjs` locking again, preserve the full read/modify/write critical section and atomic write, but keep `APPS_FILE` rooted in `users/{USER}/data/applications.md`; do not restore root `CAREER_OPS_TRACKER` as normal production routing.
- Keep shared templates, modes, scripts, and provider code in the system layer; keep generated reports, CV outputs, trackers, portals, personal profile files, and interview prep in `users/{USER}/`.
- When upstream makes script helpers import-safe for tests, keep that behavior without resolving a user at module import time; resolve the active user only when the script runtime path needs user-layer files.

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
- Adapts upstream tracker report-link normalization to the per-user layout: workers still write user-root-relative `[REPORT_NUM](reports/...)` links, and `merge-tracker.mjs --user {USER}` rewrites them relative to `users/{USER}/data/applications.md` before merging.
- Preserves upstream `--limit N` so a batch run can process only the next N pending offers, while keeping the fork's existing user-scoped state, Codex worker, and timeout behavior around that bounded-run flow.
- Preserves upstream `--status` and `--watch` progress monitoring on the fork's user-scoped batch state.
- Preserves upstream `--skip-pdf`, but the flag still runs under the fork's active-user contract and writes user-scoped tracker additions with `❌` / `"pdf": null` rather than bypassing `users/{USER}/batch/`.
- Preserves upstream `awk`-based score arithmetic and malicious-score-safe status summaries; keep these in future merges so batch status rendering does not depend on `bc` and does not interpolate untrusted score text into shell arithmetic.
- Copies `local:jds/...` input rows from `users/{USER}/jds/...` into the temporary JD file passed to the worker. Missing local JD files intentionally become an empty temporary file so the worker can fail or recover using the URL/context path consistently.
- Logs the selected CLI and limit at run start so batch logs show which worker backend handled the run.
- Preserves upstream session/rate-limit handling: Claude workers can pause a batch with `paused_rate_limit`, resume through `--resume-paused`, and avoid consuming retry budget when a session/rate limit is detected.
- Preserves upstream Claude MCP isolation through `--strict-mcp-config`, while keeping Codex execution separate through the fork's schema-checked final JSON flow.
- Injects `users/{USER}/modes/_profile.md` and `users/{USER}/config/profile.yml` into the temporary resolved worker prompt so batch scoring uses the same user-layer personalization as interactive scoring.

Future merge notes:

- If upstream changes `batch/batch-runner.sh`, preserve the CLI abstraction unless upstream adds equivalent multi-agent worker support.
- Keep the Codex command rooted at `PROJECT_DIR` so generated reports, tracker additions, and user-layer paths resolve the same way as normal career-ops commands.
- Preserve the schema-checked final JSON contract for Codex workers; do not regress to parsing the free-form transcript as the main completion signal.
- Preserve stale-state recovery and explicit missing-artifact failure reasons. They are needed because a headless worker can write partial artifacts or transcript JSON without producing the required final-message JSON.
- Preserve runner-reserved report numbering for tracker TSVs if upstream changes batch merge behavior. Worker-side `applications.md` max calculations are unsafe under parallelism.
- Preserve report numbering beyond 999 if upstream changes `reserve-report-num.mjs`; scans for occupied slots and `--release` validation must accept any positive-width numeric prefix while artifact display can stay padded to at least 3 digits.
- Preserve upstream report-link normalization, but keep its filesystem roots user-scoped. Do not reintroduce root-level `data/applications.md`, root `reports/`, or `CAREER_OPS_TRACKER` as the normal production path.
- Keep upstream `--limit` or an equivalent bounded-run mechanism wired through the fork's user-scoped batch state; it is operationally useful when processing queues under usage limits.
- Preserve `--status` and `--watch` or equivalent progress visibility if upstream changes batch state layout; they should keep reading `users/{USER}/batch/batch-state.tsv`.
- Preserve the active-user requirement for `--status` and `--watch`; upstream root-batch fixtures need `CAREER_OPS_USERS_DIR` plus `--user test` in this fork.
- Preserve `local:jds/...` support because scan and pipeline flows can enqueue saved local JDs rather than only external URLs.
- Preserve upstream rate-limit pause semantics and Claude MCP isolation. If the worker command code is refactored again, test that `paused_rate_limit` does not consume retry budget and Claude workers still include `--strict-mcp-config`.
- If post-batch pipeline reconciliation is refactored, make sure the reconciler receives the user-scoped state, pipeline, and reports paths together; otherwise it can look for report files in the wrong reports directory.

## Custom Provider Layer

The fork adds a large structured provider surface for zero-token scanning and keeps local compatibility filters around some providers that upstream later adopted.

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
- `providers/arbeitsagentur.mjs`
- `templates/portals.example.yml`
- `test-all.mjs`

What this customizes:

- Adds structured parsers/fetchers for PCSX, Landing.jobs, DevITJobs-family boards, DEVjobs.de, jobs.ch, Jobs in English Denmark, Make it in Germany, EU Remote Jobs, ITJobs, SAPO Emprego, Portal Emprego, Dice, Remote in Europe, NoDesk, RustJobs.dev, and related English Jobs boards.
- Upstream now also supplies first-party Workable, SmartRecruiters, Recruitee, SolidJobs, Workday, RemoteOK, Remotive, IBM, Working Nomads, Arbeitsagentur, Jobstreet, Glints, BambooHR, and Breezy provider modules. Keep those upstream modules separate from the custom provider layer instead of duplicating them in `providers/_custom.mjs`.
- Working Nomads is partly retired from the fork's custom-provider dispatcher: the provider module is now direct/upstream-style, while local config compatibility for `api`, inferred location, `api_params.q/category/location/tags`, and `published_within_days` remains in `providers/workingnomads.mjs`.
- Arbeitsagentur remains an upstream-style provider module, but the fork adds local normalization that prefixes remote-titled postings with `Remote, ...`, avoids doing so for explicit no-remote/no-homeoffice titles, and uses `Deutschland` when the API omits a location. This keeps location filtering useful for nationwide/remote Germany scans without letting `NO REMOTE` titles slip through as remote.
- The current upstream Arbeitsagentur provider adds `remoteMatch: filter` and `remoteMaxPages` so server-side `homeoffice=nv_true` filtering can complement the fork's title-based remote normalization; preserve both paths because source configs may rely on either.
- Keeps small provider adapter modules so `scan.mjs` can load these sources through the upstream provider plugin contract.
- Adds retry-aware JSON fetching with timeouts, exponential backoff, jitter, and a deliberately narrow retryable-status set.
- Extends the example portal config with these discovery sources and custom notes/parameters.
- Adds tests for the retry helper, Greenhouse URL safety, and the custom provider fetch wrapper.
- Keeps upstream provider tests intact for Workable, SmartRecruiters, Recruitee, SolidJobs, and scanner rediscovery behavior.

Future merge notes:

- If upstream adds one of these providers, compare behavior before keeping both. Prefer upstream modules when they produce equivalent fields and filtering; otherwise keep only the missing compatibility layer, as done for Working Nomads filters in this merge.
- If upstream adds a shared retry helper, consider replacing `providers/_custom-fetch.mjs` and reducing local tests to compatibility coverage. Upstream's Ashby-specific timeout/backoff is not yet a full replacement for the custom helper because the fork uses the helper across several custom structured providers.
- Keep upstream Workable, SmartRecruiters, Recruitee, IBM, Arbeitsagentur, Jobstreet, Glints, BambooHR, and Breezy tests intact when changing scanner/provider plumbing; they are now part of the upstream provider baseline that the fork should build around.
- Preserve the Arbeitsagentur remote/no-remote normalization unless upstream adds an equivalent signal in the provider output or scan filtering layer.
- `templates/portals.example.yml` is high-conflict. Preserve upstream example improvements, then reapply only still-useful local source definitions.

## Scan Company And Location Filters

The fork adds scanner-side policy filters so per-user portal configs can reject forbidden employers and tune location matching before offers are added to the pipeline.

Files:

- `scan.mjs`
- `test-all.mjs`
- `users/{USER}/portals.yml`

What this customizes:

- Adds exported `buildCompanyFilter(company_filter)` support in `scan.mjs`.
- Reads optional `company_filter.block` from the active user's `portals.yml`.
- Builds the global location filter from `location_filter`, but lets each tracked company or job-board entry override it with its own `location_filter`. This is useful for broad global filters plus source-specific exceptions such as Germany-only Arbeitsagentur boards.
- Rejects provider results whose `job.company` contains a blocked company keyword, case-insensitively.
- Applies the company block before title, location, URL, and company-role dedupe checks, so forbidden employers do not consume dedupe slots or enter `data/pipeline.md`.
- Prints `Filtered by company: N removed` in scan summaries when a company block list is configured.
- Adds `test-all.mjs` coverage that checks the scanner advertises the company block path and verifies `buildCompanyFilter` rejects configured employers while passing unrelated companies.
- Preserves upstream `content_filter` as a separate title/description filter; do not collapse it into the company block filter because the two policies answer different questions.

Future merge notes:

- Preserve this hook while user profiles need hard employer exclusions such as direct partners, conflicts of interest, or blocked industries.
- If upstream adds first-class employer/company exclusion support, migrate `company_filter.block` configs to the upstream schema or keep this key as a compatibility alias.
- Keep the filter tolerant of missing or malformed company names; unknown company values should pass to downstream evaluation rather than being silently dropped.
- Preserve per-target `location_filter` precedence over the global filter. If upstream adds provider-specific scan filters, keep the current config shape as a compatibility alias or provide a migration for user portal configs.
- Keep LinkedIn authenticated scanning's `linkedin_searches.employer_blocklist` separate unless upstream unifies authenticated and zero-token scan filtering under one shared company-block schema.
- Preserve upstream metadata sanitization (`formatPipelineOffer` / `formatScanHistoryRow`) when changing filter order so hostile provider strings cannot write extra pipeline or TSV fields.

## Scanner Duplicate Reopen Semantics

The fork treats a reopened posting as the same opportunity when the scanner rediscovers a company/title match that previously closed.

Files:

- `scan.mjs`
- `test-all.mjs`
- `dashboard/internal/data/career.go`
- `dashboard/internal/data/career_test.go`
- `users/{USER}/data/applications.md`
- `users/{USER}/data/scan-history.tsv`

What this customizes:

- `scan.mjs` parses tracker rows by header names, splits company/title dedupe state into active, closed, and reopenable rows, and keeps the exact company/title key as the duplicate identity for this behavior.
- If a provider returns a live posting whose company/title matches a `Closed` row and no normal active row exists, the scanner counts it as a duplicate, does not append it to `users/{USER}/data/pipeline.md`, and reopens the original row in `users/{USER}/data/applications.md` by setting status to canonical `Evaluated`.
- Reopening updates the original tracker row's date to the scan date and appends `Reopened {YYYY-MM-DD}: duplicate live posting found at {URL}` to the notes column. The row number, score, PDF marker, report link, company, and role are preserved.
- If the scanner later finds a duplicate of an already reopened duplicate, it still updates the same original tracker row and appends the newer URL instead of creating a second row or ignoring the fresher posting.
- Reopened duplicate URLs are written to `users/{USER}/data/scan-history.tsv` with status `reopened_closed_duplicate`, so URL enrichment and audit trails can see the fresh listing without turning it into a new application.
- Dashboard parsing extracts reopened URLs from tracker notes and uses the last reopened URL as the current job URL. This intentionally beats stale `**URL:**` values in old reports whose original posting has closed.
- Regression coverage lives in `test-all.mjs` for repeated scanner duplicate reopen writes and in `dashboard/internal/data/career_test.go` for latest-reopened-URL selection.

Future merge notes:

- Preserve the single-row invariant: closed reposts and duplicate-of-duplicate reposts should refresh the original tracker row, not create new tracker rows or pending pipeline items.
- Preserve `Evaluated` as the canonical reopened state. Dashboard may label this bucket as `OPEN`, but `OPEN` is not a tracker status.
- Keep reopened URL extraction ahead of report-header URL extraction in dashboard data parsing, otherwise old report headers can make the `o` open action point back to a stale closed URL.
- Keep `reopened_closed_duplicate` as a scan-history audit status unless upstream adds an equivalent explicit reopened/reposted status.

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
- Uses upstream's shared `auto_pdf_score_threshold` config from `users/{USER}/config/profile.yml`, defaulting to `3.0`, so interactive pipeline and batch processing share the same score threshold.
- Skips HTML/PDF generation when `final_decision` is `Skip`, even if the numeric score is higher.
- Skips HTML/PDF generation when `_profile.md` applies an explicit hard stop, such as a blocked company/domain or consultancy/staff-augmentation model.
- When a batch worker does generate a tailored CV, it may reorder and rewrite bullets inside each Work Experience block for JD relevance, but it must preserve the reverse-chronological order of the experience blocks themselves.
- Requires the report header to say `**PDF:** not generated - run /career-ops pdf {company-slug} to create on demand` when the gate blocks PDF generation.
- Requires the tracker TSV PDF column to use `❌` and the worker JSON summary to use `"pdf": null` when no PDF is generated.

Future merge notes:

- The configurable score threshold is now upstream behavior and should be preserved. The remaining fork-specific gate is the extra block for `Skip` decisions and `_profile.md` hard stops.
- Preserve the Skip/hard-stop gate unless upstream adds an equivalent policy to avoid wasting time and artifacts on offers the candidate should not apply to.
- Keep the gate aligned with `modes/pipeline.md`, which now says the full auto-pipeline generates PDFs only when the offer score meets the resolved `auto_pdf_score_threshold`.
- If upstream changes the batch worker prompt format, reapply the rule at the first point after score/final decision are known and before any HTML/PDF artifact is written.
- Preserve the Work Experience ordering constraint if upstream rewrites the CV tailoring instructions; relevance sorting should not make an older role appear more recent than it was.

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
- Preserves upstream ATS text normalization in `generate-pdf.mjs`; the theme override should layer on the normalized HTML rather than bypassing it.
- Preserves upstream temp-file `file://` rendering in `generate-pdf.mjs`, so local images/resources load through `page.goto(...)` while `cv.theme` overrides and user-scoped `cv.md` section validation still run before rendering.
- Fails PDF generation before Playwright launch if the rendered HTML still contains unresolved `{{PLACEHOLDER}}` tokens, so optional template fields must be resolved or omitted instead of leaking into candidate-facing PDFs.

Future merge notes:

- If upstream changes the CV template, keep the variable names stable or provide a migration for existing `cv.theme` configs.
- If upstream introduces first-class theming, compare key names and remove this local implementation if upstream covers the same use case.
- If upstream changes PDF rendering again, verify it still handles local images/resources, data-URL font inlining, `load` wait semantics, unresolved-placeholder rejection, `cv.theme`, and `users/{USER}/cv.md` validation in one focused smoke test.

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
- `dashboard/internal/data/derive.go`
- `dashboard/internal/data/derive_test.go`
- `dashboard/internal/model/career.go`
- `dashboard/internal/ui/screens/pipeline.go`
- `dashboard/internal/ui/screens/pipeline_test.go`

What this customizes:

- Removes the root `npm run dashboard` wrapper and `run-dashboard.sh`.
- Dashboard binaries are built into `users/{USER}/`, e.g. `cd dashboard && go build -o ../users/{USER}/career-dashboard .`.
- Cross-compiled dashboard binaries are also written into `users/{USER}/`, e.g. Windows x64 uses `GOOS=windows GOARCH=amd64 go build -o ../users/{USER}/career-dashboard.exe .`.
- The dashboard infers the user folder from its own location or the current directory, so the per-user binary runs without `--path`; `--path` remains available for unusual layouts.
- Adds `ListingDate` to dashboard application data.
- Extracts listing/posting dates from reports when present.
- Reads `data/scan-history.tsv` before the old root-level fallback.
- Shows listing date in the dashboard, falling back to the tracker processed date when no listing date is known.
- Uses a dashboard-specific fast parse path for startup and refresh: `ParseApplicationsForDashboard(...)` reads the tracker plus cheap scan/batch indexes without opening every linked report file.
- Keeps the full `ParseApplications(...)` report-enrichment behavior for non-dashboard callers that still need eager report URL/listing-date fallback.
- Lazily hydrates dashboard report summary fields (`Archetype`, `TL;DR`, `Remote`, `Comp`, and report-derived listing date) only for rows in or near the visible viewport, then renders those details in place as async loads complete.
- Runs viewport report reads inside Bubble Tea commands and returns loaded data through `PipelineReportLoadedMsg`; file IO does not happen inside the main `Update` handler, so keyboard navigation is not blocked by report parsing.
- Tracks report paths already being loaded so fast scrolling does not enqueue duplicate reads for the same visible report.
- Treats the original job URL as action-lazy data: viewport summary prefetches do not parse `**URL:**`; if the selected row has no known URL and the user presses `o`, the dashboard loads that selected report with URL extraction enabled and opens it only after the load returns a URL.
- Customizes the dashboard tab row for triage: removes the visible `ALL` and `TOP ≥4` tabs, labels the canonical `Evaluated` bucket as `OPEN` and makes it the first/default tab, keeps `OFFER` between `INTERVIEW` and `REJECTED`, and renders the tabs inline in the title row between `CAREER PIPELINE` and the right-side offer/average summary.
- Adds a canonical `Closed` tracker status for postings that closed before application; `Closed` has its own dashboard tab, is excluded from actionable/active metrics, and takes over closed/expired aliases that previously collapsed into `Discarded`.
- Simplifies the dashboard chrome by removing the secondary status-count row (`Applied:x`, `Evaluated:x`, `Skip:x`, etc.) and the separate `Sort`/`View`/shown-count row; the current sort label now lives in the bottom help row beside the keyboard shortcuts.
- Makes the dashboard flat-only: grouped view mode and the `v` view toggle are removed because the compact inline tabs and table layout make grouped rendering redundant.
- Customizes dashboard table defaults for scanning: the date column is labelled `DATE` instead of `APPLIED`, the last-contact column is labelled `CONTACT` instead of `LAST`, and the `PDF` plus `CONTACT` columns are visible by default while `RPT` remains optional.
- Treats dashboard status changes as job-ad interactions for the `CONTACT` column: status cells remain canonical, while the dashboard appends a dated `Status changed to ...` note and derives `CONTACT` from the latest note/status ISO date or the tracker date fallback.
- Renders the selected dashboard row as one continuous highlight by applying the selection background to every cell, separator, and trailing fill area instead of wrapping the already-styled row after composition.
- Removes passive dashboard/viewer background fills from the dashboard title, status summary, help row, job viewer title/footer, fenced code blocks, and inline code so background highlighting is reserved for actual interactive selections.
- Preserves upstream derived fields, shared sort comparator, and new dashboard sort modes, but keeps the listing-date sort on the fork's `dashboardDate()` fallback so reports/scan-history listing dates win when available.
- Preserves upstream customizable columns / column picker behavior and cross-platform default-app open helpers while keeping user-root normalization for report/PDF targets.
- Preserves upstream in-viewer status editing and status-cell-only row refresh while keeping the fork's `NewViewerModelWithFileRoot(...)` report/PDF link rewriting against the resolved user folder.
- Preserves upstream EUR/GBP/CHF compensation parsing and additional international-city derivation in dashboard pipeline data without changing the fork's per-user dashboard root inference.

Future merge notes:

- If upstream changes dashboard models or table rendering, preserve the listing-date fallback behavior unless upstream provides a better equivalent.
- Do not reintroduce the root dashboard wrapper unless upstream provides a better per-user binary flow.
- Keep upstream sort helper tests and add/adjust fork tests around listing-date fallback when dashboard parsing changes.
- Keep upstream column picker and OS-open tests intact when dashboard navigation changes; fork-specific tests should focus on user-root path inference and listing-date fallback.
- Keep status-picker tests and user-root PDF rewrite tests together if the viewer constructor changes again; both behaviors must coexist.
- Preserve the dashboard fast path on future parser changes: startup/refresh should not read every report, viewport summary prefetch should stay async and duplicate-suppressed, and URL extraction should remain tied to the explicit `o` open-original action unless the URL is displayed directly in the list.
- Preserve the fork's triage-oriented tab layout unless upstream adds equivalent configurability: dashboard label `OPEN` for canonical `Evaluated` first/default, `OFFER` visible between `INTERVIEW` and `REJECTED`, no visible `ALL` or `TOP ≥4`, and tabs rendered inline in the first TUI row between the title and summary.
- Preserve `Closed` as distinct from `Discarded`: closed/expired postings map to `Closed`, candidate-discarded rows map to `Discarded`, and actionable metrics keep `Closed` out of actionable views.
- Preserve the fork's lean dashboard chrome unless upstream adds equivalent configurability: no secondary status-count row, no separate sort/view/shown row, no grouped view toggle, and current sort shown only in the bottom help row.
- Preserve the fork's dashboard table defaults unless upstream adds user-configurable column presets: flat-only rows, `DATE`/`CONTACT` labels, and visible `PDF` plus `CONTACT` columns.
- Preserve the `CONTACT` interaction semantics: manual dashboard status changes should update the tracker notes with a dated interaction, and parser changes should continue reading the latest ISO date from notes plus legacy dated status cells before falling back to the tracker date.
- Preserve the selected-row highlight behavior when table rendering changes: the highlight should cover the full row across all visible columns, separators, and trailing whitespace.
- Keep passive dashboard/viewer chrome unhighlighted when theme or renderer code changes; only selected rows and active picker rows should use background fills.

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
- Documents upstream `scan_history.recheck_after_days`, salary filtering, `scan:full`, scan handoff follow-up, and portal validation while keeping all examples user-scoped.

Future merge notes:

- Reconcile upstream copy edits first, then update only the provider lists and behavior statements that remain fork-specific.
- Keep `scan-ats-full.mjs` and `validate-portals.mjs` user-scoped unless upstream introduces equivalent multi-user routing.
- If upstream changes scan-history TTL, salary filters, or rediscovery semantics, preserve the fork's company block filter and authenticated scan age filter as separate local policy layers.

## Scan Handoff Artifact And Mode

The fork persists the full Agent/WebSearch follow-up list from the zero-token scan and exposes a separate command mode to process it on demand.

Files:

- `scan.mjs`
- `modes/scan.md`
- `modes/scan-handoff.md`
- `.agents/skills/career-ops/SKILL.md`
- `AGENTS.md`
- `DATA_CONTRACT.md`
- `README.md`
- `test-all.mjs`

What this customizes:

- `scan.mjs` writes `users/{USER}/data/scan-handoff.json` on every non-dry-run scan, using schema `career-ops.scan-handoff.v1` and including the complete handoff list even when terminal output truncates after the first 25 entries.
- The handoff artifact is user-layer data because it reflects the active user's `portals.yml` and latest scan state; updates must not modify or delete it.
- `/career-ops scan` remains a zero-token scanner command and does not automatically continue into the handoff flow.
- `/career-ops scan-handoff` reads the saved artifact and runs the agent/WebSearch follow-up workflow from `modes/scan-handoff.md`, including Playwright liveness verification before WebSearch-derived URLs reach `users/{USER}/data/pipeline.md`.
- `test-all.mjs` covers the handoff JSON payload shape and field sanitization.

Future merge notes:

- Preserve the separation between `scan.mjs` as the deterministic zero-token producer and `scan-handoff` as the agent/WebSearch consumer unless upstream ships an equivalent explicit resume command.
- If upstream adds a handoff artifact, migrate to the upstream schema only if it remains user-scoped and stores the complete list, not just the terminal preview.
- Keep WebSearch-derived additions gated by Playwright liveness verification; search snippets must not decide posting activity.

## Full ATS Discovery And Portal Validation

Upstream added reverse ATS discovery and portal schema validation. The fork keeps both features but routes their default files through the active user layer.

Files:

- `scan-ats-full.mjs`
- `validate-portals.mjs`
- `scan.mjs`
- `docs/SCRIPTS.md`
- `package.json`
- `test-all.mjs`

What this customizes:

- `scan-ats-full.mjs --user <username>` reads `users/{USER}/portals.yml`, writes to `users/{USER}/data/pipeline.md`, records `users/{USER}/data/scan-history.tsv`, and caches public ATS company directories under `users/{USER}/data/cache/ats-companies/`.
- Upstream `scan-ats-full.mjs --json` reserves stdout for one machine-readable result, sends human progress to stderr, reports degraded dataset/cap/undated metadata, and supports `--include-undated` and `--shuffle`; the fork keeps those semantics while still requiring `--user <username>` for real scans.
- `scan.mjs` exports `configureScanUserPaths(ctx)` so reverse ATS discovery can reuse the regular pipeline and scan-history writer without duplicating path logic.
- `validate-portals.mjs --user <username>` defaults to `users/{USER}/portals.yml`, while `--file` and `--self-test` remain data-independent for tests and template validation.
- `npm run scan:full -- --user <username>` and `npm run validate:portals -- --user <username>` are the normal production commands.

Future merge notes:

- If upstream changes the reverse scan writer or dedupe logic, keep it on the same configured scan helper path as `scan.mjs` so dedupe and pipeline format do not diverge.
- If upstream changes `--json` output again, keep stdout clean JSON in JSON mode and keep user/path logging on stderr; callers may parse stdout directly.
- If upstream makes portal validation part of CI only, keep explicit `--file` support for templates and explicit `--user` support for real user portals.

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
- Any fork provider adapter now covered by upstream first-party modules such as RemoteOK, Remotive, IBM, or Working Nomads. Working Nomads is already on the upstream-style module path; only the fork's local filter compatibility should remain unless upstream adds equivalent filters.
- A shared retry/backoff helper for provider fetches.
- Report-numbered CV artifact naming.
- Config-driven CV theme tokens.
- Per-user dashboard binary build/run flow.
- Dashboard listing-date parsing/display.
- Batch runner support for both Claude and Codex workers.
- Schema-checked Codex batch worker final JSON via `--output-last-message`.
- Bounded batch runs through `--limit` are now upstream baseline; preserve only the fork-specific user-scoped/Codex integration around the flag.
- Batch status/watch progress monitoring through user-scoped batch state.
- `local:jds/...` batch input handling.
- Conditional batch PDF generation for `Skip` decisions and profile hard stops. Score-threshold configuration is now upstream behavior through `auto_pdf_score_threshold`.
- Per-user adaptation for upstream tracker report-link normalization and `merge-tracker.mjs --migrate`.
- Per-user adaptation for upstream `merge-tracker.mjs` filesystem locking and atomic writes.
- Per-user adaptation for upstream `reserve-report-num.mjs`, `scan-ats-full.mjs`, `validate-portals.mjs`, and `generate-cover-letter.mjs`.
- Per-user adaptation for upstream `verify-portals.mjs`, `reconcile-pipeline.mjs`, pipeline liveness sweeps, `doctor.mjs --strict`, and any new scan/batch helpers that read `portals.yml`, `data/`, or `batch/`.
- User-scoped scan handoff artifacts at `users/{USER}/data/scan-handoff.json` plus the explicit `/career-ops scan-handoff` follow-up mode.
- Report-number reservation past 999 and reconciler report lookup through explicit `--reports` paths.
- Per-target scan `location_filter` overrides and Arbeitsagentur remote-title/no-remote normalization.
- User-scoped `voice-dna.md` behavior, if upstream keeps treating root `voice-dna.md` as a user file.
- Antigravity skill entrypoint materialization in `update-system.mjs`.
- Upstream dead-link/liveness gates in `modes/oferta.md` and `modes/auto-pipeline.md` that still respect user-layer reports and Playwright verification rules.
- Upstream Playwright MCP doctor warning that remains available through `doctor.mjs --user {USER} --json`.
- Upstream Release Please component-tag parsing in `update-system.mjs`.
- Upstream Docker/scaffolder tooling that preserves the user-layer data contract.
- Upstream cover-letter and interview modes that route generated artifacts and context through `users/{USER}/`.
- Generic JD/PDF extraction commands.
- Equivalent user-layer ignores for interview prep, scan summaries, `article-digest.md`, and editor folders.

If upstream covers one of these, prefer deleting the local customization over carrying duplicate behavior.
