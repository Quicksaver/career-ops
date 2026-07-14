# Mode: verify -- Reviewed pipeline integrity

Run the user-scoped reviewed verifier:

```bash
node verify-runner.mjs --user {USER}
```

This mode preserves `verify-pipeline.mjs` as the raw deterministic checker. The reviewed runner executes that checker, removes only exact finding fingerprints already recorded as seen, sends every remaining error and warning through schema-constrained read-only review, applies only bounded deterministic actions, and runs the raw verifier again.

## Review outcomes

Every active finding must receive exactly one disposition:

- `mark_seen` for a verified false positive, legitimate exception, or informational finding. The decision is appended to `users/{USER}/data/verification-reviews.jsonl`; it suppresses only the same finding ID, level, and full-payload fingerprint. Changed evidence resurfaces automatically.
- `resolve_duplicate` for a confirmed duplicate tracker/report group. `resolve-verify-warnings.mjs` validates the exact candidate partition and makes the most advanced lifecycle row the keeper using `Hired > Offer > Interview > Responded > Rejected > Applied > Evaluated > Skip/Closed`; reviewer-selected canonical identity breaks equal-status ties only. The keeper retains its original report/HTML/PDF without renaming, while losing artifacts are backed up and archived and the decision is recorded in the duplicate ledger.
- `restore_orphan` for a valid evaluation whose tracker row was lost. Restoration must use a matching preserved TSV under `users/{USER}/batch/tracker-additions/merged/`.
- `archive_orphan` for a verified redundant or obsolete orphan. The report and matching outputs are backed up and moved under timestamped orphan archives.
- `patch_tracker` for an evidence-backed bounded correction to company, Via, canonical status, score, or report link on a uniquely identified tracker row.
- `manual_review` when no supported deterministic action is safe or user judgment is required.

The prompt reviewer is read-only and cannot mutate files. `apply-verification-review.mjs` and `resolve-verify-warnings.mjs` are the only mutation boundaries. Every action is written to a user-scoped append-only ledger and backed up before destructive movement or tracker rewriting.

The reviewer decides whether an orphan is valid, redundant, or ambiguous, but it does not author trusted filesystem metadata. For `archive_orphan`, the runner derives the exact report path from the raw verifier finding and fixes `tracker_tsv` to `null`. Restore paths remain evidence-backed and must match a preserved tracker-addition TSV. Semantic validation reports all invalid decisions in the chunk together instead of stopping at the first item.

## Live progress

Review calls contain at most five findings. Reviewer concurrency resolves as explicit `--parallel N`, then the active user's `batch.parallel`, then `1`; the same resolved model and reasoning effort are passed to every reviewer. Findings with overlapping tracker/report/orphan identities stay in the same dependency lane and are reviewed sequentially with prior decisions as binding context, while independent lanes run concurrently. Reviewers are read-only and use distinct input, output, and log files. All repairs and ledger writes remain serialized in the parent after every lane completes and aggregate consistency passes.

An invalid review retries only its five-finding chunk, with every semantic validation error supplied as correction feedback. The default is two retries and can be changed with `--review-retries N`. A chunk receives an atomic validated checkpoint only after its complete response passes normalization and semantic validation. No reviewed action is applied from a partially completed or failed pass.

Interrupted runs are ignored by a normal fresh invocation. An operator may explicitly continue one with `--resume-run RUN_ID`; only validated checkpoints whose user, findings, and prior-decision context exactly match their stored signature are reused. Raw reviewer output is never a resumable checkpoint. Use a fresh run when reviewer decisions should be discarded and recomputed.

Before the first phase, the runner prints `run-id: <RUN_ID>` and its `logs:` directory so an interrupted run can be resumed with `--resume-run <RUN_ID>`. After each call completes, it writes one compact stdout line per finding: `reviewed X/Y, job(s) #{related IDs}, {issue code} → {classification}`. Tracker IDs are preferred; report IDs are used for report-only and orphan findings. Full decisions, rationale, evidence, and action details remain in the run artifacts instead of flooding the terminal. The default final output is only a compact summary plus the actual failure text, when present. Pass `--json` for a complete machine-readable result; in that mode stdout contains only JSON and progress moves to stderr. `--quiet` suppresses live progress while retaining phase logs and the logs path in the final human summary.

## Completion

The runner loops through review, action, and raw re-verification for up to three passes by default. It returns:

- `completed` when every raw finding is either resolved or matched by an unchanged seen record;
- `partial` when reviewed findings still require human action;
- `failed` only for an operational, schema, validation, or mutation failure.

Report raw error/warning counts, previously seen counts, decisions made this run, deterministic actions applied, unresolved findings, backup/ledger paths, review retry/checkpoint/normalization counts under `review_resilience`, and final status. Do not describe a warning-only raw verifier result as a failed reviewed verification when every warning has a valid seen record.
