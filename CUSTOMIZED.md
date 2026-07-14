# Fork Customizations

This file documents what this fork changes relative to `upstream/main` so future upstream updates can be merged without losing local behavior, and so local changes can be retired when upstream makes them redundant.

Generated from:

- Upstream ref: `upstream/main` at `c553fb24e925baf0183e5f849111025b6c6284be`
- Fork ref: current `main` at `23b9f18776d650571ddc6622626e6dca2bd6bc44`, before this inventory refresh
- Relationship baseline after merge, before this inventory refresh: upstream-only commits `0`, fork-only commits `143`
- Diff-size baseline after merge, before this inventory refresh: `225 files changed, 16378 insertions(+), 2900 deletions(-)`

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

This inventory incorporates upstream 1.9 through 1.19 behavior and web v0.3.0 through `c553fb24e925baf0183e5f849111025b6c6284be` as the new baseline, with fork-specific routing restored where upstream still assumed a single root user.

New upstream features or behavior now present:

- v1.19.0 release baseline: release metadata, changelog, README updates, and scaffolder package metadata are adopted through `c553fb24e925baf0183e5f849111025b6c6284be`.
- Dashboard discard learning loop: the pipeline status picker now asks for a predicted, canonical, or custom reason when a row moves to `Discarded` or `SKIP`, writes the reason atomically with the status, and feeds aggregated `discard_reasons` into pattern recommendations. The fork composes this with its dated `Status changed to ...` contact notes, distinct `Closed` state, lazy report hydration, user-root path containment, and semicolon-delimited Notes history.
- Truthful PDF tailoring gate: `jd-skill-gap.mjs` classifies JD requirements as named CV skills, resume-supported skills, or real gaps before drafting. Normal execution requires `--user <id>`, reads `users/{USER}/cv.md`, and uses user-scoped JD scratch files; no candidate claims are added automatically.
- Manual reply ingestion: `paste-reply.mjs` provides a no-Gmail interactive/file input path into reply-watch. Normal execution now requires an active user and appends only to `users/{USER}/data/reply-candidates.json`; the environment path override remains limited to isolated tests.
- Targeted upskill analysis: `upskill.mjs` can analyze a local JD or guarded remote URL in addition to aggregate tracker reports. The merge fixed direct-URL normalization and removed the upstream fallback to a system example CV so suppression evidence comes only from `users/{USER}/cv.md` and `users/{USER}/config/profile.yml`.
- Compact JD extraction routing: `oferta` and `auto-pipeline` may opt into `browser-extract.mjs` through `scan.extractor: cli`; the switch is read from `users/{USER}/config/profile.yml`, while Playwright remains the fallback.
- Provider and fetch hardening: upstream adds the Meituan provider and example portal entry, improves Workday CXS requests with browser-like headers, preserves Glints fetch behavior, and extends shared HTTP/provider tests. These providers remain stateless and receive user-selected portal configuration through the existing user-scoped scanner.
- OpenRouter prompt caching: the static system prefix is sent as an ephemeral cache-control text block so supporting providers can reuse it across evaluations without changing prompt contents or the fork's user-scoped prompt composition.
- Tracker parsing hardening: pipe-delimited additions now preserve empty interior PDF/Notes cells, and `—`/`-` join `N/A`/`DUP` as recognized no-score sentinels. Fixture tests explicitly clear inherited active-user variables when exercising path overrides so sandbox report links remain self-contained.
- Interview-prep URL fallback: interview preparation may fetch a supplied job URL only when no matching user report exists; `users/{USER}/reports/` remains authoritative whenever a report is available.
- Documentation provenance: upstream README translations add Wikidata backlinks for author/place entities. This is presentation-only and does not affect the active-user or candidate-fact boundary.
- Cheap-model golden evaluation harness: `eval-golden.mjs` and the synthetic `evals/` corpus provide deterministic replay scoring for archetype agreement and tolerance-banded score drift, with optional live evaluation through `openai-eval.mjs`. Replay remains user-independent; this fork requires `--user <id>` for live mode and forwards it to the existing user-scoped evaluator so CV reads stay under `users/{USER}/`.
- Browser extraction control: `browser-extract.mjs --max-chars N` can raise or lower the default 12,000-character JD text cap without changing listing-mode result limits. Invalid and non-positive values fall back to the safe default.
- Dashboard Spanish localization: the upstream `es` catalog and locale detection are adopted. The merge filled the fork-only Open, Offer, Hired, Closed, Date, and Contact labels so Spanish does not lose the customized lifecycle tabs or columns.
- PDF launch-failure cleanup: `generate-pdf.mjs` now removes temporary HTML even when Chromium fails to launch and defensively closes an opened browser without masking the original rendering error. This composes with the fork's active-user output boundary and PDF manifest behavior.
- Report numbering above 999: upstream now accepts arbitrary-width report prefixes and release ranges in `reserve-report-num.mjs`, making the fork's existing arbitrary-width reservation customization redundant at those parsing points; the user-scoped reports directory, contiguous reservations, and report/artifact ID parity remain fork behavior.
- Automated scan triage: the GitHub workflow now recognizes generated Markdown scan headers and emoji-led scan-result titles while anchoring the broader pattern to machine-report headings to avoid closing ordinary prose mentions.
- Auto-pipeline instructions: upstream removed a duplicated agency-mediated-posting paragraph. The conflict resolution keeps that cleanup and retains the fork's bounded research wording, which allows the assigned agent to finish the shared query budget without weakening the established delegation boundary.
- Author attribution documentation: the English and German README author credit now uses the author's full name, with the English name linked to the About page. This is presentation-only and does not interact with user-specific data or active-user routing.
- AI-maturity legitimacy signal: Block G now flags a possible AI-buzzword/infrastructure mismatch only when at least two of three evidence classes are present: transformation language that exceeds the role's scope/seniority, a very small team carrying organization-wide transformation expectations, and a legacy-heavy industry base rate. The note is descriptive, uses no additional research queries, suggests concrete interview probes, and remains orthogonal to both application score and the High Confidence / Proceed with Caution / Suspicious legitimacy tier.
- Deterministic HTML CV rendering: `build-cv-html.mjs` now turns a compact structured payload into the final ATS-safe HTML, so agents no longer spend output tokens reproducing template markup. The fork requires an active user for normal execution, preserves the report-linked `{REPORT_NUM}-{company}-{date}` artifact identity, restricts output to `users/{USER}/`, restricts template reads to `templates/`, and retains supported local/data-image profile photos.
- Template resolution hardening: `cv-templates.mjs` now allowlists `html` and `tex` formats, closing the format-based path-traversal route while retaining active-user profile defaults. `generate-cover-letter.mjs` now uses the same resolver with `users/{USER}/config/profile.yml`, so configured and per-payload cover templates affect real PDF generation rather than only mode instructions.
- Template and headless-tailoring documentation: the FAQ now explains named CV/cover templates and `docs/SCRIPTS.md` lists `openai-tailor.mjs` plus the deterministic HTML renderer. All candidate-data examples remain explicit-user/user-scoped in this fork.
- Deterministic user instruction composition: every routed mode now loads the shared system rules first, then `users/{USER}/modes/_profile.md`, then `users/{USER}/modes/_custom.md`, and finally the selected mode. `_custom.md` remains procedural/style context only and cannot introduce candidate facts.
- Configurable document templates: `cv-templates.mjs` discovers and validates named HTML/LaTeX CV and cover-letter templates, with defaults selected from the active user's profile. `build-cv-latex.mjs`, PDF mode, and cover mode use the shared resolver while preserving report-linked output and active-user containment.
- New document and assessment helpers: `img-to-pdf.mjs` converts one image to a one-page PDF through the existing Playwright runtime, and `assessment-log.mjs` records append-only assessment vendor/topic/threshold/score/staleness observations. Normal CLI use requires an explicit user; assessment data and generated outputs remain under `users/{USER}/`.
- Scanner/docs/web refinements: cross-listing fingerprints and blacklist behavior now have user-facing FAQ/script documentation, CRLF-safe doc assertions and CI rationale comments were adopted, and the web assistant/copy/theme controls now use the shared `Button` primitive without changing their behavior.
- v1.18.0 / web v0.3.0 release baseline: the fork adopted the current release metadata, dependency updates, accessibility/contrast and mobile tap-target fixes, Via-aware web parsing, and the split per-plugin registry while preserving the system-checkout/active-user web boundary.
- Evaluation and career operations: upstream added salary-gap analysis, lifetime stats, funnel calibration/velocity, adjacent-title and upskill modes, offer-prep with draft-only negotiation replies, interview red-flag analysis, reply classification, and fuzzy interview-invite matching. Every command that reads candidate data is adapted to require an active user and resolve under `users/{USER}/`.
- Tracker lifecycle: upstream added canonical `set-status.mjs`, the Via channel, duplicate-number detection, shared header-aware readers, and a `Hired` terminal state. The fork keeps its separate pre-application `Closed` state, preserves report/tracker ID parity by blocking conflicting TSVs instead of renumbering them, and exposes both `Hired` and `Closed` through the dashboard and analytics.
- Scanner policy and evidence: upstream added user blacklists, company aliases, posting-age gates, `postedAt` persistence, per-title content filters, scan-run counters, JD fingerprints for cross-listings, a compact CLI browser extractor, and Ashby/Lever API overrides. These are wired into the fork's user-scoped portal/pipeline/history paths and coexist with company/location filters plus closed-duplicate reopen behavior.
- Provider expansion: upstream added or hardened Tencent, 4dayweek, LaraJobs, EchoJobs, Lever EU, Cornerstone/CSOD, Rheinmetall, Phenom, Radancy, TKMS, Heckler & Koch, Deutsche Bahn, and the extracted auto-discovered provider test suites. Fork-only providers remain in the custom provider layer rather than duplicating upstream implementations.
- CV safety and alternate rendering: upstream added `verify-cv-facts.mjs`, OpenAI-compatible headless tailoring, intentional `--allow-reorder`, and the opt-in `latex-tex` extract/patch/compile flow. The fork routes CV/profile/output access through `users/{USER}/`, includes user profile/custom mode context, keeps report-numbered artifact names, and runs the fact gate before PDF rendering.
- Batch policy: upstream added `spend_tier` model routing and the auditable pre-screen discard gate. Claude tier mapping now runs against `users/{USER}/config/profile.yml`; Codex retains its explicit schema-checked worker path and uses its configured default unless `--model` is supplied. Discard logs live under `users/{USER}/batch/logs/`.
- Dashboard i18n and terminal states: upstream extracted the Go TUI catalog and added `Hired` celebration behavior. The fork keeps its inline OPEN/APPLIED/INTERVIEW/OFFER/HIRED/REJECTED/CLOSED/DISCARDED/SKIP tab order, lazy report hydration, DATE/PDF/CONTACT defaults, full-row selection, lean responsive help row, and per-user binary/root inference.
- Language surface: upstream added Hindi, Indonesian, Traditional Chinese, and German interview modes, and decoupled `language.output` from market-mode selection. These remain system-layer translations; candidate preferences and content stay in the active user's profile/mode files.
- Instruction and test architecture: upstream now owns the thin `CLAUDE.md` wrapper, so the former fork-only wrapper restoration is retired as a customization. Upstream also split provider tests into `tests/providers/` with a shared CodeQL-safe harness; fork-specific tests remain in the core suite and use disposable explicit-user fixtures.

- v1.17.0 / web v0.2.0 release baseline: upstream `VERSION`, Release Please manifest, changelog, web package metadata, and `web/CHANGELOG.md` now include the current release. The fork adopted the release metadata while preserving updater safeguards and explicit-user data routing.
- Web inbox triage: upstream added the Abundance → Triage → Shortlist → Opt-in Score inbox flow (`web/src/components/inbox/*`, `web/src/lib/inbox.ts`) plus report progressive disclosure, mobile tap-target fixes, cleaner config copy, and `cleanChips` tests. The fork keeps these changes while preserving the web split between the system checkout (`CAREER_OPS_ROOT`) and the active user folder (`CAREER_OPS_USER`).
- Provider and portal expansion: upstream added or hardened Amazon, Avature, SAP SuccessFactors/RMK/CSB, Get on Board, Dassault, Beesite, Softgarden, Workday, SmartRecruiters, Glints, and Jobstreet behavior, including Workday liveness probe max-page caps, `api:` honoring for Workday/SmartRecruiters, Avature offset self-heal, Glints v2 API support, and Jobstreet GraphQL migration docs. The fork adopted these providers under the existing active-user scan pipeline and portal-template model.
- New workflow helpers: upstream added `agent-inbox.mjs`, `add-entry.mjs`, `followup-seed.mjs`, and `process-quality.mjs`, plus `modes/agent-inbox.md`, `modes/add.md`, formal email draft mode, application pre-scan knockout questions, process-friction aggregation, and transcript-driven targeting correction. The fork routes normal CLI use through `--user {USER}` and `users/{USER}/...`, while keeping explicit env/file overrides for isolated tests.
- Report/PDF/updater fixes: upstream added `reserve-report-num.mjs --count N`, CSS `@page` margins for PDFs, configurable updater timeout budgets, and CLAUDE local-additions preservation. The fork keeps these behaviors with user-scoped reports/output and restores `CAREER_OPS_REPORTS_DIR` as a test fixture override for reservation tests.
- Language and interview surface: upstream added Korean modes plus Spanish/French interview plan/practice/debrief translations. These are system-layer language assets; user-specific targeting and interview content still belong in `users/{USER}/config/profile.yml`, `users/{USER}/modes/_profile.md`, and `users/{USER}/interview-prep/`.
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
- Doctor warnings: upstream `doctor.mjs` now warns when project-level Playwright MCP config is missing. The fork keeps this warning user-scoped through `doctor.mjs --user {USER} --json`, but the warning is not proof that runtime Playwright tools are unavailable; Codex agents must use `tool_search` or equivalent runtime tool discovery before saying Playwright MCP is absent.
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
- Ashby liveness upgrade: upstream added an Ashby-specific `liveness-api.mjs` API rung that maps `jobs.ashbyhq.com/{org}/{jobId}` and `/application` links to the public org job-board API, then confirms whether the specific job ID is still listed. This reduces false-expired results from JS-rendered Ashby pages while preserving the fork's conservative fallback: malformed payloads, network errors, redirects, rate limits, and unknown shapes still return `null` for the Playwright browser check.
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
- v1.14 release baseline: upstream `VERSION`, Release Please manifest, and `CHANGELOG.md` now include v1.14.0. The fork adopted the release metadata while preserving updater safeguards for user-layer files.
- CLI/runtime surface: upstream added first-class Codex docs/wrapper support and Kimi CLI entrypoints through `CODEX.md`, `KIMI.md`, and `.kimi/skills/career-ops/SKILL.md`. The fork keeps these as thin `AGENTS.md` / canonical-skill pointers, but rewrites examples to include the required active user instead of root `data/pipeline.md` assumptions.
- OpenAI-compatible evaluator: upstream added `openai-eval.mjs` for OpenAI, OpenRouter, Together, Groq, DeepSeek, local `/v1` servers, and other compatible endpoints. The fork adopted the endpoint/security behavior and adapted CV/report paths through `--user {USER}`, `users/{USER}/cv.md`, and `users/{USER}/reports/`; `test-all.mjs` now has a guard for that user-scoped routing.
- Governance/docs surface: upstream added `ARCHITECTURE.md`, `MAINTAINERS.md`, broadened `CODEOWNERS`, and added `docs/SUPPORTED_JOB_BOARDS.md`. These are system-layer docs; keep any user-specific targeting or company preferences in `users/{USER}/portals.yml` and profile files.
- Scanner/mode hardening: upstream trimmed `title_filter` keywords before length checks and bounded scan subagents as single-pass workers that must not fan out into more research agents. The fork keeps those constraints while preserving quiet long-running monitoring, `scan-auth`, `scan-handoff`, `go`, user-scoped portal paths, and the custom provider layer.
- Sourcing shorthand: the fork adds `/career-ops go` as a coordinated sourcing mode that runs zero-token scan, conditionally runs scan-handoff when the latest scan wrote handoff items, runs authenticated LinkedIn scan, and conditionally runs pipeline only when the scan phases added pending jobs.
- Updater/runtime fixes: upstream registered Kimi paths in updater system manifests and fixed updater self-reexec checkout discovery from import closure analysis. The fork keeps those fixes while preserving `users/`, root `voice-dna.md`, and other user-path safety guards; `scaffolder/bin/skill-entrypoints.mjs` also materializes `.kimi/skills/career-ops/SKILL.md` so Kimi behaves like the other CLI entrypoints on filesystems without symlink support.
- Tracker parser consolidation: upstream extracted header-name tracker column parsing into `tracker-parse.mjs` and expanded tests so `merge-tracker.mjs`, `dedup-tracker.mjs`, `followup-cadence.mjs`, and `analyze-patterns.mjs` share the same `Location`-column-safe mapping. The fork adopted the shared parser while keeping production readers on `users/{USER}/data/applications.md`; `CAREER_OPS_TRACKER` remains a fixture/non-standard override.
- Evaluation research bounds: upstream added an explicit single-pass research budget to `modes/oferta.md` and `modes/auto-pipeline.md`, capping company/comp/hiring-signal lookup at 5 WebSearch queries and keeping research inside the agent assigned to each role instead of recursively launching research workers. This preserves the fork's one-role-per-worker pipeline fan-out while bounding work within each evaluation.
- Setup support docs: upstream added `docs/FAQ.md` and linked it from `README.md`/`SUPPORT.md`. The fork keeps the FAQ but rewrites scanner and batch examples to use `--user {USER}` plus `users/{USER}/portals.yml` instead of root single-user paths.
- Test/CI coverage: upstream now runs Go dashboard tests in GitHub Actions and adds quick-suite coverage for Remotive normalization, shared tracker parsing, `dedup-tracker.mjs` with an inserted Location column, fresh-install `scan.mjs` pipeline creation, and bounded evaluation research. The fork keeps those tests while preserving explicit-user fixtures for production paths.
- v1.15 release baseline: upstream `VERSION`, Release Please manifest, and `CHANGELOG.md` now include v1.15.0. The fork adopted the release metadata while preserving updater safeguards for user-layer files.
- Plugin system: upstream added an opt-in plugin engine, bundled Apify/Gmail/Notion plugins, registry governance, plugin audit/install commands, config templates, registry validation CI, and plugin docs. The fork keeps bundled plugin code in the system layer but treats `config/plugins.yml`, `plugins.local/`, and `plugins.lock` as user-layer data under `users/{USER}/`; `plugins/_engine.mjs`, `doctor.mjs`, and `scan.mjs` were adapted so bundled plugins come from the repo while enabled-plugin config, local plugin roots, and integrity locks can live under the active user.
- Plugin successor model: upstream now treats bundled plugins as reference seeds and allows a registry-approved community plugin with `supersedesBundled: true` to override the bundled seed only when the user installs the exact pinned commit. The fork keeps the registry as system-layer trust metadata but resolves installed successors, plugin locks, and local plugin files from the active user root (`users/{USER}/plugins.local/` and `users/{USER}/plugins.lock`), so one user's approved successor does not shadow bundled plugins for another user.
- Google Calendar plugin registry: upstream added a pinned `career-ops-plugin-google-calendar` registry entry. This only expands the curated install catalog; users still must explicitly install, enable, and consent through `node plugins.mjs --user {USER} add/enable ...`, with config and locks under the active user's folder.
- Tavily plugin registry: upstream added a pinned `career-ops-plugin-tavily` search plugin entry requiring `TAVILY_API_KEY` and `api.tavily.com`. This only expands the curated install catalog; users still must explicitly install, enable, and consent through `node plugins.mjs --user {USER} add/enable ...`, with config and locks under the active user's folder.
- Obsidian/startup-board plugin registry: upstream added pinned `career-ops-plugin-obsidian` and startup-board registry entries, expanded community plugin docs, and fixed the Notion plugin so slash-formatted scores are not mangled. These remain catalog/plugin behavior only until a user explicitly installs/enables them; registry metadata is system-layer, while plugin config, locks, and local plugin roots remain under `users/{USER}` in this fork.
- Experimental web UI: upstream added the opt-in `web/` Next.js alpha, web CI, issue template, local-first dashboard views, apply helper routes, CV editor/ingest, pipeline/explore views, and bug-report diagnostics. The fork keeps the web app as system-layer code but adapts its central root helper so `CAREER_OPS_ROOT` points to the system checkout while `CAREER_OPS_USER` selects `users/{USER}` for data reads/writes; subprocesses that run core scripts use the system root plus `CAREER_OPS_USER`/`CAREER_OPS_USERS_DIR`.
- Application preparation and safe apply flow: upstream added `prepare-application.mjs` and web apply helpers for Greenhouse/Ashby/Lever auto-fill preparation. The fork keeps the prepare-not-submit boundary and routes profile, PDF, and cover-letter reads through the active user's root, so generated application material still comes from `users/{USER}/config/profile.yml` and `users/{USER}/output/`.
- Finder and verifier upgrades: upstream added `find.mjs` to resolve tracker/report/company queries and expanded `verify-pipeline.mjs` to warn about duplicate reports and orphan reports. The fork keeps those read-only/report-hygiene behaviors but reads `users/{USER}/data/applications.md`, `users/{USER}/data/pdf-index.tsv`, and `users/{USER}/reports/` by default, with fixture overrides reserved for tests.
- Interview workflow modes: upstream added `modes/interview/plan.md`, `modes/interview/practice.md`, and `modes/interview/debrief.md`, plus session scaffolding under `interview-prep/sessions/`. The fork exposes those modes in the canonical agent router while keeping user interview notes and session outputs as user-layer data under `users/{USER}/interview-prep/`.
- Scanner and pattern analysis upgrades: upstream added `classify-tier.mjs`, optional `skip_tiers` filtering in `scan.mjs`, JibeApply provider support, ATS channel-yield analysis in `analyze-patterns.mjs`, and `responded_initial` follow-up cadence handling. The fork keeps the new filters/analysis while preserving company block filtering, per-target location filters, active-user scan paths, and user-scoped tracker/report reads.
- PDF/onboarding/release fixes: upstream v1.16.0 added the PDF output-root guard fix, right-gutter CV template fix, doctor `autoCopied` reporting for seeded templates, and translated README personal-data whitelist adjustments. The fork keeps those fixes while anchoring PDF output containment to the active user root when a user is selected and preserving `CLAUDE.md` as a thin `AGENTS.md` wrapper.
- OpenRouter/free-tier runtime: upstream added `openrouter-runner.mjs`, free-tier onboarding docs, concrete token-budget walkthroughs, and `.env.example` entries for OpenRouter-compatible execution. The fork adopted the runner and docs while preserving the rule that user-specific model/provider preferences belong in `users/{USER}/config/profile.yml` or user custom instructions rather than system modes.
- Provider expansion: upstream added direct first-party providers for Arbeitnow, Pinpoint, The Muse, Rippling, The Hub, Landing.jobs, Himalayas, Jobicy, Hacker News, JustJoin, NoFluffJobs, Jobspresso, 4 Day Week, and NoDesk. The fork adopted these direct providers; `providers/landingjobs.mjs` and `providers/nodesk.mjs` now retire the older `_custom` wrapper path for those IDs, while the `_custom` dispatcher remains for fork-only providers still not covered upstream.
- Scanner behavior: upstream added repost detection through `detect-reposts.mjs`, compensation persistence into `pipeline.md`, tighter company matching/dedup ordering for cooldown filtering, and fresh provider tests. The fork keeps those behaviors while preserving company block filtering, per-target `location_filter`, active-user pipeline/history/handoff paths, and closed-duplicate reopen handling.
- Dashboard PDF workflow: upstream added report-viewer cover-letter hotkey `L`, pipeline hotkeys `d` to open CV PDFs and `D` to regenerate them, `data/pdf-index.tsv`, and dashboard PDF lookup tests. The fork routes the PDF manifest to `users/{USER}/data/pdf-index.tsv`, keeps generated HTML/PDF under `users/{USER}/output/`, and makes dashboard regeneration from a per-user binary call the repo `generate-pdf.mjs` with `--user {USER}` plus `CAREER_OPS_USERS_DIR`.
- PDF manifest source metadata: upstream now threads the original input HTML path through `renderHtmlToPdf(...)` so `data/pdf-index.tsv` records the source document instead of the temporary render file. The fork preserves that behavior while keeping manifest rows rooted at `users/{USER}/data/pdf-index.tsv`; PDF and HTML entries are user-root-relative when a user is active, and blank rather than escaping the allowed manifest root.
- Italian language modes: upstream added `modes/it/` (`annuncio`, `candidarsi`, `pipeline`, `_shared`, and README) and registered the locale in updater materialization. These are system-layer language assets; user-specific Italian targeting still belongs in `users/{USER}/config/profile.yml` or `users/{USER}/modes/_profile.md`.
- Zero-cost model docs: upstream expanded `docs/RUNNING_ON_A_BUDGET.md` with `npm run or:*`, Ollama, and OpenAI-compatible runtime paths. The fork keeps those docs as general system guidance; user-specific provider/model preferences remain user-layer configuration.
- User-layer ignore coverage: upstream added root ignores for `data/follow-ups.md` and `modes/_custom.md`. The fork adopted those ignores alongside its existing legacy-root ignores for `voice-dna.md`, `article-digest.md`, `.scan-auth/`, and `users/`, so accidental root personal data remains protected while real user data lives under `users/{USER}/`.
- CV pagination fix: upstream adjusted `templates/cv-template.html` so role titles do not orphan at page breaks. The fork adopted the template fix while preserving `cv.theme` CSS variable overrides and user-scoped PDF output behavior.
- Application answer persistence: upstream added `application-answers.mjs` plus `modes/apply.md` guidance for writing a `## Application Answers` section with filled/submitted state, free-text answers, selections, field values, and uploaded files. The fork keeps the formatter/upsert behavior but requires an active `--user {USER}` for CLI writes and resolves report paths under `users/{USER}/`, so application snapshots are stored in the user's report files rather than root `reports/`.
- Teamtailor provider: upstream added a zero-auth RSS provider for `*.teamtailor.com` plus explicit `provider: teamtailor` support for branded Teamtailor domains. The fork adopted the provider and tests as system-layer provider code; per-user opt-in for branded domains still belongs in `users/{USER}/portals.yml`.
- HigherEdJobs provider: upstream added `providers/higheredjobs.mjs`, supported-board docs, `templates/portals.example.yml` examples, and tests for the public HigherEdJobs RSS category feed. The fork adopted it unchanged as system-layer provider code; users opt in from `users/{USER}/portals.yml` with `provider: higheredjobs` and optional `cat_id`.
- VC portfolio seed discovery: upstream added `seeds/vc-portfolios.mjs`, `seeds/README.md`, and `scan-ats-full.mjs --seeds yc,a16z` to discover companies from public VC portfolio lists and probe them through ATS providers. The fork preserves that discovery surface while keeping `scan-ats-full.mjs` under the active-user resolver, with cache, pipeline, scan history, and portal filters rooted at `users/{USER}`.
- CI workflow: upstream changed `.github/workflows/test.yml` to use `npm install --ignore-scripts`, skipping the Playwright browser download because the quick Node and Go test jobs do not launch a browser. Local PDF/liveness workflows that do need browsers still rely on the normal Playwright install path.
- Dashboard/tracker column safety: upstream mapped dashboard tracker reads and status writes by header name, matching the Node tracker parser. The fork keeps that mapping while preserving reopened-URL preference from tracker notes and dated status-change notes when the dashboard edits an application status.
- Security/path hardening: upstream hardened batch temporary JD files, PDF output containment, tracker cell handling, common PII filename ignores, and structural updater path coverage through `validate-system-paths-coverage.mjs`. The fork keeps the hardening but scopes PDF output containment to the active user root, preserves `local:jds/...` batch copying from `users/{USER}/jds/`, and keeps `lib/` plus `liveness-browser.mjs` in updater system path coverage.
- Language/docs surface: upstream added Spanish locale modes (`modes/es/`), German README, Japanese mode parity updates, `docs/CODEX.md`, `docs/SUPPORTED_CLIS.md`, and broader setup/support docs. The fork adopted these as system-layer assets and rewrote conflicted examples to use explicit users and `users/{USER}` paths where they touch candidate data.

Conflict notes from this merge:

- `AGENTS.md`, `modes/pdf.md`, `jd-skill-gap.mjs`, `paste-reply.mjs`, `upskill.mjs`, `modes/reply-watch.md`, and `docs/SCRIPTS.md`: adopted the new skill-gap, manual-reply, and targeted-upskill workflows while replacing upstream root `cv.md`, `config/profile.yml`, `data/`, `reports/`, and output assumptions with explicit `--user {USER}` routing and `users/{USER}/...` paths.
- `dashboard/internal/data/career.go`, `dashboard/internal/data/career_test.go`, `dashboard/internal/ui/screens/pipeline.go`, and `dashboard/main.go`: combined the upstream discard-reason picker and atomic Notes write with the fork's dated dashboard interaction notes, distinct `Closed` state, lazy viewport hydration, and per-user dashboard root. Reason reads reject path traversal and normalize quoted YAML values before showing them in the picker.
- `batch/batch-prompt.md` and `analyze-patterns.mjs`: retained the new `discard_reasons` Machine Summary field and removed a duplicate report-summary block introduced by overlap; learning-loop recommendations now point to `users/{USER}/modes/_custom.md` instead of the tracked root template.
- `tracker-columns-tests.mjs`: preserved upstream empty-cell regression coverage while clearing inherited `CAREER_OPS_USER` and `CAREER_OPS_USERS_DIR` inside explicit tracker/additions fixtures; otherwise the fork's active-user resolver rebased sandbox report links outside the fixture.
- `modes/oferta.md`, `modes/auto-pipeline.md`, and `modes/interview-prep.md`: kept upstream compact extraction and URL-fallback instructions, with profile and report lookups restored to the active user's layer.
- `modes/oferta.md`: the upstream AI-buzzword/infrastructure mismatch signal merged cleanly into Block G. The fork retained its bounded-research and non-prescriptive legitimacy behavior, and corrected the adjacent employment-classification jurisdiction lookup to `users/{USER}/config/profile.yml` so both signals remain inside the active-user contract.
- `build-cv-html.mjs` and `modes/pdf.md`: adopted upstream's compact JSON → deterministic HTML workflow while replacing candidate-name/root-output examples with the fork's report-linked artifact basename and `users/{USER}/output/` paths. Normal CLI execution requires `--user`, rejects output outside the active user root, rejects templates outside `templates/`, and keeps self-test execution data-independent.
- `generate-cover-letter.mjs`, `modes/cover.md`, and `test/cover-resolver.test.mjs`: combined upstream's shared cover-template resolver with the fork's active-user output flow. Production resolution now reads `cover_letter.template` from `users/{USER}/config/profile.yml`, generated PDFs stay under `users/{USER}/output/`, and pure resolver/build tests still import without selecting a real user.
- `docs/FAQ.md` and `docs/SCRIPTS.md`: kept upstream's custom-template and OpenAI-tailoring documentation while restoring user-scoped profile/output paths, preserving the blacklist FAQ, and documenting the deterministic renderer's user/output/template boundaries.
- `cv-templates.mjs`, `test/cv-templates.test.mjs`, `test-all.mjs`, and `update-system.mjs`: adopted the upstream template-format allowlist, cover resolver tests, renderer self-test, and updater registration. The merged quick suite passes 1,748 checks; a separate temporary-user smoke test rendered the deterministic HTML through `generate-pdf.mjs` and recorded the report-linked manifest entry.
- `.agents/skills/career-ops/SKILL.md`, `AGENTS.md`, and `modes/_shared.md`: accepted upstream's deterministic `_profile` → `_custom` → selected-mode order and factual-source guard, while resolving every user customization reference through `users/{USER}` and retaining the fork's active-user, `go`, `scan-handoff`, `scan-auth`, and quiet-monitoring contracts.
- `assessment-log.mjs`, `cv-templates.mjs`, `img-to-pdf.mjs`, and `build-cv-latex.mjs`: upstream introduced or extended these helpers with root-oriented defaults. The merge routes assessment/profile access through `lib/user-context.mjs`, requires a user for normal CLI execution, and keeps generated image/LaTeX output inside the active user root; import-only helpers and self-tests remain data-independent.
- `DATA_CONTRACT.md`, `docs/FAQ.md`, `docs/SCRIPTS.md`, `modes/cover.md`, `modes/latex.md`, `modes/pdf.md`, and `modes/scan.md`: adopted assessment logging, template selection, image conversion, cross-listing, and blacklist documentation while rewriting candidate-data paths and examples to `users/{USER}` plus explicit `--user` arguments.
- `test-all.mjs`: combined upstream template, CRLF, workflow-order, assessment, and image self-tests with the fork's disposable `CAREER_OPS_USERS_DIR` fixtures and explicit active-user path markers. The merged quick suite passes 1,745 checks.
- `web/src/components/assistant-console.tsx`, `web/src/components/copyable-command.tsx`, and `web/src/components/theme-toggle.tsx`: adopted the shared `Button` primitive refactor unchanged; the web typecheck, 19 tests, audit, and production build remain green.
- `.agents/skills/career-ops/SKILL.md` and `AGENTS.md`: combined upstream `email`, `add`, `agent-inbox`, interview submodes, and onboarding docs with the fork's mandatory active-user router, `go`, `scan-handoff`, `scan-auth`, and quiet long-running monitoring rules. The canonical agent skill now exposes both the new upstream modes and the fork-only sourcing/auth modes.
- `CLAUDE.md`: upstream expanded this file again; the fork restored the thin `@./AGENTS.md` wrapper so active-user, data-contract, and source-of-truth behavior continues to have one canonical instruction surface.
- `DATA_CONTRACT.md`, `modes/patterns.md`, `modes/followup.md`, `modes/apply.md`, `modes/update.md`, `docs/SETUP.md`, `docs/SCRIPTS.md`, and `README.md`: merged upstream's new helpers and docs while rewriting user-data examples to `users/{USER}` and commands to explicit `--user {USER}` where they touch candidate data.
- `scan.mjs`: adopted upstream's provider registry loader (`providers/_registry.mjs`) and provider additions while preserving `configureScanUserPaths(ctx)`, user-scoped portal/profile/pipeline/history/handoff paths, company block filtering, per-target `location_filter`, and the combined `emptyTargets` behavior.
- `reserve-report-num.mjs`: combined upstream contiguous `--count N` reservation and range release with `users/{USER}/reports/`, arbitrary-width numeric prefixes, and the fork's test-only `CAREER_OPS_REPORTS_DIR` / `CAREER_OPS_REPORTS` override.
- `merge-tracker.mjs` and `dedup-tracker.mjs`: kept upstream's stricter score/status TSV column detection and fuzzy duplicate safeguards while preserving user-context imports and `users/{USER}/data/applications.md` routing.
- `prepare-application.mjs`: kept upstream's relative PDF containment hardening and adapted the error path/output guard to `users/{USER}/output/`.
- `add-entry.mjs`, `agent-inbox.mjs`, `followup-seed.mjs`, and `process-quality.mjs`: upstream introduced these as root-file helpers; the fork adapted normal CLI use to explicit users and `users/{USER}` defaults, kept env/file overrides for tests, and moved user resolution inside CLI-only paths where imports/tests need pure helper functions.
- `web/next.config.mjs` and `web/src/lib/career-ops.ts`: kept upstream web v0.2.0 behavior and the Turbopack root pin while preserving the fork's separation between system checkout resolution and active-user data resolution.
- `test-all.mjs`, `agent-inbox-tests.mjs`, `followup-seed-tests.mjs`, `process-quality.test.mjs`, and `web/test-clean-chips.mjs`: adopted upstream coverage for the new workflow helpers, providers, updater budgets, PDF margins, and web chip cleanup while adapting fixtures that touch candidate files to `CAREER_OPS_USERS_DIR`, `CAREER_OPS_REPORTS_DIR`, and explicit `--user test`.
- `.agents/skills/career-ops/SKILL.md`: combined upstream multi-CLI/Codex invocation notes with the fork's mandatory active-user routing, quiet long-running monitoring, `scan-auth`, and `scan-handoff` mode routing.
- `README.md` and `docs/SETUP.md`: kept upstream Codex/headless examples, supported job-board documentation, and broader CLI list, but rewrote setup and command examples to use `users/{USER}` and explicit `<username>` prompts.
- `modes/scan.md`: kept upstream's single-pass worker / no-subagent-fanout rule and preserved the fork's Spanish quiet-monitoring policy, `users/{USER}/portals.yml` configuration path, and scan-handoff completion guidance.
- `test-all.mjs`: kept upstream Codex/Kimi/docs/updater/MCP coverage while adding `.kimi` skill integrity checks and user-scoped `openai-eval.mjs` guards. The upstream `.claude/settings.local.json` MCP test was adapted to run through `doctor.mjs --user test` with a disposable `CAREER_OPS_USERS_DIR`.
- `openai-eval.mjs`: upstream added the evaluator as a root single-user script; the fork adapted it to `lib/user-context.mjs`, user-scoped CV/report paths, and help/output text that requires `--user {USER}`.
- `scaffolder/bin/skill-entrypoints.mjs`: upstream added Kimi wrapper files but the shared materializer still omitted Kimi; the fork added `.kimi/skills/career-ops/SKILL.md` to `SKILL_ENTRYPOINTS` and extended materialization tests accordingly.
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
- `analyze-patterns.mjs` and `followup-cadence.mjs`: adopted upstream `tracker-parse.mjs` shared column parsing, but resolved conflicts by keeping active-user resolution and `users/{USER}/data/applications.md`; `followup-cadence.mjs` still tolerates older user-root-relative `reports/...` links during migration.
- `docs/FAQ.md`: adopted upstream setup FAQ but rewrote scanner, ATS discovery, and batch examples to use `--user {USER}` and `users/{USER}/portals.yml`, preserving the fork's no-root-user-data contract.
- `test-all.mjs`: adopted upstream tests for shared tracker parsing, Remotive provider normalization, fresh-install pipeline creation, bounded evaluation research, and dashboard CI coverage; helper-only fixtures may still use temporary root `data/` or `CAREER_OPS_TRACKER`, but production CLI behavior remains explicit-user.
- `DATA_CONTRACT.md`, `.gitignore`, `doctor.mjs`, `scan.mjs`, and `plugins/_engine.mjs`: adopted upstream's opt-in plugin system while moving user-owned plugin toggles, local plugins, and plugin locks to `users/{USER}`. The plugin engine now supports a repo plugin root plus a separate active-user config/lock root so bundled plugins remain auto-updatable while user consent/config remains protected.
- `generate-pdf.mjs`, `modes/pdf.md`, `batch/batch-prompt.md`, `dashboard/internal/data/pdf.go`, `dashboard/internal/ui/screens/pipeline.go`, and `dashboard/main.go`: adopted upstream PDF manifest and dashboard PDF hotkeys, then routed the manifest and regenerated files through `users/{USER}/data/pdf-index.tsv` and `users/{USER}/output/`. The dashboard's `D` hotkey now resolves the repo root from a per-user binary and invokes `generate-pdf.mjs --user {USER}` with absolute user artifact paths.
- `.gitignore`: adopted upstream's `data/follow-ups.md` and `modes/_custom.md` root ignores while preserving the fork's broader user-layer and legacy-root ignore set, including `users/`, `.scan-auth/`, `voice-dna.md`, and `article-digest.md`.
- `generate-pdf.mjs`: combined upstream's manifest metadata threading (`inputPath` through `renderHtmlToPdf`) with the fork's user-scoped manifest path. The conflict resolution keeps `repoRelativeManifestPath(...)` for upstream compatibility and adds a root-aware manifest path helper so active-user manifests do not record paths outside `users/{USER}`.
- `modes/apply.md`: adopted upstream's persistent Application Answers workflow and Section H wording while keeping searches, CV reads, tracker updates, and example commands user-scoped under `users/{USER}/...`.
- `application-answers.mjs`: adopted upstream's additive report-section formatter/upsert helper, then wrapped CLI writes in the fork's active-user resolver so relative report paths resolve under `users/{USER}` and absolute report paths outside the active user root are rejected.
- `scan-ats-full.mjs`: adopted upstream `--seeds` VC portfolio discovery and `runSeedScan(...)`, then kept the fork's `configureScanUserPaths(...)`, `CAREER_OPS_USERS_DIR`, and user-scoped portal/cache/pipeline/history routing. The startup summary now includes both the user id and selected ATS/seed sources.
- `update-system.mjs`: added upstream `application-answers.mjs` and `seeds/` to system path coverage while preserving fork-only system entries such as `extract-jd.mjs`, `extract-pdf.mjs`, `scan-auth.mjs`, and `scan-auth/linkedin.mjs`.
- `providers/higheredjobs.mjs`, `templates/portals.example.yml`, `docs/SUPPORTED_JOB_BOARDS.md`, and `test-all.mjs`: the follow-up upstream HigherEdJobs commit merged cleanly with no conflict. No active-user adaptation was required because the provider is stateless and only reads the configured portal entry passed by `scan.mjs`; the example remains a system-layer template for copying into `users/{USER}/portals.yml`.
- `.github/workflows/test.yml`, `liveness-api.mjs`, and `test-all.mjs`: the Ashby liveness and CI follow-up merged cleanly with no conflict. No user-path adaptation was required because `liveness-api.mjs` is stateless URL classification/fetch code, and the new tests mock `globalThis.fetch` rather than reading user-layer files.
- `plugins.mjs`, `plugins/_engine.mjs`, `docs/PLUGIN_REVIEW.md`, `docs/PLUGINS.md`, `plugins/README.md`, and `test-all.mjs`: combined upstream's seed/successor model and plugin registry docs with the fork's user-scoped plugin root. `resolveSuccessorIds(root, userRoot)` now reads the system registry from the repo but checks `plugins.local` and `plugins.lock` under the active user root; `plugins.mjs list/run/skill` passes that override set into discovery, and tests cover user-root successor resolution.
- `plugins-registry.json`: upstream's Tavily registry addition merged cleanly with no conflict. No active-user adaptation was required because the registry is system-layer metadata and user install/config remains user-scoped.
- `.agents/skills/career-ops/SKILL.md` and `AGENTS.md`: combined upstream interview submodes and `doctor.mjs --json` `autoCopied` documentation with the fork's mandatory active-user router, `go`, `scan-handoff`, `scan-auth`, and quiet long-running monitoring rules.
- `CLAUDE.md`: upstream expanded this file back into a full single-root instruction copy; the fork restored the thin `@./AGENTS.md` wrapper so the active-user and source-of-truth contract has one canonical instruction surface.
- `analyze-patterns.mjs`: combined upstream ATS channel-yield analysis and `--min-vendor-n` guard with the fork's active-user resolver and `users/{USER}/data/applications.md` default.
- `scan.mjs`: combined upstream `skip_tiers` seniority filtering with the fork's company block filter, per-target `location_filter`, user-scoped portal/profile/pipeline/history/handoff paths, and closed-duplicate reopen logic. Filter order is company, title, seniority tier, location, salary, content.
- `generate-pdf.mjs`: combined upstream's repo-root anchored traversal fix with the fork's user-root output boundary: active-user runs can only write inside `users/{USER}`, while non-user fixture runs fall back to the repo root guard.
- `match-star.mjs`, `find.mjs`, `prepare-application.mjs`, and `verify-pipeline.mjs`: adopted upstream story-bank tests, finder, prepare-not-submit helper, and report hygiene warnings while preserving explicit-user CLI routing and `users/{USER}` file resolution.
- `web/src/lib/career-ops.ts`, web API routes, and `web/README.md`: adopted upstream's experimental web app but split system checkout resolution from active-user data resolution. `CAREER_OPS_ROOT` selects the code checkout, `CAREER_OPS_USER` selects the user folder, and core subprocesses run from the system root with the user env injected.
- `docs/SCRIPTS.md`: adopted upstream documentation for `find.mjs` and expanded verify report checks, then rewrote command examples and paths to `--user <username>` and `users/{USER}/...`.
- `dashboard/internal/data/career.go`, `dashboard/internal/ui/screens/viewer.go`, and `dashboard/main.go`: combined upstream header-name tracker writes, cover-letter hotkey, and cross-platform open helpers with fork behavior for reopened live URLs in notes, dated dashboard status-change notes, user-root PDF URL rewriting, and per-user binary/root inference.
- `scan.mjs`: combined upstream plugin-provider merging, compensation persistence, cooldown history statuses, and tighter dedup ordering with the fork's active-user portal/profile/pipeline/history/handoff paths and closed-duplicate reopen writeback.
- `providers/landingjobs.mjs` and `providers/nodesk.mjs`: upstream now owns direct first-party implementations, so the fork retired the old `_custom.mjs` wrapper for those providers while keeping the custom provider layer for fork-only sources.
- `batch/batch-runner.sh`: combined upstream secure `mktemp` JD files and score/status hardening with the fork's `local:jds/...` copy behavior, resolved URL prompt injection, Codex final-JSON schema contract, and per-user batch state.
- `modes/ja/_shared.md`: adopted upstream Japanese parity updates while rewriting source-of-truth, voice DNA, story-bank, tracker, and CV-sync commands to `users/{USER}` paths.
- `update-system.mjs`: kept upstream structural path coverage and new browser-liveness path while preserving the fork's `lib/` user-context layer and user-path rollback safeguards.
- `verify-cv-facts.mjs`, `salary-gap.mjs`, `funnel-velocity.mjs`, `stats.mjs`, `upskill.mjs`, `invite-match.mjs`, `reply-watch.mjs`, `set-status.mjs`, and `openai-tailor.mjs`: upstream introduced these with single-root defaults; direct user-data execution now resolves through `lib/user-context.mjs`, while pure imports and `--self-test` paths stay usable without touching a real user.
- `batch/batch-prompt.md` and `batch/batch-runner.sh`: combined upstream compensation reliability, `spend_tier`, pre-screen discard logging, typed final JSON, and CV fact validation with the fork's `{{USER_ROOT}}` prompt paths, explicit active user, Codex contract, report-numbered output, and per-user batch logs/state.
- `scan.mjs`: combined upstream company aliases, blacklist, title-category content filters, posting-age/`postedAt`, fingerprints, and run metrics with fork company/location filters, active-user paths, scan handoff, and closed-duplicate reopen writes. Alias-aware company/title buckets are used for new dedupe; the exported legacy loader remains for compatibility tests.
- `merge-tracker.mjs`: adopted upstream shared lock/atomic-write and header-aware tracker utilities, but intentionally keeps the fork's collision policy: a worker-reserved number already owned by another row blocks the TSV and leaves it pending; it is never silently renumbered away from its report/artifact identity.
- `dashboard/internal/{data,i18n,ui}` and `dashboard/main.go`: combined upstream TUI i18n and `Hired` behavior with the fork's `Closed` state, inline tab order, async viewport report loads, lean table/chrome defaults, dated status-contact notes, and per-user path inference.
- `test-all.mjs` and `tests/`: adopted upstream's auto-discovered provider layout and safe command harness, retained fork coverage for active-user routing and report-ID parity, and converted upstream single-root fixtures to disposable `CAREER_OPS_USERS_DIR` users.
- `CLAUDE.md`: upstream now ships the same thin `@AGENTS.md` wrapper pattern, so this file no longer needs a fork-only restoration. Future merges should accept the upstream wrapper and keep fork behavior canonical in `AGENTS.md`.

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
- `tracker-parse.mjs`
- `cv-sync-check.mjs`
- `doctor.mjs`
- `analyze-patterns.mjs`
- `add-entry.mjs`
- `agent-inbox.mjs`
- `followup-cadence.mjs`
- `followup-seed.mjs`
- `gemini-eval.mjs`
- `generate-pdf.mjs`
- `generate-cover-letter.mjs`
- `process-quality.mjs`
- `reserve-report-num.mjs`
- `scan-ats-full.mjs`
- `validate-portals.mjs`
- `verify-portals.mjs`
- `reconcile-pipeline.mjs`
- `archive-posting.mjs`
- `match-star.mjs`
- `ollama-eval.mjs`
- `openai-eval.mjs`
- `openai-tailor.mjs`
- `verify-cv-facts.mjs`
- `salary-gap.mjs`
- `funnel-velocity.mjs`
- `stats.mjs`
- `upskill.mjs`
- `invite-match.mjs`
- `reply-watch.mjs`
- `set-status.mjs`
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
- Upstream helper scripts adopted in this merge have been adapted to the same resolver: report reservations use `users/{USER}/reports/`, reverse ATS scans use `users/{USER}/portals.yml` plus `users/{USER}/data/`, portal validation defaults to `users/{USER}/portals.yml`, deterministic CV/cover-letter/image outputs use `users/{USER}/output/`, assessment events use `users/{USER}/data/assessments.tsv`, and analytics/reply/status/tailoring commands read only the active user's tracker, reports, profile, and fact sources.
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

Files:

- `batch/batch-runner.sh`
- `batch/batch-output-schema.json`
- `resolve-parallel.mjs`
- `lib/parallel-config.mjs`
- `batch/README.md`
- `config/profile.example.yml`

What this customizes:

- Replaces the Claude-only worker assumption with a generic headless worker setting.
- Adds `--cli claude|codex`, defaulting to `claude`, and supports `CAREER_OPS_BATCH_CLI` so local runs can select Codex without editing the script.
- Makes `--parallel` optional and resolves worker count as explicit argument,
  then `users/{USER}/config/profile.yml` `batch.parallel`, then system default
  `1`. Values outside `1-32` fail closed, and the startup summary records the
  resolved source.
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
- Preserves upstream `spend_tier` routing for Claude workers, but reads the tier from `users/{USER}/config/profile.yml`; direct Codex batch runs deliberately keep the Codex global model unless `--model` is explicit.
- Treats `--model` as an explicit override for either worker CLI and adds the
  Codex-only `--reasoning-effort minimal|low|medium|high|xhigh` override, which
  is forwarded to every Codex batch worker as `model_reasoning_effort`.
- Keeps direct batch invocation semantics distinct from go-runner resolution:
  without explicit `--model` or `--reasoning-effort`, direct Codex batches use
  Codex global defaults. `go-runner.mjs` resolves its argument/profile/global
  hierarchy first and passes any resolved non-global values into the batch
  invocation explicitly.
- Preserves upstream pre-screen discards and their audit records under `users/{USER}/batch/logs/discard.log`; sourced helper tests fall back to the fixture-local batch directory without weakening runtime user routing.
- Injects `users/{USER}/modes/_custom.md` after the profile context and keeps the batch CV fact gate/output command on the same `{{USER_ROOT}}/output/{REPORT_NUM}-...` artifact path.

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
- Preserve optional parallel resolution as argument, profile `batch.parallel`,
  then `1`, including the `1-32` validation and logged source. Do not restore a
  shell-level default that masks the profile value.
- Preserve Codex `--reasoning-effort` validation and forwarding alongside the
  existing model override; go-runner relies on both flags to carry its resolved
  profile values into every batch worker.
- If post-batch pipeline reconciliation is refactored, make sure the reconciler receives the user-scoped state, pipeline, and reports paths together; otherwise it can look for report files in the wrong reports directory.

## Batch Artifact Integrity And Verification Propagation

The fork treats the worker's report, tracker addition, and structured final JSON as one consistency boundary. A worker cannot be marked complete merely because each artifact exists independently, and confidential-employer rows cannot enter a Via-aware tracker without a supported agency or source channel.

Files:

- `batch/batch-prompt.md`
- `batch/batch-output-schema.json`
- `batch/validate-worker-artifacts.mjs`
- `batch/batch-runner.sh`
- `merge-tracker.mjs`
- `verify-pipeline.mjs`
- `go-runner.mjs`
- `test-all.mjs`
- `tests/workflows/batch-artifacts.test.mjs`
- `tests/workflows/go-runner.test.mjs`

What this customizes:

- Defines tracker additions as nine required TSV columns plus tagged optional fields. Direct named-employer rows normally have nine columns; agency-mediated and confidential-employer rows append `via={Agency-or-Portal}` rather than being forced into an exactly-nine-column contract.
- Extends the schema-checked worker result with `via`, `company_confidential`, and `tracker`, keeping those control fields explicit instead of inferring them from worker prose or artifact filenames.
- Requires `company_confidential: true` and `company: "?"` to carry a supported Via value. Workers prefer a named agency or recruiter, then a known application/discovery portal; they fail closed when the source material supports neither.
- Adds a deterministic artifact finalizer that parses the report's YAML Machine Summary and the tracker TSV, then validates company, role, score, Via, confidential-company state, and structured final-JSON artifact references as one unit.
- Allows one deliberately narrow repair: when the report has a valid Via and the tracker TSV omitted it, `--repair` appends the report value as a tagged `via=` field. Conflicting Via values, missing report evidence, confidential employers without a channel, malformed optional fields, and other cross-artifact disagreements remain hard failures.
- Runs artifact validation before either normal worker completion or timeout artifact recovery can mark a batch item completed. Validation failures are persisted as `artifact-validation:` batch errors for diagnosis and retry.
- Adds a second integrity gate in `merge-tracker.mjs`: when the destination tracker exposes a Via column, a `company=?` addition without `via=` stays pending and the merge exits nonzero. Legacy trackers without a Via column retain their migration-compatible behavior.
- Makes standalone batch verification authoritative: blocking `verify-pipeline.mjs` errors make `batch/batch-runner.sh` exit nonzero. The internal `--defer-verification` option is used only when `go-runner.mjs` owns the final structured verification phase, avoiding two competing final gates.
- Makes `verify-pipeline.mjs --json` assign `process.exitCode` instead of terminating with `process.exit()`, allowing warning-heavy JSON larger than the pipe buffer to flush completely before Node exits.
- Makes `go-runner.mjs` wait for child-process `close` and log-stream completion, capture verifier exit code `1` as structured JSON, retain that payload in the run summary, and report the actual blocking findings instead of an arbitrary truncated warning tail.
- Adds regression coverage for deterministic Via completion, cross-artifact Via mismatch rejection, untraceable confidential-employer rejection, merge-time blocking with pending-file preservation, verifier JSON above 64 KiB, and the coordinator's log-drain/structured-failure wiring.

Future merge notes:

- Keep the prompt, final JSON schema, artifact validator, runner gate, and tracker merge guard synchronized. Adding or renaming a cross-artifact field in only one layer weakens the completion contract or causes every worker to fail.
- Do not simplify the TSV rule to exactly nine fields. The first nine columns are required; tagged `via=` metadata is part of the integrity model for agency and confidential listings.
- Keep deterministic repair evidence-preserving and one-directional: a missing tracker Via may be copied from the report, but the validator must not invent a Via, overwrite a conflicting value, or mutate the report to match the tracker.
- Preserve pending TSVs on merge integrity failures so operators can inspect or retry them. Do not silently discard, merge, or renumber a blocked confidential-employer row.
- Preserve the standalone-versus-parent verification split: direct batch runs must fail on blocking verification errors, while the deterministic `go` coordinator may defer the batch-local check only because it immediately performs and records its own structured verification.
- Preserve Node's graceful stdout flush and the coordinator's `close`/stream-drain ordering. Reintroducing immediate `process.exit()` or resolving child phases on `exit` can truncate valid JSON and obscure the real failure.
- If upstream adds an equivalent artifact transaction, retire this layer only after testing missing Via repair, conflicting Via rejection, confidential-source enforcement, pending-file preservation, large verifier output, and structured coordinator failure propagation end to end.

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
- Preserves upstream `data/blacklist.md` as a user-owned exact company block layer and `company_aliases` as a dedupe identity layer; neither replaces the fork's substring-based `company_filter.block` policy.
- Applies upstream posting-age, `postedAt`, fingerprint, and scan-run metrics inside the active user's pipeline/history/run files so scanner evidence never falls back to root `data/`.

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
- Preserves upstream TUI language switching and localized status/column labels while keeping the fork's compact inline tab layout and responsive single-line help row.
- Adds `Hired` between `Offer` and `Rejected` without collapsing the fork's distinct `Closed` tab; `Hired` counts as having reached offer in analytics, while `Closed` remains pre-application and excluded from funnel progression.
- Combines upstream's discard-reason picker with the fork's contact semantics: a discard/skip transition and its reason are written together, while the Notes cell also retains the dated `Status changed to ...` interaction used by the `CONTACT` column.

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
- Preserve atomic discard updates together with `CONTACT` semantics: selecting a discard/skip reason must write status, dated interaction, and the `DISCARD:`/`SKIP:` tag in one tracker update without replacing existing notes.
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

## Go Sourcing Shorthand Mode

The fork adds `/career-ops go` as an explicit command-mode shorthand for the normal sourcing loop without making `/career-ops scan` itself auto-chain into heavier follow-up work.

Files:

- `modes/go.md`
- `.agents/skills/career-ops/SKILL.md`
- `AGENTS.md`
- `DATA_CONTRACT.md`
- `README.md`
- `docs/SETUP.md`
- `test-all.mjs`

What this customizes:

- Routes `go` through the shared career-ops mode router and command menus as a first-class mode.
- Requires the same active-user and cold-start/onboarding checks as the other career-ops commands before any user-layer reads or writes.
- Runs the sequence: `node scan.mjs --user {USER}`, then `scan-handoff` only when `users/{USER}/data/scan-handoff.json` has a positive count or non-empty `items`, then `node scan-auth.mjs --user {USER} linkedin`, then `pipeline` only when the final pending pipeline count is greater than the starting pending count.
- Uses pending-item counts in `users/{USER}/data/pipeline.md` as the conditional gate for whether pipeline processing is needed after the scan phases.
- Preserves the explicit separation between `scan` and `scan-handoff`: `scan` stays a deterministic zero-token producer, while `go` is the opt-in coordinator that chains the saved handoff when present.
- Treats provider-specific, company-specific, per-listing extraction, title-filter, dedupe, or skipped-result failures during scan phases as non-fatal when the overall phase completed and usable output can still be inspected.
- Stops immediately for catastrophic issues such as missing active user, onboarding gaps, unreadable required config, failure to read/write user state, script crashes that prevent output determination, or login/CAPTCHA/account-verification prompts requiring explicit user action.
- Inherits the quiet long-running command policy: do not narrate routine scan/auth/pipeline polling, but report completion, blockers, required user action, suspected hangs, or warnings that change what the user should do.

Future merge notes:

- Preserve `go` as an explicit shorthand mode rather than changing `/career-ops scan` to auto-continue into handoff/auth/pipeline work.
- If upstream adds an equivalent sourcing coordinator, prefer the upstream implementation only if it keeps active-user routing, conditional handoff from the saved JSON artifact, authenticated LinkedIn scan, conditional pipeline gating by pending-count delta, and non-fatal provider/company failure semantics.
- Keep `modes/go.md` loading or referencing `modes/scan.md`, `modes/scan-handoff.md`, `modes/scan-auth.md`, and `modes/pipeline.md` so the shorthand inherits fixes to each child mode instead of duplicating their full logic.
- Keep tests that assert `/career-ops go` remains exposed in routing/discovery and that `modes/go.md` documents the full sequence and conditional gates.

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

## Long-Running Supervision And Execution Ownership

The fork keeps multi-minute career-ops workflows quiet while making the current root turn responsible for supervising each run through its terminal outcome. It also separates root-owned serial workflows from the direct-pipeline fan-out used for larger inboxes.

Files:

- `AGENTS.md`
- `.agents/skills/career-ops/SKILL.md`
- `modes/_shared.md`
- `modes/auto-pipeline.md`
- `modes/oferta.md`
- `modes/scan.md`
- `modes/go.md`
- `modes/scan-auth.md`
- `modes/pipeline.md`
- `modes/batch.md`
- `test-all.mjs`

What this customizes:

- Keeps the active agent turn open until `go`, `scan`, `scan-handoff`, `scan-auth`, `pipeline`, or `batch` reaches completion, requires user action, receives an explicit stop, encounters confirmed destructive risk, or exhausts safe recovery.
- Treats background and detached processes as work owned by the current turn. Agents poll process output and persisted state at least every 60 seconds, keep routine polls silent, and limit normal user-visible liveness updates to at most once every 10 minutes.
- Uses stdout/stderr, logs, artifacts, PID/session state, lock ownership, worker liveness, and persisted counters as progress evidence. Proven ownerless locks and stale `processing` entries are recovered before resuming with the same active user and parallelism.
- Finishes long-running work by confirming worker exit, reconciling pipeline state, merging tracker additions, running `node verify-runner.mjs --user {USER}`, and reporting completed, skipped, failed, seen, repaired, unresolved, and remaining counts.
- Keeps `go`, `scan`, `scan-handoff`, `scan-auth`, Playwright-assisted `apply`, and direct pipelines with one or two pending URLs serial in the root agent. `modes/scan.md` now expresses this as affirmative root-agent execution instead of recommending a background scan subagent.
- Uses one subagent per surviving URL when a direct pipeline has three or more pending URLs. The root agent coordinates the fan-out, reconciliation, tracker merge, and final verification.
- Requires every delegated pipeline prompt to carry `ACTIVE_USER`, `USER_ROOT=users/{ACTIVE_USER}`, one URL, an atomically reserved report number, and the loaded shared/profile/custom/pipeline instructions. The prompt states that all user-layer relative paths resolve inside `USER_ROOT`.
- Keeps each role's extraction, evaluation, and bounded company/compensation research within the agent assigned to that role, preserving one-role-per-worker scope.
- Starts one `batch/batch-runner.sh` invocation at a time directly from the root agent. Configured `--parallel N` workers remain bounded internal concurrency managed by that single root-owned runner.
- Resolves optional batch concurrency consistently for both go and direct batch
  execution: explicit `--parallel`, then active-user `batch.parallel`, then `1`.
  The go coordinator records the effective value and source in its final JSON.
- Adds `test-all.mjs` assertions for the cross-file supervision contract in `AGENTS.md`, the career-ops skill, pipeline mode, and batch mode.

Future merge notes:

- Preserve quiet polling together with terminal supervision; an equivalent upstream policy must cover process and persisted-state checks, safe recovery, reconciliation, verification, and terminal count reporting.
- Preserve the execution split: root-owned serial scan/auth/apply/small-pipeline work, one-worker-per-URL fan-out for direct pipelines with three or more surviving URLs, and one root-owned batch-runner invocation with script-managed internal parallelism.
- `go-runner.mjs` and `batch/batch-runner.sh` resolve optional parallelism deterministically as explicit `--parallel`, then the active user's `config/profile.yml` `batch.parallel`, then system default `1`. The go summary records both the resolved value and its source.
- Keep delegated worker prompts explicit about `ACTIVE_USER`, `USER_ROOT`, user-layer path resolution, one assigned URL, and atomically reserved report numbers.
- Keep the supervision assertions synchronized with wording changes across instructions and mode files.

## Deterministic `go` Runner

Files:

- `go-runner.mjs`
- `scan.mjs`
- `scan-auth/linkedin.mjs`
- `resolve-parallel.mjs`
- `resolve-verify-warnings.mjs`
- `verify-runner.mjs`
- `apply-verification-review.mjs`
- `check-liveness.mjs`
- `pipeline-liveness.mjs`
- `sync-pipeline-batch.mjs`
- `verify-pipeline.mjs`
- `batch/batch-runner.sh`
- `lib/codex-config.mjs`
- `lib/verification-review.mjs`
- `lib/parallel-config.mjs`
- `lib/pipeline-queue.mjs`
- `schemas/go-handoff-output.schema.json`
- `schemas/verify-review-output.schema.json`
- `modes/verify.md`
- `tests/workflows/verify-review.test.mjs`
- `tests/workflows/go-runner.test.mjs`
- `package.json`
- `update-system.mjs`
- `config/profile.example.yml`
- `DATA_CONTRACT.md`
- `docs/SCRIPTS.md`
- `batch/README.md`
- `AGENTS.md`
- `.agents/skills/career-ops/SKILL.md`
- `modes/go.md`
- `modes/batch.md`

What this customizes:

- Adds an executable, user-scoped coordinator for the complete conditional `go`
  sequence: doctor, scan, schema-constrained handoff when the latest scan has
  items, LinkedIn unless explicitly skipped, and pipeline/batch processing only
  when the sourcing phases increased the pending count.
- Keeps scan, LinkedIn scan, liveness, queue synchronization, batch execution,
  tracker merge, reconciliation, and verification deterministic and directly
  script-driven.
- Uses schema-constrained Codex invocations for the browser/WebSearch handoff
  phase and a standalone read-only verification reviewer. Handoff additions are
  cross-checked against persisted pending counts. Verification review is
  deterministically chunked at 5 findings per one-off call. Independent
  dependency lanes run concurrently using the shared parallel setting, while
  overlapping tracker/report/orphan identities remain sequential and carry
  prior lane decisions forward as binding context. The parent validates the
  aggregate contract and overlapping duplicate keepers before any repair is considered.
  After duplicate repair it runs an intermediate raw check and applies only
  decisions whose exact finding fingerprint still exists, preventing a stale
  patch from overwriting state changed by the duplicate resolver.
- Preserves `verify-pipeline.mjs` as the broad raw detector: every error and
  warning is still emitted. `verify-runner.mjs` filters only findings whose
  level, stable ID, and complete canonical payload SHA-256 match a prior
  `mark_seen` record, then reviews every remaining finding, applies supported
  deterministic decisions, and runs the raw verifier again for up to three
  passes.
- Stores verified false positives, legitimate exceptions, and informational
  findings in the append-only user ledger
  `data/verification-reviews.jsonl`. An exact unchanged finding no longer
  resurfaces in reviewed verification, while any changed message/details payload
  gets a new fingerprint and is reviewed again. Raw verification never hides
  these findings.
- Resolves confirmed duplicate tracker/report groups through the existing
  duplicate resolver, which validates exact candidate partitions, merges
  tracker history, archives losing reports/output artifacts, backs up state,
  and records `data/duplicate-resolutions.jsonl`.
- Preserves duplicate lifecycle order as `Hired > Offer > Interview > Responded
  > Rejected > Applied > Evaluated > Skip/Closed`. The most advanced row becomes
  the keeper together with its existing tracker ID, report, HTML, PDF, and
  links; reviewer-selected canonical identity breaks equal-status ties only.
  Losing notes are merged and losing artifacts are backed up and archived. The
  ledger records the reviewer keeper, effective lifecycle keeper, and override.
- Adds deterministic orphan handling: restore a valid lost tracker row only
  from its matching preserved `batch/tracker-additions/merged/*.tsv`, or back up
  and archive a confirmed redundant/obsolete orphan report and matching output
  artifacts. Bounded tracker patches cover only uniquely identified company,
  Via, canonical status, score, and report-link findings. These actions are
  recorded in `data/verification-actions.jsonl` with timestamped backups.
- Makes orphan action metadata deterministic after the reviewer chooses the
  outcome. For `archive_orphan`, `verify-runner.mjs` derives `report_file` from
  the raw verifier finding and fixes `tracker_tsv` to `null`; the model cannot
  omit the required object or redirect an archive to another path. Restore
  report paths are fixed to verifier evidence and tracker TSV paths are
  canonicalized from project-relative `users/{USER}/batch/...` output to the
  user-root-relative `batch/tracker-additions/merged/*.tsv` contract before
  semantic validation. Restore metadata remains constrained to a matching
  preserved tracker-addition TSV. The restore parser also accepts the two
  historical merged artifacts whose separators were stored as literal `\t`
  text; current batch artifact validation continues to reject that malformed
  representation, so this compatibility path does not weaken new writes.
- Makes duplicate action metadata type-specific before checkpointing. Tracker
  duplicate findings retain only `keeper_tracker_num` and
  `duplicate_tracker_nums`; report duplicate findings retain only
  `keeper_report_file` and `duplicate_report_files`. Redundant cross-type fields
  are mechanically cleared, report paths are canonicalized to the exact
  `reports/...` candidates emitted by the verifier, exact warning candidates
  are semantically revalidated, and paired tracker/report plans must still
  agree on canonical identity. This prevents a valid duplicate judgment from
  failing late because a reviewer copied the combined identity or user-root
  paths into both warning types.
- Aggregates all semantic contract errors in a five-finding reviewer response
  and retries only that failed chunk, passing the complete validation feedback
  and previous response back for correction. `--review-retries N` defaults to
  two and is bounded to zero through five. A malformed item no longer discards
  valid independent chunk work or hides later invalid items behind the first
  error.
- Writes an atomic checkpoint only after a complete chunk is normalized and
  semantically validated. Actions remain pass-atomic: no duplicate, orphan,
  tracker, or seen-ledger mutation starts until every lane and the aggregate
  duplicate-consistency check succeed. A fresh invocation ignores prior run
  artifacts; `--resume-run RUN_ID` explicitly reuses only checkpoints whose
  signature matches the active user, exact findings, and prior lane decisions.
  Matching checkpoints are normalized and semantically revalidated under the
  current contract when loaded, while their original decision chain remains
  available solely for matching later checkpoints from the same historical
  run. Each successful deterministic action phase also writes an atomic result
  checkpoint. If duplicate repair commits but the following apply phase fails,
  resume requires an exact match with the saved post-duplicate verification,
  normalizes/revalidates the saved applicable decisions, retains the completed
  duplicate result, and retries apply without prompting reviewers again.
  Raw/invalid reviewer outputs are never resumable decisions. Retry, checkpoint,
  and normalization counts are exposed under `review_resilience`.
- Keeps the prompt reviewer read-only. Only
  `resolve-verify-warnings.mjs` and `apply-verification-review.mjs` may mutate
  data, and both revalidate prompt output against deterministic verifier
  evidence. Unsupported, conflicting, ambiguous, or high-severity findings use
  `manual_review` and keep reviewed verification `partial`.
- Adds an idempotent `pipeline.md` to `batch-input.tsv` synchronizer with stable
  IDs so the resumable batch runner cannot silently miss newly scanned jobs.
- Adds JSON output to `check-liveness.mjs` plus a deterministic pipeline wrapper
  that moves only confirmed-expired rows and uses `set-status.mjs` for any
  matching tracker row.
- Exposes the complete review/action/reverify lifecycle independently as
  `/career-ops verify`, `npm run verify -- --user {USER}`, and
  `node verify-runner.mjs --user {USER}`. `npm run verify:raw` remains the
  unreviewed detector. The `go` coordinator delegates its final integrity phase
  to the same reviewed runner, so standalone and end-to-end behavior cannot
  drift.
- Serializes concurrent `go` and reviewed-verification runs with per-user PID
  locks, owns child process
  groups for stop handling, and writes phase logs under the user root. A run is complete only when the pending queue is empty and
  no finding requires human review; otherwise it reports partial, while setup or
  authenticated-login requirements report blocked.
- Establishes a consistent public CLI output contract. Manual invocations stream
  bounded operational progress to stdout and finish with only a compact summary
  plus the actual failure text. `--json` opts into the complete machine result,
  keeps stdout as a single parseable JSON object, and routes progress to stderr.
  Internal orchestrators pass `--json` explicitly when parsing child results.
  Doctor and the batch runner retain their existing compact human output and
  persisted state artifacts.
- Adds user-scoped run-artifact retention through
  `npm run cleanup:runs -- --user {USER}`. It deletes timestamped directories
  under both `data/verify-runs/` and `data/go-runs/` once they are strictly
  older than 10 days, and refuses cleanup while another go or verify runner is
  active for that user. The go runner applies the same cleanup at startup.
- Compacts only terminal `completed` go and reviewed-verification runs to a
  single `summary.json`. Failed, interrupted, partial, and blocked runs keep
  their full diagnostic and resume artifacts until the fixed 10-day cleanup
  removes the entire run directory.
- Prints the reviewed verifier's run ID and artifact directory immediately after
  acquiring its per-user lock, before the first phase starts. Interrupted runs
  therefore expose the exact value accepted by `--resume-run`; JSON mode sends
  these early lines to stderr so stdout remains parseable.
- Streams zero-token target/provider start and completion,
  handoff task activity, LinkedIn search prompts, queue deltas, batch job
  start/completion, and one short line per reviewed finding after its
  five-finding call completes: `reviewed X/Y, job(s) #{related IDs},
  {issue code} → {classification}`. Tracker IDs are preferred, with report IDs
  used for report-only and orphan findings. Full rationale, evidence, and action
  details stay in run artifacts and the opt-in JSON result. `--quiet` retains
  the phase-log-only behavior.
- Registers the runner, helpers, shared library, tests, and JSON schema in the
  updater-managed system layer so updates do not leave a partial coordinator.
- Resolves Codex model and reasoning independently as runner argument, active
  user `profile.yml`, then global Codex default, and forwards resolved
  non-global values to handoff, reviewed verification, and every batch Codex
  worker.
- Resolves parallelism independently as runner argument, active-user
  `batch.parallel`, then `1`, records `parallel` and `parallel_source`, and passes
  the resolved value explicitly to the batch and reviewed-verification runners.
  Verification uses it only for isolated read-only review lanes; deterministic
  repair and ledger mutation remain serialized in the parent.

Future merge notes:

- Preserve the strict handoff output schema and observed-state cross-check; do
  not make agent prose a control signal.
- Preserve the read-only prompt/deterministic mutation boundary. New action
  types must validate against raw verifier evidence, remain user-scoped,
  acquire the appropriate lock, back up affected artifacts, append an audit
  record, and be followed by raw re-verification.
- Preserve lifecycle-first duplicate identity: Rejected stays between Responded
  and Applied, the most advanced row and its original artifacts remain active,
  and reviewer-selected identity is only an equal-status tiebreaker. Keep
  losing-artifact backup/archive, rollback, and keeper-override ledger coverage.
- Preserve exact-payload seen fingerprints. Never weaken them to warning code,
  company/role, or finding ID alone; changed evidence must resurface. Keep the
  seen ledger user-owned and append-only, and keep raw verifier output
  unsuppressed.
- Preserve five-finding review chunks, dependency-safe lane partitioning,
  per-lane prior-decision context, isolated reviewer artifacts, aggregate
  duplicate-keeper consistency, aggregated per-chunk semantic validation,
  bounded retries, signature-checked validated checkpoints, serialized
  pass-atomic mutations, severity-based `manual_review`, and the
  completed-versus-partial final status contract; finding volume must not make
  a single unconstrained prompt or silently downgrade review requirements.
- Preserve deterministic action metadata. Reviewers may classify an orphan but
  must not control archive paths; derive them from the verifier finding. Keep
  normal runs fresh and checkpoint reuse explicitly opt-in through
  `--resume-run`, with user/finding/prior-decision signature validation.
- Preserve stable batch IDs and append-only synchronization because
  `batch-state.tsv` references those IDs across retries and resumes.
- Preserve human-streaming output as the default and require `--json` for machine
  consumers. In JSON mode, keep stdout to one lossless JSON object and progress
  on stderr; keep `--quiet` available for unattended callers that want log-only
  phase details.
- Keep `verify-pipeline.mjs --json` finding IDs, codes, and evidence stable
  enough for schema-constrained review, exact fingerprints, and deterministic
  action validation. If a raw finding payload intentionally changes, expect its
  old seen record not to match and let it resurface for review.

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

## Repository Icon Synchronization

Files:

- `web/src/app/icon.svg`
- `web/public/bimi-logo.svg`
- `favicon.svg`

What this customizes:

- Keeps a root-level favicon copy of the web app icon so repository-aware tools can display career-ops with its branded icon.
- Registers `favicon.svg` in `update-system.mjs` as system-layer content so updater coverage validation includes the fork-owned repository icon.

Future merge notes:

- Treat `web/src/app/icon.svg` as the canonical visual source; whenever it changes, update `web/public/bimi-logo.svg` and `favicon.svg` so all three SVG surfaces stay identical.
- When adding another repository-level icon, review all existing icon surfaces and update this inventory with the new synchronization relationship.

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
- Deterministic HTML CV rendering that preserves active-user containment, selected system templates, supported local/data-image photos, and report-linked artifact names.
- Config-driven CV theme tokens.
- Per-user dashboard binary build/run flow.
- Dashboard listing-date parsing/display.
- Batch runner support for both Claude and Codex workers.
- Schema-checked Codex batch worker final JSON via `--output-last-message`.
- Cross-artifact batch validation equivalent to the fork's report/TSV/final-JSON consistency gate, confidential-employer Via requirement, bounded deterministic repair, merge-time pending-file preservation, and structured verifier failure propagation.
- Optional profile-driven batch parallelism with argument ->
  `batch.parallel` -> `1` precedence and bounded validation.
- Codex model/reasoning argument -> profile -> global resolution across every
  Codex call owned by the deterministic go coordinator.
- Deterministic `go-runner.mjs` orchestration with strict handoff/final-triage
  schemas, stable queue synchronization, structured verification, duplicate-only
  repair, and human-review-preserving final status.
- Bounded batch runs through `--limit` are now upstream baseline; preserve only the fork-specific user-scoped/Codex integration around the flag.
- Batch status/watch progress monitoring through user-scoped batch state.
- User-scoped `spend_tier`, pre-screen discard logs, CV fact validation, salary/funnel/stats/upskill analytics, reply matching, invite matching, and canonical status updates.
- `local:jds/...` batch input handling.
- Conditional batch PDF generation for `Skip` decisions and profile hard stops. Score-threshold configuration is now upstream behavior through `auto_pdf_score_threshold`.
- Per-user adaptation for upstream tracker report-link normalization and `merge-tracker.mjs --migrate`.
- Per-user adaptation for upstream `merge-tracker.mjs` filesystem locking and atomic writes.
- Per-user adaptation for upstream `reserve-report-num.mjs`, `scan-ats-full.mjs`, `validate-portals.mjs`, and `generate-cover-letter.mjs`.
- Per-user adaptation for upstream `assessment-log.mjs`, `cv-templates.mjs`, `img-to-pdf.mjs`, and template-aware `build-cv-latex.mjs`.
- Per-user adaptation for upstream `verify-portals.mjs`, `reconcile-pipeline.mjs`, pipeline liveness sweeps, `doctor.mjs --strict`, and any new scan/batch helpers that read `portals.yml`, `data/`, or `batch/`.
- User-scoped scan handoff artifacts at `users/{USER}/data/scan-handoff.json` plus the explicit `/career-ops scan-handoff` follow-up mode.
- Explicit `/career-ops go` sourcing shorthand with conditional scan-handoff, authenticated LinkedIn scan, conditional pipeline execution, and non-fatal provider/company scan failure semantics.
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
- Dashboard configurability equivalent to the fork's combined `Hired` + `Closed` inline-tab layout, lazy report hydration, compact column defaults, and per-user root inference.
- Dashboard discard-reason handling equivalent to the fork's combined atomic reason write, dated status interaction, existing Notes preservation, distinct `Closed` state, and user-root report containment.
- Equivalent user-layer ignores for interview prep, scan summaries, `article-digest.md`, and editor folders.

If upstream covers one of these, prefer deleting the local customization over carrying duplicate behavior.
