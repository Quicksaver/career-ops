# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (preserved by updates).

## User Layer (preserved by updates)

These files contain your personal data, customizations, and work product. Updates preserve user-owned files. The updater may create or replace only these system-owned `.gitkeep` scaffolds inside user-layer directories: `data/.gitkeep`, `data/offers/.gitkeep`, `data/parser-output/.gitkeep`, `jds/.gitkeep`, `output/.gitkeep`, and `reports/.gitkeep`. It never checks out or modifies any other user file in those directories.

| File | Purpose |
|------|---------|
| `.career-ops-web/chats/*.json` | Local assistant conversation history (gitignored, not verified profile facts); only the chat API writes these files |
| `users/{USER}/.career-ops-web/cv-studio/*.json` | Your CV Studio edits to a tailored CV, one file per report number (gitignored); only the CV Studio API writes these files |
| `users/{USER}/cv.md` | Your CV in markdown |
| `users/{USER}/config/profile.yml` | Your identity, targets, comp range |
| `users/{USER}/config/cv-facts.json` | Your CV fact-check allowlist and forbidden phrases |

| `config/benchmarks.yml` | Your market calibration benchmark overrides (optional; copy `templates/benchmarks.yml` here and edit — read by `funnel-velocity.mjs`) |
| `config/local-paths.txt` | Files *this clone* owns that upstream does not ship — one repo-relative path per line (optional; copy `config/local-paths.example.txt` here and edit). See [Fork-local paths](#fork-local-paths) below |
| `users/{USER}/modes/_profile.md` | Your archetypes, narrative, negotiation scripts |
| `users/{USER}/modes/_custom.md` | Your house rules, custom workflows & output preferences (procedural — survives updates) |
| `{DATA_ROOT}/modes/_brief.md` | Your compact profile brief (~1.5–2K tokens) read by the two-pass triage first pass |
| `users/{USER}/voice-dna.md` | Your writing voice guardrail — banned words, anti-AI-slop rules, tone (optional) |
| `users/{USER}/article-digest.md` | Your proof points from portfolio |
| `users/{USER}/interview-prep/story-bank.md` | Your accumulated STAR+R stories |
| `users/{USER}/interview-prep/{company}-{role}.md` | Company-specific interview prep reports (written by `/career-ops interview-prep`) |
| `users/{USER}/interview-prep/sessions/*.md` | Interview sessions — real transcripts + mock sessions (sensitive: real names/companies; gitignored except scaffold). Drives `patterns` Step 1b targeting signal and `interview-redflag` analysis. Scaffold files (`README.md`, `.gitkeep`) are system-owned. |
| `users/{USER}/documents/*` | Your profile intake sources — master CV, LinkedIn export, diplomas, reference letters (PII — gitignored except scaffold; read locally by `intake.mjs`, see `modes/intake.md`). Scaffold files (`README.md`, `.gitkeep`) are system-owned. |
| `users/{USER}/data/.hired-share-state.json` | Hired Wall ask-state (asked/shared/later/never per hire) — the anti-nag memory; never committed, never read by anything but `hired-share.mjs` |
| `data/.gitkeep` | System-owned empty directory scaffold; the updater writes only this exact file and preserves all user files in `users/{USER}/data/` |
| `data/offers/.gitkeep` | System-owned empty directory scaffold; the updater writes only this exact file and preserves all user files in `users/{USER}/data/offers/` |
| `data/parser-output/.gitkeep` | System-owned empty directory scaffold; the updater writes only this exact file and preserves all user files in `users/{USER}/data/parser-output/` |
| `users/{USER}/data/intake-state.json` | Fingerprints of already-ingested intake sources (written by `node intake.mjs --commit`; makes re-runs propose only new material — safe to delete, next intake re-proposes everything) |
| `users/{USER}/portals.yml` | Your customized company list |
| `users/{USER}/config/plugins.yml` | Your plugin activation toggles (opt-in; seeded from `config/plugins.example.yml`) |
| `opencode.json` | Your OpenCode project config (MCP servers, model, formatter, LSP) — gitignored, copy `opencode.example.json` to start |
| `plugins.local/` | Your own / private plugins (never auto-updated) |
| `plugins.lock` | Integrity pins + recorded consent for your enabled plugins (generated; never auto-updated) |
| `users/{USER}/data/applications.md` | Your application tracker (source of truth) |
| `users/{USER}/data/career-profile.yml` | Your source-backed Master Career Profile; written only after explicit review of imported CV facts |
| `users/{USER}/data/applications.db` | Derived query index over `applications.md` and `status-log.tsv` (SQLite, rebuilt by `node tracker.mjs sync`). Its `status_events` table, read by `tracker.mjs history`, is derived from the ledger: every sync rebuilds a row's events from `status-log.tsv` folded through `foldObservations()` in `funnel-velocity.mjs`, so `correction` and retraction lines apply. The one thing it adds is a status the ledger does not explain (a hand edit in `applications.md`, which writes no ledger row), recorded as observed at the sync that saw it and shown by `history` as `(no ledger row; observed at sync)`. Safe to delete: the next sync rebuilds every ledger-derived event exactly, and only those hand-edit observations are lost |
| `users/{USER}/data/pipeline.md` | Your URL inbox |
| `users/{USER}/data/workflow-runs/`, `users/{USER}/data/verify-runs/`, legacy `users/{USER}/data/go-runs/` | Workflow diagnostics and resumable checkpoints; completed runs are compacted, timestamped runs expire after 10 days |
| `users/{USER}/data/manual-actions.json` | Persisted exact-posting questions and user actions collected by the workflow coordinator |
| `users/{USER}/data/manual-answers.json` | User answers saved by the interactive workflow, scoped to the exact posting URL and hold reason; includes pasted JD text when supplied |
| `users/{USER}/data/scan-handoff.json` | Latest unsupported-source handoff for the selected user's scanner |
| `users/{USER}/data/posting-context/*.json` | URL-keyed snapshots of provider descriptions and source metadata, saved before publishing inbox rows. External posting evidence only; never candidate facts or user answers. Safe to delete, but original source context may then require recovery. |
| `users/{USER}/data/verification-reviews.jsonl` | Exact finding fingerprints, review decisions and accepted exceptions |
| `users/{USER}/data/jd-archive-maintenance.json` | Automatic archive recovery receipts and known historical gaps, bound to the exact report hash and original posting URL; records unavailable evidence without claiming a JD exists |
| `users/{USER}/data/verification-actions.jsonl` | Verification repair records and artifact provenance |
| `users/{USER}/data/duplicate-resolutions.jsonl` | Duplicate keeper decisions, lifecycle overrides and archive locations |
| `users/{USER}/data/run-workflow.pid*`, legacy `users/{USER}/data/go-runner.pid*`, `users/{USER}/data/verify-runner.pid*` | Per-user coordinator ownership metadata and compatibility PID stamps |
| `users/{USER}/batch/*` | Batch inputs/state, `logs/*.hold.json` exact-posting holds, quarantined evidence, tracker additions and `tracker-additions/merged/` provenance; `batch-runner.pid*` and `.workers-*/` record active ownership |
| `~/.scan-auth/users/{USER}/` | Per-user authenticated portal browser profiles, outside the checkout |
| `users/{USER}/data/scan-history.tsv` | Your scan history: one tab-separated row per posting the scanners have seen. Columns are append-only — a new column goes at the end and existing ones never move — so older rows may have fewer columns, and a missing cell reads as empty. The column order is declared in `lib/scan-history-columns.mjs`; what each column holds is in the Scan History table of `modes/scan.md`. A cell that would run as a spreadsheet formula is stored with one extra leading `'`; `parseScanHistoryLine` removes it. |
| `users/{USER}/data/scan-runs.tsv` | Your per-run scan counters (appended by `scan.mjs`, read by `stats.mjs`) |
| `users/{USER}/data/scheduled-jobs.json` | Your local scheduled-scan definitions, queue, and bounded run history (written by the web UI and `web/scripts/scheduled-jobs-runner.mjs`) |
| `users/{USER}/data/portal-health.tsv` | Consecutive reachability status for scanned portals (appended by `scan.mjs`; statuses: `reachable`, `empty`, `slug_gone`, `network`, `auth`, `server`, `unknown`, `unverified_zero` — the last four joined the vocabulary later, so older files carry only the first four; `unverified_zero` means a provider returned no jobs without any observed successful HTTP response and counts toward the failure streak) |
| `users/{USER}/data/dead-boards.tsv` | Boards that returned three consecutive 404s during mass reverse ATS sweeps (written by `scan-ats-full.mjs`; unlike `users/{USER}/data/portal-health.tsv`, this does not track the user's configured portals; re-probed after 30 days — safe to delete, the next sweep rebuilds it) |
| `users/{USER}/data/follow-ups.md` | Your follow-up history |
| `users/{USER}/data/active-interviews.md` | Your active interview processes, incl. inline `[process-friction]` notes (read by `process-quality.mjs`) |
| `users/{USER}/data/agent-inbox.md` | Your append-only request queue drained at session start (written by `agent-inbox.mjs`) |
| `users/{USER}/data/reply-candidates.json` | Your normalized employer-reply candidates (subject, body, sender, signal, plus optional `received_at`/`date` — read by `reply-watch.mjs`; a reliable received date is required for date-guarded company-wide rejection suggestions) |
| `users/{USER}/data/reply-proposals/*.json` | Local integration status proposals with quoted evidence; read-only until explicit review in `reply-watch.mjs`. Acceptance writes status plus a `[reply-proposal:<digest>]` Notes receipt atomically through `set-status.mjs`; keep receipts to prevent replay. See `docs/REPLY_PROPOSALS.md` for the v1 draft contract; the format may change until a real producer writes to the directory. |
| `users/{USER}/data/learning/*` | Your retro state: the candidates and reply files, pending checks, and the ledger of accepted and rejected rules (written by `learn.mjs`, never loaded into a prompt) |
| `users/{USER}/data/pdf-index.tsv` | PDF↔report linkage manifest (written by `generate-pdf.mjs`, read by `find.mjs`, the dashboard, and the `email` mode) |
| `users/{USER}/data/offers/*` | Your received offers/contracts, promise notes, prep reports, and reply drafts (PII — gitignored, written by the `offer-prep` mode) |
| `users/{USER}/data/outcomes/*` | Your application outcome logs and archived application artifacts (written by the `outcome` mode) |
| `users/{USER}/data/salary-observations.tsv` | Your append-only compensation observation log: `{tracker#}\t{date}\t{desired\|advertised\|actual}\t{amount}\t{currency}\t{source}\t{note}`. Written by interactive modes when a figure is stated/confirmed; never edited in place. Column 1 is a **tracker#** — the `#` of the row in the active tracker file (`users/{USER}/data/applications.md` in the default layout), not a report number. The two counters diverge permanently once any row exists without a report, so a number copied off a `users/{USER}/reports/{###}-*.md` filename can name a different application; padding is not identity, so `29` and `029` are the same row. Advertised figures come from reports' `advertised_comp` instead — reports are themselves observation sources, reached through the tracker row's Report link rather than by matching numbers. Read by `salary-gap.mjs` |
| `status-log.tsv` (sibling of the active tracker file — `users/{USER}/data/status-log.tsv` in the default layout) | Your append-only status transition ledger: `{tracker#}\t{date}\t{from}\t{to}\t{source}\t{note}`. Appended by `set-status.mjs` next to wherever the tracker lives, on every real status change (the tracker stays the source of truth for *state*; the ledger records *when* transitions happened); never edited in place — corrections are new `correction`-source lines. An unknown from- or to-state is the sentinel `-`, never an empty cell; the two columns then diverge, with a from of `-` parsing to null (no prior state) and a to of `-` preserved as the literal unknown-target sentinel, while an empty cell is rejected as `unknown from-state ""` or `unknown to-state ""` for its own column. The source column is a closed set whose members are `VALID_SOURCES` in `funnel-velocity.mjs` — that declaration is the authority, so this contract points at it rather than restating a list that goes stale the next time a writer is added. Any value outside the set parses but is counted as an unknown source and excluded from the funnel, so per-writer detail belongs in the note column rather than namespaced onto the source. Read by `funnel-velocity.mjs` and `company-history.mjs`, and by `tracker.mjs sync`, which derives `applications.db`'s `status_events` from it (see the `data/applications.db` row: the ledger is authoritative, the table adds only status changes no ledger row explains) |
| `users/{USER}/data/upskill/*` | Your skill-gap analysis reports (written by the `upskill` mode) |
| `users/{USER}/data/blacklist.md` | Your do-not-apply list (opt-in — absence = no filtering; never auto-populated: only you, or the agent on your explicit instruction, write to it. Its `Scope` is `company` (default: normalized feed company name) or `domain` (the Company cell is a hostname suffix matched to the posting URL); no parent/subsidiary relationship is inferred. Respected by `scan.mjs`, by `discover-new-companies.mjs` and `discover-ats.mjs` (a blacklisted company is never proposed, probed, or written to `users/{USER}/portals.yml`), and by the `auto-pipeline`/`oferta`/`apply` gates; never a scoring input. The discover scripts read it from `{DATA_ROOT}/data/blacklist.md`, overridable with `CAREER_OPS_BLACKLIST`) |
| `users/{USER}/data/assessments.tsv` | Your append-only skills-assessment log: `{date}\t{company}\t{report#\|-}\t{platform}\t{subject}\t{threshold%\|-}\t{score%\|-}\t{stale_note}`. Appended by `node assessment-log.mjs add`; never edited in place. Empty stale_note = no staleness observed. Read by `assessment-log.mjs` |
| `users/{USER}/data/contacts.tsv` | Your job-search phonebook (third-party PII — gitignored): `{name}\t{company}\t{type}\t{title}\t{phone}\t{email}\t{linkedin}\t{tracker#\|-}\t{notes}`. `type` optional; when present must be one of the enum (recruiter\|hiring-manager\|peer\|interviewer\|internal-referral\|other), else flagged in `quality`. Written by the `contacto` mode only after you confirm; lines are updated in place when a contact's details change (unlike the append-only salary log). Read by `contacts.mjs` |
| `users/{USER}/data/Connections.csv` | Your LinkedIn connections export (third-party PII — gitignored, never committed, never touched by the updater). Placed here by you: LinkedIn → Settings → Data Privacy → Get a copy of your data → Connections. Read fresh on every run by `linkedin-join.mjs`, which writes no cache, index or sidecar state, so the file is disposable — delete it after use and re-export when you need it again. Never enters a prompt and never leaves the machine; only rows you paste by hand reach `users/{USER}/data/contacts.tsv` |
| `users/{USER}/writing-samples/*` | Your personal writing samples for style calibration (except the system checkout's `writing-samples/README.md`, which is system-owned documentation delivered by updates) |
| `users/{USER}/reports/*` | Your evaluation reports, including optional `job_facts_cache` metadata; `reports/.gitkeep` is the system-owned directory scaffold and may be replaced by the updater. `evaluation-cache.mjs` projects only the public allowlist documented in `batch/batch-prompt.md`; candidate-fit data never enters the reusable job-facts payload. Reports and application bundles remain private user-layer files. No sharing or separate cache store is introduced. |
| `users/{USER}/output/*` | Your generated PDFs; `output/.gitkeep` is the system-owned directory scaffold and may be replaced by the updater |
| `users/{USER}/jds/*` | Your saved job descriptions; `jds/.gitkeep` is the system-owned directory scaffold and may be replaced by the updater |
| `templates/cv-{candidate}-{company-slug}.html`, `templates/cover-{candidate}-{company-slug}.html` | Your per-application generated CVs/cover letters, for installs that save the HTML twin under `templates/` instead of `users/{USER}/output/` (#3636). `templates/` is otherwise system-owned (base CV/cover templates), so these are recognized by name rather than directory: anything under `templates/` starting with `cv-` or `cover-` that is NOT one of the shipped `cv-template*.html` / `cover-letter-template*.html` files is treated as your data — see `isGeneratedTemplateArtifact()` in `update-system.mjs` |
| `templates/cv-template.{name}.html` / `.tex`, `templates/cover-letter-template.{name}.html` / `.tex` | Your own named CV/cover-letter template variant, when `{name}` matches `cv.template` / `cover_letter.template` in `users/{USER}/config/profile.yml`, or in the profile an exported `CAREER_OPS_PROFILE` names (the updater never loads a `.env`; it reads both, and skips with a warning a data-root profile it cannot parse while the override is the one in force; the convention `cv-templates.mjs`'s `resolveTemplate()` reads — see its `KINDS`). `templates/` is otherwise system-owned, and a variant file this install created shares that directory and naming shape with the real shipped variants (`cv-template.zh-minimal.html`, ...), so it is recognized by cross-referencing the configured template name rather than by directory — see `isUserConfiguredTemplateVariant()` in `update-system.mjs`. An unconfigured or differently-named `cv-template.*.html` file is not covered by this carve-out and is still managed as a system file (updated or pruned normally). This is distinct from `templates/cv-{candidate}-{company-slug}.html` / `templates/cover-{candidate}-{company-slug}.html`, which is generated per-application *output*, not an authored template *variant*. |

### Fork-local paths

The two lists above describe *this project*. A fork usually carries files the project has never heard of — a nightly runner, an `.mcp.json`, a private fixtures directory. Those files are in the user layer by every definition that matters, but they cannot be added to `USER_PATHS`: that array lives in `update-system.mjs`, which `apply` overwrites and which git re-merges on every sync. The declaration would be erased by the process it exists to constrain.

`config/local-paths.txt` moves the declaration outside that blast radius. It is gitignored by default, read at runtime, and merged into the user layer for both the updater's safety check and `validate-system-paths-coverage.mjs`:

```text
# one repo-relative path per line; blank lines and # comments ignored
run-nightly.ps1
.mcp.json
qa-fixtures/          # trailing slash = everything under this directory
```

Absent file means no extra paths — identical to the behaviour of every install that never creates one.

Three declarations are refused, loudly, naming the entry:

| Refused | Why |
|---------|-----|
| An absolute path, or one containing `..` | Would extend "never touch" over files outside the checkout |
| A path the system layer already ships | The file would silently stop receiving updates, with no other signal that it had been frozen |
| `config/local-paths.txt` itself | It is gitignored by default, so nothing updates it; listing it protects against a threat that does not exist and reads as though it did. A fork whose CI runs the suite un-ignores and commits it (see `config/local-paths.example.txt`); it is then tracked and not ignored, which both guards accept |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Eval-core: scoring system, global rules, tools |
| `modes/_writing.md` | Writing guardrails (Voice DNA / Writing Style / ATS) — loaded by the CV/cover/apply writing modes, not by evaluation (#1710) |
| `modes/_custom.template.md` | Template seed for the user's `users/{USER}/modes/_custom.md` |
| `modes/_profile.template.md` | Template seed for the user's `users/{USER}/modes/_profile.md` |
| `modes/_brief.template.md` | Template seed for the user's `{DATA_ROOT}/modes/_brief.md` |
| `modes/oferta.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/cover.md` | Cover letter generation instructions |
| `modes/latex.md` | LaTeX/Overleaf CV export instructions |
| `modes/text.md` | Tailored markdown CV instructions |
| `modes/add.md` | CV addition (project/paper/role) instructions |
| `modes/scan.md` | Portal scanner instructions |
| `modes/scan-handoff.md` | Agent/WebSearch scan handoff instructions |
| `modes/scan-auth.md` | Authenticated portal scanner instructions |
| `modes/run.md` | Full sourcing and queue workflow instructions |
| `run-workflow.mjs` | Deterministic end-to-end sourcing coordinator |
| `cleanup-runs.mjs` | Deletes per-user workflow and verification run directories older than 10 days |
| `modes/verify.md` | Prompt-reviewed integrity workflow instructions |
| `verify-runner.mjs` | Standalone review/action/reverify coordinator used by `run` |
| `apply-verification-review.mjs` | Applies bounded tracker/orphan actions and exact-fingerprint seen records |
| `resolve-parallel.mjs` | Resolves batch parallelism from argument, user profile, or system default |
| `resolve-verify-warnings.mjs` | Validates and applies model-confirmed duplicate-only warning resolutions |
| `pipeline-liveness.mjs` | Pending-queue liveness preflight; human output by default, machine result with `--json` |
| `sync-pipeline-batch.mjs` | Stable pipeline-to-batch queue synchronizer |
| `modes/batch.md` | Batch processing instructions |
| `modes/apply.md` | Application assistant instructions |
| `modes/auto-pipeline.md` | Auto-pipeline instructions |
| `modes/contacto.md` | LinkedIn outreach instructions |
| `modes/email.md` | Formal application email draft instructions |
| `modes/deep.md` | Research prompt instructions |
| `modes/regional/*` | Regional market calibration modes |
| `modes/ofertas.md` | Comparison instructions |
| `modes/pipeline.md` | Pipeline processing instructions |
| `modes/project.md` | Project evaluation instructions |
| `modes/tracker.md` | Tracker instructions |
| `modes/training.md` | Training evaluation instructions |
| `modes/patterns.md` | Pattern analysis instructions |
| `modes/titles.md` | Adjacent job-title suggestion instructions |
| `modes/upskill.md` | Skill-gap analysis instructions |
| `modes/followup.md` | Follow-up cadence instructions |
| `modes/offer-prep.md` | Offer-stage contract reading companion instructions |
| `modes/interview.md` | Interactive profile/CV onboarding interview instructions |
| `modes/interview-prep.md` | Company-specific interview prep instructions |
| `modes/interview-redflag.md` | Company red-flag detection instructions |
| `modes/outcome.md` | Application outcome instructions |
| `modes/interview/*` | Interview prep planning, practice, and debrief skills |
| `modes/agent-inbox.md` | Agent inbox (queued requests) instructions |
| `modes/reply-watch.md` | Employer reply classification instructions |
| `modes/retro.md` | Session review instructions: propose rules for `learn.mjs` to check |
| `modes/update.md` | System update instructions |
| `modes/ar/*` | Arabic language modes |
| `modes/da/*` | Danish language modes |
| `modes/de/*` | German language modes |
| `modes/es/*` | Spanish language modes |
| `modes/fr/*` | French language modes |
| `modes/hi/*` | Hindi language modes |
| `modes/id/*` | Indonesian language modes |
| `modes/it/*` | Italian language modes |
| `modes/ja/*` | Japanese language modes |
| `modes/ko/*` | Korean language modes |
| `modes/nl/*` | Dutch language modes |
| `modes/pl/*` | Polish language modes |
| `modes/pt/*` | Portuguese language modes |
| `modes/ru/*` | Russian language modes |
| `modes/tr/*` | Turkish language modes |
| `modes/ua/*` | Ukrainian language modes |
| `modes/vi/*` | Vietnamese language modes |
| `modes/zh/*` | Chinese language modes |
| `modes/heuristics/*` | Shared candidate-facing application heuristics |
| `CLAUDE.md` | Agent instructions (Claude Code) |
| `OPENCODE.md` | Agent instructions (OpenCode) |
| `CODEX.md` | Agent instructions (Codex) |
| `KIMI.md` | Agent instructions (Kimi CLI) |
| `GEMINI.md` | Legacy no-op context guard (prevents Antigravity duplicate imports) |
| `AGENTS.md` | Canonical agent instructions (imported by CLI-specific wrappers) |
| `*.mjs` | Utility scripts |
| `lib/*` | Shared system helpers |
| `scan-auth/*.mjs` | Authenticated portal scanner classes |
| `providers/` | Job-source provider modules for the zero-token scanner |
| `plugins/` | Bundled plugins + the plugin engine (opt-in external integrations) |
| `plugins.mjs` | Plugin CLI (list/run/available/add/new/enable/skill/trust/remove) |
| `plugins-registry/` | Curated community plugins, one `<id>.json` per plugin (the trust root) |
| `plugin-install.mjs` / `plugin-audit.mjs` / `validate-plugin-registry.mjs` | Plugin install/audit/registry-validation utilities |
| `config/plugins.example.yml` | Plugin activation template (seed for `users/{USER}/config/plugins.yml`) |
| `opencode.example.json` | OpenCode project config template (seed for `opencode.json`; ships Playwright MCP registration) |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.sh` | Batch orchestrator |
| `batch/worker-process.mjs` | Native worker launch, ownership registration and process-tree cleanup |
| `batch/state-store.mjs` | Native process ownership and atomic batch state transactions |
| `lib/windows-job-worker.ps1` | System-owned Windows Job Object launcher and descendant drain helper |
| `resolve-codex-config.mjs` | Shared model/reasoning resolution for the selected user |
| `schemas/*` | Strict JSON contracts for deterministic agent steps |
| `dashboard/*` | Go TUI dashboard |
| `templates/*` | Base templates |
| `fonts/*` | Self-hosted fonts |
| `.claude/skills/*` | Skill definitions (Claude Code) |
| `.opencode/skills/*` | Skill definitions (OpenCode) |
| `.qwen/skills/*` | Skill definitions (Qwen Code) |
| `.antigravitycli/skills/*` | Skill definitions (Antigravity CLI) |
| `.grok/skills/*` | Skill definitions (Grok Build CLI) |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |
| `users/{USER}/writing-samples/README.md` | System-owned onboarding documentation for the writing-samples directory |
| `seed-fixture.mjs` / `test-fixtures/*` | Upgrade-test fixtures and seeder (system layer; fictional data, never user data) |
| `upgrade-tests.mjs` | Dynamic upgrade regression harness (PR gate: old install applies the commit under test hermetically) |

## The Rule

**If a file is user-owned, no update process may modify or delete it.** The only files the updater writes inside user-layer directories are the exact system-owned `.gitkeep` scaffolds listed above.

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**

## Custom Data Directory

Every workflow requires an explicit active user. By default, User Layer files reside in `users/{USER}/` inside the system checkout. You can select a separate directory for that user's personal data.

### Resolution Precedence:
1. **Environment variables:** `CAREER_OPS_ROOT`, then `CAREER_OPS_DATA_DIR`, select the active user's data root. Relative paths anchor to the system checkout.
2. **Marker file:** When neither data-root alias nor `CAREER_OPS_USERS_DIR` is configured, `.career-ops-data` in the checkout selects the active user's data root. Its path may be absolute or relative to the checkout.
3. **Selected user default:** Use `{CAREER_OPS_USERS_DIR}/{USER}` when configured, otherwise `{SYSTEM_ROOT}/users/{USER}`. Never fall back to the system checkout as user data.

The selected root already identifies the user: resolve `cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `data/`, `reports/`, `output/`, `portals.yml`, and `batch/` (including `batch/tracker-additions/`) directly beneath it. Do not append `users/{USER}/` again. System modes, scripts, templates, and bundled plugins remain in the system checkout. The web app uses `CAREER_OPS_CODE_ROOT` for that checkout and `CAREER_OPS_DATA_DIR` for an explicit data root; its legacy `CAREER_OPS_ROOT` alias denotes the system checkout.

### Tracker Path & Writes:
- **`CAREER_OPS_TRACKER`** can be set to override the applications tracker file path directly (relative paths are resolved relative to the repository root).
- **`CAREER_OPS_BLACKLIST`** overrides the `data/blacklist.md` path read by `discover-new-companies.mjs` and `discover-ats.mjs` (the same pattern as their `CAREER_OPS_PORTALS` / `CAREER_OPS_SCAN_HISTORY` overrides); unset, they read `{DATA_ROOT}/data/blacklist.md`.
- **Read Resolution:** If no tracker override is set, reading resolves to `{DATA_ROOT}/data/applications.md` if it exists; otherwise falls back to `{DATA_ROOT}/applications.md`.
- **Write Resolution:** All writes (including merge operations and first-run creation) target the canonical location `{DATA_ROOT}/data/applications.md`.
