# Batch processing

Process job offers with headless Codex workers by default. Explicit `--cli claude` selects Claude. `CAREER_OPS_BATCH_CLI` overrides the system CLI default; a command-line `--cli` takes precedence over that environment variable.

The coordinated `run` workflow supports Codex and Claude. Standalone batch retains legacy OpenCode, Gemini and Qwen dispatch with one worker; those choices do not implement the coordinated queue contract.

Select a user on every invocation. User state, inputs, reports and output live under the active user data root, normally `users/{USER}/`. This directory follows the configured data-root overrides.

## Run a batch

Create `users/{USER}/batch/batch-input.tsv` with real tab-separated fields:

```tsv
id	url	source	notes
1	https://jobs.example.com/role-a	Employer	priority
2	local:jds/archived-role.md	Authenticated capture	archived
```

```bash
./batch/batch-runner.sh --user USER --dry-run
./batch/batch-runner.sh --user USER
./batch/batch-runner.sh --user USER --cli claude
```

The worker loads the current shared, evaluation and output modes. It runs A-G evaluation, archives the JD, generates the configured CV format when gates permit, and writes a labeled tracker addition. The runner validates artifacts, merges tracker additions, reconciles pipeline state and verifies integrity. A parent coordinator can use `--defer-verification` to own the final verification pass.

Codex model and reasoning resolve independently from command-line `--model` / `--reasoning-effort`, then `codex.model` / `codex.reasoning_effort` in the active profile, then `gpt-6.1-sol` / `medium`. Claude resolves its model from `--model`, then the profile's `spend_tier`.

## Options

| Flag | Default | Purpose |
|---|---|---|
| `--user ID` | required | Select the user |
| `--cli NAME` | `codex` | Select Codex or Claude |
| `--parallel N` | profile `batch.parallel`, then `1` | Limit concurrent workers |
| `--model NAME` | profile, then system default | Override model |
| `--reasoning-effort LEVEL` | profile, then `medium` | Codex reasoning override |
| `--queue-file PATH` | absent | Read-only exact posting URLs, one per line, limiting dispatch |
| `--answers-file PATH` | absent | Explicit user-owned exact-URL manual answers |
| `--dry-run` | off | Preview dispatch without workers |
| `--limit N` | unlimited when omitted | Positive maximum count; explicit zero is invalid |
| `--start-from N` | `0` | Ignore input IDs below this value |
| `--min-score N` | `0`, disabled | Mark completed evaluations below the threshold skipped in batch state |
| `--retry-failed` | off | Select failed jobs, granting one additional dispatch even at the retry cap |
| `--resume-paused` | off | Select jobs paused by Codex or Claude session/rate limits |
| `--include-pending` | off | Internal coordinator flag that unions recovery selections with ordinary pending eligibility |
| `--max-retries N` | `2` | Bound retry attempts |
| `--worker-timeout N` | `900` | Finite nonnegative seconds; zero disables the timeout and decimals are accepted |
| `--rate-limit-sleep N` | `300` | Maximum adaptive Claude retry delay; zero pauses immediately |
| `--skip-pdf` | off | Disable PDF rendering |
| `--recover-artifact-failures` | off | Revalidate known false artifact failures without workers |
| `--defer-verification` | off | Leave final verification to the parent |
| `--status` / `--watch` | off | Inspect persisted progress |

## Manual holds and exact answers

A missing JD or unconfirmed agency is `needs_confirmation`, with reason `jd_unavailable` or `agency_confirmation`. It is held outside automatic retries and produces no evaluation, tracker, CV or application artifact. Per-job handoffs are saved in `batch/logs/{id}.hold.json`, including user, exact URL, reason and question. The parent can collect these alongside `batch-state.tsv`.

Headless batch never bulk-fetches LinkedIn through curl, WebFetch, guest endpoints or API bypasses. Without archived or explicitly supplied JD text or an employer URL, it returns a `jd_unavailable` hold before launching a worker. The original posting URL remains the job identity and provenance.

Supply a read-only answer file explicitly:

```json
{
  "schema_version": 1,
  "user": "USER",
  "answers": [
    {"url": "https://www.linkedin.com/jobs/view/123", "reason": "jd_unavailable", "answer": "Pasted the exact posting", "jd_text": "Full job description..."},
    {"url": "local:jds/archived-role.md", "reason": "agency_confirmation", "answer": "This is a direct employer posting", "direct_employer": true}
  ]
}
```

A JD answer requires nonempty `jd_text` or a public non-LinkedIn `employer_url`. An agency answer identifies/confirms the intermediary in `answer`, or explicitly corrects it to direct with `direct_employer: true`. The runner resumes only a hold with the same user, exact URL, job ID and reason. A JD answer never confirms agency. User-contained `local:jds/...` identities are accepted; traversal and escaping symlinks are rejected.

```bash
./batch/batch-runner.sh --user USER --queue-file current-inbox.txt --answers-file answers.json
```

Completed and skipped rows remain terminal and are reconciled instead of evaluated again. Retry flags never supply a user's answer. Direct recovery invocations select only the requested failed/paused states, or both when both flags are supplied. The parent adds `--include-pending` to include ordinary eligible work and grants `--retry-failed` only on its first queue pass. A failed extra attempt increments the persisted retry count, so an ordinary later run cannot renew it. Codex usage, session and rate limits persist `paused_rate_limit` without spending job retries, stop new dispatch and drain existing workers. Resume requires `--resume-paused`.

Batch ownership uses the shared atomic directory/token protocol at `batch/batch-runner.pid.owner.lock/owner.json`. Its `pid` is the native OS PID of the supervising Bash process, including on Windows. The compatibility `batch-runner.pid` retains the Bash PID. Only the acquiring token can release either artifact. A native owner proven dead can be recovered; unreadable or ambiguous ownership stays locked. An illegal hold that writes artifacts is quarantined and stops the run before merging those artifacts.

Reviewed verification holds this same ownership mutex. Worker launches use the shared native command resolver and separate POSIX process groups. On Windows, a PowerShell helper assigns workers to an owned Job Object before they execute, then drains descendants even when the launcher exits normally. This requires Windows 10 or later and Windows PowerShell. Timeout recovery starts after the owned process tree stops. Batch interruption owns offer supervisors before child registration exists and drains both pending supervisors and registered workers before releasing ownership. Unconfirmed cleanup retains its registration and stops processing with exit 125; a later run refuses recovery while an earlier worker owner remains alive or ambiguous. Required preparation and quarantine failures also stop sequential processing before merge.

## Artifact identity

Reports use the runner-reserved number. The primary PDF and HTML stay at `output/{REPORT_NUM}-{company-slug}-{DATE}.{pdf|html}` and are indexed against that number. Text/LaTeX formats never claim a PDF. Skip, hard stops and the PDF score threshold block rendering. Template/pack resolution, standing page format, title/structure/fact checks, keyword diagnostics and opt-in ATS output follow `modes/pdf.md`. Secondary ATS PDFs omit `--report` and cannot replace the primary PDF index entry.

Node.js and the selected CLI must be installed. PDF rendering additionally needs the browser dependencies reported by `npm run doctor`.
