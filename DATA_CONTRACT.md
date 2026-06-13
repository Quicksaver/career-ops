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
| `users/{USER}/modes/_profile.md` | Archetypes, narrative, negotiation scripts |
| `users/{USER}/article-digest.md` | Proof points from portfolio |
| `users/{USER}/interview-prep/story-bank.md` | Accumulated STAR+R stories |
| `users/{USER}/interview-prep/*` | Company-specific interview prep |
| `users/{USER}/portals.yml` | Customized company list |
| `users/{USER}/data/applications.md` | Application tracker source of truth |
| `users/{USER}/data/applications.db` | Derived query index over `applications.md` (SQLite, rebuilt by `node tracker.mjs sync --user {USER}` — safe to delete) |
| `users/{USER}/data/pipeline.md` | URL inbox |
| `users/{USER}/data/scan-history.tsv` | Scan history |
| `users/{USER}/data/follow-ups.md` | Follow-up history |
| `users/{USER}/data/parser-output/*` | Local parser debug/audit output |
| `users/{USER}/batch/*` | Batch input, state, logs, and tracker additions |
| `users/{USER}/writing-samples/*` | Personal writing samples for style calibration |
| `users/{USER}/reports/*` | Evaluation reports |
| `users/{USER}/output/*` | Generated PDFs |
| `users/{USER}/jds/*` | Saved job descriptions |
| `~/.scan-auth/users/{USER}/{PORTAL}/profile/` | Browser profile for authenticated scanning |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Scoring system, global rules, tools |
| `modes/oferta.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/scan.md` | Portal scanner instructions |
| `modes/scan-auth.md` | Authenticated portal scanner instructions |
| `modes/batch.md` | Batch processing instructions |
| `modes/apply.md` | Application assistant instructions |
| `modes/auto-pipeline.md` | Auto-pipeline instructions |
| `modes/contacto.md` | LinkedIn outreach instructions |
| `modes/deep.md` | Research prompt instructions |
| `modes/ofertas.md` | Comparison instructions |
| `modes/pipeline.md` | Pipeline processing instructions |
| `modes/project.md` | Project evaluation instructions |
| `modes/tracker.md` | Tracker instructions |
| `modes/training.md` | Training evaluation instructions |
| `modes/patterns.md` | Pattern analysis instructions |
| `modes/followup.md` | Follow-up cadence instructions |
| `modes/de/*` | German language modes |
| `modes/fr/*` | French language modes |
| `modes/ja/*` | Japanese language modes |
| `modes/pt/*` | Portuguese language modes |
| `modes/ru/*` | Russian language modes |
| `CLAUDE.md` | Agent instructions (Claude Code) |
| `OPENCODE.md` | Agent instructions (OpenCode) |
| `AGENTS.md` | Canonical agent instructions (imported by CLI-specific wrappers) |
| `*.mjs` | Utility scripts |
| `lib/*` | Shared system helpers |
| `scan-auth/*.mjs` | Authenticated portal scanner classes |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.sh` | Batch orchestrator |
| `dashboard/*` | Go TUI dashboard |
| `templates/*` | Base templates |
| `fonts/*` | Self-hosted fonts |
| `.claude/skills/*` | Skill definitions (Claude Code) |
| `.opencode/skills/*` | Skill definitions (OpenCode) |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |
| `writing-samples/README.md` | System-owned onboarding documentation for the writing-samples directory |

## The Rule

**If a file is in the User Layer, no update process may modify or delete it.**

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**
