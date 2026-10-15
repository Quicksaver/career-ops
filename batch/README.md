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

Before launching the worker, an empty HTTP/API prefetch triggers one read-only `browser-extract.mjs` attempt, with a 35-second process limit and owned browser cleanup. Substantive, untruncated text reaches the worker through its JD file; extraction errors, missing Playwright and thin pages leave the worker's normal retrieval/confirmation gates available. Diagnostics go to `batch/logs/{id}.jd-browser.log`. Supplied JD text and local captures bypass this fallback. LinkedIn remains on the authenticated scanner/manual-input path, and the generic extractor blocks LinkedIn requests and redirects.

Workers also receive the queue's source/notes and `batch/logs/{id}.source.json`, containing exact-URL scan history and any original provider description saved by the scanner. HN hiring comments are retained as individual posting identities. Older HN homepage entries can recover a unique original hiring comment through their recorded month, URL and title before prefetch or evaluation. Missing-JD escalation follows the supplied source/application links and a targeted recovery search within the normal research budget. Source snapshots retain their capture date and require the normal liveness checks; they never count as candidate facts or user confirmation. Supplied JDs, terminal rows and existing unanswered holds retain their existing handling.

Codex model and reasoning resolve independently from command-line `--model` / `--reasoning-effort`, then `codex.model` / `codex.reasoning_effort` in the active profile, then `gpt-6.1-sol` / `medium`. Claude resolves its model from `--model`, then the profile's `spend_tier`.

Parallelism resolves as `--parallel`, profile `batch.parallel`, then `1` for both CLIs. After a transient rate limit, the owning batch pool reduces new dispatch to one worker for the rest of that batch. Active workers drain normally; quota/session holds still require explicit recovery.

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

Agency confirmation is the default. Set the selected user's `config/profile.yml` → `batch.agency_confirmation: posting_evidence` to delegate identification to the worker instead. Workers then proceed from posting evidence without asking for an agency confirmation or a direct-employer URL. Unknown identities remain unknown and normal legitimacy checks apply. `run` also supplies exact-posting standing-policy answers for old agency holds on restart; the standalone runner can consume those through `--answers-file`. This policy never supplies missing JD text or verifies an undisclosed employer.

The answers API also accepts `{"url":"https://example.com/jobs/123","reason":"jd_unavailable","answer":"","resolution":"skip"}` when the user cannot supply the JD. This is an explicit terminal decision, not an empty JD or permission to evaluate. It must match the selected user, exact posting URL and missing-JD reason; omit `jd_text`, `employer_url` and `direct_employer`. The batch records `skipped` without an agent, report or CV, preserves retry history, and reconciliation records the reason in Processed. Empty answers without this resolution remain invalid.

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

A JD answer that resumes evaluation requires nonempty `jd_text` or a public non-LinkedIn `employer_url`; an explicit `resolution: "skip"` instead closes the posting without evaluation. An agency answer identifies/confirms the intermediary in `answer`, or explicitly corrects it to direct with `direct_employer: true`. The runner resumes only a hold with the same user, exact URL, job ID and reason. A JD answer never confirms agency. User-contained `local:jds/...` identities are accepted; traversal and escaping symlinks are rejected.

```bash
./batch/batch-runner.sh --user USER --queue-file current-inbox.txt --answers-file answers.json
```

For normal human use, run `node run-workflow.mjs --user USER` in a writable terminal. Its fixed input area asks one question at a time and saves answers automatically; you do not need to create this JSON by hand. Independent workers continue, and an answered job resumes in a free slot. `/later` defers the current question and presents the next. Ctrl+D with text submits a multiline JD; on a missing-JD question, empty Ctrl+D or `/skip` followed by Enter resolves the posting as skipped because the user cannot provide the JD. That decision survives restart without evaluation artifacts. Empty Ctrl+D on other question types defers. `/finish` followed by Enter stops questions and exits after active work drains. Deferred questions return on restart. Ctrl+C stops the run. Headless batch still uses the explicit files above.

The coordinator's internal `--live-inputs PATH` flag keeps one owned batch pool open for live answers and exact job retry requests. It requires `--answers-file` and `--queue-file`, validates the parent user/native PID, and exits when that owner disappears. The queue file remains read-only to batch; its owning coordinator may publish newly admitted inbox URLs atomically. Dispatch fingerprints allow bounded automatic retries and one attempt per new answer or explicit retry token. A posting remains unavailable until its previous offer process has exited and been reaped; duplicate input IDs cannot bypass its terminal/processing state or chosen ID. Nonnumeric historical input IDs cannot claim the canonical posting slot. A confirmation under any ID gates the whole posting URL and resumes only the matching held ID after its exact answer validates. Multiple held IDs, a held ID absent from input, or a held ID conflicting with an already-dispatched identity stop with an explicit repair error. Confirmation answers preserve the prior failure count. Idle/busy selection and coordinator publication run approximately once per second, publishing changed contents only. This is an internal protocol, not an additional file a user needs to author.

Completed and skipped rows remain terminal and are reconciled instead of evaluated again. Retry flags never supply a user's answer. Direct recovery invocations select only the requested failed/paused states, or both when both flags are supplied. The parent adds `--include-pending` to include ordinary eligible work and grants `--retry-failed` only on its first queue pass. A failed extra attempt increments the persisted retry count, so an ordinary later run cannot renew it. Codex usage, session and rate limits persist `paused_rate_limit` without spending job retries, stop new dispatch and drain existing workers. Standalone batch resumes through `--resume-paused`; the live coordinator may instead authorize an exact posting retry without resuming other paused jobs.

Batch ownership uses the shared atomic directory/token protocol at `batch/batch-runner.pid.owner.lock/owner.json`. Its `pid` is the native OS PID of the supervising Bash process, including on Windows. The compatibility `batch-runner.pid` retains the Bash PID. Only the acquiring token can release either artifact. A native owner proven dead can be recovered; unreadable or ambiguous ownership stays locked. An illegal hold that writes artifacts is quarantined and stops the run before merging those artifacts.

Reviewed verification holds this same ownership mutex. Worker launches use the shared native command resolver. On POSIX, cleanup covers the worker's process group and descendants reachable through the ancestry snapshot taken at stop or close. A descendant outside that group and already reparented away from the launcher's ancestry is outside verifiable containment; successful cleanup does not prove it stopped. On Windows, a PowerShell helper assigns workers to an owned kernel Job before they execute, then drains its Job members even when the launcher exits normally. Launch JSON travels through an owned registration sibling file, preserving native argv capacity and inherited worker stdin. This requires Windows 10 or later and Windows PowerShell. Timeout recovery and ownership release follow successful cleanup within that platform's ownership boundary. Batch interruption owns offer supervisors before child registration exists and cleans up both pending supervisors and registered workers before releasing ownership. A failed stop skips waiting for that surviving offer and continues other cleanup attempts. Unconfirmed cleanup immediately retains a failed registration and returns exit 125 independently of child closure; a later run refuses recovery while an earlier worker owner remains alive or ambiguous. Required preparation and quarantine failures also stop sequential processing before merge.

## Artifact identity

Strict artifact checks preserve recognized `#/job/{id}` and `#/jobs/{id}` identities, so different SPA postings cannot authorize each other's outputs. Other URL components retain the strict dispatched-URL comparison. A report-backed agency can repair an empty Via cell or append the optional Via column to a valid headed TSV; existing column order and values remain intact, and conflicting agency values fail validation.

Reports use the runner-reserved number. The primary PDF and HTML stay at `output/{REPORT_NUM}-{company-slug}-{DATE}.{pdf|html}` and are indexed against that number. Text/LaTeX formats never claim a PDF. Skip, hard stops and the PDF score threshold block rendering. Template/pack resolution, standing page format, title/structure/fact checks, keyword diagnostics and opt-in ATS output follow `modes/pdf.md`. Secondary ATS PDFs omit `--report` and cannot replace the primary PDF index entry.

Node.js and the selected CLI must be installed. PDF rendering additionally needs the browser dependencies reported by `npm run doctor`.
