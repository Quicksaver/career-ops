---
name: career-ops
description: AI job search command center -- evaluate offers, generate CVs, scan portals, track applications
arguments: mode
user_invocable: true
user-invocable: true
argument-hint: "[go | verify | scan | scan-handoff | scan-auth | deep | pdf | latex | latex-tex | cover | email | add | eu-swe | oferta | ofertas | apply | batch | tracker | agent-inbox | pipeline | contacto | training | project | interview-prep | interview | interview/plan | interview/practice | interview/debrief | patterns | offer-prep | titles | upskill | followup | update]"
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

Resolve the active user before doing mode routing, reading files, or running scripts:

1. If the current invocation explicitly names a user, set that as `ACTIVE_USER`.
   - Preferred: `/career-ops go <username>`, `/career-ops scan <username>`, `/career-ops scan-auth <username> linkedin`, `/career-ops pipeline <username>`
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

For `go`, `verify`, `scan`, `scan-handoff`, `scan-auth`, `pipeline`, and `batch`, supervise the workflow through completion while keeping routine monitoring quiet:

- Keep the current agent turn active until the workflow completes and final reconciliation and verification succeed, or until user action, an explicit stop, a confirmed destructive risk, or exhausted safe recovery provides the terminal outcome.
- Treat background and detached processes as actively supervised work owned by the current turn. Send the final response after the terminal outcome.
- Poll the process and persisted state at least every 60 seconds with the longest supported wait. Keep routine polls silent; the 10-minute interval applies to normal user-visible liveness updates.
- Use stdout/stderr, logs, artifacts, runner PID/session, state counts, lock ownership, and live-worker checks as the progress source.
- When the runner exits early or state stalls, inspect the evidence, clear proven ownerless locks, recover stale `processing` entries, resume with the same active user and parallelism, and continue monitoring.
- Reserve user-visible updates for completion, required user action, suspected hangs, concrete warnings, material recovery, explicit status requests, and at most one normal liveness update every 10 minutes.
- Treat a status request as an intermediate update, then return to silent monitoring.
- Complete the run by confirming all workers have exited, reconciling pipeline state, merging tracker additions, running `node verify-runner.mjs --user {ACTIVE_USER}`, and reporting completed, skipped, failed, seen, repaired, unresolved, and remaining counts.
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
| `interview/plan` | `interview/plan` |
| `interview/practice` | `interview/practice` |
| `interview/debrief` | `interview/debrief` |
| `pdf` | `pdf` |
| `latex` | `latex` |
| `latex-tex` | `latex-tex` |
| `email` | `email` |
| `training` | `training` |
| `project` | `project` |
| `tracker` | `tracker` |
| `agent-inbox` | `agent-inbox` |
| `inbox` | `agent-inbox` |
| `pipeline` | `pipeline` |
| `apply` | `apply` |
| `go` | `go` |
| `verify` | `verify` |
| `scan` | `scan` |
| `scan-handoff` | `scan-handoff` |
| `scan-auth` | `scan-auth` |
| `batch` | `batch` |
| `patterns` | `patterns` |
| `offer-prep` | `offer-prep` |
| `titles` | `titles` |
| `upskill` | `upskill` |
| `followup` | `followup` |
| `update` | `update` |
| `cover` | `cover` |
| `add` | `add` |

**Auto-pipeline detection:** If `$mode` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `auto-pipeline`.

If `$mode` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Output Language Directive

Before executing any mode, read `config/profile.yml` if it exists and resolve:

- `language.output` → ISO language code for human-facing output. Default: `en`.
- `language.modes_dir` → optional market-mode directory. This controls market vocabulary and local evaluation rules only.

Inject this directive after loading the mode instructions and before producing any user-visible content:

> Write all human-facing output in `{language.output}` regardless of the language of these instructions or of the job description. This includes reports, tracker notes, PDFs, cover letters, outreach, interview prep, form answers, and summaries. If `language.modes_dir` supplies market-specific vocabulary, keep the market logic but explain terms in `{language.output}` when needed.

`language.output` is authoritative for prose. `modes_dir` is market context; it must not force the prose language.

---

## Discovery Mode (no arguments)

If your CLI supports `/career-ops`, show this menu. In Codex, surface the same options in plain text and map the requested mode the same way.

Concrete equivalents for Codex prompt-driven sessions:

```text
/career-ops {JD}           ↔ "Evaluate this JD with career-ops auto-pipeline: {JD or URL}"
/career-ops go             ↔ "Run the career-ops go mode for <username>."
/career-ops verify         ↔ "Run reviewed career-ops verification for <username>."
/career-ops scan           ↔ "Run the career-ops scan mode and summarize new matches."
/career-ops pipeline       ↔ "Run the career-ops pipeline mode for <username>."
/career-ops pdf            ↔ "Run the career-ops pdf mode for the latest evaluated role."
/career-ops email          ↔ "Run the career-ops email mode for the latest evaluated role."
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
  /career-ops interview/plan → Time-blocked prep plan for an upcoming interview
  /career-ops interview/practice → Practice interview, one question at a time with feedback
  /career-ops interview/debrief → Post-interview debrief: close gaps, predict next round
  /career-ops pdf       → PDF only, ATS-optimized CV
  /career-ops latex     → Export CV as LaTeX/Overleaf .tex
  /career-ops latex-tex → Tailor your own resume.tex in place (opt-in; cv.md stays default)
  /career-ops cover     → Cover letter: standalone JD paste or /career-ops cover {slug}
  /career-ops email     → Formal application email draft (draft-only; never sends, submits, or clicks)
  /career-ops add       → Add a project/paper/role to your CV (fetch + preview + confirm)
  /career-ops training  → Evaluate course/cert against North Star
  /career-ops project   → Evaluate portfolio project idea
  /career-ops tracker   → Application status overview
  /career-ops agent-inbox → Queue/drain requests for the next session (users/{ACTIVE_USER}/data/agent-inbox.md)
  /career-ops apply     → Live application assistant (reads form + generates answers)
  /career-ops go        → Run scan, conditional handoff, LinkedIn scan, and conditional pipeline
  /career-ops verify    → Review every integrity finding, apply safe fixes, remember verified exceptions, and reverify
  /career-ops scan      → Scan portals and discover new offers
  /career-ops scan-handoff → Process saved Agent/WebSearch handoff from the latest scan
  /career-ops scan-auth <username> linkedin → Authenticated portal scan with per-user browser session
  /career-ops batch     → Batch processing with parallel workers
  /career-ops patterns  → Analyze rejection patterns and improve targeting
  /career-ops offer-prep → Read a received offer/contract with the candidate: clause walk + lawyer questions (not legal advice)
  /career-ops titles    → Suggest adjacent job titles from your CV to broaden the search
  /career-ops upskill   → Aggregate skill-gap analysis from your evaluated reports
  /career-ops followup  → Follow-up cadence tracker: flag overdue, generate drafts
  /career-ops update    → Update career-ops system files with diff preview + compat check

Inbox: add URLs to users/{ACTIVE_USER}/data/pipeline.md → /career-ops pipeline
Or paste a JD directly to run the full pipeline.

Active user: {ACTIVE_USER}
```

---

## Context Loading by Mode

After determining the mode, load the necessary files before executing:

If `users/{ACTIVE_USER}/modes/_custom.md` exists, read it after `users/{ACTIVE_USER}/modes/_profile.md` and before the selected mode file. It contains user house rules and procedural preferences. It may override workflow/style defaults, but it never adds factual claims about the candidate.

### Modes that require `_shared.md` + their mode file

Read `modes/_shared.md` + `users/{ACTIVE_USER}/modes/_profile.md` (if present) + `users/{ACTIVE_USER}/modes/_custom.md` (if present) + `modes/{mode}.md`.

Applies to: `auto-pipeline`, `oferta`, `ofertas`, `pdf`, `contacto`, `apply`, `pipeline`, `scan`, `scan-handoff`, `go`, `batch`

For `scan-handoff`, also read `modes/scan.md` before `modes/scan-handoff.md` because the handoff mode reuses scan filtering, deduplication, liveness, and pipeline-writing rules.

For `go`, also read `modes/scan.md`, `modes/scan-handoff.md`, `modes/scan-auth.md`, and `modes/pipeline.md` because the shorthand coordinates those modes conditionally.

### Standalone modes with profile and custom context

Read `users/{ACTIVE_USER}/modes/_profile.md` (if present) + `users/{ACTIVE_USER}/modes/_custom.md` (if present) + `modes/{mode}.md`, plus any user-layer files the mode names from `users/{ACTIVE_USER}/`.

Applies to: `tracker`, `agent-inbox`, `verify`, `deep`, `interview-prep`, `interview`, `regional/eu-swe`, `interview/plan`, `interview/practice`, `interview/debrief`, `latex`, `latex-tex`, `training`, `project`, `patterns`, `titles`, `upskill`, `followup`, `cover`, `email`, `add`, `offer-prep`, `scan-auth`

### Execution ownership for long-running modes

Run `go`, `scan`, `scan-handoff`, `scan-auth`, Playwright-assisted `apply`, and direct pipelines with one or two pending URLs serially in the root agent. Keep the current root turn active through completion, including browser interaction, monitoring, recovery, reconciliation, and verification.

For a direct pipeline with three or more pending URLs, launch one subagent per URL and coordinate the fan-out from the root agent. Give each worker `ACTIVE_USER`, `USER_ROOT=users/{ACTIVE_USER}`, one URL, and the loaded shared/profile/custom/mode instructions. State that all user-layer relative paths resolve inside `USER_ROOT`. Each worker completes its assigned URL directly, keeps research inline and bounded, and returns its terminal result to the root coordinator.

Run one `batch/batch-runner.sh` invocation at a time directly from the root agent and supervise it through its terminal outcome. Treat any configured `--parallel N` workers as internal batch-runner activity under that single root-owned invocation. Commands such as `scan.mjs`, `scan-auth.mjs`, and liveness checks follow the same root-owned subprocess model.

For a full `go` invocation, prefer `./go-runner.mjs --user {ACTIVE_USER}`. It is
the deterministic root-owned coordinator and invokes schema-constrained agent
work for scan handoff; batch evaluation continues to use one contract-validated
worker per job. Its final phase invokes `verify-runner.mjs`, the same reviewed
verification lifecycle exposed by the standalone `verify` mode. The reviewer
is read-only; deterministic resolvers apply confirmed duplicate/orphan repairs,
bounded tracker patches, or exact-fingerprint seen records before raw
re-verification. Unresolved findings stay user-facing. Keep the
current turn active while the runner executes and apply the same
quiet-monitoring and stop semantics.
Duplicate resolution preserves lifecycle order as `Hired > Offer > Interview >
Responded > Rejected > Applied > Evaluated > Skip/Closed`. The most advanced row
becomes the keeper together with its existing report/CV artifacts;
reviewer-selected identity breaks equal-status ties only. The resolver backs up
and archives losing artifacts and records any keeper override in the duplicate
ledger.
Resolve Codex model and reasoning independently with this precedence:
`go-runner.mjs` arguments, `users/{ACTIVE_USER}/config/profile.yml` under
`codex.model` / `codex.reasoning_effort`, then Codex global defaults. The runner
must pass resolved non-global values to the handoff worker, verification-review
worker, and all Codex batch workers.

Parallelism resolves independently as `--parallel N`, then `batch.parallel`
in `users/{ACTIVE_USER}/config/profile.yml`, then the system default `1`.
`--parallel` is optional on the go runner, direct batch runner, and reviewed
verification runner. Verification uses that value only for dependency-safe
read-only review lanes; deterministic repairs and ledger writes stay serialized.

Execute the instructions from the loaded mode file.
