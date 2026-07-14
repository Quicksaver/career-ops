# Mode: verify -- Reviewed pipeline integrity

Run the user-scoped reviewed verifier:

```bash
node verify-runner.mjs --user {USER}
```

This mode preserves `verify-pipeline.mjs` as the raw deterministic checker. The reviewed runner executes that checker, removes only exact finding fingerprints already recorded as seen, sends every remaining error and warning through schema-constrained read-only review, applies only bounded deterministic actions, and runs the raw verifier again.

## Review outcomes

Every active finding must receive exactly one disposition:

- `mark_seen` for a verified false positive, legitimate exception, or informational finding. The decision is appended to `users/{USER}/data/verification-reviews.jsonl`; it suppresses only the same finding ID, level, and full-payload fingerprint. Changed evidence resurfaces automatically.
- `resolve_duplicate` for a confirmed duplicate tracker/report group. `resolve-verify-warnings.mjs` validates the exact candidate partition, preserves lifecycle history, backs up state, archives losing artifacts, and records its ledger.
- `restore_orphan` for a valid evaluation whose tracker row was lost. Restoration must use a matching preserved TSV under `users/{USER}/batch/tracker-additions/merged/`.
- `archive_orphan` for a verified redundant or obsolete orphan. The report and matching outputs are backed up and moved under timestamped orphan archives.
- `patch_tracker` for an evidence-backed bounded correction to company, Via, canonical status, score, or report link on a uniquely identified tracker row.
- `manual_review` when no supported deterministic action is safe or user judgment is required.

The prompt reviewer is read-only and cannot mutate files. `apply-verification-review.mjs` and `resolve-verify-warnings.mjs` are the only mutation boundaries. Every action is written to a user-scoped append-only ledger and backed up before destructive movement or tracker rewriting.

## Completion

The runner loops through review, action, and raw re-verification for up to three passes by default. It returns:

- `completed` when every raw finding is either resolved or matched by an unchanged seen record;
- `partial` when reviewed findings still require human action;
- `failed` only for an operational, schema, validation, or mutation failure.

Report raw error/warning counts, previously seen counts, decisions made this run, deterministic actions applied, unresolved findings, backup/ledger paths, and final status. Do not describe a warning-only raw verifier result as a failed reviewed verification when every warning has a valid seen record.
