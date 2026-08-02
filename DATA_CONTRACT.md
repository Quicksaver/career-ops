# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (never touched by updates).

## User Layer (NEVER auto-updated)

These files contain personal data, customizations, and work product. Updates will NEVER modify them.

All user data is centralized under a gitignored per-user folder:

```
users/{USER}/
```

Commands must resolve an active user before reading or writing any user-layer file. The root-level user files from older versions remain ignored for migration safety, but new work should use `users/{USER}/...`.

| File | Purpose |
|------|---------|
| `users/{USER}/cv.md` | CV in markdown |
| `users/{USER}/config/profile.yml` | Identity, targets, comp range |
| `users/{USER}/config/cv-facts.json` | CV fact-check allowlist and forbidden phrases |
| `users/{USER}/config/benchmarks.yml` | Optional market-calibration benchmark overrides copied from `templates/benchmarks.yml` |
| `users/{USER}/config/plugins.yml` | Plugin activation toggles (opt-in; seeded from `config/plugins.example.yml`) |
| `users/{USER}/modes/_profile.md` | Archetypes, narrative, negotiation scripts |
| `users/{USER}/modes/_custom.md` | House rules, custom workflows, and output preferences (procedural; survives updates) |
| `users/{USER}/modes/_brief.md` | Compact profile brief used by the two-pass triage first pass |
| `users/{USER}/voice-dna.md` | Writing voice guardrail — banned words, anti-AI-slop rules, tone (optional) |
| `users/{USER}/article-digest.md` | Proof points from portfolio |
| `users/{USER}/interview-prep/story-bank.md` | Accumulated STAR+R stories |
| `users/{USER}/interview-prep/{company}-{role}.md` | Company-specific interview prep reports (written by `/career-ops interview-prep`) |
| `users/{USER}/interview-prep/sessions/*.md` | Interview sessions — real transcripts and mock sessions (sensitive; gitignored except scaffold). Drives `patterns` Step 1b targeting signal and interview-redflag analysis. |
| `users/{USER}/interview-prep/*` | Company-specific interview prep |
| `users/{USER}/portals.yml` | Customized company list |
| `users/{USER}/data/applications.md` | Application tracker source of truth |
| `users/{USER}/data/applications.db` | Derived query index over `applications.md` (SQLite, rebuilt by `node tracker.mjs sync --user {USER}` — safe to delete) |
| `users/{USER}/data/pipeline.md` | URL inbox |
| `users/{USER}/data/scan-history.tsv` | Scan history (tab-separated, append-only trailing columns; column 8 is the local SimHash JD fingerprint, column 9 is the posting date, columns 10-11 are trust score/flags, and column 12 is the normalized company key). Older rows may omit trailing columns. |
| `users/{USER}/data/scan-runs.tsv` | Per-run scan counters appended by `scan.mjs` and read by `stats.mjs` |
| `users/{USER}/data/portal-health.tsv` | Consecutive reachability status for scanned portals, appended by `scan.mjs` and read by `stats.mjs`; statuses include `reachable`, `empty`, `slug_gone`, `network`, `auth`, `server`, and `unknown` |
| `users/{USER}/data/scan-handoff.json` | Full Agent/WebSearch handoff list from the latest zero-token scan |
| `users/{USER}/data/follow-ups.md` | Follow-up history |
| `users/{USER}/data/agent-inbox.md` | Append-only request queue drained at session start |
| `users/{USER}/data/pdf-index.tsv` | Generated PDF manifest used by dashboard PDF hotkeys |
| `users/{USER}/data/parser-output/*` | Local parser debug/audit output |
| `users/{USER}/data/offers/*` | Received offers/contracts, promise notes, prep reports, and reply drafts (PII; written by `offer-prep`) |
| `users/{USER}/data/salary-observations.tsv` | Append-only compensation observation log: `{tracker#}\t{date}\t{desired\|advertised\|actual\|stated}\t{amount}\t{currency}\t{source}\t{note}\t{round}\t{interviewer}`. The optional trailing round/interviewer fields apply to stated figures; read by `salary-gap.mjs` |
| `users/{USER}/data/status-log.tsv` | Append-only status transition ledger written by `set-status.mjs` beside the active user's tracker and read by `funnel-velocity.mjs` |
| `users/{USER}/data/outcomes/*` | Application outcome logs and archived application artifacts written by the `outcome` mode |
| `users/{USER}/data/upskill/*` | Skill-gap analysis reports written by the `upskill` mode |
| `users/{USER}/data/blacklist.md` | Opt-in do-not-apply company list; only the user or an agent acting on explicit instruction may write it |
| `users/{USER}/data/assessments.tsv` | Append-only skills-assessment log: `{date}\t{company}\t{report#\|-}\t{platform}\t{subject}\t{threshold%\|-}\t{score%\|-}\t{stale_note}`. Appended by `node assessment-log.mjs --user {USER} add`; never edited in place |
| `users/{USER}/data/active-interviews.md` | Active interview process notes |
| `users/{USER}/data/reply-candidates.json` | Candidate matches produced from application replies |
| `users/{USER}/data/contacts.tsv` | Job-search phonebook containing confirmed recruiter, hiring-manager, peer, and interviewer contact data (third-party PII; written by `contacto`) |
| `users/{USER}/data/verification-reviews.jsonl` | Append-only exact-fingerprint seen decisions for reviewed verification findings |
| `users/{USER}/data/verification-actions.jsonl` | Append-only audit ledger for reviewed verification repairs and archive/restore actions |
| `users/{USER}/data/verify-runs/*` | Reviewed-verification run artifacts; completed runs compact to `summary.json`, all runs expire after 10 days |
| `users/{USER}/data/go-runs/*` | Go coordinator run artifacts; completed runs compact to `summary.json`, all runs expire after 10 days |
| `users/{USER}/batch/*` | Batch input, state, logs, and tracker additions |
| `users/{USER}/plugins.local/` | User/private plugins (never auto-updated) |
| `users/{USER}/plugins.lock` | Integrity pins and recorded consent for enabled plugins (generated; never auto-updated) |
| `users/{USER}/writing-samples/*` | Personal writing samples for style calibration (except `writing-samples/README.md`, which is system-owned documentation delivered by updates) |
| `users/{USER}/reports/*` | Evaluation reports |
| `users/{USER}/output/*` | Generated PDFs |
| `users/{USER}/jds/*` | Saved job descriptions |
| `~/.scan-auth/users/{USER}/{PORTAL}/profile/` | Browser profile for authenticated scanning |

Project-level CLI configuration such as root `opencode.json` is also user-owned and ignored, but it is environment configuration rather than candidate data; copy `opencode.example.json` to start.

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Eval-core: scoring system, global rules, tools |
| `modes/_writing.md` | Writing guardrails (Voice DNA / Writing Style / ATS) — loaded by the CV/cover/apply writing modes, not by evaluation (#1710) |
| `modes/_custom.template.md` | Template seed for the user's `modes/_custom.md` |
| `modes/_profile.template.md` | Template seed for the user's `modes/_profile.md` |
| `modes/_brief.template.md` | Template seed for the user's `modes/_brief.md` |
| `modes/oferta.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/cover.md` | Cover letter generation instructions |
| `modes/latex.md` | LaTeX/Overleaf CV export instructions |
| `modes/add.md` | CV addition (project/paper/role) instructions |
| `modes/scan.md` | Portal scanner instructions |
| `modes/scan-handoff.md` | Agent/WebSearch scan handoff instructions |
| `modes/scan-auth.md` | Authenticated portal scanner instructions |
| `modes/go.md` | Sourcing-loop shorthand instructions |
| `go-runner.mjs` | Deterministic end-to-end sourcing coordinator |
| `cleanup-runs.mjs` | Deletes per-user verify/go run directories older than 10 days |
| `modes/verify.md` | Prompt-reviewed integrity workflow instructions |
| `verify-runner.mjs` | Standalone review/action/reverify coordinator used by `go` |
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
| `schemas/*` | Strict JSON contracts for deterministic agent steps |
| `dashboard/*` | Go TUI dashboard |
| `templates/*` | Base templates |
| `fonts/*` | Self-hosted fonts |
| `.claude/skills/*` | Skill definitions (Claude Code) |
| `.cursor/skills/*` | Skill definitions (Cursor) |
| `.opencode/skills/*` | Skill definitions (OpenCode) |
| `.qwen/skills/*` | Skill definitions (Qwen Code) |
| `.antigravitycli/skills/*` | Skill definitions (Antigravity CLI) |
| `.grok/skills/*` | Skill definitions (Grok Build CLI) |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |
| `writing-samples/README.md` | System-owned onboarding documentation for the writing-samples directory |
| `seed-fixture.mjs` / `test-fixtures/*` | Upgrade-test fixtures and seeder (system layer; fictional data, never user data) |
| `upgrade-tests.mjs` | Dynamic upgrade regression harness (PR gate: old install applies the commit under test hermetically) |

## The Rule

**If a file is in the User Layer, no update process may modify or delete it.**

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**
