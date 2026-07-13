# Mode: go -- Full sourcing shorthand

Run the normal sourcing sequence for the active user:

1. `/career-ops scan`
2. `/career-ops scan-handoff`, only when the just-finished scan wrote handoff items
3. `/career-ops scan-auth linkedin`
4. `/career-ops pipeline`, only when the scan phases added new pending jobs

This mode is a shorthand coordinator. It does not replace the individual mode rules. Before running it, read:

- `modes/scan.md`
- `modes/scan-handoff.md`
- `modes/scan-auth.md`
- `modes/pipeline.md`

Follow each child mode's filtering, deduplication, liveness, quiet-monitoring, and user-layer rules.

## Deterministic runner

Prefer the executable coordinator for end-to-end runs:

```bash
./go-runner.mjs --user {USER} --batch-cli codex
```

The runner owns phase gating, per-user locking, pending counters, JSON-validated
handoff-agent output, bulk liveness, pipeline-to-batch synchronization, batch
supervision, reconciliation, final verification, and read-only prompt-based
warning triage. When verification has warnings, the triage worker reviews each
one. Only confirmed duplicate tracker/report groups may be repaired, through a
constrained deterministic resolver followed by verification again. Orphans,
submission risks, and every other warning remain user warnings and may set
`needs_human_review` based on severity or impact. Detailed phase logs go to
`users/{USER}/data/go-runs/`. Live progress goes to stderr: the current
zero-token provider/target, handoff task, authenticated search prompt, queue
additions, and batch job are visible while the run is active. Stdout still
contains exactly one JSON summary, so machine consumers remain stable. Pass
`--quiet` to retain log-only phase output. The `--parallel` option is optional.
Parallelism resolves in this order:

1. `--parallel N` on `go-runner.mjs`
2. `batch.parallel` in `users/{USER}/config/profile.yml`
3. System default `1`

The resolved value is passed explicitly to the batch runner.

Codex model settings resolve independently with this precedence:

1. `--codex-model` / `--codex-reasoning-effort` on `go-runner.mjs`
2. `codex.model` / `codex.reasoning_effort` in `users/{USER}/config/profile.yml`
3. Codex global configuration (the runner omits that CLI override)

The resolved non-global values are passed to the scan-handoff and warning-triage
`codex exec` calls and every batch-worker `codex exec` call.

## Preconditions

Resolve `ACTIVE_USER` first. Do not read or write user-layer files until the active user is known.

Run the cold-start check before starting:

```bash
node doctor.mjs --user {USER} --json
```

If onboarding is needed, stop and follow the onboarding flow. If `modes/_profile.md` is the only missing file, seed it from `modes/_profile.template.md` as described in `AGENTS.md`, then continue only if the remaining required setup is complete.

## Counters

Before the first scan phase, count pending pipeline items in `users/{USER}/data/pipeline.md`:

```text
- [ ] ...
```

If the file is missing, treat the starting count as `0` and create it only through the normal scan/pipeline writers.

After each scan phase, recount pending items. Track whether any scan phase increased the count compared with the starting count. The final pipeline step runs only when the final pending count is greater than the starting pending count.

After `/career-ops scan`, inspect `users/{USER}/data/scan-handoff.json`. Run `/career-ops scan-handoff` only when the latest file has a positive `count` or a non-empty `items` array. If the file is missing, invalid, or empty, skip handoff and continue to LinkedIn.

## Workflow

### 1. Run zero-token scan

Run:

```bash
node scan.mjs --user {USER}
```

Provider-specific or company-specific failures do not stop `go` when the scanner still completed the overall pass and wrote usable output. Continue to the next phase after reporting those failures in the final summary.

Stop immediately only for catastrophic issues, including:

- missing/invalid active user or onboarding requirements
- unreadable required config such as `users/{USER}/portals.yml`
- failure to read or write user-owned state such as `pipeline.md`, `scan-history.tsv`, or `scan-handoff.json`
- a script crash that prevents determining whether the scan produced usable output
- an authentication, CAPTCHA, browser-login, or other prompt that requires explicit user action

### 2. Conditionally run scan-handoff

If the latest handoff JSON has items, run the `scan-handoff` mode against that file.

Skip this phase when the latest handoff JSON is missing, invalid, or empty. Missing/invalid handoff JSON is not catastrophic if `node scan.mjs` otherwise completed and the next phases can still run.

Company-specific WebSearch or liveness failures inside handoff do not stop `go` when other handoff items can still be processed. Continue to LinkedIn after collecting the failure count for the final summary.

### 3. Run authenticated LinkedIn scan

Run:

```bash
node scan-auth.mjs --user {USER} linkedin
```

LinkedIn can be slow and may page through many result pages. Keep `scan-auth` running through long duration, high page count, noisy output, or many accepted listings; wait for it to finish and persist its output. Stop only when the user explicitly says to stop, the process exits/fails, login/CAPTCHA/account verification/other user action is required, or there is a confirmed destructive/data-corruption risk.

Continue after ordinary per-listing extraction, title-filter, deduplication, or skipped-result errors.

Stop if LinkedIn requires login, CAPTCHA, account verification, or another explicit user action. Tell the user to run:

```bash
node scan-auth.mjs --user {USER} --login linkedin
```

in a separate terminal window, then rerun `/career-ops go`.

### 4. Conditionally run pipeline

After all scan phases that can run have finished, recount pending items in `users/{USER}/data/pipeline.md`.

If the final pending count is greater than the starting pending count, run `/career-ops pipeline` using the normal `modes/pipeline.md` rules. This processes the active pending inbox, not only the newly added rows.

If no scan phase added jobs to the pipeline, skip pipeline and report that there were no new pending jobs from this `go` run.

## Output

Keep monitoring quiet while the scan and pipeline phases run. At the end, print one concise summary:

```text
go -- {YYYY-MM-DD}
Scan: completed, N new pending, E provider/company errors
Handoff: skipped|completed, N new pending, E errors
LinkedIn: completed|needs login|skipped, N new pending, E errors
Pipeline: skipped|completed, processed N pending jobs
Warning triage: skipped|completed, W user warnings, D duplicate groups resolved, human review yes|no
```

If a catastrophic issue stopped the sequence, state which phase stopped, the exact blocking reason, and the command the user should run next.
