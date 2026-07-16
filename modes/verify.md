# Mode: verify -- Reviewed pipeline integrity

Run the user-scoped reviewed verifier:

```bash
node verify-runner.mjs --user {USER}
```

This mode preserves `verify-pipeline.mjs` as the raw deterministic checker. The reviewed runner executes that checker, removes only exact finding fingerprints already recorded as seen, sends every remaining error and warning through schema-constrained read-only review, applies only bounded deterministic actions, and runs the raw verifier again.

## Review outcomes

Every active finding must receive exactly one disposition:

- `mark_seen` for a verified false positive, legitimate exception, or informational finding. The decision is appended to `users/{USER}/data/verification-reviews.jsonl`; it suppresses only the same finding ID, level, and full-payload fingerprint. Changed evidence resurfaces automatically.
- `resolve_duplicate` for a confirmed duplicate tracker/report group. `resolve-verify-warnings.mjs` validates the exact candidate partition and makes the most advanced lifecycle row the keeper using `Hired > Offer > Interview > Responded > Rejected > Applied > Evaluated > Skip/Closed`. Equal-status copies of the same canonical posting use the most recent complete evaluation, then the highest ID, as the deterministic tie-break. The keeper retains its original report/HTML/PDF without renaming, while losing artifacts are backed up and archived and the decision is recorded in the duplicate ledger.
- `restore_orphan` for a valid evaluation whose tracker row was lost. Restoration prefers a matching preserved TSV under `users/{USER}/batch/tracker-additions/merged/`; the applier revalidates the TSV's row number and report link at mutation time because batch-slot filenames can be reused. When no TSV survives or its current contents no longer belong to the report, a complete report reconstructs the bounded tracker fields and the fallback is recorded in the action ledger. If its numeric prefix is already occupied, the applier assigns a fresh ID and renames the report plus matching HTML/PDF/TeX artifacts together.
- `archive_orphan` for a verified redundant or obsolete orphan. The report and matching outputs are backed up and moved under timestamped orphan archives.
- `patch_tracker` for an evidence-backed bounded correction to company, Via, canonical status, score, or report link on a uniquely identified tracker row.
- `manual_review` when no supported deterministic action is safe or user judgment is required.

The prompt reviewer is read-only and cannot mutate files. `apply-verification-review.mjs` and `resolve-verify-warnings.mjs` are the only mutation boundaries. Every action is written to a user-scoped append-only ledger and backed up before destructive movement or tracker rewriting.

The reviewer decides whether an orphan is valid, redundant, or ambiguous, but it does not author trusted filesystem paths. For `archive_orphan`, the runner derives the exact report path from the raw verifier finding and fixes `tracker_tsv` to `null`. Restore report paths are likewise fixed to verifier evidence. A supplied tracker TSV is canonicalized to the user-root-relative `batch/tracker-additions/merged/*.tsv` form and semantically validated; otherwise `tracker_tsv: null` selects deterministic report-derived reconstruction. A project-relative `users/{USER}/batch/...` path is never passed to the applier. Semantic validation reports all invalid decisions in the chunk together instead of stopping at the first item.

Duplicate findings use type-specific plans even when tracker and report warnings overlap. A `possible_duplicate_tracker` decision contains only tracker IDs; its report fields are mechanically cleared. A `duplicate_reports_same_role` decision contains only report files; its tracker fields are mechanically cleared. Both plans must still select the same canonical identity, and semantic validation checks their exact candidate partitions before checkpointing. This prevents a reviewer from passing a combined tracker/report object that the deterministic resolver would reject later.

URL identity removes standard source, referral, and feed tracking parameters before grouping. A stable terminal posting UUID also overrides a changed human-readable slug on the same host. If raw evidence still contains a strict nested duplicate group and a broader confirmed group already covers every candidate, only the maximal group may mutate state. The nested tracker/report findings are mechanically recorded as informational seen findings. This preserves the raw audit record while preventing overlapping resolver actions and keepers that fall outside a subset's exact candidates.

## Live progress

Review calls contain at most five findings. Reviewer concurrency resolves as explicit `--parallel N`, then the active user's `batch.parallel`, then `1`; the same resolved model and reasoning effort are passed to every reviewer. Findings with overlapping tracker/report/orphan identities stay in the same dependency lane and are reviewed sequentially with prior decisions as binding context, while independent lanes run concurrently. Reviewers are read-only and use distinct input, output, and log files. All repairs and ledger writes remain serialized in the parent after every lane completes and aggregate consistency passes.

Dependency components remain contiguous inside a lane so an exact tracker/report pair is normally reviewed in the same five-finding call. A contradictory paired response retries only that call with the consistency error as feedback. If the bounded retries still disagree, or either side requires human review, the whole exact pair is promoted to `manual_review` instead of failing the runner or applying half of a resolution. When both sides confirm a duplicate but select different equal-status keepers, the tracker keeper is authoritative and the report keeper is mechanically aligned to its linked report before mutation.

Pass reviews validate only findings active in that pass; exact duplicate pairs wholly settled by an earlier pass do not create missing-decision errors. If a repair changes one side's fingerprint or creates a new tracker-side warning while its exact report counterpart is already recorded as seen, the runner reactivates that counterpart and reviews the pair together. This prevents stale seen evidence from silently authorising a contradictory one-sided duplicate action.

Current tracker links and active report contents define present identity. Historical batch completion files are provenance rather than canonical state: they may expose a report-number collision, but a superseded reservation does not override an otherwise consistent current tracker/report pair. Orphan ownership is checked against the exact linked report filename rather than only its numeric prefix. When multiple active files share one prefix, the linked file retains that identity; each unlinked exact orphan is independently reviewed and either archived or restored under a fresh ID. The raw collision remains manual only when those bounded actions cannot make ownership safe.

Broad company/title warnings remain intact. When the reports reveal that only part of a broad group shares one canonical posting URL, raw verification additionally emits exact URL-matched tracker and report subgroups. Prompt review can resolve those proven subsets while marking the mixed broad group as a legitimate seen exception, instead of escalating the whole set.

If a legacy tracker has no Via column, reviewed verification first runs the deterministic Via schema migration and reverifies. Individual missing values then appear as bounded `missing_via_value` findings that the reviewer can patch from report evidence; schema absence no longer turns every confidential-employer row into manual review.

An invalid review retries only its five-finding chunk, with every semantic validation error supplied as correction feedback. The default is two retries and can be changed with `--review-retries N`. A chunk receives an atomic validated checkpoint only after its complete response passes normalization and semantic validation. No reviewed action is applied from a partially completed or failed pass.

Interrupted or operationally failed runs are ignored by a normal fresh invocation. An operator may explicitly continue one with `--resume-run RUN_ID`; only checkpoints whose user, findings, and prior-decision context exactly match their stored signature are reused. Checkpoint decisions are mechanically normalized and semantically revalidated on load, so compatible checkpoints created before a contract hardening can still resume safely. If duplicates were committed but the following apply step failed, the runner also reuses the exact-fingerprint-matched `verification.apply-*` and `review.applicable-*` artifacts, preserves the completed duplicate action result, and retries apply directly instead of reviewing the post-duplicate findings again. Raw reviewer output is never a resumable checkpoint. Use a fresh run when reviewer decisions should be discarded and recomputed.

Before the first phase, the runner prints `run-id: <RUN_ID>` and its `logs:` directory so an interrupted run can be resumed with `--resume-run <RUN_ID>`. After each call completes, it writes one compact stdout line per finding: `reviewed X/Y, job(s) #{related IDs}, {issue code} → {classification}`. Tracker IDs are preferred; report IDs are used for report-only and orphan findings. At the very end, still-unresolved non-manual findings are repeated with their level, related jobs, and issue code, followed by a separate compact block for still-active `manual_review` items. The blocks do not duplicate findings, so the operator can see all remaining work without searching earlier progress output. Full decisions, rationale, evidence, and action details remain in the run artifacts instead of flooding the terminal while a run is incomplete. A `completed` run is immediately compacted to one `summary.json`; every other status retains the detailed artifacts. The default final output is only a compact summary plus the actual failure text, when present. Pass `--json` for a complete machine-readable result; in that mode stdout contains only JSON and progress moves to stderr, with neither human recap added. `--quiet` suppresses live progress while retaining phase logs for non-completed runs and the run path in the final human summary.

## Completion

The runner loops through review, action, and raw re-verification for up to three passes by default. It returns:

- `completed` when every raw finding is either resolved or matched by an unchanged seen record;
- `partial` when reviewed findings still require human action;
- `failed` only for an operational, schema, validation, or mutation failure.

Report raw error/warning counts, previously seen counts, decisions made this run, deterministic actions applied, unresolved findings, backup/ledger paths, review retry/checkpoint/normalization counts under `review_resilience`, and final status. Do not describe a warning-only raw verifier result as a failed reviewed verification when every warning has a valid seen record.
