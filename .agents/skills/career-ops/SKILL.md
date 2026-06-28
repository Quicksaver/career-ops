---
name: career-ops
description: AI job search command center -- evaluate offers, generate CVs, scan portals, track applications
arguments: mode
user_invocable: true
user-invocable: true
argument-hint: "[scan | scan-handoff | scan-auth | deep | pdf | latex | cover | eu-swe | oferta | ofertas | apply | batch | tracker | pipeline | contacto | training | project | interview-prep | interview | patterns | followup | update]"
license: MIT
---

# career-ops -- Router

career-ops is a multi-CLI job-search command center. The routing below is shared across supported agent CLIs even when the invocation surface differs.

## Invocation Notes

- CLIs with slash-command registration can expose this router as `/career-ops`.
- Interactive Codex sessions use `codex` in the repo root. Slash commands are not guaranteed in Codex, so ask Codex to run the same mode by name if `/career-ops` is unavailable.
- Headless Codex workers use `codex exec "prompt"`.
- The routing semantics below stay the same regardless of whether the entrypoint is a slash command or a natural-language prompt.
- Every invocation still requires an active user before user-layer files are read or written.

Codex prompt examples that map to the same router semantics:

```text
Evaluate this JD with career-ops auto-pipeline for <username>: https://company.com/jobs/123
Run the career-ops scan mode for <username> and summarize new matches.
Run the career-ops pipeline mode for <username>.
Run the career-ops pdf mode for the latest evaluated role for <username>.
Run the career-ops tracker mode for <username> and summarize the current statuses.
```

## User Context (Mandatory)

Every `/career-ops` invocation runs against exactly one active user ID. User data lives under:

```
users/{USER}/
```

Resolve the active user before doing mode routing, reading files, launching subagents, or running scripts:

1. If the current invocation explicitly names a user, set that as `ACTIVE_USER`.
   - Preferred: `/career-ops scan <username>`, `/career-ops scan-auth <username> linkedin`, `/career-ops pipeline <username>`
   - For commands with free-form arguments, prefer: `/career-ops pdf --user <username> some-job`
   - `--user <username>` and `--user=<username>` are always explicit.
2. Otherwise, if this conversation already established an active user from a prior `/career-ops` invocation, reuse that user.
3. Otherwise, stop immediately and ask the user to specify the career-ops user. Do not inspect or modify user-layer files.

Valid user IDs use letters, numbers, dots, underscores, or hyphens. Do not accept path-like user IDs.

After resolving `ACTIVE_USER`, use `USER_ROOT=users/{ACTIVE_USER}`:

- Read/write user-layer files only inside `USER_ROOT` (`cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `article-digest.md`, `portals.yml`, `data/`, `reports/`, `output/`, `interview-prep/`, `jds/`, `writing-samples/`, and user batch state).
- Read system-layer files from the repo root (`modes/_shared.md`, mode files, scripts, templates, providers, dashboard, docs).
- Remove the explicit user token or `--user` flag from the invocation before mode routing. Example: `/career-ops scan <username>` routes as mode `scan` with `ACTIVE_USER=<username>`.
- When running scripts, pass `--user {ACTIVE_USER}` or set `CAREER_OPS_USER={ACTIVE_USER}`.
- Dashboard TUI binaries belong in `USER_ROOT`. Build from `dashboard/` into the active user folder: current platform `cd dashboard && go build -o ../users/{ACTIVE_USER}/career-dashboard .`; Windows x64 `cd dashboard && GOOS=windows GOARCH=amd64 go build -o ../users/{ACTIVE_USER}/career-dashboard.exe .`; Linux x64 `cd dashboard && GOOS=linux GOARCH=amd64 go build -o ../users/{ACTIVE_USER}/career-dashboard .`; macOS arm64 `cd dashboard && GOOS=darwin GOARCH=arm64 go build -o ../users/{ACTIVE_USER}/career-dashboard .`.
- Run the per-user dashboard binary without `--path`; it infers `USER_ROOT` from the binary/current directory. Keep `--path` as an optional override for unusual layouts.
- If delegating to a subagent, include `ACTIVE_USER` and `USER_ROOT` explicitly in the prompt and tell the subagent that all user-layer relative paths resolve inside `USER_ROOT`.
- If the user explicitly changes user later in the conversation, switch to that user for subsequent `/career-ops` commands.

## Long-Running Command Quiet Mode

For `scan`, `scan-handoff`, `scan-auth`, `pipeline`, and `batch`, keep process monitoring quiet:

- Start the command, then do not send routine "still running" or "currently at phase X" updates.
- Poll the process internally only as needed for liveness. If it is still running normally, wait at least 10 minutes between user-visible status updates.
- Treat command stdout/stderr as the progress source. Do not paraphrase every phase back to the user.
- For Codex tool sessions, do not send commentary before or after routine `write_stdin` polls. Poll with the longest supported wait, and if the tool returns before 10 minutes, continue polling silently until the command completes or a real action is needed.
- Do not emit filler such as "Continuing quietly", "still processing", "worker remains active", or "no failure output" during routine polls.
- Report immediately only when the command completes, fails, asks for login/CAPTCHA/user action, appears hung, or produces a concrete warning that changes what the user should do.
- If the user explicitly asks for status while the command is running, answer once with the current observed state, then return to quiet monitoring.
## Mode Routing

Determine the mode from `$mode`:

| Input | Mode |
|-------|------|
| (empty / no args, after user context is resolved) | `discovery` -- Show command menu |
| JD text or URL (no sub-command) | **`auto-pipeline`** |
| `oferta` | `oferta` |
| `ofertas` | `ofertas` |
| `contacto` | `contacto` |
| `deep` | `deep` |
| `interview-prep` | `interview-prep` |
| `interview` | `interview` |
| `eu-swe` | `regional/eu-swe` |
| `pdf` | `pdf` |
| `latex` | `latex` |
| `training` | `training` |
| `project` | `project` |
| `tracker` | `tracker` |
| `pipeline` | `pipeline` |
| `apply` | `apply` |
| `scan` | `scan` |
| `scan-handoff` | `scan-handoff` |
| `scan-auth` | `scan-auth` |
| `batch` | `batch` |
| `patterns` | `patterns` |
| `followup` | `followup` |
| `update` | `update` |
| `cover` | `cover` |

**Auto-pipeline detection:** If `$mode` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `auto-pipeline`.

If `$mode` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Discovery Mode (no arguments)

If your CLI supports `/career-ops`, show this menu. In Codex, surface the same options in plain text and map the requested mode the same way.

Concrete equivalents for Codex prompt-driven sessions:

```text
/career-ops {JD}           ↔ "Evaluate this JD with career-ops auto-pipeline: {JD or URL}"
/career-ops scan           ↔ "Run the career-ops scan mode and summarize new matches."
/career-ops pipeline       ↔ "Run the career-ops pipeline mode for <username>."
/career-ops pdf            ↔ "Run the career-ops pdf mode for the latest evaluated role."
/career-ops tracker        ↔ "Run the career-ops tracker mode and summarize the current statuses."
```

Show this menu:

```
career-ops -- Command Center

Available commands:
  /career-ops {JD} --user <username> → AUTO-PIPELINE: evaluate + report + PDF + tracker (paste text or URL)
  /career-ops pipeline <username>    → Process pending URLs from inbox (users/<username>/data/pipeline.md)
  /career-ops oferta --user <username> → Evaluation only A-F (no auto PDF)
  /career-ops ofertas   → Compare and rank multiple offers
  /career-ops contacto  → LinkedIn power move: find contacts + draft message
  /career-ops deep      → Deep research prompt about company
  /career-ops interview-prep → Generate company-specific interview prep doc
  /career-ops interview    → Interactive profile/CV onboarding interview
  /career-ops eu-swe    → Calibrate a European SWE application before CV/apply/interview
  /career-ops pdf       → PDF only, ATS-optimized CV
  /career-ops latex     → Export CV as LaTeX/Overleaf .tex
  /career-ops cover     → Cover letter: standalone JD paste or /career-ops cover {slug}
  /career-ops training  → Evaluate course/cert against North Star
  /career-ops project   → Evaluate portfolio project idea
  /career-ops tracker   → Application status overview
  /career-ops apply     → Live application assistant (reads form + generates answers)
  /career-ops scan      → Scan portals and discover new offers
  /career-ops scan-handoff → Process saved Agent/WebSearch handoff from the latest scan
  /career-ops scan-auth <username> linkedin → Authenticated portal scan with per-user browser session
  /career-ops batch     → Batch processing with parallel workers
  /career-ops patterns  → Analyze rejection patterns and improve targeting
  /career-ops followup  → Follow-up cadence tracker: flag overdue, generate drafts
  /career-ops update    → Update career-ops system files with diff preview + compat check

Inbox: add URLs to users/{ACTIVE_USER}/data/pipeline.md → /career-ops pipeline
Or paste a JD directly to run the full pipeline.

Active user: {ACTIVE_USER}
```

---

## Context Loading by Mode

After determining the mode, load the necessary files before executing:

### Modes that require `_shared.md` + their mode file:
Read `modes/_shared.md` + `modes/{mode}.md` + `users/{ACTIVE_USER}/modes/_profile.md` (if present) + `users/{ACTIVE_USER}/modes/_custom.md` (if present).

Applies to: `auto-pipeline`, `oferta`, `ofertas`, `pdf`, `contacto`, `apply`, `pipeline`, `scan`, `scan-handoff`, `batch`

For `scan-handoff`, also read `modes/scan.md` before `modes/scan-handoff.md` because the handoff mode reuses scan filtering, deduplication, liveness, and pipeline-writing rules.

### Standalone modes (only their mode file):
Read `modes/{mode}.md` plus any user-layer files it names from `users/{ACTIVE_USER}/`.

Applies to: `tracker`, `deep`, `interview-prep`, `interview`, `regional/eu-swe`, `latex`, `training`, `project`, `patterns`, `followup`, `cover`, `scan-auth`

### Modes delegated to subagent:
For `scan`, `scan-handoff`, `apply` (with Playwright), and `pipeline` (3+ URLs): launch as a worker/subagent with the content of `_shared.md` + `modes/{mode}.md` injected into the worker prompt. If your CLI exposes an `Agent(...)` primitive, the call looks like this:

```
Agent(
  subagent_type="general-purpose",
  prompt="ACTIVE_USER={ACTIVE_USER}\nUSER_ROOT=users/{ACTIVE_USER}\nAll user-layer paths are relative to USER_ROOT.\nFor scan/scan-handoff/scan-auth/pipeline/batch monitoring, stay quiet while the process runs. Do not narrate routine tool polls; report completion, failure, required user action, suspected hang, or at most one normal liveness update every 10 minutes.\n\n[content of modes/_shared.md]\n\n[content of users/{ACTIVE_USER}/modes/_profile.md if present]\n\n[content of users/{ACTIVE_USER}/modes/_custom.md if present]\n\n[content of modes/{mode}.md]\n\n[invocation-specific data]",
  description="career-ops {mode}"
)
```

Execute the instructions from the loaded mode file.
