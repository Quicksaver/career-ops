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

## Live progress

Review calls contain at most five findings. Reviewer concurrency resolves as explicit `--parallel N`, then the active user's `batch.parallel`, then `1`; the same resolved model and reasoning effort are passed to every reviewer. Findings with overlapping tracker/report/orphan identities stay in the same dependency lane and are reviewed sequentially with prior decisions as binding context, while independent lanes run concurrently. Reviewers are read-only and use distinct input, output, and log files. All repairs and ledger writes remain serialized in the parent after every lane completes and aggregate consistency passes.

After each call completes, the runner writes one compact stderr line per finding: `reviewed X/Y, job(s) #{related IDs}, {issue code} → {classification}`. Tracker IDs are preferred; report IDs are used for report-only and orphan findings. Full decisions, rationale, evidence, and action details remain in the run artifacts and final JSON summary instead of flooding the terminal. Stdout remains reserved for the single final JSON summary; `--quiet` suppresses live progress while retaining phase logs.

## Completion

The runner loops through review, action, and raw re-verification for up to three passes by default. It returns:

- `completed` when every raw finding is either resolved or matched by an unchanged seen record;
- `partial` when reviewed findings still require human action;
- `failed` only for an operational, schema, validation, or mutation failure.

Report raw error/warning counts, previously seen counts, decisions made this run, deterministic actions applied, unresolved findings, backup/ledger paths, and final status. Do not describe a warning-only raw verifier result as a failed reviewed verification when every warning has a valid seen record.
