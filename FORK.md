# Fork Customizations

This file documents what this fork changes relative to its incorporated upstream base so future upstream updates can be merged without losing local behavior, and so local changes can be retired when upstream makes them redundant. The active customization sections describe current behavior; the adopted-upstream section records merge history rather than additional fork patches.

Generated from:

- Incorporated upstream base: `97f67c6cc56c0d1f65cc52fb7c5f3c59ad430812`, the merge base of `main` and `upstream/main`. The remote ref can advance independently of this incorporated base.
- Implementation snapshot: `3882777953c0c01a91b785f4c582de1392df177a`, the post-v1.37 upstream integration at `97f67c6c` with its compatibility repairs.
- Relationship to the incorporated base at that snapshot: upstream-only commits `0`, fork-only commits `281`.
- Diff size against the incorporated base at that snapshot: `867 files changed, 38085 insertions(+), 9345 deletions(-)`.

The refs and counts describe that committed implementation snapshot. A later documentation-only inventory refresh may follow it; no uncommitted implementation is included. Refresh the snapshot after subsequent implementation or upstream merges.

## Upstream integration at 97f67c6c

This update incorporates the 31 commits from `09a554802d4254942aeaf151682e3c824fc2684b` through `97f67c6cc56c0d1f65cc52fb7c5f3c59ad430812`, post-v1.37 main-branch work with no new release tag. Twelve files conflicted; upstream stays the baseline and the fork's per-user paths are re-applied around it. Nothing in the batch, liveness, reconciliation or verification lanes that `run` drives changed behavior, so the runner needed no adaptation.

- **Web profile override.** The web prompts now name the profile through upstream's `profileRef()`/`profileNote()` (`CAREER_OPS_PROFILE`, #5588). `web/src/lib/run-prompts.mjs` keeps the fork's absolute `systemRoot`/`userRoot` paths: with no override the prompts still name `users/{USER}/config/profile.yml`, and with one they name the override and prepend upstream's profile note to the runtime-paths preamble. The assistant prompt moved to upstream's `web/src/lib/assistant-preamble.mjs`, which carries the fork's `CLOSED`/`Closed` states. The batch lane still does not adopt `CAREER_OPS_PROFILE`, as recorded below.
- **Web telemetry.** `NEXT_TELEMETRY_DISABLED` (#5596) is set in `web/next.config.mjs` beside the fork's user-context imports, and in `web/server.mjs` beside its `webRoot` cwd.
- **New commands under the selected user.** `reeval-candidates.mjs` (#5672) resolves its data root through `getCareerOpsRoot()`, so it reads `users/{USER}/` with `--user` and refuses to run without a user. Because `users/` is gitignored, source changes are dated by file mtime and labelled approximate. AGENTS and `docs/SCRIPTS.md` list it, `filter-audit` and `coverage-check` with `--user {USER}` and `users/{USER}/` paths.
- **Docs.** The `set-status`/`outcome` selector wording (#5681: a bare number is the tracker `#`, `--report` names a report) keeps `--user {USER}`. The README quick start keeps the user-id step and adopts upstream's chat-driven setup in place of the manual copy steps, and keeps the per-user dashboard note beside upstream's tab and sort counts. `batch/README.md` keeps the fork's option table, with `--status --full` added, rather than upstream's separate progress table.
- **Tests.** `tests/flag-equals-form-parity.test.mjs` selects a fixture user and passes `upskill --json`, since the fork's `upskill` prints human output by default. `tests/modes-set-status-selector.test.mjs` scans `outcome.mjs` calls too and allows the fork's `--user {USER}` prefix.
- **Updater.** Upstream's dependency reinstall, its exit code 3 and its rebuild of `dashboard/career-dashboard(.exe)` when `go.mod`/`go.sum` change are adopted unchanged. Per-user dashboard binaries are still built by hand into `users/{USER}/`.

Validation: `node test-all.mjs --quick --jobs 8` passed 17,735 checks with 16 warnings. Its three failures are load-related, and each passes when run alone: the ownership-retries suite was killed at 120 s, and the worker-process and pipeline-lock suites failed. An earlier 16-job run timed out in other batch and run-flow suites, which also pass alone: queue flow 40/40 and interactive flow 26/26 under `node --test`. Under `test-all --only` those two exceed the 30 s limit for an in-process single suite. The web suite passed 1,821 tests, with 42 skipped. Raw `verify-pipeline.mjs --user fixture --json` returned clean against an isolated empty tracker, and `reeval-candidates.mjs --user` read a fixture users directory. Dashboard Go sources did not change. Paid evaluations, real providers and user data were not exercised.

## Upstream integration at 09a55480

This update incorporates the 63 commits from `8f489289b48cb5c99439da98aa4abbb524854aa4` through `09a554802d4254942aeaf151682e3c824fc2684b`, post-v1.37 main-branch work with no new release tag. Thirty-seven files conflicted; upstream stays the baseline and the fork's per-user, identity and runner guarantees are re-applied around it.

- **Batch.** Adopted `--company` (#5526) for standalone runs: it filters the selected input before `--limit`, and the runner rejects it with `--live-inputs`, because the coordinator's live pool picks its own postings. Adopted the zero-token JD rescue from structured page data (#5521), `--status --summary`/`--full` (#5525), dry runs without the agent CLI (#5559) and the throttle re-check before each launch (#5522). Upstream's `batch/company-scope.mjs` and `batch/jd-rescue.mjs` are called from `$SCRIPT_DIR`, since the fork's `$BATCH_DIR` is the user's batch folder. Not adopted: `--thin-action` (#5547), because the fork already makes one owned browser-extraction attempt and then hands a thin JD to the worker, which holds it as `jd_unavailable`; a terminal `skipped` without artifacts would drop a reserved report number outside the run's hold contract. Also not adopted, as before: `CAREER_OPS_PROFILE` in the batch lane (#5544, #5567), so `tests/batch-runner-profile-override.test.mjs` is removed. The shared fixture `tests/helpers/batch-runner-fixture.mjs` copies the owned runner scripts, selects `--cli claude` and a fixture data root, and the throttle test anchors the parallel launch (which carries the remaining count) and asks for three workers, since the fork defaults to one.
- **Pipeline headings.** Upstream's `lib/pipeline-sections.mjs` (#5520, every mode language) replaces the fork's `PENDING_HEADER`/`PROCESSED_HEADER` in `lib/pipeline-queue.mjs`; reconciliation and `sync-batch-input.mjs` use the same `sectionKind()`. Lines are trimmed before detection, as the fork's queue reader always did, so an indented heading still drains, and a created Processed heading follows the Pending heading's language.
- **YAML.** Upstream's `loadYaml()` (#5464), which reads a comment-only file as empty, now also backs the fork-only readers: `run-workflow.mjs`, `reconcile-pipeline.mjs`, `apply-verification-review.mjs`, `batch/validate-worker-artifacts.mjs`, `lib/agency-policy.mjs`, `lib/codex-config.mjs`, `lib/parallel-config.mjs`, `scan-auth/linkedin.mjs` and `generate-pdf.mjs`.
- **New commands under the selected user.** `apply-scope.mjs` (#5499), `onboard-write.mjs` (#5479) and `learn.mjs` consume `--user` before parsing their own arguments; `apply-scope.mjs launch-options` and `onboard-write.mjs --target` still need no user. The apply mode and its 18 localized variants, `retro` (#5485), the debrief sync step (#5509), the tracker query step (#5560), discard analytics, AGENTS onboarding (one writer call, then `doctor.mjs --user {USER}`) and `docs/SCRIPTS.md` pass `--user {USER}` and name `users/{USER}/` paths. `retro` writes only `users/{USER}/modes/_custom.md` or `_profile.md` and is registered in the router. The onboarding writer keeps the template's commented profession examples, which the fork's personalized `title_filter.positive` had dropped from `templates/portals.example.yml`.
- **Tracker.** Status hooks for reply-watch and dedup writers (#5536), `set-status.mjs --expect-row/--expect-status`, status history derived from `status-log.tsv` (#5555) and atomic `cv.md`/`portals.yml` replacement in `add-entry.mjs` (#5552) are adopted unchanged. Upstream's seeded round-trip suite (#5580) is adapted to the fork's identity contract: it has no reserved-number collision fixture, since the fork leaves such a TSV pending and exits nonzero, and a re-evaluation keeps the row's primary report link and names the newer report in Notes.
- **Other adaptations.** `openrouter-runner.mjs apply` locates reports with upstream's contained `locateApplyReport()` against the selected user's root; `openai-tailor.mjs` validates locked CV sections (#2082) while keeping report-linked names; plugin removal keeps the fork's earlier id guard with upstream's wording; the updater's single `lib/` entry covers the new `lib/` modules, and the two new batch modules are listed. The dashboard shows localized work modes (#5557) in the fork's flat pipeline, and the upstream test drops its grouped-view setup. Upstream's deletion of the unused web tracker lock is accepted.
- **Tests.** New upstream suites that spawn scripts now select a fixture user, matching the fork's user contract: apply scope, application-artifact markers (which apply only without a users-directory override), dry run without the CLI, status summary, company scope, cover-letter answers, plugin removal, tracker query, empty YAML, upskill (`--json`) and debrief/retro wording.

Validation passed `node test-all.mjs --quick --jobs 8` with 17,381 checks and 16 warnings; the one failure under that load was `tests/batch-recovery-ownership.test.mjs`'s 5 s wait for its fixture worker, which pre-merge HEAD also exceeds under the same parallel load, so the wait is now 15 s and the suite passes. All dashboard Go packages pass. Raw `verify-pipeline.mjs --user fixture --json` returned clean against an isolated empty tracker. The queue-flow, interactive, live-batch, parallel, throttle and ownership suites exercise the real Windows Git Bash runner and owned process trees. Web tests, paid evaluations, real providers and user data were not exercised.

## Upstream integration at 8f489289

This update incorporates the 192 commits from `77027cc5cb22f588ecba56a4d834afa58c8695ae` through `8f489289b48cb5c99439da98aa4abbb524854aa4`, covering the core v1.37.0 and web v0.15.0 releases plus post-release main-branch work. Ninety files conflicted; every resolution keeps upstream behavior as the baseline and re-applies the fork's per-user, `Closed`, identity and ownership guarantees around it.

- **Profile path.** Upstream's single `CAREER_OPS_PROFILE`-aware helper `getProfilePath()` (#5087, #5095) replaces every hand-built `config/profile.yml` path, including fork-only readers (`generate-pdf.mjs` theme overrides, `audit-portals.mjs`, `verify-portals.mjs`, `update-system.mjs`). The fork's helper validates the selected user before returning either the override or the user profile, so an override never bypasses user selection and there is no root-level fallback. Modules resolve it when called, not at import. Deliberate limitation: the `run`/batch lane (`run-workflow.mjs`, `verify-runner.mjs`, `batch/validate-worker-artifacts.mjs`, `lib/agency-policy.mjs` and the batch prompts) reads the selected user's own profile and ignores `CAREER_OPS_PROFILE`, so every phase of a run, including headless workers, reads the same file.
- **Locks.** `pipeline-lock.mjs` is now a wrapper over upstream's shared `lib/dir-lock.mjs` (#5389); the fork's copy of the protocol is retired. The fork's `ownerPid` option survives as an owner field spread after the protocol's own PID, so batch state and runner ownership (`staleMs: Infinity`) still judge liveness by the supervising process's native PID.
- **Batch.** Adopted the headless guard `CAREER_OPS_HEADLESS=1` and the prompt's rule against writing user rule files (#5455), `--cli grok` (#5473), closed stdin for prompt-as-argument CLIs, per-offer progress lines (#5212), empty-cell-safe state reads (#5338), economy tier → Haiku 5.5 (#5289), the job-facts cache (#4646) and the `**Decision:**` line (#5500). Upstream's Bash `run_worker` watchdog and 1800s default are retired; `worker-process.mjs` remains the only owner of timeouts (900s default, `0` disables) and Windows Job Object process trees, grok included. The dealbreaker gate (#5493) is adopted in the fork's contract: workers return `status: skipped`, `reason: dealbreaker` (now in `batch/batch-output-schema.json`, so Codex can emit it), the runner accepts it only when the single SKIP tracker addition matches the reserved number, posting, company and role with no report/CV/JD artifacts, records the quoted `Dealbreaker:` note in state, and keeps the reservation until the merge. `run` treats it as final and reports `batch_counts.dealbreaker`. Report JD archives stay embedded; upstream's archive-pointer fallback is not adopted. The batch prompt keeps one Machine Summary schema and loads Signals 19–22 and the report header (including the `**Decision:**` line) from `modes/oferta.md`, so upstream's tests for those were adapted through `batchCanonicalContext()`, as for Signals 16–18. A real Windows bug surfaced under load: `worker-process.mjs` deleted the launch payload in `finally` even when cleanup failed, while the PowerShell Job worker could still hold it open, masking the real cleanup error. The payload is now kept until the worker tree drains and is otherwise left to the stale-worker guard. The batch parity and recovery-ownership suites are each split across files (shared fixtures in `tests/fixtures/`) so every file finishes inside test-all's per-file node:test budget under parallel load.
- **Queue sync.** Upstream's `sync-batch-input.mjs` (#3442) duplicated `sync-pipeline-batch.mjs`/`lib/run-batch-sync.mjs` but wrote the checkout-level `batch/` without a lock. It is retired as an implementation: its pure helpers stay exported unchanged, and its CLI requires a selected user, rejects path overrides and forwards to the fork's locked, stable-ID synchronizer. The shared Pending header now also accepts German `Offen` and French `En attente`, and `reconcile-pipeline.mjs` reads the same Pending/Processed headers as the queue. Upstream's `isSafePublicHttpUrl` filter is not ported because fork rows include `local:jds/...` references and the queue, runner and prefetch already apply URL and local-path containment.
- **Unreadable JDs.** Upstream's `unreadable` bucket (#5409) is honored on both paths: `modes/pipeline.md` keeps `insufficient_content` items pending, and `pipeline-liveness.mjs` (the `run` path) no longer counts them as expired, so they are never moved to Processed or closed in the tracker. Their workers evaluate them or hold them as `jd_unavailable`.
- **Liveness.** Upstream's tracker-wide expiry (#5241) is adapted as `check-liveness.mjs --tracker --close-expired [--apply]` (alias `--discard-expired`, export alias `discardExpiredRows`). It writes `Closed`, never `Discarded`, only for a uniquely matched Evaluated row, re-checks before writing and passes `--expect-tracker`. It stays opt-in; `run` still sweeps only its pending inbox. Per-host browser spacing, once-per-run Ashby fetches and new API rungs are adopted unchanged.
- **Scan.** Adopted `preferred_languages` (#5285), recorded title-filter rejects as `skipped_title` (#2732), the stderr progress line (#5472) and unpinned `skipped_no_apply_control` rows (#4866). `scan-hn.mjs` keeps the fork's hand-off to `scan.mjs`, so every scan filter, blacklist and dedup applies, instead of upstream's shared admission gate (#5481); the other gate callers use the selected user's scan paths. A bug from the automatic merge is fixed: the reopen path lost its `appendFileSync` import, so Closed→Evaluated reopens would have silently skipped their status-log row; it now uses upstream's `appendLedgerRows`. `discover-new-companies.mjs` and `discover-ats.mjs` resolve the blacklist per selected user (#5333).
- **CV naming.** Upstream's `cv-{candidate}-{report}-{company}` output names (#5394, #5391) are redundant with the fork's report-linked `{REPORT_NUM}-{company-slug}-{date}` basename and are not adopted; only the report-qualified temp payload `/tmp/cv-{candidate}[-{report}]-{company}.json` is. The fact gate now runs on every renderer (#5348) and mode docs pass `--user {USER}` to `generate-latex.mjs`.
- **Modes.** Block G signals 8–22 load lazily from `modes/oferta-signals/` (#5229, plus new Ontario-seed signals); the fork's inline copies are retired. Adopted the hard-rule stop before Block A (#5466), unattended gate defaults (#5476), search-based pipeline reads (#5205), story-provenance rules (#5355) and the `language.output` rule (#5364). Vietnamese modes and 15 new Turkish modes are adapted to `users/{USER}/` paths, `--user`, report-linked CV names and `Closed`. Restored upstream text that earlier merges had dropped: `modes/pipeline.md` step 2f (`needs_confirmation` handoff) and CV-output placement, `modes/auto-pipeline.md`'s iframe note and `modes/oferta.md`'s `posted:` Notes rule.
- **Updater.** Template-variant preservation uses upstream's `snapshotConfiguredTemplateVariantsAcrossProfiles` (the fork's `dataRoots` code is retired): the profile in force, then every configured user's profile, with templates read from the system checkout. An unreadable non-active user's profile now warns instead of blocking; an unreadable active profile still blocks. The non-default-branch guard (#3923) is compatible with the fork's `main` updates and linked-worktree rerouting. `lib/` stays one updater path entry.
- **Web and dashboard.** Adopted CV Studio and single-bullet rewrite, the apply checklist with PDF-ready and follow-up seed actions, cover-letter drafts from reports, macOS/Linux scheduled scans and the worker-feedback work. New routes that bypassed the selected user (`pdf-ready`, CV Studio PDF-ready, employer discovery, `core-cli.ts`) now pass `careerOpsCoreEnv()` and the user data root, and `careerOpsCoreEnv()` hands children absolute profile/portals paths. The fork's web section scanner and private `runSetStatus` are retired in favor of upstream's core `sectionState` (plus a saved-preferences overlay) and `core-cli.ts`. `PIPELINE_TABS` includes `CLOSED`. The sh scan scheduler records the selected user. The dashboard adopts windowed rendering (#5506) without grouped headers and keeps reading whole reports for listing dates.
- **Session title (#5303).** Playwright `apply` stays in the root agent, so the root session renames itself after reading the JD; upstream's delegated-apply worker handoff paragraph is not adopted.
- **Updater coverage.** Upstream tests that expect per-module `lib/x.mjs` updater entries also accept the fork's single `lib/` entry. The fork's `recover-linkedin-holds.mjs`, previously unregistered, is now in `SYSTEM_PATHS`.
- **Launcher and CLI memory.** `npm run ui` (`scripts/ui-server.mjs`) passes the checkout as `CAREER_OPS_CODE_ROOT` and the selected user, and forwards a core data-root override as `CAREER_OPS_DATA_DIR`, instead of upstream's `CAREER_OPS_ROOT=<data root>`, which the fork's web reads as the system checkout. `remember-cli.mjs` accepts `--user`; the remembered CLI lives in the selected user's data-root `.env`.

Known gaps left as they were before this merge: pattern analysis counts `Closed` rows as pending rather than with discarded postings; the Windows `.ps1` web scheduler records no user; localized pipeline and `_shared.md` files still call several scripts without `--user`; the run queue's `validUrl` does not reject decimal or IPv4-mapped loopback forms.

## Upstream integration at 77027cc5

This update incorporates the 104 commits from `8aafd1252c14d08b00f0c4e8c2f7f778db80bce9` through `77027cc5cb22f588ecba56a4d834afa58c8695ae`. Core and web release versions remain v1.36.0 and v0.14.0; these are post-release main-branch changes.

- Evaluation adopts canonical recruiter-identity Signal 18, archived-JD fallback for keyword diagnostics, multiword skill extraction and protected source-of-truth context during compression. Batch workers load the current evaluation mode and explicitly run its report Keyword Coverage step. Their report schema remains defined once in `batch/batch-prompt.md`.
- Existing sources receive Recruitee requirements, publish dates and annualized salaries, stricter invalid-date rejection, SuccessFactors pagination/date fixes and bounded Feishu concurrency. Google Careers, Kalibrr and Tech in Asia are new optional providers. Google intentionally reads only the first results page per query. No existing user's portals are enabled or rewritten by maintenance.
- The fork retains argument → profile `batch.parallel` → one worker for both supported batch CLIs instead of upstream's new three-worker Claude default. Upstream's transient rate-limit throttle is adopted in both the static batch loop and the interactive live pool: remaining dispatch drops to one worker while active workers drain. Codex quota/session holds still need explicit recovery.
- Upstream's shared-checkout batch-state reads are adapted around per-user ownership. `reconcile-pipeline.mjs` and `dashboard/internal/data/career.go` read the selected user's batch input/state, including external data roots. Reconciliation refuses an explicit state path outside that root. A shared checkout's batch files never supply another user's progress or posting URL.
- Web evaluation agents now return a report envelope without Write/Bash permission. The backend runs the real allocator, `persist-evaluation-report.mjs`, merger and reservation release from the system checkout with the selected user's data environment. The writer requires an explicit user. CV Studio's new edit-model/API storage is user-scoped at `.career-ops-web/cv-studio/`; rendering and tracker updates use system scripts with the same selected-user environment. The fork's decision-signals table is retained alongside upstream score levers, card reasons and interview-prep questions.
- Follow-ups can be disabled through `follow_ups.enabled: false` in the selected profile. Applied transitions seed from the real transition date rather than the old evaluation date. Web follow-ups include upcoming entries; Today gains persisted snoozes, clearer decisions and Apply-next links, and pipeline rows support comparison and bulk status changes. Go and web active-application metrics now count only Applied, Responded, Assessment, Interview and Offer.
- Upstream's reevaluation PDF re-key helper is retired here because the fork preserves the primary report identity. A dead PDF-index entry cannot preserve a readiness check; a live original PDF stays attached to its original report while newer evaluations remain linked in Notes.
- `check-liveness.mjs --user {USER} --tracker [--status=Evaluated,Applied]` is an optional tracker-wide diagnostic with human and JSON output. `run` still checks its pending inbox automatically; it does not broaden that sweep to all Applied/Evaluated tracker rows or close an active application merely because its posting expires.
- The new optional LaTeX installer is available as `node install-latex-engine.mjs`. Interactive modes ask for consent before downloading. Headless `run`/batch workers never authorize an installation themselves: missing engines remain a manual prerequisite, surfaced through the existing failure/retry action. Workspace MCP remains a separately installed, opt-in plugin.
- Fork providers now use the shared `BROWSER_LIKE_USER_AGENT` instead of embedded browser identity literals. Upstream's test data-root sandbox and drift guard are retained alongside fictional-user fixtures; each fixture explicitly selects its own layout instead of inheriting the suite's scratch root.

Compatibility evidence includes the real Windows Git Bash/CLI path, owned process-tree cleanup, executable queue and interactive fixtures, live-pool throttling and real web report persistence through core scripts into an external fictional user root. Raw pipeline verification uses an isolated fictional user. Paid evaluations, real providers, user profiles and POSIX-only containment were not exercised on this Windows host.

Validation for this integration passed `node test-all.mjs --quick --jobs 8` with 15,240 checks, zero failures and 14 warnings, all dashboard Go packages, 1,570 web tests with 16 optional skips, and a production web build without an active user. The warnings cover missing user fixtures, upstream maintainer-text matches, opt-in live/token checks and Windows permission/symlink limitations. Focused queue/interactive/CLI/process-tree suites and the real web-to-core persistence fixture passed. The latest tracker-liveness JSON, missing-tracker and mixed-input checks also passed. Raw `verify-pipeline.mjs --user fixture --json` returned clean with zero warnings/errors against an isolated empty tracker; it does not certify a personal pipeline.

## Reviewed compatibility repairs

The full fork review adds production-boundary checks beyond the original runner fixtures:

- Liveness now exposes the JSON interface the coordinator consumes. Expiry closes only the exact posting's Evaluated row, with a tracker snapshot precondition; later application states remain intact.
- Verification snapshots and repair planning occur under the tracker lock. Saved reviews bind to the selected user, root, tracker, and current evidence; field-specific patches cannot alter unrelated cells. Manual duplicate decisions remain binding across overlapping groups and resumptions. Resumed action results require matching input hashes, and orphan restoration reserves report IDs through the shared allocator.
- Reviewed verification and batch processing share authoritative ownership. On POSIX, worker cleanup covers the worker's process group and descendants reachable through the ancestry snapshot taken at stop or close. A descendant outside that group and already reparented away from the launcher's ancestry is outside verifiable containment; successful cleanup does not prove it stopped. Windows workers belong to an owned kernel Job, whose members are drained before recovery or ownership release. Explicit manual JD text survives missing local captures, completed scores must agree across artifacts, and failed final results cannot become recovered completions.
- Duplicate repairs compare posting identities and report references against fresh evidence under the tracker lock. Partial manual holds cross tracker/report boundaries; a broad mixed-posting exception still permits an independently proven exact subgroup. Cross-type subgroup comparison requires complete tracker-to-report mappings in the shared report identity domain; manual holds, equal-set exceptions and ambiguous mappings remain binding. Pending action reuse binds to the pending input generation, and name-scoped verification findings retain stable identities when neighboring findings disappear.
- Batch supervisors are owned before worker registration. Windows workers join an owned Job Object before executing, and normal launcher exit drains its Job members before validation. Owned launch JSON files preserve argv capacity and worker stdin. Failed cleanup persists evidence and returns a fatal outcome independently of child closure; the parent skips a failed-stop wait and attempts other cleanup before retaining ownership. Sequential preparation and quarantine failures stop the run before merge. Worker timeouts accept finite nonnegative seconds, including zero to disable and fractional values.
- The coordinator retains separate bounded stdout and stderr buffers so a late progress burst cannot erase the useful failure diagnostic. JSON parsing and merge-result checks continue to consume stdout.
- Batch state transactions use native OS owner PIDs and ownership tokens through the shared lock protocol. Git Bash PID mismatches cannot reclaim a live writer. State rewrites use one atomic replacement with a unique temporary file instead of per-row shell appends, preserving unrelated rows and empty TSV fields while supporting concurrent workers.
- Headless batch preparation validates an exact queue once and selects its matching input rows in one pass. Large historical inputs no longer start a Node process and revalidate every local capture for each historical row. Queue and answer files remain read-only; user, URL and local-path containment checks still apply.
- Web CV template selection reads the selected user's profile even when the web process uses `CAREER_OPS_ROOT` for the system checkout. CLI LaTeX output checks canonical containment, PDF theme insertion preserves literal CSS values, and dashboard report URLs take precedence over synthesized company URL fallbacks.
- OpenRouter help routes before selected-user context, environment-file loading or model discovery. Bare `help` is a command; an operand such as `evaluate help` still requires a selected user. Plugin removal validates a plain slug before deleting files or changing configuration.
- Scans reopen only eligible pre-application rows after a matching live rediscovery, preserve recorded URLs and evaluation dates, write the canonical transition ledger under the tracker transaction, and use liveness before reopening when requested. Authenticated scans share canonical queue/history admission and persist missing-JD holds. HTML provider shape changes fail visibly, optional browser subresources do not abort an otherwise valid board, and pagination/categories retain posting identity.
- Web workers load modes, templates, executable scripts, and shared locking code from the system checkout while keeping facts, tracker writes, PDFs, and manifests beneath the selected user root. Explicit data-root and marker layouts are supported. Dashboard refreshes retain report metadata and date ordering; posting URLs outrank company fallbacks. Dashboard actions carry the validated selected user even when its data folder has another name, and a per-user binary takes precedence over the working directory when inferring its owner.
- Answer reads require user context and contained report paths. CV outputs reject symlink escapes, LaTeX arguments resolve the user before positional parsing, template defaults resolve the current profile lazily, and plugin management uses system templates with per-user installations and consent records. Reevaluations preserve the primary tracker/report identity and link the newer evaluation in Notes; reportless rows receive their first report link.
- Agent instructions consistently resolve the user data root, local JD references, brief files, and tracker-addition links. Updater template preservation reads each configured user's profile and preserves templates from the system checkout. User-data guards permit only exact system scaffolds and named batch modules.

Validation uses disposable fictional users and offline provider/worker fixtures. Paid production evaluations, real providers, and user datasets are outside this review's validation scope. Windows process-tree and Git Bash behavior are exercised natively; POSIX-specific process-group tests require a POSIX host.

## Merge Policy

Upstream changes are the baseline. When merging future `upstream/main`, keep the new upstream behavior by default and adapt the customizations below around it.

Do not place user-specific data in system-layer files. Candidate data, targeting, proof points, portals, reports, outputs, and interview prep belong in the per-user layer defined by `DATA_CONTRACT.md`.

Do not hardcode local user IDs in tracked/system files. Use placeholders such as `{USER}`, `<username>`, or `<id>` outside the ignored `users/{USER}/` folder.

After each upstream merge, re-run this inventory:

```bash
git fetch upstream main
base=$(git merge-base main upstream/main)
git diff --stat "$base"..main
git diff --name-status "$base"..main
git log --oneline --left-right --cherry-pick upstream/main...main
```

Use the merge-base diff to inventory fork changes. The left/right log separately shows incoming upstream work and outgoing fork commits. Then update this file if a customization is added, removed, or made redundant.

## Adopted upstream behavior and merge history

This inventory incorporates core v1.37.0 and web v0.15.0 plus post-release main-branch changes through `09a554802d4254942aeaf151682e3c824fc2684b`. Older entries below describe earlier merges. The current fork keeps explicit user selection and adapts upstream data-root support around that requirement.

The entries below record successive upstream merges and their conflict resolutions. Release references and validation counts belong to those historical merges. The active sections that follow define the customization requirements to preserve today.

New upstream features or behavior now present:

- Core v1.27 through v1.36 and web v0.14.0 are adopted across 1,556 incoming commits. Current additions include a source-backed Master Career Profile, calibration and keyword coverage, richer evaluation evidence, CV title/chronology checks, ATS and text CV variants, template packs, and ordered multi-market context. Intake and profile changes retain their explicit confirmation and provenance requirements.
- Scanner updates include new providers, configurable field whitelists, history-derived ATS seeds, requisition/location/language-aware dedup, budgeted partial results, filtered-posting diagnostics, and dead-board recovery. `scan.mjs` retains the fork's closed-posting reopen behavior around these newer dedup decisions; different requisitions and language versions retain upstream's separate-posting behavior.
- Batch execution adds OpenCode, Gemini, and Qwen alongside Claude and the fork's Codex backend. Upstream supplies cached system prompts, adaptive backoff, header-aware additions, and agency-confirmation holds. The fork keeps bounded workers, per-user bookkeeping, reserved report identity, and cross-artifact validation. A confirmation hold is reported separately and never becomes a completed evaluation or an automatic retry.
- CV and document rendering adopts kinded PDF-index rows, so a report's cover letter and CV no longer evict each other. Shared renderer containment, manifest locking, page-format support, title checks, chronology checks, and template-pack validation are upstream behavior. The fork retains `cv.theme`, report-linked styled-CV filenames, relevance filtering, and its two-page/3–4-project mode defaults. An explicitly selected external template pack is now supported; the old system-template-directory-only compiler restriction is retired.
- Dashboard updates include Assessment, source-faithful missing-score rendering, status-history metrics, dimension statistics, and canonical status writes through `set-status.mjs`. The fork keeps its OPEN-first tabs, tracker-number display/sort, listing-date DATE column, and lazy report loading. Statistics enrich report archetypes when opened rather than on every pipeline refresh. Manual status transitions retain a dated interaction note alongside the upstream ledger and follow-up behavior.
- Web updates include scheduled scans, persisted assistant conversations, expanded analytics, inline pipeline status controls, origin/host guards, worker fencing, cost confirmation, and the upstream semantic verdict callout. These operate on the selected user's files. The fork keeps mandatory `CAREER_OPS_USER`, a userless build phase, system/data separation, Job ID display, and the Machine Summary decision-signals table.
- Shared path and CLI handling now accepts `--user` on newly added native scripts, validates the user before data-root selection, and propagates selection to child commands. Normal data remains under `users/{USER}/`; explicit data-directory overrides require a valid selected user and are layout overrides, not user inference. `tests/user-fixture.mjs` adapts flat upstream fixtures to that same selection contract.
- Doctor's JSON command is now read-only by default; `--init-templates` performs onboarding template initialization. This retires the earlier automatic-copy assumption. Shared state fallbacks derive from the canonical UI state list, with the fork's Closed state included, rather than maintaining another alias list in the web ACL.
- Reviewed verification retains stable JSON finding IDs, report-file ownership, canonical posting-URL subsets, collision errors, and duplicate/orphan repair boundaries. Incoming JD-archive coverage is exposed as additional typed findings; these checks do not reinterpret a missing archive as an evaluation success.

- v1.26.0 and a total of 156 upstream commits since the prior baseline are adopted. The release adds rejection-latency signals, rejection-aware invite matching, pay-transparency and minimum-wage review prompts, `join.com` and additional zero-auth providers, CV/cover safeguards, scanner path overrides, and broader Unicode-safe matching; post-release work adds intake, relevance ranking, tracker/interview drift checks, failed-scan accounting, requisition-age visibility, and extensive runtime hardening.
- Local intake and prioritization are adopted: `intake.mjs` extracts source-annotated proposals from user documents, `rank-pipeline.mjs` provides an opt-in LLM relevance annotation, `rejection-latency.mjs` reports a descriptive courtesy signal, and `tracker-sync-check.mjs` detects interview-state drift. Their normal paths are adapted to `users/{USER}/documents/`, `users/{USER}/data/`, and `users/{USER}/config/`; none reads or writes another user's files.
- Sourcing gains Eightfold and join.com plus stronger Getro, Jobvite, Workday, Workable, Personio, Phenom, CSOD, Oracle, Softgarden, Radancy, The Muse, and RSS handling. Shared entity decoding, retry behavior, scan-history locking, failed-run records, deterministic URL dedup, and Unicode-aware company/role keys are composed with the fork's active-user pipeline/history/cache paths and closed-duplicate reopen semantics.
- Dashboard and web surfaces now expose requisition age through the upstream `POSTED` date while preserving the fork's existing listing-date and contact-date columns. The web Apply flow can return to its origin and record an application, status writes take the core tracker lock, headless CLI launches close stdin consistently, Codex JSONL/exit status stays authoritative, and the runtime picker includes Grok Build and default-path OpenCode discovery.
- CLI and dependency hardening is adopted: shared flag validation now rejects misspellings before reads or writes; `js-yaml` imports work across the supported 4.x/5.x range; updater local-edit detection tolerates line-ending-only differences and restores deleted system files; archive capture keeps SSRF/private-network guards; and pipeline/state locks handle contention, jitter, retry, and recovery records without shifting empty TSV fields.
- Candidate-content fidelity improves across non-Latin headings, role matching, STAR matching, status aliases, CV scalar rendering, skill extraction, JD requirements, allowed-metric synonyms, theme dollar patterns, and Ollama profile context. These changes remain bounded by the fork's source-of-truth contract: claims still come only from the active user's allowed files.
- Concrete reconciliation in this merge preserved fork-only behavior where upstream intentionally differs: re-evaluation keeps the established tracker/report/PDF identity, `Closed` remains a distinct lifecycle state, dashboard listing date remains available alongside upstream requisition age, web/core roots remain split between system code and active-user data, and every new candidate-data CLI requires or derives an explicit user.
- Validation after reconciliation covered 4,113 core assertions, all dashboard Go packages, 254 web tests, a production Next.js build, and `verify-pipeline.mjs` against a seeded disposable user. The only core-suite warning was the expected live archive-render skip when no Playwright browser executable was available.
- v1.25.0 and web v0.6.0 are adopted. The release adds Awards & Honors as an optional CV section, deterministic CV visual-regression fixtures, safer partial fallbacks and dollar-pattern replacement, cover-letter signatures plus unresolved-token rejection, live web state-file reloads, expanded sourcing providers, scanner flag/window controls, tracker data-loss fixes, and dependency/security maintenance.
- CV and document workflow: Awards & Honors flows through the HTML and LaTeX builders and templates, and the opt-in hiring-manager audit can review a finished CV without becoming a factual source. Conflict resolution keeps the fork's active-user output containment, flat report/tracker/PDF identity, 3-4-project preference, relevance-based experience filtering, and strict user-source boundary; the new audit instructions use only `users/{USER}/...` inputs and outputs.
- Cover letters now compose the shared writing guidance, accept an optional `letter.signature`, and fail if any template token remains unresolved. The fork retains active-user profile/template selection and report-linked output under `users/{USER}/output/`; no sending or submission authority was added.
- Provider and scanner expansion: Getro, Consider, Joinup, Manfred, and Remotli join the registry; Arbeitsagentur v6, Workable, The Hub, a16z Speedrun, and shared HTTP behavior gain parsing, pagination, retry, and truncation fixes. `scan.mjs` and reverse-ATS scanning accept shared `--since`/`--flag=value` forms and explicit output-lane overrides while normal runs still derive portals, profile, pipeline, history, cache, checkpoint, and debug paths from the active user.
- Tracker reconciliation now writes lower-score and equal-score re-evaluations through instead of silently preserving stale optimistic data, retains accumulated Notes, refreshes its same-run cache, and hardens Unicode, requisition-number, orphan, duplicate, and reserved-number handling. The fork deliberately keeps row #N/report #N/PDF #N identity on re-evaluation; a colliding reservation stays pending and exits nonzero rather than being renumbered or reported as success.
- Doctor and portability updates are adopted: billing-source diagnostics, JSONC parsing for OpenCode configuration, CRLF normalization through `.gitattributes`, source NUL checks, and related documentation/test coverage. All candidate-facing diagnostics remain active-user scoped.
- Web v0.6.0 reloads canonical states when the system state file changes, using the resolved career-ops system root rather than a process-cwd assumption. The fork retains its distinct `Closed` lifecycle and per-user data selection while adopting the new explore/today refresh behavior.
- Concrete conflict resolution in this merge touched batch orchestration, scanner path/flag composition, tracker merge and PDF synchronization, doctor/updater/validator CLIs, CV/cover/interview/PDF mode instructions, Arbeitsagentur, web state loading, and the consolidated test harness. Every new normal data path was adapted to `users/{USER}/`; explicit environment/file overrides remain narrow fixture or non-standard-layout lanes.
- Retired as independent fork deltas because upstream now owns them: lower/equal re-evaluation write-through, requisition-number-aware fuzzy dedup, Notes preservation across re-evaluations, same-run merge-cache refresh, and the new CV dollar-pattern/partial-fallback fixes. Fork-specific behavior remains active-user routing, artifact identity preservation, collision failure semantics, and source/output containment.
- v1.24.0 application lifecycle additions are adopted: deterministic JD similarity and versioned application artifact bundles, the `outcome` workflow with append-only outcome archives, transition-ledger writes from `set-status.mjs`, a two-pass `triage` mode, and the weekly interview digest. Conflict resolution keeps flat report-linked CV/PDF names as the canonical compatibility path and roots every normal CLI artifact under `users/{USER}/`; explicit path overrides remain available only for fixtures and non-standard layouts.
- Jurisdiction-aware compliance tables and `check-table-freshness.mjs` are adopted for protected grounds, prohibited application content, immigration-status overreach, agency licensing, and restrictive covenants. Templates remain system data; the review threshold is read from `users/{USER}/config/profile.yml`, and the evaluation/apply modes retain neutral, source-tiered, not-legal-advice language.
- Contacts and follow-up intelligence are adopted: `contacts.mjs` provides a user-owned TSV phonebook plus vCard export, follow-up cadence reports exact/estimated/fallback application-date provenance and cold applications, and the web v0.5.0 follow-up workspace can log/pin dates. Contact PII, follow-up logs, interview sessions, question banks, and vCards are all routed through the active user's folder.
- Scanner and provider updates are adopted: Interamt Playwright scanning, a16z Speedrun and Cryptocurrency Jobs providers, reverse-ATS iCIMS coverage, normalized-company scan history, resolver-outage circuit breaking, DNS pacing, target-aware location matching, and a cross-process portal-health lock. The fork configures the imported scanner with the active user's portal, history, pipeline, cache, checkpoint, and debug-output paths before any read or write.
- Portal repair and runtime diagnostics are adopted: `fix-slugs.mjs` reuses the read-only verifier's suggestions, and `doctor.mjs` resolves Playwright MCP configuration per CLI while explicitly distinguishing project config from runtime tool discovery. Normal portal and doctor commands still require an active user; `--file`/`--target` are narrow fixture and non-standard-layout escape hatches rather than root-user fallbacks.
- CV claim safety now extends the nonmetric fact gate to cover letters, and the PDF workflow gains `mark-pdf-ready.mjs` plus nested application bundles. The fork passes the active user's CV/article/profile sources into the fact gate, preserves the strict two-page and 3-4-project defaults, and updates the tracker only after a confirmed render.
- Dashboard and web status propagation now include upstream `Hired` fixes while preserving the fork's distinct `Closed` lifecycle. Conflict resolution added `Closed` to every web state/tab/funnel fallback and removed a duplicated `Hired` dashboard switch case; both terminal success and pre-application closure now render and count consistently.
- Batch workers now expose schema-constrained terminal status, so a worker-reported failure can no longer be treated as completed merely because the process exited zero. The fork retires that old exit-code-only assumption but retains cross-artifact validation as final authority, report-number reservations, detailed recovery diagnostics, and the rule that failed work does not release identity for unsafe reuse.
- New fork adaptation in this merge: all newly introduced candidate-facing CLIs (`application-artifacts`, `company-funded`, `contacts`, `outcome`, `weekly-digest`, `scan-interamt`, `mark-pdf-ready`, portal verification/repair, and compliance freshness) now accept the shared active-user contract. No new root-level candidate-data compatibility layer was added.
- Retired as independent fork deltas because upstream now owns them: web-wide `Hired` propagation, portal-health mutual exclusion, and recognition of worker-reported batch failure. The remaining fork differences in those areas are limited to `Closed`, active-user routing, and stricter artifact/identity validation.
- v1.23.0 sourcing expansion: iCIMS, VDAB, and Flowxtra providers, resumable reverse-ATS sweeps, profile-derived VDAB keywords, better provider health classification, DNS caching, and URL-aware location matching are adopted. The merge passes the active user's profile path into provider context and keeps all portal, checkpoint, pipeline, and scan-history state under `users/{USER}/`.
- Agentic Engineering Jobs now uses upstream's documented REST API implementation. The fork's July 2026 HTML-card parser and its markup-specific regression cases are retired because the upstream API supplies equivalent structured title, company, location, work-model, date, and dedup behavior without scraping page markup.
- Company and ATS discovery tools: `company-history.mjs` adds descriptive responsiveness/repost evidence cards, while `discover-ats.mjs` resolves company lists into scannable ATS entries. Both normal CLI paths require an active user; history reads `users/{USER}/data/`, and discovery writes only `users/{USER}/portals.yml`.
- Scanner integrity: cross-process pipeline locking, normalized-company persistence in scan history, country-eligibility filtering, URL hints for ambiguous location filters, expanded portal-health error categories, and resumable reverse scans are adopted. Conflict resolution composes these with the fork's company filter, closed-duplicate reopen semantics, active-user caches, JSON stdout discipline, and import-safe company normalization so importing `scan.mjs` never requests a user or emits CLI output.
- Work-authorization gating: evaluation and batch prompts compare JD sponsorship language with structured `location.authorized_in` and `location.needs_sponsorship`, quote the posting verbatim, and distinguish sponsors, not-needed, unstated, and no-sponsorship outcomes. Candidate work rights continue to come only from `users/{USER}/config/profile.yml`.
- Context and batch controls: the context-budget compressor, deterministic golden-budget analysis, `batch-tailor.mjs`, and `sync-pdf-flags.mjs` are adopted. New CLI utilities require `--user` or `CAREER_OPS_USER`, and their reports, batch state, tracker, and PDF manifest paths are derived from the selected user. `merge-tracker.mjs` explicitly propagates its resolved tracker and PDF manifest to the sync child so fixture and active-user layouts behave identically.
- CV composition and theming: reusable HTML section partials, optional-section coverage, resume-subheading LaTeX compatibility, and profile `style:` tokens are adopted. The shared renderer receives `users/{USER}/config/profile.yml` explicitly; it no longer falls back to a root-level profile when called without user context.
- Interview and localization coverage: Dutch market modes, Brazilian Portuguese interview plan/practice/debrief modes, transcript persistence, the Tamil README, Cursor skill discovery, and OpenCode/Kimi entrypoint improvements are adopted. All newly added candidate-data references were rewritten to `users/{USER}/...`.
- Dashboard updates: the `Responded` status/tab, compensation parsing fixes, localized labels, and related derivation tests are adopted while preserving the fork's per-user binary layout, distinct `Closed`/`Hired` states, lazy report hydration, and forward funnel tabs (`Open`, `Applied`, `Responded`, `Interview`, `Offer`, ...).
- Web and dependency maintenance: web state/company helpers, release workflows, dependency updates, and the upstream `postcss`/`sharp` security overrides are adopted. The reconciled web package lock is regenerated from the merged manifest.
- Safer tracker status targeting: `set-status.mjs --role` now validates even a lone company match before mutating it, distinguishes symbol-bearing titles such as C# and C++, and fails closed with a structured `role-mismatch` unless the caller explicitly uses `--force`. The fork keeps this behavior on `users/{USER}/data/applications.md` through its existing active-user resolver.
- Multi-brand SuccessFactors support: `providers/successfactors.mjs` preserves brand/tenant path prefixes when deriving RMK tile, jobs, search, and job-detail URLs, while avoiding doubled endpoint segments. The provider remains stateless and runs through the fork's active-user portal configuration and scanner state.
- Updater materialization verification: `update-system.mjs apply` now distinguishes expected upstream-absent manifest paths from real checkout failures, keeps expected Git pathspec errors quiet, recursively verifies the target manifest reached disk, and reports a required second pass instead of claiming a partial update succeeded. The merge retains the fork's broader system-path inventory and user-layer rollback safeguards.
- Onboarding diagnostics: missing CV, profile, mode profile, or portals prerequisites now appear as non-fatal setup warnings in the human doctor checklist rather than failed runtime checks. Conflict resolution preserves the active user's full `users/{USER}/...` path in each warning, while the separate machine-readable `onboardingNeeded` contract continues to gate career-ops modes.
- Localized Risk Summary parity: Arabic, Japanese, Turkish, Simplified Chinese, and Traditional Chinese evaluation modes now carry the same fixed five-signal Risk Summary block as the default evaluation mode. The fork routes each red-flag source lookup through `users/{USER}/interview-prep/` while retaining report-relative links.
- Plugin and release integration: the canonical Claude-compatible plugin manifest now declares the career-ops skill and is mirrored byte-for-byte under `.github/plugin/` for the awesome-copilot validator; Release Please updates both copies and the quick suite detects drift. Web CI now runs the web unit tests before typecheck/build.
- Documentation and language surface: the Turkish README joins the localized documentation set, Spanish accents and the LaTeX script invocation are corrected, Cowork setup notes reflect first-party verification, and the public signature ledger gains five entries. These changes do not alter active-user routing or candidate-data ownership.
- v1.22.0 provider expansion: Alibaba, Agentic Engineering Jobs, Gem, Jobvite, and Welcome to the Jungle join the zero-token provider registry, while Arbeitsagentur and SmartRecruiters receive parsing fixes. Providers remain system-layer code; configuration and resulting pipeline/history state remain under `users/{USER}/`.
- Scanner precision and persistence: `scan.mjs` adds absolute `--posted-after` / `--posted-before` windows, visa-sponsorship filters, cosmetic URL normalization, and company+role dedup seeded from the active user's tracker, scan history, and pending pipeline. The merge composes those gates with the fork's company/location filters and closed-duplicate reopen behavior, so a rediscovered closed role still updates its original row instead of creating a second application.
- Shared tracker-writer transactions: upstream supplies one filesystem lock/atomic replacement implementation for tracker writers and the Go dashboard. The fork keeps the full read/modify/write transaction but derives the lock from the canonical active-user tracker path; fixture overrides remain test-only and `Closed` remains a distinct canonical fork state alongside upstream `Hired` fixes.
- Token accounting: evaluator and batch logs now record per-step prompt, completion, cached-token, provider, model, and estimated-cost data. `batch/aggregate-tokens.mjs` is adapted from upstream root paths to `users/{USER}/batch/` and `users/{USER}/reports/`, and `batch-runner.sh` always passes its resolved user explicitly.
- Output-language parity: Gemini, Ollama, OpenAI-compatible, and OpenRouter evaluation paths load the active user's `language.output` and inject it into generated prose while retaining market-mode vocabulary independently. The fork preserves user-scoped CV/profile/report paths and import-safe helper tests.
- CV/PDF rendering controls: optional Education and Projects sections are removed through one shared core, profile photos are resolved safely for deterministic HTML and preview output, PDF rendering exposes page-budget warnings plus `--strict-pages`, and the new Simplified Chinese template/typography tests are adopted. Generated preview/HTML/PDF/LaTeX artifacts remain contained under `users/{USER}/output/` with report-linked names.
- `/expand` evidence discovery: the new confirm-before-write mode can inspect only public URLs already linked from the active user's profile, dry-run exact serialized payloads through `add-entry.mjs`, and add approved evidence without rewriting existing entries. The fork rewrites its source and command examples to `users/{USER}/...` and `--user {USER}`.
- Release and integration surface: v1.22.0 metadata, Cowork documentation, plugin/release workflow updates, Kimi entrypoint parity, and Simplified Chinese interview modes are adopted without widening the candidate-data source-of-truth boundary.
- Unified company Risk Summary: evaluation and batch reports now close Block G with a fixed five-signal summary covering posting legitimacy, employment classification, culture, interview red flags, and AI/infrastructure consistency without adding new judgment. The same values are preserved as a nested `risk_summary` Machine Summary map for downstream analysis; interview-redflag links and source files remain under `users/{USER}/interview-prep/`, and reports remain under `users/{USER}/reports/`.
- Scanner trust persistence: `scan.mjs` now surfaces flagged trust scores and reasons as a labeled `trust:` pipeline segment and appends score/flag columns after `postedAt` in `users/{USER}/data/scan-history.tsv`. Clean postings and scans without `trust_filter` keep the pipeline row unchanged, while pipeline triage can feed flagged trust evidence into Block G before evaluation.
- v1.21.0 release and attribution updates: release metadata and changelog entries are adopted, the updater's manifesto URL now carries `utm_source=updater`, several localized READMEs gain author-entity parity, and `SIGNATURES.md` gains one community signature. These release and documentation changes do not alter active-user routing or candidate-data ownership.
- README wordmark and language navigation: all 15 localized READMEs replace the text heading with an adaptive light/dark SVG wordmark, add the standalone project logo asset, center the language selector, and move Spanish into the second position. `SIGNATURES.md` also gains one community signature. These are presentation-only changes and do not alter the fork's runtime, active-user routing, or candidate-data boundary.
- Community review governance: `MAINTAINERS.md` names the first community Reviewer and defines the areas where that review can unblock merges, while `docs/REVIEWING.md` provides a short doctrine-led checklist covering the data contract, tests, scope, behavior changes, security, and contributor tone. This is documentation-only and does not alter the fork's runtime, user-data routing, or maintenance workflow.
- Portal health history and coverage decay: `scan.mjs` now appends per-target `reachable`, `empty`, `slug_gone`, or `network` observations and escalates only after the configured consecutive-failure threshold; `stats.mjs` exposes persistently dead configured portals. Conflict resolution moves `portal-health.tsv` from upstream's root `data/` default to `users/{USER}/data/`, keeps `--dry-run` write-free, and prints `verify-portals.mjs --file` commands against the active user's `portals.yml`.
- Interview-round compensation continuity: `salary-gap.mjs` accepts append-only `stated` observations with optional round and interviewer fields and exposes `--stated-for <tracker#>` without folding those statements into salary-gap math. `modes/interview-prep.md`, `modes/interview/plan.md`, and `modes/interview/debrief.md` now carry prior statements between rounds; the fork preserves human-readable default output, requires `--user {USER}`, and routes the log through `users/{USER}/data/salary-observations.tsv`.
- Oracle Recruiting Cloud scanning: `providers/oraclecloud.mjs`, its provider tests, and the example portal entry add zero-auth ORC discovery with pagination, location normalization, and provider-registry coverage. The provider remains stateless and runs through the fork's active-user scan configuration and pipeline/history paths.
- Application integrity reminders: `modes/apply.md` now warns when the candidate has prior applications at the same company, recommends checking retained ATS profile history, and expands confirmed resume-truncation follow-up to other in-flight applications through the same detectable or user-confirmed vendor. All tracker/report lookups remain under `users/{USER}/` and the mode still never logs into an employer portal on the candidate's behalf.
- Interview-process learning: coffee-chat notes can be cross-referenced against interview intel, named multi-panel rounds reuse the Panel Intel table, and `interview-redflag` adds a separate scope/compensation mismatch observation plus a copy-only blacklist suggestion at Reconsider level. The merge removes GitHub PR references from candidate-facing templates and rewrites all new session, JD, output, profile, and blacklist paths to the active user's layer.
- Communication and evaluation guidance: `modes/email.md` adds a short confirmed-time no-show follow-up variant; `modes/oferta.md` adds a non-scoring benefits/employment terminology country-mismatch signal. Both remain draft/advisory behavior and do not broaden submission or application authority.
- Localized pipeline extraction guidance: all 17 localized pipeline modes now mention the opt-in CLI extractor and silent browser fallback. The fork changes the new profile references from root `config/profile.yml` to `users/{USER}/config/profile.yml` so language-specific routing uses the same active-user switch as the default mode.
- Documentation ledger updates: `SIGNATURES.md` adds two community signatures and the ledger bot confirmation copy is corrected. These changes are presentation-only and do not affect user data.
- Cover-letter CLI controls: `generate-cover-letter.mjs` now accepts `--format letter|a4` and `--report NNN`, forwarding both plus the payload input path to the shared PDF renderer so cover letters can use the selected page size and join `data/pdf-index.tsv`. The conflict resolution keeps `--user <username>`, profile-selected cover templates, sanitized output inside `users/{USER}/output/`, and explicit-user help text.
- Empty Projects suppression: `build-cv-html.mjs` and `build-cv-latex.mjs` remove the complete optional Projects section when the render payload has no projects, avoiding a bare section heading while preserving the fork's active-user output and template-containment rules.
- Headless tailoring artifact identity: upstream `openai-tailor.mjs` added a role slug to its candidate-named PDF suggestion for same-company multi-role searches. In this fork the report number already provides the stable per-role identity, so the merge retires candidate/role-derived filenames in that path and emits the canonical `{REPORT_NUM}-{company-slug}-{date}.{html|pdf}` basename plus an explicit `generate-pdf.mjs --user {USER}` handoff. This brings the helper into line with the existing report/tracker/PDF identity contract rather than duplicating role identity in filenames.
- Onboarding runtime diagnostics: `doctor.mjs` now passes Node 22.5 or later, warns without blocking on Node 18 through pre-22.5 because `node:sqlite` tracker indexing is unavailable there, and continues to fail below Node 18. The markdown tracker remains usable when the SQLite index is unavailable.
- Updater commit failures: `update-system.mjs` now distinguishes a genuinely empty commit from a failed commit that leaves target files changed or staged. Real failures surface the first Git error and an explicit scoped recovery command instead of being reported as a successful no-op; the fork's user-path rollback safeguards and skill-entrypoint materialization remain intact.
- Documentation corrections: README evaluation copy now accurately describes five weighted dimensions feeding the 1.0-5.0 score, and the public manifesto signature ledger gains one entry. These changes do not affect user-layer data.
- v1.20.0 and CareerOps Manifesto baseline: `VERSION`, release metadata, `MANIFESTO.md`, `SIGNATURES.md`, the signature/guestbook/community workflows, README/onboarding links, and `manifesto.mjs` are adopted. `AGENTS.md` keeps the upstream once-only, non-blocking setup suggestion while retaining the fork's active-user onboarding contract.
- Dashboard manifesto access: `dashboard/internal/ui/screens/pipeline.go` and the i18n catalog now expose the `m` shortcut, help label, and footer hyperlink. The conflict resolution composes that entry with the fork's inline tabs, active sort display, responsive one-line help fallback, and per-user dashboard behavior instead of restoring upstream's wider default footer layout.
- Unified atomic report allocation: upstream replaced private evaluator `max+1` scans with exported reservation APIs in `reserve-report-num.mjs` and migrated Gemini, Ollama, OpenAI-compatible, and OpenRouter evaluators. The fork keeps the shared allocator logic, including tracker row/report-link occupancy, ownership tokens, shared tracker locking, safe ranges, and arbitrary-width IDs, while requiring `--user {USER}` for CLI use and passing each evaluator's `users/{USER}/reports/` and `users/{USER}/data/applications.md` paths into reserve and release calls.
- Report/tracker collision policy remains fork-specific: upstream `merge-tracker.mjs` would renumber a colliding addition while leaving its report link unchanged; the merge deliberately keeps the fork's fail-closed behavior, leaves the TSV pending, exits nonzero, and preserves report/tracker/artifact ID parity. The tracker-aware allocator should prevent ordinary collisions before this guard is reached.
- Reverse ATS blacklist enforcement: `scan-ats-full.mjs` now uses the shared blacklist parser, skips normalized matches by default, supports annotated `--include-blacklisted` audits, and reports blacklist counts. The fork preserves active-user configuration before loading the blacklist, user-scoped cache/pipeline/history paths, JSON stdout discipline, and explicit `--user` docs/examples.
- Targeted upskill fixes: `upskill.mjs` now uses canonical-to-canonical known-skill suppression and runs fetched JD text through the string-in/string-out `compactText(...)` helper. The fork keeps human output plus `--json`, requires the active user's real CV, and deliberately rejects the upstream system `cv-example.md` fallback so candidate evidence stays inside the source-of-truth boundary.
- Zero-token liveness and scanner output: `liveness-api.mjs` adds Workday CXS resolution/classification to the API-first rung, and `scan.mjs` suppresses dotenv chatter in `--json` mode so stdout stays parseable. Both changes compose cleanly with per-user scanner state.
- Matching and CV pagination fixes: `role-matcher.mjs` keeps a base title distinct from specialized-suffix siblings, and `templates/cv-template.html` avoids separating a role header/location line from its bullets at a page boundary. These are system-layer correctness fixes with no user-path conflict.
- Environment and provider documentation: `.envrc` loads the Nix flake only when Nix is installed, the budget docs correct the evaluation-dimension count, and OpenAI-compatible provider docs include NVIDIA NIM. These changes do not alter candidate-data routing.
- v1.19.0 release baseline: release metadata, changelog, README updates, and scaffolder package metadata are adopted through `c553fb24e925baf0183e5f849111025b6c6284be`.
- Dashboard discard learning loop: the pipeline status picker now asks for a predicted, canonical, or custom reason when a row moves to `Discarded` or `SKIP`, writes the reason atomically with the status, and feeds aggregated `discard_reasons` into pattern recommendations. The fork composes this with its dated `Status changed to ...` contact notes, distinct `Closed` state, lazy report hydration, user-root path containment, and semicolon-delimited Notes history.
- Truthful PDF tailoring gate: `jd-skill-gap.mjs` classifies JD requirements as named CV skills, resume-supported skills, or real gaps before drafting. Normal execution requires `--user <id>`, reads `users/{USER}/cv.md`, and uses user-scoped JD scratch files; no candidate claims are added automatically.
- Manual reply ingestion: `paste-reply.mjs` provides a no-Gmail interactive/file input path into reply-watch. Normal execution now requires an active user and appends only to `users/{USER}/data/reply-candidates.json`; the environment path override remains limited to isolated tests.
- Targeted upskill analysis: `upskill.mjs` can analyze a local JD or guarded remote URL in addition to aggregate tracker reports. The merge fixed direct-URL normalization and removed the upstream fallback to a system example CV so suppression evidence comes only from `users/{USER}/cv.md` and `users/{USER}/config/profile.yml`.
- Compact JD extraction routing: `oferta` and `auto-pipeline` may opt into `browser-extract.mjs` through `scan.extractor: cli`; the switch is read from `users/{USER}/config/profile.yml`, while Playwright remains the fallback.
- Provider and fetch hardening: upstream adds the Meituan provider and example portal entry, improves Workday CXS requests with browser-like headers, preserves Glints fetch behavior, and extends shared HTTP/provider tests. These providers remain stateless and receive user-selected portal configuration through the existing user-scoped scanner.
- OpenRouter prompt caching: the static system prefix is sent as an ephemeral cache-control text block so supporting providers can reuse it across evaluations without changing prompt contents or the fork's user-scoped prompt composition.
- Tracker parsing hardening: pipe-delimited additions now preserve empty interior PDF/Notes cells, and `—`/`-` join `N/A`/`DUP` as recognized no-score sentinels. Fixture tests explicitly clear inherited active-user variables when exercising path overrides so sandbox report links remain self-contained.
- Interview-prep URL fallback: interview preparation may fetch a supplied job URL only when no matching user report exists; `users/{USER}/reports/` remains authoritative whenever a report is available.
- Documentation provenance: upstream README translations add Wikidata backlinks for author/place entities. This is presentation-only and does not affect the active-user or candidate-fact boundary.
- Cheap-model golden evaluation harness: `eval-golden.mjs` and the synthetic `evals/` corpus provide deterministic replay scoring for archetype agreement and tolerance-banded score drift, with optional live evaluation through `openai-eval.mjs`. Replay remains user-independent; this fork requires `--user <id>` for live mode and forwards it to the existing user-scoped evaluator so CV reads stay under `users/{USER}/`.
- Browser extraction control: `browser-extract.mjs --max-chars N` can raise or lower the default 12,000-character JD text cap without changing listing-mode result limits. Invalid and non-positive values fall back to the safe default.
- Dashboard Spanish localization: the upstream `es` catalog and locale detection are adopted. The merge filled the fork-only Open, Offer, Hired, Closed, Date, and Contact labels so Spanish does not lose the customized lifecycle tabs or columns.
- PDF launch-failure cleanup: `generate-pdf.mjs` now removes temporary HTML even when Chromium fails to launch and defensively closes an opened browser without masking the original rendering error. This composes with the fork's active-user output boundary and PDF manifest behavior.
- Report numbering above 999: upstream now accepts arbitrary-width report prefixes and release ranges in `reserve-report-num.mjs`, making the fork's existing arbitrary-width reservation customization redundant at those parsing points; the user-scoped reports directory, contiguous reservations, and report/artifact ID parity remain fork behavior.
- Automated scan triage: the GitHub workflow now recognizes generated Markdown scan headers and emoji-led scan-result titles while anchoring the broader pattern to machine-report headings to avoid closing ordinary prose mentions.
- Auto-pipeline instructions: upstream removed a duplicated agency-mediated-posting paragraph. The conflict resolution keeps that cleanup and retains the fork's bounded research wording, which allows the assigned agent to finish the shared query budget without weakening the established delegation boundary.
- Author attribution documentation: the English and German README author credit now uses the author's full name, with the English name linked to the About page. This is presentation-only and does not interact with user-specific data or active-user routing.
- AI-maturity legitimacy signal: Block G now flags a possible AI-buzzword/infrastructure mismatch only when at least two of three evidence classes are present: transformation language that exceeds the role's scope/seniority, a very small team carrying organization-wide transformation expectations, and a legacy-heavy industry base rate. The note is descriptive, uses no additional research queries, suggests concrete interview probes, and remains orthogonal to both application score and the High Confidence / Proceed with Caution / Suspicious legitimacy tier.
- Deterministic HTML CV rendering: `build-cv-html.mjs` now turns a compact structured payload into the final ATS-safe HTML, so agents no longer spend output tokens reproducing template markup. The fork requires an active user for normal execution, preserves the report-linked `{REPORT_NUM}-{company}-{date}` artifact identity, restricts output to `users/{USER}/`, restricts template reads to `templates/`, and retains supported local/data-image profile photos.
- Template resolution hardening: `cv-templates.mjs` now allowlists `html` and `tex` formats, closing the format-based path-traversal route while retaining active-user profile defaults. `generate-cover-letter.mjs` now uses the same resolver with `users/{USER}/config/profile.yml`, so configured and per-payload cover templates affect real PDF generation rather than only mode instructions.
- Template and headless-tailoring documentation: the FAQ now explains named CV/cover templates and `docs/SCRIPTS.md` lists `openai-tailor.mjs` plus the deterministic HTML renderer. All candidate-data examples remain explicit-user/user-scoped in this fork.
- Deterministic user instruction composition: every routed mode now loads the shared system rules first, then `users/{USER}/modes/_profile.md`, then `users/{USER}/modes/_custom.md`, and finally the selected mode. `_custom.md` remains procedural/style context only and cannot introduce candidate facts.
- Configurable document templates: `cv-templates.mjs` discovers and validates named HTML/LaTeX CV and cover-letter templates, with defaults selected from the active user's profile. `build-cv-latex.mjs`, PDF mode, and cover mode use the shared resolver while preserving report-linked output and active-user containment.
- New document and assessment helpers: `img-to-pdf.mjs` converts one image to a one-page PDF through the existing Playwright runtime, and `assessment-log.mjs` records append-only assessment vendor/topic/threshold/score/staleness observations. Normal CLI use requires an explicit user; assessment data and generated outputs remain under `users/{USER}/`.
- Scanner/docs/web refinements: cross-listing fingerprints and blacklist behavior now have user-facing FAQ/script documentation, CRLF-safe doc assertions and CI rationale comments were adopted, and the web assistant/copy/theme controls now use the shared `Button` primitive without changing their behavior.
- v1.18.0 / web v0.3.0 release baseline: the fork adopted the current release metadata, dependency updates, accessibility/contrast and mobile tap-target fixes, Via-aware web parsing, and the split per-plugin registry while preserving the system-checkout/active-user web boundary.
- Evaluation and career operations: upstream added salary-gap analysis, lifetime stats, funnel calibration/velocity, adjacent-title and upskill modes, offer-prep with draft-only negotiation replies, interview red-flag analysis, reply classification, and fuzzy interview-invite matching. Every command that reads candidate data is adapted to require an active user and resolve under `users/{USER}/`.
- Tracker lifecycle: upstream added canonical `set-status.mjs`, the Via channel, duplicate-number detection, shared header-aware readers, and a `Hired` terminal state. The fork keeps its separate pre-application `Closed` state, preserves report/tracker ID parity by blocking conflicting TSVs instead of renumbering them, and exposes both `Hired` and `Closed` through the dashboard and analytics.
- Scanner policy and evidence: upstream added user blacklists, company aliases, posting-age gates, `postedAt` persistence, per-title content filters, scan-run counters, JD fingerprints for cross-listings, a compact CLI browser extractor, and Ashby/Lever API overrides. These are wired into the fork's user-scoped portal/pipeline/history paths and coexist with company/location filters plus closed-duplicate reopen behavior.
- Provider expansion: upstream added or hardened Tencent, 4dayweek, LaraJobs, EchoJobs, Lever EU, Cornerstone/CSOD, Rheinmetall, Phenom, Radancy, TKMS, Heckler & Koch, Deutsche Bahn, and the extracted auto-discovered provider test suites. Fork-only providers remain in the custom provider layer rather than duplicating upstream implementations.
- CV safety and alternate rendering: upstream added `verify-cv-facts.mjs`, OpenAI-compatible headless tailoring, intentional `--allow-reorder`, and the opt-in `latex-tex` extract/patch/compile flow. The fork routes CV/profile/output access through `users/{USER}/`, includes user profile/custom mode context, keeps report-numbered artifact names, and runs the fact gate before PDF rendering.
- Batch policy: upstream added `spend_tier` model routing and the auditable pre-screen discard gate. Claude tier mapping now runs against `users/{USER}/config/profile.yml`; Codex retains its explicit schema-checked worker path and uses its configured default unless `--model` is supplied. Discard logs live under `users/{USER}/batch/logs/`.
- Dashboard i18n and terminal states: upstream extracted the Go TUI catalog and added `Hired` celebration behavior. The fork keeps its inline OPEN/APPLIED/INTERVIEW/OFFER/HIRED/REJECTED/CLOSED/DISCARDED/SKIP tab order, lazy report hydration, DATE/PDF/CONTACT defaults, full-row selection, lean responsive help row, and per-user binary/root inference.
- Language surface: upstream added Hindi, Indonesian, Traditional Chinese, and German interview modes, and decoupled `language.output` from market-mode selection. These remain system-layer translations; candidate preferences and content stay in the active user's profile/mode files.
- Instruction and test architecture: upstream now owns the thin `CLAUDE.md` wrapper, so the former fork-only wrapper restoration is retired as a customization. Upstream also split provider tests into `tests/providers/` with a shared CodeQL-safe harness; fork-specific tests remain in the core suite and use disposable explicit-user fixtures.

- v1.17.0 / web v0.2.0 release baseline: upstream `VERSION`, Release Please manifest, changelog, web package metadata, and `web/CHANGELOG.md` now include the current release. The fork adopted the release metadata while preserving updater safeguards and explicit-user data routing.
- Web inbox triage: upstream added the Abundance → Triage → Shortlist → Opt-in Score inbox flow (`web/src/components/inbox/*`, `web/src/lib/inbox.ts`) plus report progressive disclosure, mobile tap-target fixes, cleaner config copy, and `cleanChips` tests. The fork keeps these changes while preserving the web split between the system checkout (`CAREER_OPS_ROOT`) and the active user folder (`CAREER_OPS_USER`).
- Provider and portal expansion: upstream added or hardened Amazon, Avature, SAP SuccessFactors/RMK/CSB, Get on Board, Dassault, Beesite, Softgarden, Workday, SmartRecruiters, Glints, and Jobstreet behavior, including Workday liveness probe max-page caps, `api:` honoring for Workday/SmartRecruiters, Avature offset self-heal, Glints v2 API support, and Jobstreet GraphQL migration docs. The fork adopted these providers under the existing active-user scan pipeline and portal-template model.
- New workflow helpers: upstream added `agent-inbox.mjs`, `add-entry.mjs`, `followup-seed.mjs`, and `process-quality.mjs`, plus `modes/agent-inbox.md`, `modes/add.md`, formal email draft mode, application pre-scan knockout questions, process-friction aggregation, and transcript-driven targeting correction. The fork routes normal CLI use through `--user {USER}` and `users/{USER}/...`, while keeping explicit env/file overrides for isolated tests.
- Report/PDF/updater fixes: upstream added `reserve-report-num.mjs --count N`, CSS `@page` margins for PDFs, configurable updater timeout budgets, and CLAUDE local-additions preservation. The fork keeps these behaviors with user-scoped reports/output and restores `CAREER_OPS_REPORTS_DIR` as a test fixture override for reservation tests.
- Language and interview surface: upstream added Korean modes plus Spanish/French interview plan/practice/debrief translations. These are system-layer language assets; user-specific targeting and interview content still belong in `users/{USER}/config/profile.yml`, `users/{USER}/modes/_profile.md`, and `users/{USER}/interview-prep/`.
- Docker/scaffolder install surface: `Dockerfile`, `docker-compose.yml`, `DOCKER.md`, `cops`, and `scaffolder/` were adopted. They are system-layer tooling; do not let them write personal data outside `users/{USER}/`.
- New user-facing modes and docs: cover letters (`modes/cover.md`, `generate-cover-letter.mjs`, `templates/cover-letter-template.html`), interview onboarding (`modes/interview.md`), Arabic modes, and translated README updates were adopted. The cover-letter renderer was adapted so default output goes to `users/{USER}/output/`, while upstream's optional greeting/salutation placeholders and import-safe `buildHtml` behavior are preserved.
- Deterministic onboarding: upstream `doctor.mjs --json` is now the cold-start source of truth. The fork version still requires `--user {USER}` or `CAREER_OPS_USER` and checks `users/{USER}/cv.md`, `users/{USER}/config/profile.yml`, `users/{USER}/modes/_profile.md`, and `users/{USER}/portals.yml`.
- Atomic report-number reservation: upstream `reserve-report-num.mjs` was adopted and adapted to `--user {USER}` so sentinels live under `users/{USER}/reports/`, not root `reports/`.
- Scanner upgrades: upstream salary filtering, scan-history recheck TTL, 404/410 rediscovery, anti-bot headed fallback, throttle controls, Workday/SolidJobs support, `scan-ats-full.mjs`, and `validate-portals.mjs` were adopted. New scan utilities were adapted to active-user portal, pipeline, cache, and history paths.
- Batch runner upgrades: upstream session/rate-limit pause, `--resume-paused`, `--rate-limit-sleep`, skipped-offer summary behavior, Claude `--strict-mcp-config`, and runtime profile-context injection were adopted while preserving the fork's per-user batch state and Codex worker contract.
- Dashboard upgrades: upstream derived fields, sorting helpers, sort/time tests, and the last-contact calendar-day fix were adopted while preserving the fork's per-user dashboard path flow and listing-date fallback.
- Liveness/security/updater upgrades: upstream SSRF hardening, headed fallback behavior, updater migration tests, and release/version updates were adopted.
- Tracker safety upgrades: upstream now serializes concurrent `merge-tracker.mjs` runs with a filesystem lock and atomic writes. The fork keeps the lock but binds it to `users/{USER}/data/applications.md`, canonicalizes both tracker and user-root paths before report-link normalization, and keeps `CAREER_OPS_ADDITIONS` only as a test/non-standard additions-dir hook.
- Tracker index and column upgrades: upstream now includes `tracker.mjs`, a Node `node:sqlite` derived index over `applications.md`, header-name column mapping for tracker reads/writes, `tracker-columns-tests.mjs`, shared `role-matcher.mjs`, and safer dedup behavior that avoids deleting distinct same-company roles. The fork keeps those changes and routes normal tracker/index operations through `--user {USER}` so the index is `users/{USER}/data/applications.db`; `CAREER_OPS_TRACKER` remains only an explicit fixture/non-standard override.
- Evaluation gates: upstream `modes/oferta.md` and `modes/auto-pipeline.md` now gate URL inputs on liveness before scoring, so closed/dead postings should stop before Block A / Step 1 instead of producing misleading evaluations.
- Doctor warnings: upstream `doctor.mjs` now warns when project-level Playwright MCP config is missing. The fork keeps this warning user-scoped through `doctor.mjs --user {USER} --json`, but the warning is not proof that runtime Playwright tools are unavailable; Codex agents must use `tool_search` or equivalent runtime tool discovery before saying Playwright MCP is absent.
- Runtime/tooling fixes: upstream PDF rendering now waits for `load` instead of `networkidle`, inlines local fonts as data URLs before Playwright rendering, adds `lang="ja"` CJK font fallbacks for Japanese HTML CVs, guards LaTeX generation against unsupported CJK content, `update-system.mjs` parses Release Please component-prefixed tags and applies the target updater manifest/runtime path list, the command menus expose `latex`, and the CV template aligns certification organization column widths while preserving fork theme CSS variables.
- OpenCode support: upstream added first-class OpenCode wrappers/skills (`OPENCODE.md` and `.opencode/skills/career-ops/SKILL.md`) and CLI docs. The fork keeps the OpenCode skill symlinked to the canonical agent skill and preserves active-user, `scan-auth`, and quiet-monitoring instructions there.
- Updater/dashboard behavior: upstream `update-system.mjs` now detects dashboard Go source changes and rebuilds the dashboard binary after updates. This should be preserved because this fork also builds per-user dashboard binaries under `users/{USER}/`.
- User-layer hygiene: upstream removed tracked `interview-prep/story-bank.md` and left `interview-prep/.gitkeep`. This aligns with the fork rule that story banks belong under `users/{USER}/interview-prep/story-bank.md`.
- Cover-letter docs: upstream fixed stale ReportLab wording; the fork keeps the HTML + Playwright cover-letter pipeline and user-scoped output behavior.
- Dependency/release baseline: upstream v1.11.0 release metadata and dependency bumps were merged into `VERSION`, `.release-please-manifest.json`, `package.json`, `scaffolder/package.json`, and `CHANGELOG.md`.
- README presentation: upstream decluttered the README hero and added the Built with Claude Code badge across translated READMEs. This is presentation-only and does not change fork runtime behavior.
- Follow-up report links: upstream fixed `followup-cadence.mjs` so report links are resolved relative to the tracker file directory, matching `merge-tracker.mjs --migrate` output such as `../reports/...`. The fork keeps that fix and also tolerates older user-root-relative links during migration.
- Ashby coverage: upstream now includes `secondaryLocations` when normalizing Ashby jobs, so EU-eligible or multi-location roles should surface more reliably through the existing scan filters.
- PDF text extraction: upstream changed `templates/cv-template.html` toward ATS-safe system fonts for cleaner CV text extraction. The fork keeps this template direction while preserving `cv.theme` CSS variable overrides in `generate-pdf.mjs`.
- Tracker dedup safety: upstream now requires company agreement before number-based merge-tracker dedup updates. The fork keeps that safety behavior on the user-scoped tracker path.
- Provider baseline: upstream now includes first-party `remoteok`, `remotive`, `ibm`, and `workingnomads` provider modules. The fork adopted these modules; `providers/workingnomads.mjs` now uses the upstream direct provider shape plus fork-preserved `api`, inferred region, `api_params.q/category/location/tags`, and `published_within_days` filtering, so the older thin `_custom` dispatcher wrapper is retired for this provider.
- v1.12 release baseline: upstream `VERSION`, Release Please manifest, and changelog now include v1.12.0 plus follow-up fixes. The fork adopted the release metadata while preserving user-layer update safeguards.
- CLI/runtime surface: upstream added Antigravity CLI support through `.antigravitycli/skills/career-ops/SKILL.md` and docs. The fork keeps that entrypoint as a symlink/pointer to the canonical `.agents/skills/career-ops/SKILL.md`, and extends updater materialization so Antigravity behaves like Claude/OpenCode on filesystems without symlink support.
- Pipeline/batch operations: upstream added `batch/batch-runner.sh --status` and `--watch`, replaced `bc` score math with `awk`, added `reconcile-pipeline.mjs` for inbox cleanup after batch runs, and added a pipeline liveness sweep for unconfirmed scan/batch entries. The fork keeps these behaviors on `users/{USER}/batch/` and `users/{USER}/data/pipeline.md`.
- Scanner/provider upgrades: upstream added content/description filtering, external metadata sanitization before pipeline/history writes, an in-process Arbeitsagentur provider, Indonesian Jobstreet and Glints providers, IBM provider tests, and hardened `local-parser` / `scan-ats-full` command and SSRF handling. The fork adopted the upstream providers and safety fixes while retaining the separate custom provider layer and company block filter.
- Portal verification: upstream added `verify-portals.mjs` for ATS slug validation and wired `doctor.mjs --strict` to probe portal slugs. The fork keeps this optional network check user-scoped through `users/{USER}/portals.yml`.
- Dashboard upgrades: upstream added customizable dashboard columns with a column picker, English/Spanish archetype parsing including YAML-style `archetype:`, and OS-specific open helpers that avoid shelling through Windows `cmd`. The fork preserves those while keeping per-user dashboard root inference and listing-date fallback.
- Voice DNA guardrail: upstream introduced optional `voice-dna.md` writing guardrails. In this fork it is treated as user-layer data at `users/{USER}/voice-dna.md`; the upstream root file was not kept as a tracked system file, and legacy root `voice-dna.md` is gitignored for migration safety.
- Resume/ATS assets: upstream added `examples/resume-example.md` and `templates/resume-template.html`, plus ATS-safe wording/template updates. The fork adopted these as system-layer examples/templates.
- Evaluation and tracker fixes: upstream hardened Gemini report-shape validation, preserved tracker notes when rows lack a trailing pipe, used the real application date from notes in follow-up cadence, auto-creates missing pipeline files, and added data-contract coverage for interview-prep outputs. The fork kept those fixes on the active user's files.
- Chinese modes: upstream added `modes/zh/` and related README updates for China-market job seekers. The fork adopted them as system-layer language modes.
- Current scanner filter follow-ups: the fork now supports per-target `location_filter` overrides in `scan.mjs`, so a specific tracked company or job board can narrow/relax location matching without changing the global portal filter. The Arbeitsagentur provider also marks remote-titled postings as `Remote, {location}`, ignores explicit no-remote/no-homeoffice titles for that remote marker, and defaults missing Arbeitsagentur locations to `Deutschland`.
- Current pipeline/report-number follow-ups: `reserve-report-num.mjs` now treats any numeric `{N}-` report prefix as occupied while still printing at least 3 digits, so users beyond report 999 do not recycle lower slots. `reconcile-pipeline.mjs` now accepts a validated `--reports <dir>` path and chooses the pending section that actually contains pending items when duplicate `Pending`/`Pendientes` headings exist.
- Current pipeline/user-routing follow-ups: `reconcile-pipeline.mjs` now honors the shared active-user resolver, so `node reconcile-pipeline.mjs --user {USER}` defaults to `users/{USER}/batch/batch-state.tsv`, `users/{USER}/data/pipeline.md`, and `users/{USER}/reports/`; explicit `--state`, `--pipeline`, and `--reports` overrides remain validated when used.
- Current tracker/report-ID follow-ups: `merge-tracker.mjs` now preserves the worker-reserved tracker/report number from each TSV instead of renumbering lower IDs to `max+1`, which keeps user-facing tracker IDs aligned with report/artifact IDs during parallel batches. If that TSV number is already used by a different entry, the TSV is left pending for manual repair instead of silently fabricating a different tracker ID. Tracker row writes also sanitize raw `|` characters in Markdown table cells to keep company/role/notes text from shifting score/status/report columns.
- Liveness upgrades: upstream added `liveness-api.mjs` so `check-liveness.mjs` can perform zero-token ATS API checks before Playwright, while preserving Playwright fallback semantics for inconclusive or non-ATS pages. This fits the fork's verification rule as long as WebSearch/WebFetch snippets still do not decide posting liveness.
- Ashby liveness upgrade: upstream added an Ashby-specific `liveness-api.mjs` API rung that maps `jobs.ashbyhq.com/{org}/{jobId}` and `/application` links to the public org job-board API, then confirms whether the specific job ID is still listed. This reduces false-expired results from JS-rendered Ashby pages while preserving the fork's conservative fallback: malformed payloads, network errors, redirects, rate limits, and unknown shapes still return `null` for the Playwright browser check.
- Provider upgrades: upstream added first-party BambooHR and Breezy providers, hardened Lever/Ashby/Workday redirect handling, fixed Recruitee custom-domain URLs, and added config-driven Arbeitsagentur `remoteMatch` / server-side homeoffice filtering. The fork adopted these upstream modules and kept its custom provider layer separate for sources upstream still does not cover.
- Scanner and reverse-discovery upgrades: upstream `scan-ats-full.mjs` now has `--json`, `--include-undated`, and `--shuffle`; the fork keeps those while preserving `--user {USER}` routing for `users/{USER}/portals.yml`, cache, pipeline, and scan history. Upstream also hardened malformed `title_filter` keyword normalization, which should reduce config-induced scanner crashes without changing the fork's company/location policy hooks.
- Batch runner upgrades: upstream added `--skip-pdf`, hardened status score handling by removing `bc`, and improved `--status` behavior. The fork keeps these while preserving active-user batch state under `users/{USER}/batch/`, Codex worker JSON contracts, `--limit`, worker timeouts, user prompt injection, and user-scoped post-batch reconcile/verify commands.
- Dashboard upgrades: upstream added in-viewer status editing, rewrites only the status cell on update, and derives EUR/GBP/CHF pay plus additional international cities from pipeline/report text. The fork keeps those while preserving per-user dashboard binary/root inference and report/PDF path normalization.
- Tracker upgrades: upstream added `tracker.mjs delete --num N` for safe row deletion. The fork keeps the command on the user-scoped markdown tracker and made the row-removal helper import-safe so tests/tools can use it without selecting a user.
- PDF/template upgrades: upstream changed `generate-pdf.mjs` to render a temporary `file://` HTML document via `page.goto(...)`, so relative images and other local resources render correctly; upstream also disabled `fi`/`fl` ligatures in CV, resume, and cover-letter templates for ATS-clean text extraction. The fork keeps those changes while preserving `cv.theme` injection and `users/{USER}/cv.md` section-order validation.
- Language and docs surface: upstream added Polish modes (`modes/pl/`) and localized README updates. These are system-layer language assets; user-specific Polish targeting still belongs in `users/{USER}/config/profile.yml` or `users/{USER}/modes/_profile.md`.
- v1.13 release baseline: upstream `VERSION`, Release Please manifest, and `CHANGELOG.md` now include v1.13.0. The fork adopted the release metadata while preserving updater safeguards for user-layer files.
- Language and docs surface: upstream added Danish modes (`modes/da/`), `README.da.md`, and update-system materialization for Danish locale paths. These are system-layer language assets; user-specific Danish targeting still belongs in `users/{USER}/config/profile.yml` or `users/{USER}/modes/_profile.md`.
- Batch budget guidance: upstream added `docs/RUNNING_ON_A_BUDGET.md`, linked it from batch docs/modes, and added a base `--limit` flag to `batch/batch-runner.sh`. The fork already had `--limit`; the merged runner keeps upstream's budget-facing documentation and limit semantics while preserving per-user batch state, Codex worker support, schema-checked final JSON, worker timeouts, prompt personalization, and user-scoped reconcile/verify commands.
- Repository hygiene: upstream added `.github/CODEOWNERS` for hosted entrypoint surfaces and universal ignore rules for nested `.env*.local` and `*.tsbuildinfo` files. The fork kept those while preserving `.scan-auth/` credential-profile hygiene.
- Source-of-truth boundary: upstream hardened `modes/_shared.md`, `AGENTS.md`, and related docs so candidate-facing text must come only from in-scope CV/profile/article/story/user files. The fork keeps that anti-fabrication rule and maps every user-owned source to `users/{USER}/...`, including interview prep.
- User custom instructions: upstream added `modes/_custom.template.md` and the `modes/_custom.md` concept. In this fork `_custom.md` is user-layer data at `users/{USER}/modes/_custom.md`; the template is system-layer.
- Application calibration and heuristics: upstream added `modes/regional/eu-swe.md` and `modes/heuristics/recruiter-side.md`. The fork exposes `eu-swe` in `.agents/skills/career-ops/SKILL.md` while preserving the active-user router, and PDF/interview-prep modes now use recruiter-side risk mapping without abandoning report-linked `users/{USER}/output` artifacts.
- Story-bank matching: upstream added `match-star.mjs` and `modes/apply.md` guidance for matching behavioral application questions to prepared STAR stories. The fork keeps this as a user-scoped feature that reads `users/{USER}/interview-prep/story-bank.md` rather than root interview-prep data.
- Job-archive workflow: upstream added `archive-posting.mjs` to capture live postings as local JD PDFs. The fork routes archived postings under `users/{USER}/jds/` and reads pipeline entries from `users/{USER}/data/pipeline.md`.
- Local evaluator: upstream added `ollama-eval.mjs` for local interactive evaluation. The fork routes CV input and report output through `--user {USER}` so local Ollama evaluation still reads `users/{USER}/cv.md` and writes `users/{USER}/reports/`.
- Scanner trust metadata: upstream added `providers/_trust-validator.mjs` and trust score/flag/level enrichment in `scan.mjs`. The fork keeps enrichment before filters, but preserves company block filtering, per-target `location_filter`, active-user pipeline/history paths, and the rule that trust flags annotate jobs rather than silently dropping them.
- Scanner duplicate reopen behavior: when a scan finds a live company/title duplicate whose only known tracker row is `Closed`, or whose tracker row was previously reopened from a closed duplicate, the fork keeps it as a duplicate rather than creating a new pipeline/tracker row. It reopens the original row as `Evaluated`, updates the row date, appends the fresh live URL to notes, records `reopened_closed_duplicate` in scan history, and makes dashboard URL opening prefer the latest reopened URL.
- Provider upgrades: upstream added first-party Personio, Comeet, and WeWorkRemotely providers and broadened provider config examples. The fork adopted these modules as system-layer providers, separate from the custom provider dispatcher.
- CLI/runtime surface: upstream added Grok Build CLI support via `.grok/skills/career-ops/SKILL.md` and extracted skill entrypoint materialization into `scaffolder/bin/skill-entrypoints.mjs`. The fork keeps Grok alongside Claude/OpenCode/Qwen/Antigravity and uses the shared helper from `update-system.mjs` instead of duplicating entrypoint constants.
- Batch robustness: upstream added a single-worker lock fallback and a Claude exit-127 shim-swap retry. The fork keeps both while preserving Codex stdin prompt delivery, schema-checked final JSON, per-user batch state, and worker-timeout behavior.
- Tracker row utilities: upstream extracted duplicated row rebuilding into `tracker-utils.mjs`. The fork uses that helper from `normalize-statuses.mjs` while preserving active-user path resolution and user-scoped backups.
- CV/template behavior: upstream added opt-in profile-photo support and scoped `break-inside` pagination rules in `templates/cv-template.html`. The fork keeps those template changes while preserving `cv.theme` CSS variable overrides and report-linked output naming.
- v1.14 release baseline: upstream `VERSION`, Release Please manifest, and `CHANGELOG.md` now include v1.14.0. The fork adopted the release metadata while preserving updater safeguards for user-layer files.
- CLI/runtime surface: upstream added first-class Codex docs/wrapper support and Kimi CLI entrypoints through `CODEX.md`, `KIMI.md`, and `.kimi/skills/career-ops/SKILL.md`. The fork keeps these as thin `AGENTS.md` / canonical-skill pointers, but rewrites examples to include the required active user instead of root `data/pipeline.md` assumptions.
- OpenAI-compatible evaluator: upstream added `openai-eval.mjs` for OpenAI, OpenRouter, Together, Groq, DeepSeek, local `/v1` servers, and other compatible endpoints. The fork adopted the endpoint/security behavior and adapted CV/report paths through `--user {USER}`, `users/{USER}/cv.md`, and `users/{USER}/reports/`; `test-all.mjs` now has a guard for that user-scoped routing.
- Governance/docs surface: upstream added `ARCHITECTURE.md`, `MAINTAINERS.md`, broadened `CODEOWNERS`, and added `docs/SUPPORTED_JOB_BOARDS.md`. These are system-layer docs; keep any user-specific targeting or company preferences in `users/{USER}/portals.yml` and profile files.
- Scanner/mode hardening: upstream trimmed `title_filter` keywords before length checks and bounded scan subagents as single-pass workers that must not fan out into more research agents. The fork keeps those constraints while preserving quiet long-running monitoring, `scan-auth`, `scan-handoff`, `run`, user-scoped portal paths, and the custom provider layer.
- Sourcing shorthand: the fork adds `/career-ops run` as a coordinator for zero-token discovery, current-scan handoff, authenticated LinkedIn, existing/new inbox processing, and reviewed verification. Manual source/job actions stay visible while independent jobs continue; an empty discovery result still processes the backlog.
- Agency handling is user-configurable through `batch.agency_confirmation`: `required` retains upstream's default gate; `posting_evidence` delegates agency identification to the worker without asking the user to confirm the agency or supply a direct URL. Unknown identities and legitimacy checks remain explicit. On restart, `run` supplies exact-posting `source: standing_policy` answers for saved agency holds while preserving explicit answers, other holds and terminal jobs. Personal preferences remain in the user layer. Preserve this override across updates to upstream's confirmation instructions, including localized entrypoints.
- Updater/runtime fixes: upstream registered Kimi paths in updater system manifests and fixed updater self-reexec checkout discovery from import closure analysis. The fork keeps those fixes while preserving `users/`, root `voice-dna.md`, and other user-path safety guards; `scaffolder/bin/skill-entrypoints.mjs` also materializes `.kimi/skills/career-ops/SKILL.md` so Kimi behaves like the other CLI entrypoints on filesystems without symlink support.
- Tracker parser consolidation: upstream extracted header-name tracker column parsing into `tracker-parse.mjs` and expanded tests so `merge-tracker.mjs`, `dedup-tracker.mjs`, `followup-cadence.mjs`, and `analyze-patterns.mjs` share the same `Location`-column-safe mapping. The fork adopted the shared parser while keeping production readers on `users/{USER}/data/applications.md`; `CAREER_OPS_TRACKER` remains a fixture/non-standard override.
- Evaluation research bounds: upstream added an explicit single-pass research budget to `modes/oferta.md` and `modes/auto-pipeline.md`, capping company/comp/hiring-signal lookup at 5 WebSearch queries and keeping research inside the agent assigned to each role instead of recursively launching research workers. This preserves the fork's one-role-per-worker pipeline fan-out while bounding work within each evaluation.
- Setup support docs: upstream added `docs/FAQ.md` and linked it from `README.md`/`SUPPORT.md`. The fork keeps the FAQ but rewrites scanner and batch examples to use `--user {USER}` plus `users/{USER}/portals.yml` instead of root single-user paths.
- Test/CI coverage: upstream now runs Go dashboard tests in GitHub Actions and adds quick-suite coverage for Remotive normalization, shared tracker parsing, `dedup-tracker.mjs` with an inserted Location column, fresh-install `scan.mjs` pipeline creation, and bounded evaluation research. The fork keeps those tests while preserving explicit-user fixtures for production paths.
- v1.15 release baseline: upstream `VERSION`, Release Please manifest, and `CHANGELOG.md` now include v1.15.0. The fork adopted the release metadata while preserving updater safeguards for user-layer files.
- Plugin system: upstream added an opt-in plugin engine, bundled Apify/Gmail/Notion plugins, registry governance, plugin audit/install commands, config templates, registry validation CI, and plugin docs. The fork keeps bundled plugin code in the system layer but treats `config/plugins.yml`, `plugins.local/`, and `plugins.lock` as user-layer data under `users/{USER}/`; `plugins/_engine.mjs`, `doctor.mjs`, and `scan.mjs` were adapted so bundled plugins come from the repo while enabled-plugin config, local plugin roots, and integrity locks can live under the active user.
- Plugin successor model: upstream now treats bundled plugins as reference seeds and allows a registry-approved community plugin with `supersedesBundled: true` to override the bundled seed only when the user installs the exact pinned commit. The fork keeps the registry as system-layer trust metadata but resolves installed successors, plugin locks, and local plugin files from the active user root (`users/{USER}/plugins.local/` and `users/{USER}/plugins.lock`), so one user's approved successor does not shadow bundled plugins for another user.
- Google Calendar plugin registry: upstream added a pinned `career-ops-plugin-google-calendar` registry entry. This only expands the curated install catalog; users still must explicitly install, enable, and consent through `node plugins.mjs --user {USER} add/enable ...`, with config and locks under the active user's folder.
- Tavily plugin registry: upstream added a pinned `career-ops-plugin-tavily` search plugin entry requiring `TAVILY_API_KEY` and `api.tavily.com`. This only expands the curated install catalog; users still must explicitly install, enable, and consent through `node plugins.mjs --user {USER} add/enable ...`, with config and locks under the active user's folder.
- Obsidian/startup-board plugin registry: upstream added pinned `career-ops-plugin-obsidian` and startup-board registry entries, expanded community plugin docs, and fixed the Notion plugin so slash-formatted scores are not mangled. These remain catalog/plugin behavior only until a user explicitly installs/enables them; registry metadata is system-layer, while plugin config, locks, and local plugin roots remain under `users/{USER}` in this fork.
- Experimental web UI: upstream added the opt-in `web/` Next.js alpha, web CI, issue template, local-first dashboard views, apply helper routes, CV editor/ingest, pipeline/explore views, and bug-report diagnostics. The fork keeps the web app as system-layer code but adapts its central root helper so `CAREER_OPS_ROOT` points to the system checkout while `CAREER_OPS_USER` selects `users/{USER}` for data reads/writes; subprocesses that run core scripts use the system root plus `CAREER_OPS_USER`/`CAREER_OPS_USERS_DIR`.
- Web tracker schema routing: `web/src/lib/career-ops.ts` reads `data/applications.md` from the selected `users/{USER}` root but loads the shared header schema (`tracker-aliases.json`) from `CAREER_OPS_ROOT`. Keep those roots separate: resolving schema metadata from the user folder triggers the legacy fixed-column fallback and misclassifies 10-column trackers such as the fork's `Via` layout.
- Web report decision view: `/pipeline/{id}` uses a `96rem` maximum width and promotes `next_action` as the Verdict plus non-empty `hard_stops`, `soft_gaps`, and `top_strengths` from the report's fenced YAML Machine Summary into a brand-colored decision table. The report's F section keeps its actual semantic title (normally `Interview Plan`) and renders in natural A-G order as a standard collapsed detail. Parsing is tolerant and read-only; malformed or legacy summaries keep the existing report rendering, and the raw Machine Summary remains in Technical details.
- Application preparation and safe apply flow: upstream added `prepare-application.mjs` and web apply helpers for Greenhouse/Ashby/Lever auto-fill preparation. The fork keeps the prepare-not-submit boundary and routes profile, PDF, and cover-letter reads through the active user's root, so generated application material still comes from `users/{USER}/config/profile.yml` and `users/{USER}/output/`.
- Finder and verifier upgrades: upstream added `find.mjs` to resolve tracker/report/company queries and expanded `verify-pipeline.mjs` to warn about duplicate reports and orphan reports. The fork keeps those read-only/report-hygiene behaviors but reads `users/{USER}/data/applications.md`, `users/{USER}/data/pdf-index.tsv`, and `users/{USER}/reports/` by default, with fixture overrides reserved for tests.
- Interview workflow modes: upstream added `modes/interview/plan.md`, `modes/interview/practice.md`, and `modes/interview/debrief.md`, plus session scaffolding under `interview-prep/sessions/`. The fork exposes those modes in the canonical agent router while keeping user interview notes and session outputs as user-layer data under `users/{USER}/interview-prep/`.
- Scanner and pattern analysis upgrades: upstream added `classify-tier.mjs`, optional `skip_tiers` filtering in `scan.mjs`, JibeApply provider support, ATS channel-yield analysis in `analyze-patterns.mjs`, and `responded_initial` follow-up cadence handling. The fork keeps the new filters/analysis while preserving company block filtering, per-target location filters, active-user scan paths, and user-scoped tracker/report reads.
- PDF/onboarding/release fixes: upstream v1.16.0 added the PDF output-root guard fix, right-gutter CV template fix, doctor `autoCopied` reporting for seeded templates, and translated README personal-data whitelist adjustments. The fork keeps those fixes while anchoring PDF output containment to the active user root when a user is selected and preserving `CLAUDE.md` as a thin `AGENTS.md` wrapper.
- OpenRouter/free-tier runtime: upstream added `openrouter-runner.mjs`, free-tier onboarding docs, concrete token-budget walkthroughs, and `.env.example` entries for OpenRouter-compatible execution. The fork adopted the runner and docs while preserving the rule that user-specific model/provider preferences belong in `users/{USER}/config/profile.yml` or user custom instructions rather than system modes.
- Provider expansion: upstream added direct first-party providers for Arbeitnow, Pinpoint, The Muse, Rippling, The Hub, Landing.jobs, Himalayas, Jobicy, Hacker News, JustJoin, NoFluffJobs, Jobspresso, 4 Day Week, and NoDesk. The fork adopted these direct providers; `providers/landingjobs.mjs` and `providers/nodesk.mjs` now retire the older `_custom` wrapper path for those IDs, while the `_custom` dispatcher remains for fork-only providers still not covered upstream.
- Scanner behavior: upstream added repost detection through `detect-reposts.mjs`, compensation persistence into `pipeline.md`, tighter company matching/dedup ordering for cooldown filtering, and fresh provider tests. The fork keeps those behaviors while preserving company block filtering, per-target `location_filter`, active-user pipeline/history/handoff paths, and closed-duplicate reopen handling.
- Dashboard PDF workflow: upstream added report-viewer cover-letter hotkey `L`, pipeline hotkeys `d` to open CV PDFs and `D` to regenerate them, `data/pdf-index.tsv`, and dashboard PDF lookup tests. The fork routes the PDF manifest to `users/{USER}/data/pdf-index.tsv`, keeps generated HTML/PDF under `users/{USER}/output/`, and makes dashboard regeneration from a per-user binary call the repo `generate-pdf.mjs` with `--user {USER}` plus `CAREER_OPS_USERS_DIR`.
- PDF manifest source metadata: upstream now threads the original input HTML path through `renderHtmlToPdf(...)` so `data/pdf-index.tsv` records the source document instead of the temporary render file. The fork preserves that behavior while keeping manifest rows rooted at `users/{USER}/data/pdf-index.tsv`; PDF and HTML entries are user-root-relative when a user is active, and blank rather than escaping the allowed manifest root.
- Italian language modes: upstream added `modes/it/` (`annuncio`, `candidarsi`, `pipeline`, `_shared`, and README) and registered the locale in updater materialization. These are system-layer language assets; user-specific Italian targeting still belongs in `users/{USER}/config/profile.yml` or `users/{USER}/modes/_profile.md`.
- Zero-cost model docs: upstream expanded `docs/RUNNING_ON_A_BUDGET.md` with `npm run or:*`, Ollama, and OpenAI-compatible runtime paths. The fork keeps those docs as general system guidance; user-specific provider/model preferences remain user-layer configuration.
- User-layer ignore coverage: upstream added root ignores for `data/follow-ups.md` and `modes/_custom.md`. The fork adopted those ignores alongside its existing legacy-root ignores for `voice-dna.md`, `article-digest.md`, `.scan-auth/`, and `users/`, so accidental root personal data remains protected while real user data lives under `users/{USER}/`.
- CV pagination fix: upstream adjusted `templates/cv-template.html` so role titles do not orphan at page breaks. The fork adopted the template fix while preserving `cv.theme` CSS variable overrides and user-scoped PDF output behavior.
- Application answer persistence: upstream added `application-answers.mjs` plus `modes/apply.md` guidance for writing a `## Application Answers` section with filled/submitted state, free-text answers, selections, field values, and uploaded files. The fork keeps the formatter/upsert behavior but requires an active `--user {USER}` for CLI writes and resolves report paths under `users/{USER}/`, so application snapshots are stored in the user's report files rather than root `reports/`.
- Teamtailor provider: upstream added a zero-auth RSS provider for `*.teamtailor.com` plus explicit `provider: teamtailor` support for branded Teamtailor domains. The fork adopted the provider and tests as system-layer provider code; per-user opt-in for branded domains still belongs in `users/{USER}/portals.yml`.
- HigherEdJobs provider: upstream added `providers/higheredjobs.mjs`, supported-board docs, `templates/portals.example.yml` examples, and tests for the public HigherEdJobs RSS category feed. The fork adopted it unchanged as system-layer provider code; users opt in from `users/{USER}/portals.yml` with `provider: higheredjobs` and optional `cat_id`.
- VC portfolio seed discovery: upstream added `seeds/vc-portfolios.mjs`, `seeds/README.md`, and `scan-ats-full.mjs --seeds yc,a16z` to discover companies from public VC portfolio lists and probe them through ATS providers. The fork preserves that discovery surface while keeping `scan-ats-full.mjs` under the active-user resolver, with cache, pipeline, scan history, and portal filters rooted at `users/{USER}`.
- CI workflow: upstream changed `.github/workflows/test.yml` to use `npm install --ignore-scripts`, skipping the Playwright browser download because the quick Node and Go test jobs do not launch a browser. Local PDF/liveness workflows that do need browsers still rely on the normal Playwright install path.
- Dashboard/tracker column safety: upstream mapped dashboard tracker reads and status writes by header name, matching the Node tracker parser. The fork keeps that mapping while preserving reopened-URL preference from tracker notes and dated status-change notes when the dashboard edits an application status.
- Security/path hardening: upstream hardened batch temporary JD files, PDF output containment, tracker cell handling, common PII filename ignores, and structural updater path coverage through `validate-system-paths-coverage.mjs`. The fork keeps the hardening but scopes PDF output containment to the active user root, preserves `local:jds/...` batch copying from `users/{USER}/jds/`, and keeps `lib/` plus `liveness-browser.mjs` in updater system path coverage.
- Language/docs surface: upstream added Spanish locale modes (`modes/es/`), German README, Japanese mode parity updates, `docs/CODEX.md`, `docs/SUPPORTED_CLIS.md`, and broader setup/support docs. The fork adopted these as system-layer assets and rewrote conflicted examples to use explicit users and `users/{USER}` paths where they touch candidate data.

Conflict notes from this merge:

- `application-artifacts.mjs`, `contacts.mjs`, `outcome.mjs`, `weekly-digest.mjs`, `company-funded.mjs`, `scan-interamt.mjs`, `mark-pdf-ready.mjs`, `verify-portals.mjs`, `fix-slugs.mjs`, and `check-table-freshness.mjs`: upstream introduced root-oriented defaults; the merge requires the shared active user for normal execution, moves reads/writes under `users/{USER}/`, and keeps explicit fixture paths narrowly available for isolated tests.
- `batch/batch-runner.sh`: combined upstream's structured worker-failure contract with the fork's reservation and cross-artifact validator. A valid reported failure remains failed, a completed result must still pass artifact validation, and failed identities are not released for reuse.
- `dashboard/internal/i18n/catalog.go`, `templates/states.yml`, and the web status surfaces: adopted upstream `Hired` propagation and the new canonical-state coverage tests while retaining the fork's separate `Closed` state. The merge removed a duplicate `Hired` switch arm and added `Closed` to all dashboard/web fallback lists and assistant enums.
- `doctor.mjs`: composed upstream CLI-aware MCP configuration discovery with the fork's active-user onboarding paths. `--target` is treated as an explicit fixture root when no user is supplied; ordinary runs continue to fail closed without `--user` or `CAREER_OPS_USER`.
- `modes/pdf.md` and `application-artifacts.mjs`: adopted nested versioned application bundles and similarity recommendations without replacing the fork's flat report-linked HTML/PDF identity. Nested bundles coexist as audit/reuse material; the canonical tracker/PDF manifest still points at the established flat artifact names.
- `doctor.mjs`: adopted upstream's non-fatal setup-warning presentation while retaining the fork's active-user prerequisite root and explicit `users/{USER}/...` labels; the machine-readable onboarding state remains authoritative for whether user workflows may proceed.
- `docs/SCRIPTS.md`: kept the fork's deterministic HTML renderer documentation and accepted upstream's corrected direct `node build-cv-latex.mjs` invocation and heading.
- `modes/ar/fursah.md`, `modes/ja/kyujin.md`, `modes/tr/is-ilani.md`, `modes/zh-TW/oferta.md`, and `modes/zh/oferta.md`: adopted upstream's localized Risk Summary blocks but changed their red-flag source paths to `users/{USER}/interview-prep/`; generated report links remain relative to `users/{USER}/reports/`.
- `.agents/skills/career-ops/SKILL.md` and `AGENTS.md`: combined upstream `/expand`, output-language, Kimi/Gemini, and v1.22 documentation with the fork's active-user router, `run`/`verify`/`scan-handoff`/`scan-auth` supervision, `Closed` lifecycle, and explicit `users/{USER}` path contract.
- `build-cv-html.mjs`, `build-cv-latex.mjs`, `generate-pdf.mjs`, and `modes/pdf.md`: composed the shared optional-section core, photo/preview support, and page budgets with template containment, report-linked naming, section-order validation, and active-user output containment.
- `gemini-eval.mjs`, `ollama-eval.mjs`, `openai-eval.mjs`, and `openrouter-runner.mjs`: kept upstream token tracking and output-language directives while restoring per-user CV/profile/report allocation and tracker merging. Gemini's reservation is released on every failure path and its tracker addition is written only after the user-scoped report succeeds.
- `scan.mjs`, `scan-ats-full.mjs`, and `templates/portals.example.yml`: adopted normalized URL/company-role dedup, posted-date windows, visa filters, content-filter refinements, and new provider examples while preserving active-user portal/cache/pipeline/history paths, fork company/location filters, and closed-duplicate reopen writeback.
- `tracker-utils.mjs`, `dedup-tracker.mjs`, `normalize-statuses.mjs`, `reply-watch.mjs`, `merge-tracker.mjs`, and the dashboard data layer: adopted shared filesystem transactions and upstream `Hired` fixes while retaining canonicalized per-user tracker lock keys, test-only file overrides, report-link normalization, and the fork's `Closed` lifecycle ordering.
- `batch/batch-runner.sh` and `batch/aggregate-tokens.mjs`: moved the new token summary away from upstream root `batch/` and `reports/` assumptions. It now reads the selected user's state/logs/reports and is invoked with the batch runner's validated `--user` value.
- `modes/expand.md`: retained upstream's no-unlinked-URL, literal-evidence, dry-run, and approval gates, but made every candidate source and `add-entry.mjs` call explicitly user-scoped.
- `test-all.mjs`, `tests/generate-pdf-page-budget.test.mjs`, `tests/scan-company-role-dedup.test.mjs`, `tracker-writer-lock-tests.mjs`, and workflow fixtures: kept upstream coverage while supplying disposable explicit users/dependencies and avoiding fixture source strings that violate the suite's direct-`process.exit` guard. The merged quick suite passes 2,961 checks with no failures (one expected warning for the empty-data CV sync smoke).
- `AGENTS.md`, `modes/interview-redflag.md`, and `modes/oferta.md`: adopted the Risk Summary report contract and preserved the required `**Warning level:**` cross-reference while keeping report and interview-prep files under `users/{USER}/`; relative report links still use `../interview-prep/...` from the per-user reports directory.
- `batch/batch-prompt.md`: adopted the fixed Risk Summary table and `risk_summary` Machine Summary map, changed red-flag source lookup to `{{USER_ROOT}}/interview-prep/`, and retained the fork's single canonical Machine Summary schema rather than duplicating upstream's root-oriented schema inside the report-header example.
- `modes/pipeline.md`, `scan.mjs`, and `test-all.mjs`: adopted labeled pipeline trust segments and trailing scan-history trust columns while documenting the history file at `users/{USER}/data/scan-history.tsv`; the scanner already writes through the active user's configured pipeline and history paths.
- `AGENTS.md`, `modes/pdf.md`, `jd-skill-gap.mjs`, `paste-reply.mjs`, `upskill.mjs`, `modes/reply-watch.md`, and `docs/SCRIPTS.md`: adopted the new skill-gap, manual-reply, and targeted-upskill workflows while replacing upstream root `cv.md`, `config/profile.yml`, `data/`, `reports/`, and output assumptions with explicit `--user {USER}` routing and `users/{USER}/...` paths.
- `dashboard/internal/data/career.go`, `dashboard/internal/data/career_test.go`, `dashboard/internal/ui/screens/pipeline.go`, and `dashboard/main.go`: combined the upstream discard-reason picker and atomic Notes write with the fork's dated dashboard interaction notes, distinct `Closed` state, lazy viewport hydration, and per-user dashboard root. Reason reads reject path traversal and normalize quoted YAML values before showing them in the picker.
- `batch/batch-prompt.md` and `analyze-patterns.mjs`: retained the new `discard_reasons` Machine Summary field and removed a duplicate report-summary block introduced by overlap; learning-loop recommendations now point to `users/{USER}/modes/_custom.md` instead of the tracked root template.
- `tracker-columns-tests.mjs`: preserved upstream empty-cell regression coverage while clearing inherited `CAREER_OPS_USER` and `CAREER_OPS_USERS_DIR` inside explicit tracker/additions fixtures; otherwise the fork's active-user resolver rebased sandbox report links outside the fixture.
- `modes/oferta.md`, `modes/auto-pipeline.md`, and `modes/interview-prep.md`: kept upstream compact extraction and URL-fallback instructions, with profile and report lookups restored to the active user's layer.
- `modes/oferta.md`: the upstream AI-buzzword/infrastructure mismatch signal merged cleanly into Block G. The fork retained its bounded-research and non-prescriptive legitimacy behavior, and corrected the adjacent employment-classification jurisdiction lookup to `users/{USER}/config/profile.yml` so both signals remain inside the active-user contract.
- `build-cv-html.mjs` and `modes/pdf.md`: adopted upstream's compact JSON → deterministic HTML workflow while replacing candidate-name/root-output examples with the fork's report-linked artifact basename and `users/{USER}/output/` paths. Normal CLI execution requires `--user`, rejects output outside the active user root, rejects templates outside `templates/`, and keeps self-test execution data-independent.
- `generate-cover-letter.mjs`, `modes/cover.md`, and `test/cover-resolver.test.mjs`: combined upstream's shared cover-template resolver with the fork's active-user output flow. Production resolution now reads `cover_letter.template` from `users/{USER}/config/profile.yml`, generated PDFs stay under `users/{USER}/output/`, and pure resolver/build tests still import without selecting a real user.
- `docs/FAQ.md` and `docs/SCRIPTS.md`: kept upstream's custom-template and OpenAI-tailoring documentation while restoring user-scoped profile/output paths, preserving the blacklist FAQ, and documenting the deterministic renderer's user/output/template boundaries.
- `cv-templates.mjs`, `test/cv-templates.test.mjs`, `test-all.mjs`, and `update-system.mjs`: adopted the upstream template-format allowlist, cover resolver tests, renderer self-test, and updater registration. The merged quick suite passes 1,748 checks; a separate temporary-user smoke test rendered the deterministic HTML through `generate-pdf.mjs` and recorded the report-linked manifest entry.
- `.agents/skills/career-ops/SKILL.md`, `AGENTS.md`, and `modes/_shared.md`: accepted upstream's deterministic `_profile` → `_custom` → selected-mode order and factual-source guard, while resolving every user customization reference through `users/{USER}` and retaining the fork's active-user, `run`, `scan-handoff`, `scan-auth`, and quiet-monitoring contracts.
- `assessment-log.mjs`, `cv-templates.mjs`, `img-to-pdf.mjs`, and `build-cv-latex.mjs`: upstream introduced or extended these helpers with root-oriented defaults. The merge routes assessment/profile access through `lib/user-context.mjs`, requires a user for normal CLI execution, and keeps generated image/LaTeX output inside the active user root; import-only helpers and self-tests remain data-independent.
- `DATA_CONTRACT.md`, `docs/FAQ.md`, `docs/SCRIPTS.md`, `modes/cover.md`, `modes/latex.md`, `modes/pdf.md`, and `modes/scan.md`: adopted assessment logging, template selection, image conversion, cross-listing, and blacklist documentation while rewriting candidate-data paths and examples to `users/{USER}` plus explicit `--user` arguments.
- `test-all.mjs`: combined upstream template, CRLF, workflow-order, assessment, and image self-tests with the fork's disposable `CAREER_OPS_USERS_DIR` fixtures and explicit active-user path markers. The merged quick suite passes 1,745 checks.
- `web/src/components/assistant-console.tsx`, `web/src/components/copyable-command.tsx`, and `web/src/components/theme-toggle.tsx`: adopted the shared `Button` primitive refactor unchanged; the web typecheck, 19 tests, audit, and production build remain green.
- `.agents/skills/career-ops/SKILL.md` and `AGENTS.md`: combined upstream `email`, `add`, `agent-inbox`, interview submodes, and onboarding docs with the fork's mandatory active-user router, `run`, `scan-handoff`, `scan-auth`, and quiet long-running monitoring rules. The canonical agent skill now exposes both the new upstream modes and the fork-only sourcing/auth modes.
- `CLAUDE.md`: upstream expanded this file again; the fork restored the thin `@./AGENTS.md` wrapper so active-user, data-contract, and source-of-truth behavior continues to have one canonical instruction surface.
- `DATA_CONTRACT.md`, `modes/patterns.md`, `modes/followup.md`, `modes/apply.md`, `modes/update.md`, `docs/SETUP.md`, `docs/SCRIPTS.md`, and `README.md`: merged upstream's new helpers and docs while rewriting user-data examples to `users/{USER}` and commands to explicit `--user {USER}` where they touch candidate data.
- `scan.mjs`: adopted upstream's provider registry loader (`providers/_registry.mjs`) and provider additions while preserving `configureScanUserPaths(ctx)`, user-scoped portal/profile/pipeline/history/handoff paths, company block filtering, per-target `location_filter`, and the combined `emptyTargets` behavior.
- `reserve-report-num.mjs`: combined upstream contiguous `--count N` reservation and range release with `users/{USER}/reports/`, arbitrary-width numeric prefixes, and the fork's test-only `CAREER_OPS_REPORTS_DIR` / `CAREER_OPS_REPORTS` override.
- `merge-tracker.mjs` and `dedup-tracker.mjs`: kept upstream's stricter score/status TSV column detection and fuzzy duplicate safeguards while preserving user-context imports and `users/{USER}/data/applications.md` routing.
- `prepare-application.mjs`: kept upstream's relative PDF containment hardening and adapted the error path/output guard to `users/{USER}/output/`.
- `add-entry.mjs`, `agent-inbox.mjs`, `followup-seed.mjs`, and `process-quality.mjs`: upstream introduced these as root-file helpers; the fork adapted normal CLI use to explicit users and `users/{USER}` defaults, kept env/file overrides for tests, and moved user resolution inside CLI-only paths where imports/tests need pure helper functions.
- `web/next.config.mjs` and `web/src/lib/career-ops.ts`: kept upstream web v0.2.0 behavior and the Turbopack root pin while preserving the fork's separation between system checkout resolution and active-user data resolution.
- `test-all.mjs`, `agent-inbox-tests.mjs`, `followup-seed-tests.mjs`, `process-quality.test.mjs`, and `web/test-clean-chips.mjs`: adopted upstream coverage for the new workflow helpers, providers, updater budgets, PDF margins, and web chip cleanup while adapting fixtures that touch candidate files to `CAREER_OPS_USERS_DIR`, `CAREER_OPS_REPORTS_DIR`, and explicit `--user test`.
- `.agents/skills/career-ops/SKILL.md`: combined upstream multi-CLI/Codex invocation notes with the fork's mandatory active-user routing, quiet long-running monitoring, `scan-auth`, and `scan-handoff` mode routing.
- `README.md` and `docs/SETUP.md`: kept upstream Codex/headless examples, supported job-board documentation, and broader CLI list, but rewrote setup and command examples to use `users/{USER}` and explicit `<username>` prompts.
- `modes/scan.md`: kept upstream's single-pass worker / no-subagent-fanout rule and preserved the fork's Spanish quiet-monitoring policy, `users/{USER}/portals.yml` configuration path, and scan-handoff completion guidance.
- `test-all.mjs`: kept upstream Codex/Kimi/docs/updater/MCP coverage while adding `.kimi` skill integrity checks and user-scoped `openai-eval.mjs` guards. The upstream `.claude/settings.local.json` MCP test was adapted to run through `doctor.mjs --user test` with a disposable `CAREER_OPS_USERS_DIR`.
- `openai-eval.mjs`: upstream added the evaluator as a root single-user script; the fork adapted it to `lib/user-context.mjs`, user-scoped CV/report paths, and help/output text that requires `--user {USER}`.
- `scaffolder/bin/skill-entrypoints.mjs`: upstream added Kimi wrapper files but the shared materializer still omitted Kimi; the fork added `.kimi/skills/career-ops/SKILL.md` to `SKILL_ENTRYPOINTS` and extended materialization tests accordingly.
- `.gitignore`: kept the fork's `.scan-auth/` credential-profile ignore and added upstream's universal nested local-env / TypeScript build-cache ignore rules.
- `batch/batch-runner.sh`: removed duplicate `--limit` help/parser entries, adopted upstream's limit-aware startup summary, and kept the fork's user banner plus CLI/worker-timeout logging so per-user Codex and Claude batch runs remain auditable.
- `CLAUDE.md`: kept the fork's short redirect to `AGENTS.md` because `AGENTS.md` is the merged canonical instruction surface with active-user and user-layer rules.
- `generate-cover-letter.mjs`: kept upstream's import-safe `buildHtml`, single-pass token replacement, optional greeting block, and lazy Playwright import, then restored user-scoped `--user` resolution and `users/{USER}/output` output paths inside `main()`.
- `generate-pdf.mjs`: in the current merge, kept upstream's temp-file `page.goto(file://...)` renderer and `randomUUID` cleanup path so local images/resources render, while retaining fork user resolution, `cv.theme` overrides, and `users/{USER}/cv.md` section-order validation. A focused smoke test confirmed `--user`, theme injection, ATS normalization, and PDF output together.
- `followup-cadence.mjs`: kept upstream's tracker-directory-relative report-link resolution and layered it onto the fork's active-user context, including a compatibility fallback for older `reports/...` links relative to `users/{USER}/`.
- `batch/batch-runner.sh`: combined upstream `--skip-pdf`, `awk`-based score arithmetic, and status-only behavior with the fork's explicit `--user` requirement, user-scoped batch files, Codex worker contract, `--limit`, worker timeout, and user-scoped reconcile/verify commands.
- `dashboard/internal/ui/screens/viewer.go` and `dashboard/main.go`: combined upstream's viewer status picker with the fork's user-root PDF link rewriting by keeping `NewViewerModelWithFileRoot(...)` and passing the selected application/status context through it.
- `scan-ats-full.mjs`: combined upstream `--json`, `--include-undated`, `--shuffle`, degraded-result metadata, and JSON-stdout discipline with fork user-scoped portal/cache/pipeline/history paths and user-visible active-user logging.
- `tracker.mjs`: kept upstream `delete --num N`, but changed module initialization so imported helpers such as `removeRowByNum` do not require an active user; direct CLI usage still requires `--user {USER}` unless a fixture override is explicitly set.
- `test-all.mjs`: kept upstream coverage for BambooHR, Breezy, liveness API, tracker delete, batch score hardening, status picker, and ligature suppression while adapting fixtures to `CAREER_OPS_USERS_DIR` and explicit `--user test` where this fork's active-user contract applies.
- `providers/workingnomads.mjs`: replaced the old fork wrapper around `providers/_custom.mjs` with an upstream-style direct provider, but preserved the fork's documented Working Nomads filters and inferred `/remote-europe-jobs` style region handling.
- `DATA_CONTRACT.md` and `modes/_shared.md`: kept upstream's new `voice-dna.md` writing guardrail concept but moved it to `users/{USER}/voice-dna.md`, preserving the fork rule that user voice/style data is never tracked at the root.
- `doctor.mjs`: kept upstream `--strict` portal slug probing and pipeline-file auto-creation, then routed both through `userPath(...)` so strict checks read `users/{USER}/portals.yml` and create `users/{USER}/data/pipeline.md`.
- `gemini-eval.mjs`: kept upstream's post-save tracker merge flow and report-shape validation, but restored `merge-tracker.mjs --user {USER}` and user-scoped report/tracker-addition messages.
- `modes/pipeline.md`: kept upstream's liveness sweep for unconfirmed batch/scan entries and rewrote the workflow commands for `users/{USER}/data/pipeline.md` plus `reserve-report-num.mjs --user {USER}`.
- `scan.mjs`: kept upstream's fresh-install `PIPELINE_SKELETON` and content filter while preserving the fork's `buildCompanyFilter(config.company_filter)` and active-user pipeline path.
- `update-system.mjs`: kept upstream user-file rollback safety and target manifest behavior, added `voice-dna.md` to the user-path guard, and extended materialized skill entrypoints to Antigravity.
- `dashboard/internal/data/career.go` and `dashboard/main.go`: combined upstream English/YAML archetype parsing and cross-platform open helpers with the fork's listing-date regexes and user-root PDF target normalization.
- `voice-dna.md`: upstream added this as a tracked root user file; the fork deleted it from the merge result, added it to legacy root ignores, and documents `users/{USER}/voice-dna.md` as the supported location.
- `.agents/skills/career-ops/SKILL.md`: combined upstream `eu-swe` routing with the fork's `scan-auth` mode and active-user router.
- `DATA_CONTRACT.md`, `modes/_shared.md`, `modes/interview-prep.md`, and `modes/pdf.md`: combined upstream `_custom.md`, source-of-truth, recruiter-risk, and story-bank rules with user-scoped paths under `users/{USER}/...`.
- `batch/batch-runner.sh`: combined upstream lock-fallback and Claude shim-swap retry with the fork's Codex stdin prompt path and per-user batch state.
- `scan.mjs`: combined upstream trust enrichment and location-preserving pipeline data with fork company-block filtering, per-target location filters, and active-user pipeline/history paths.
- `normalize-statuses.mjs`: adopted upstream `tracker-utils.mjs` row rebuilding while keeping user-context initialization and `users/{USER}/data/applications.md` routing.
- `update-system.mjs`: adopted upstream's shared skill-entrypoint materializer, including Grok, while preserving the fork's user-path safety guard list.
- `test-all.mjs`: kept upstream coverage for archive posting, trust validation, new providers, Grok/materialized skills, tracker row utilities, and template pagination while preserving fork checks for scan-auth and explicit-user fixtures.
- `archive-posting.mjs`, `match-star.mjs`, and `ollama-eval.mjs`: adopted upstream tools but added active-user resolution so archived JDs, story-bank reads, CV reads, and report writes use `users/{USER}/...`.
- `analyze-patterns.mjs` and `followup-cadence.mjs`: adopted upstream `tracker-parse.mjs` shared column parsing, but resolved conflicts by keeping active-user resolution and `users/{USER}/data/applications.md`; `followup-cadence.mjs` still tolerates older user-root-relative `reports/...` links during migration.
- `docs/FAQ.md`: adopted upstream setup FAQ but rewrote scanner, ATS discovery, and batch examples to use `--user {USER}` and `users/{USER}/portals.yml`, preserving the fork's no-root-user-data contract.
- `test-all.mjs`: adopted upstream tests for shared tracker parsing, Remotive provider normalization, fresh-install pipeline creation, bounded evaluation research, and dashboard CI coverage; helper-only fixtures may still use temporary root `data/` or `CAREER_OPS_TRACKER`, but production CLI behavior remains explicit-user.
- `DATA_CONTRACT.md`, `.gitignore`, `doctor.mjs`, `scan.mjs`, and `plugins/_engine.mjs`: adopted upstream's opt-in plugin system while moving user-owned plugin toggles, local plugins, and plugin locks to `users/{USER}`. The plugin engine now supports a repo plugin root plus a separate active-user config/lock root so bundled plugins remain auto-updatable while user consent/config remains protected.
- `generate-pdf.mjs`, `modes/pdf.md`, `batch/batch-prompt.md`, `dashboard/internal/data/pdf.go`, `dashboard/internal/ui/screens/pipeline.go`, and `dashboard/main.go`: adopted upstream PDF manifest and dashboard PDF hotkeys, then routed the manifest and regenerated files through `users/{USER}/data/pdf-index.tsv` and `users/{USER}/output/`. The dashboard's `D` hotkey now resolves the repo root from a per-user binary and invokes `generate-pdf.mjs --user {USER}` with absolute user artifact paths.
- `.gitignore`: adopted upstream's `data/follow-ups.md` and `modes/_custom.md` root ignores while preserving the fork's broader user-layer and legacy-root ignore set, including `users/`, `.scan-auth/`, `voice-dna.md`, and `article-digest.md`.
- `generate-pdf.mjs`: combined upstream's manifest metadata threading (`inputPath` through `renderHtmlToPdf`) with the fork's user-scoped manifest path. The conflict resolution keeps `repoRelativeManifestPath(...)` for upstream compatibility and adds a root-aware manifest path helper so active-user manifests do not record paths outside `users/{USER}`.
- `modes/apply.md`: adopted upstream's persistent Application Answers workflow and Section H wording while keeping searches, CV reads, tracker updates, and example commands user-scoped under `users/{USER}/...`.
- `application-answers.mjs`: adopted upstream's additive report-section formatter/upsert helper, then wrapped CLI writes in the fork's active-user resolver so relative report paths resolve under `users/{USER}` and absolute report paths outside the active user root are rejected.
- `scan-ats-full.mjs`: adopted upstream `--seeds` VC portfolio discovery and `runSeedScan(...)`, then kept the fork's `configureScanUserPaths(...)`, `CAREER_OPS_USERS_DIR`, and user-scoped portal/cache/pipeline/history routing. The startup summary now includes both the user id and selected ATS/seed sources.
- `update-system.mjs`: added upstream `application-answers.mjs` and `seeds/` to system path coverage while preserving fork-only authenticated scanning entries. The hardcoded posting extraction helpers were subsequently removed.
- `providers/higheredjobs.mjs`, `templates/portals.example.yml`, `docs/SUPPORTED_JOB_BOARDS.md`, and `test-all.mjs`: the follow-up upstream HigherEdJobs commit merged cleanly with no conflict. No active-user adaptation was required because the provider is stateless and only reads the configured portal entry passed by `scan.mjs`; the example remains a system-layer template for copying into `users/{USER}/portals.yml`.
- `.github/workflows/test.yml`, `liveness-api.mjs`, and `test-all.mjs`: the Ashby liveness and CI follow-up merged cleanly with no conflict. No user-path adaptation was required because `liveness-api.mjs` is stateless URL classification/fetch code, and the new tests mock `globalThis.fetch` rather than reading user-layer files.
- `plugins.mjs`, `plugins/_engine.mjs`, `docs/PLUGIN_REVIEW.md`, `docs/PLUGINS.md`, `plugins/README.md`, and `test-all.mjs`: combined upstream's seed/successor model and plugin registry docs with the fork's user-scoped plugin root. `resolveSuccessorIds(root, userRoot)` now reads the system registry from the repo but checks `plugins.local` and `plugins.lock` under the active user root; `plugins.mjs list/run/skill` passes that override set into discovery, and tests cover user-root successor resolution.
- `plugins-registry.json`: upstream's Tavily registry addition merged cleanly with no conflict. No active-user adaptation was required because the registry is system-layer metadata and user install/config remains user-scoped.
- `.agents/skills/career-ops/SKILL.md` and `AGENTS.md`: combined upstream interview submodes and `doctor.mjs --json` `autoCopied` documentation with the fork's mandatory active-user router, `run`, `scan-handoff`, `scan-auth`, and quiet long-running monitoring rules.
- `CLAUDE.md`: upstream expanded this file back into a full single-root instruction copy; the fork restored the thin `@./AGENTS.md` wrapper so the active-user and source-of-truth contract has one canonical instruction surface.
- `analyze-patterns.mjs`: combined upstream ATS channel-yield analysis and `--min-vendor-n` guard with the fork's active-user resolver and `users/{USER}/data/applications.md` default.
- `scan.mjs`: combined upstream `skip_tiers` seniority filtering with the fork's company block filter, per-target `location_filter`, user-scoped portal/profile/pipeline/history/handoff paths, and closed-duplicate reopen logic. Filter order is company, title, seniority tier, location, salary, content.
- `generate-pdf.mjs`: combined upstream's repo-root anchored traversal fix with the fork's user-root output boundary: active-user runs can only write inside `users/{USER}`, while non-user fixture runs fall back to the repo root guard.
- `match-star.mjs`, `find.mjs`, `prepare-application.mjs`, and `verify-pipeline.mjs`: adopted upstream story-bank tests, finder, prepare-not-submit helper, and report hygiene warnings while preserving explicit-user CLI routing and `users/{USER}` file resolution.
- `web/src/lib/career-ops.ts`, web API routes, and `web/README.md`: adopted upstream's experimental web app but split system checkout resolution from active-user data resolution. `CAREER_OPS_ROOT` selects the code checkout, `CAREER_OPS_USER` selects the user folder, and core subprocesses run from the system root with the user env injected.
- `docs/SCRIPTS.md`: adopted upstream documentation for `find.mjs` and expanded verify report checks, then rewrote command examples and paths to `--user <username>` and `users/{USER}/...`.
- `dashboard/internal/data/career.go`, `dashboard/internal/ui/screens/viewer.go`, and `dashboard/main.go`: combined upstream header-name tracker writes, cover-letter hotkey, and cross-platform open helpers with fork behavior for reopened live URLs in notes, dated dashboard status-change notes, user-root PDF URL rewriting, and per-user binary/root inference.
- `scan.mjs`: combined upstream plugin-provider merging, compensation persistence, cooldown history statuses, and tighter dedup ordering with the fork's active-user portal/profile/pipeline/history/handoff paths and closed-duplicate reopen writeback.
- `providers/landingjobs.mjs` and `providers/nodesk.mjs`: upstream now owns direct first-party implementations, so the fork retired the old `_custom.mjs` wrapper for those providers while keeping the custom provider layer for fork-only sources.
- `batch/batch-runner.sh`: combined upstream secure `mktemp` JD files and score/status hardening with the fork's `local:jds/...` copy behavior, resolved URL prompt injection, Codex final-JSON schema contract, and per-user batch state.
- `modes/ja/_shared.md`: adopted upstream Japanese parity updates while rewriting source-of-truth, voice DNA, story-bank, tracker, and CV-sync commands to `users/{USER}` paths.
- `update-system.mjs`: kept upstream structural path coverage and new browser-liveness path while preserving the fork's `lib/` user-context layer and user-path rollback safeguards.
- `verify-cv-facts.mjs`, `salary-gap.mjs`, `funnel-velocity.mjs`, `stats.mjs`, `upskill.mjs`, `invite-match.mjs`, `reply-watch.mjs`, `set-status.mjs`, and `openai-tailor.mjs`: upstream introduced these with single-root defaults; direct user-data execution now resolves through `lib/user-context.mjs`, while pure imports and `--self-test` paths stay usable without touching a real user.
- `batch/batch-prompt.md` and `batch/batch-runner.sh`: combined upstream compensation reliability, `spend_tier`, pre-screen discard logging, typed final JSON, and CV fact validation with the fork's `{{USER_ROOT}}` prompt paths, explicit active user, Codex contract, report-numbered output, and per-user batch logs/state.
- `scan.mjs`: combined upstream company aliases, blacklist, title-category content filters, posting-age/`postedAt`, fingerprints, and run metrics with fork company/location filters, active-user paths, scan handoff, and closed-duplicate reopen writes. Alias-aware company/title buckets are used for new dedupe; the exported legacy loader remains for compatibility tests.
- `merge-tracker.mjs`: adopted upstream shared lock/atomic-write and header-aware tracker utilities, but intentionally keeps the fork's collision policy: a worker-reserved number already owned by another row blocks the TSV and leaves it pending; it is never silently renumbered away from its report/artifact identity.
- `dashboard/internal/{data,i18n,ui}` and `dashboard/main.go`: combined upstream TUI i18n and `Hired` behavior with the fork's `Closed` state, inline tab order, async viewport report loads, lean table/chrome defaults, dated status-contact notes, and per-user path inference.
- `test-all.mjs` and `tests/`: adopted upstream's auto-discovered provider layout and safe command harness, retained fork coverage for active-user routing and report-ID parity, and converted upstream single-root fixtures to disposable `CAREER_OPS_USERS_DIR` users.
- `CLAUDE.md`: upstream now ships the same thin `@AGENTS.md` wrapper pattern, so this file no longer needs a fork-only restoration. Future merges should accept the upstream wrapper and keep fork behavior canonical in `AGENTS.md`.

Future merge notes:

- Treat these as baseline behavior on later merges. Only carry local patches where the behavior still needs active-user routing, Codex batch support, custom provider compatibility, or user-layer hygiene.
- When upstream adds new scripts, check for root `cv.md`, `portals.yml`, `data/`, `reports/`, `output/`, or `batch/` assumptions before considering the merge done.
- Keep `test-all.mjs` fixtures aligned with the explicit-user contract; upstream tests that create root `data/` or `reports/` fixtures usually need `CAREER_OPS_USERS_DIR` plus `--user test` in this fork.
- When upstream adds process-level coordination around user files, preserve the coordination but bind locks, temp files, and canonical paths to `users/{USER}` rather than root `data/`.

## Multi-User User Layer

The fork centralizes all local candidate data under an ignored per-user folder and requires commands to resolve an active user before reading or writing user-layer files.

Files:

- `lib/user-context.mjs`
- `.agents/skills/career-ops/SKILL.md`
- `AGENTS.md`
- `DATA_CONTRACT.md`
- `.gitignore`
- `scan.mjs`
- `verify-pipeline.mjs`
- `merge-tracker.mjs`
- `normalize-statuses.mjs`
- `dedup-tracker.mjs`
- `tracker.mjs`
- `tracker-parse.mjs`
- `cv-sync-check.mjs`
- `doctor.mjs`
- `analyze-patterns.mjs`
- `add-entry.mjs`
- `agent-inbox.mjs`
- `followup-cadence.mjs`
- `followup-seed.mjs`
- `gemini-eval.mjs`
- `generate-pdf.mjs`
- `generate-cover-letter.mjs`
- `process-quality.mjs`
- `reserve-report-num.mjs`
- `scan-ats-full.mjs`
- `validate-portals.mjs`
- `verify-portals.mjs`
- `reconcile-pipeline.mjs`
- `archive-posting.mjs`
- `match-star.mjs`
- `ollama-eval.mjs`
- `openai-eval.mjs`
- `openai-tailor.mjs`
- `verify-cv-facts.mjs`
- `salary-gap.mjs`
- `funnel-velocity.mjs`
- `stats.mjs`
- `upskill.mjs`
- `invite-match.mjs`
- `reply-watch.mjs`
- `set-status.mjs`
- `batch/batch-runner.sh`
- `batch/aggregate-tokens.mjs`
- `dashboard/main.go`
- `modes/*.md`
- `modes/*/_shared.md`
- `batch/batch-prompt.md`
- `README.md`
- `docs/SETUP.md`
- `docs/SCRIPTS.md`
- `test-all.mjs`
- `update-system.mjs`

What this customizes:

- User-specific files now live under `users/{USER}/`, including `cv.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `voice-dna.md`, `article-digest.md`, `portals.yml`, `data/`, `reports/`, `output/`, `interview-prep/`, `jds/`, `writing-samples/`, and user batch state.
- `users/` is gitignored. The older root-level user paths remain ignored only for migration safety; new work should use `users/{USER}/...`.
- Career-ops commands must have an active user before any user-layer access. Explicit user selection is accepted via command text such as `/career-ops scan <username>`, via `--user <id>` / `--user=<id>`, or via `CAREER_OPS_USER`.
- In agent conversations, an explicit user in one career-ops command establishes the active user for later commands in that same conversation. If no user has ever been specified in the conversation, the agent must stop immediately and ask which user to use.
- The script-level resolver validates user IDs, strips user flags before mode-specific argument handling, and supports `CAREER_OPS_USERS_DIR` for tests or alternate user roots.
- Upstream helper scripts adopted in this merge have been adapted to the same resolver: report reservations use `users/{USER}/reports/`, reverse ATS scans use `users/{USER}/portals.yml` plus `users/{USER}/data/`, portal validation defaults to `users/{USER}/portals.yml`, deterministic CV/cover-letter/image outputs use `users/{USER}/output/`, assessment events use `users/{USER}/data/assessments.tsv`, and analytics/reply/status/tailoring commands read only the active user's tracker, reports, profile, and fact sources.
- Batch token aggregation reads only `users/{USER}/batch/batch-state.tsv`, `users/{USER}/batch/logs/`, and `users/{USER}/reports/`. Its parser/cost helpers remain import-safe, while direct CLI execution requires `--user {USER}` like the batch coordinator that invokes it.
- Report-number reservation now uses upstream's shared tracker-aware allocator core. The fork-specific layer supplies `users/{USER}/reports/` and `users/{USER}/data/applications.md`, retains the explicit-user CLI, preserves test-only report-directory overrides, and blocks tracker collisions rather than renumbering away from report/artifact identity. IDs above 999 remain valid and are padded to at least three digits only for display compatibility.
- `reconcile-pipeline.mjs` remains path-overridable for batch/user layouts: use `--state users/{USER}/batch/batch-state.tsv --pipeline users/{USER}/data/pipeline.md --reports users/{USER}/reports` when invoking it directly for a per-user batch cleanup. The script validates those paths stay inside the repository and rejects file/directory type mismatches before reading or writing.
- The upstream SQLite tracker index is adapted to the same resolver: `node tracker.mjs sync --user {USER}` reads `users/{USER}/data/applications.md` and writes the derived `users/{USER}/data/applications.db`. The database is disposable derived state, not a replacement for the markdown source of truth.
- Upstream tracker merge locking is preserved, but the lock key is derived from the active user's canonical `users/{USER}/data/applications.md` path. Report-link normalization also canonicalizes the user root so symlinked temp/user directories do not produce bogus relative links.
- Preserve tracker/report ID parity in future `merge-tracker.mjs` changes: do not renumber a new TSV entry away from its worker-reserved report number, and do not let raw table-cell pipes corrupt the Markdown tracker row shape.
- Docs and help text must use placeholders like `{USER}`, `<username>`, or `<id>`. Do not hardcode a real local username outside its own ignored `users/{USER}/` directory.

Future merge notes:

- Preserve the explicit-user requirement. Do not silently fall back to root `cv.md`, root `portals.yml`, or other legacy single-user paths.
- If upstream introduces its own profile/user abstraction, compare it against this flow before replacing it. Keep the conversation-context behavior unless upstream provides an equivalent.
- When adapting upstream script changes, route every read/write of user-layer data through `lib/user-context.mjs` or equivalent active-user resolution.
- New upstream scripts are high-risk until checked for root-path assumptions. Search for bare `portals.yml`, `data/`, `reports/`, `output/`, `batch/`, `cv.md`, and `config/profile.yml`.
- Treat upstream voice/style additions such as `voice-dna.md` as user-layer data unless they are explicitly templates or documentation; user-specific writing voice belongs under `users/{USER}/`.
- If upstream changes `merge-tracker.mjs` locking again, preserve the full read/modify/write critical section and atomic write, but keep `APPS_FILE` rooted in `users/{USER}/data/applications.md`; do not restore root `CAREER_OPS_TRACKER` as normal production routing.
- Keep shared templates, modes, scripts, and provider code in the system layer; keep generated reports, CV outputs, trackers, portals, personal profile files, and interview prep in `users/{USER}/`.
- Keep pure helper imports free of candidate-file reads and writes. Modules that bind user paths may require a selected user even on import; synthetic fixtures explicitly select a disposable user. System help and self-tests do not select a real profile.

## Validation of the v1.36 merge

The final code snapshot passed `node test-all.mjs --quick` in an isolated Linux container, with 14,517 passing checks, zero failures, and 19 warnings. Warnings covered the missing-user CV fixture, upstream maintainer-name matches, unavailable Chromium and live-service checks, locale availability, and permission fixtures run as root. All dashboard Go packages passed. The web passed type checking and a production build with no active user. `verify-pipeline.mjs --json` returned a clean result against an isolated empty tracker; this did not inspect or certify a personal pipeline.

## Current merge integration notes

- `path-resolver.mjs` and `lib/user-context.mjs` require a valid user before applying any data-root alias. Missing user-flag operands fail instead of reusing an inherited user. Repeated explicit flags use the last selected ID consistently.
- Web API core commands pass `careerOpsCoreEnv()`, including status writes, PDF generation, scans, analytics, and document ingestion. Preserve any command-specific lock or provider overrides alongside that environment. `stats` and `upskill` routes request `--json` because the fork defaults to readable terminal output.
- `scan.mjs` retains per-target HTTP request/response observation. A swallowed fetch failure must be `unverified_zero`, never a healthy empty board. Declared-field counts cover fetched postings before filtering, and imported scan writers honor explicit history/inbox lane paths.
- `merge-tracker.mjs` updates its occupied-number set as it queues new rows, so two additions in one run cannot claim the same reserved number. Re-evaluation retains the original primary report link and its PDF manifest identity while refreshing the score and notes. Distinct requisitions with an occupied number remain pending for repair.
- `verify-pipeline.mjs` retains broad company/role review and exact canonical-URL subsets, checks report links are files, and binds follow-up/portal checks to the selected tracker workspace. Uninspectable report links use the shared inspection helper and produce a typed warning rather than a fabricated missing-file error. New upstream JD archive findings join the typed JSON contract and reviewed verification flow.
- `batch/batch-output-schema.json` includes the confirmation hold fields. The worker's held example must contain every required schema field exactly once; it carries no tracker, report, or CV artifact. Batch progress parsing preserves empty TSV fields, and a fatal preparation, ownership or integrity failure stops new dispatch and owned siblings and skips merging; ordinary recorded job failures allow independent processing.
- `modes/pdf.md` keeps primary CVs at flat report-linked HTML/PDF paths. Upstream application bundles supplement explicit comparison or reuse work, and ATS variants add `-ats` and never replace the primary PDF manifest entry. Template packs use upstream validation; the previous system-template-only restriction is retired.
- `doctor.mjs --json` is read-only. Onboarding explicitly uses `--init-templates`; maintenance and code review do not initialize personal data. Runtime browser discovery remains necessary before interpreting a missing project-config warning as unavailable tools.
- Core fixtures select fictional users in temporary directories. Flat upstream fixtures may use explicit data-root aliases, marker fixtures clear users-directory overrides, and user-layer fixtures do not include a developer's ignored files. Dashboard status tests account for the fork's dated interaction note while preserving all unrelated cells.

## Data-root overrides after v1.36

An active user is required before a data directory is selected. The default is `users/{USER}/` under the system checkout; `CAREER_OPS_USERS_DIR` can relocate that users directory. Core CLI `CAREER_OPS_ROOT` and `CAREER_OPS_DATA_DIR` select an explicit data directory for the known user. A `.career-ops-data` marker is also an explicit layout override when no users-directory override is configured. None supplies a user ID, and none enables a missing-user command.

The web retains its older `CAREER_OPS_ROOT` meaning as a system-code alias. Prefer `CAREER_OPS_CODE_ROOT` for system code and `CAREER_OPS_DATA_DIR` for an unusual selected-user data layout. `careerOpsCoreEnv()` passes the selected data root and code root separately to child scripts, so a web system-root alias cannot become a child's candidate-data directory. Each selected user needs its own data directory.

Files to reconcile together are `lib/user-context.mjs`, `path-resolver.mjs`, `lib/cli-flags.mjs`, `web/src/lib/user-context.mjs`, and the dashboard/batch child environments. Pure shared path helpers remain standalone so copied CLI fixtures do not gain an undeclared import dependency.

## Web user selection and system metadata

Files:

- `web/server.mjs`
- `web/src/lib/bind-host.mjs`
- `web/tests/lib/bind-host.test.mjs`
- `web/tests/lib/server-launcher.test.mjs`
- `web/src/lib/user-context.mjs`
- `web/src/lib/career-ops.ts`
- `web/next.config.mjs`
- `web/src/lib/core/tracker-lock.ts`
- `web/src/lib/core/text-key.ts`
- `web/tests/lib/user-context.test.mjs`
- `web/README.md`

What this customizes:

- Loads Next's environment files before the launcher chooses its network bind, with development/production mode selection and shell-variable precedence preserved. Network defaults can live in the ignored `web/.env.local` without persisting a user ID. User selection remains explicit and independent of network configuration.
- Adds optional `CAREER_OPS_WEB_BIND_HOST` for one local unicast IP, paired with `CAREER_OPS_WEB_ALLOWED_HOSTS` for accepted hostnames. This lets a machine persist its Tailscale interface address and DNS name without opening other interfaces. Invalid, wildcard, multicast, and unscoped IPv6 link-local binds fail before Next starts; a non-loopback bind requires an explicit non-loopback allowed host. CLI `-H`/`--hostname` overrides the saved bind. With no network settings, the upstream loopback default remains. A specific interface bind does not also serve localhost, and a changed Tailscale IP requires updating the local setting. Machine addresses stay out of committed code; configuration examples are in `web/README.md`.
- Requires `CAREER_OPS_USER` for development and production servers and for every candidate-data root or child-process environment. Missing or invalid IDs fail with configuration guidance before data access; they never select the legacy root layout.
- Validates user IDs with the CLI's format: 1-64 characters, starting with a letter or number and continuing with letters, numbers, dots, underscores, or hyphens. Path-like IDs, including `.` and `..`, are rejected.
- Resolves candidate files under `users/{USER}/`. `CAREER_OPS_ROOT` selects system code, and `CAREER_OPS_USERS_DIR` selects an alternate users directory; relative overrides resolve against the system checkout and the child CLI receives that same absolute directory.
- Loads shared scripts, tracker aliases, canonical states, tracker-lock code, and matching helpers from the system checkout. The selected user's tracker determines the lock key; shared code must not be loaded from that user's data folder.
- Keeps report Blocks A and B expanded, the displayed Job ID tied to the tracker row, and the Machine Summary decision-signals table visible alongside the upstream verdict callout.
- Keeps production builds and unit tests independent of user selection. Server startup validates the configured user after Next loads environment files, while runtime data helpers enforce the same requirement on every access.
- The shared dashboard/onboarding-assistant completeness check recognises compensation targets or a pay floor and explicit remote/hybrid availability already saved in the selected user's `config/profile.yml`, even when the corresponding `_profile.md` sections are missing or still template text. A home city, timezone or currency alone is insufficient. This read-only fallback leaves both files untouched, still reports a missing personalization file independently, and surfaces malformed or unreadable YAML instead of treating it as missing preferences.

Future merge notes:

- Preserve required user selection across the web app and CLI. Adapt new upstream readers and writers to the selected user instead of adding a single-root fallback.
- Keep shared metadata and module loading on the system root while routing candidate data and lock targets through the user root.
- Keep regression coverage for missing/invalid users, path traversal, separate users, alternate users roots, child-process environment parity, and data-independent builds.

## Batch Runner Multi-CLI Processing

The fork makes the batch runner usable with Codex as well as Claude, and adds smaller resumable processing controls for long pipeline runs.

Files:

- `batch/batch-runner.sh`
- `batch/batch-output-schema.json`
- `resolve-parallel.mjs`
- `lib/parallel-config.mjs`
- `batch/README.md`
- `config/profile.example.yml`

What this customizes:

- Replaces the Claude-only worker assumption with a generic headless worker setting.
- Supports upstream `--cli claude|codex|opencode|gemini|qwen`, defaulting to `codex`, and supports `CAREER_OPS_BATCH_CLI` so local runs can select Codex without editing the script.
- Makes `--parallel` optional and resolves worker count as explicit argument, then `users/{USER}/config/profile.yml` `batch.parallel`, then system default `1`. Values outside `1-32` fail closed, and the startup summary records the resolved source.
- Keeps Claude behavior on `claude -p --dangerously-skip-permissions --append-system-prompt-file ...`.
- Adds Codex behavior through `codex exec --dangerously-bypass-approvals-and-sandbox -C "$PROJECT_DIR"`, passing the combined resolved prompt through stdin rather than a huge argv string.
- Requires Codex workers to write their final message through `--output-last-message` and validate it against `batch/batch-output-schema.json`.
- Treats clean Codex completion as `exit 0` plus valid final JSON with `status: "completed"` plus report and tracker artifacts. Timeout-based artifact recovery remains a fallback, not the primary success path.
- Records Codex contract failures explicitly when the final JSON, report, or tracker TSV is missing, instead of leaving the offer in `processing`.
- Recovers stale `processing` rows at the start of a new non-dry-run batch by marking them failed with `stale-processing-state`, so interrupted workers do not block or hide the next run.
- Removes a zero-length macOS Finder `Icon\r` metadata file before releasing or recovering the state-lock directory. Finder can add this file beside the lock PID; without the cleanup, `rmdir` leaves an ownerless `.batch-state.lock` behind and every worker eventually times out waiting for it.
- Keeps report-number allocation inside the state-lock critical section, but derives each report basename with shell parameter expansion instead of spawning one `basename` process per historical report. Large profiles with thousands of reports therefore release the lock within the configured wait window rather than serializing workers behind a multi-minute scan.
- Uses the runner-reserved `REPORT_NUM` as the TSV first column, report link number, and artifact number so parallel workers do not race while calculating tracker numbers from `applications.md`.
- Adapts upstream tracker report-link normalization to the per-user layout: workers still write user-root-relative `[REPORT_NUM](reports/...)` links, and `merge-tracker.mjs --user {USER}` rewrites them relative to `users/{USER}/data/applications.md` before merging.
- Preserves upstream `--limit N` so a batch run can process only the next N pending offers, while keeping the fork's existing user-scoped state, Codex worker, and timeout behavior around that bounded-run flow.
- Preserves upstream `--status` and `--watch` progress monitoring on the fork's user-scoped batch state.
- Preserves upstream `--skip-pdf`, but the flag still runs under the fork's active-user contract and writes user-scoped tracker additions with `❌` / `"pdf": null` rather than bypassing `users/{USER}/batch/`.
- Preserves upstream `awk`-based score arithmetic and malicious-score-safe status summaries; keep these in future merges so batch status rendering does not depend on `bc` and does not interpolate untrusted score text into shell arithmetic.
- Copies `local:jds/...` input rows from `users/{USER}/jds/...` into the temporary JD file passed to the worker. Missing local JD files intentionally become an empty temporary file so the worker can fail or recover using the URL/context path consistently.
- Logs the selected CLI and limit at run start so batch logs show which worker backend handled the run.
- Includes `remaining N` in each offer-start progress line. This counts selected offers that have not yet been launched, after the current launch; it excludes workers already running and does not promise that those workers have completed.
- Preserves upstream session/rate-limit handling: Claude workers can pause a batch with `paused_rate_limit`, resume through `--resume-paused`, and avoid consuming retry budget when a session/rate limit is detected.
- Preserves upstream Claude MCP isolation through `--strict-mcp-config`, while keeping Codex execution separate through the fork's schema-checked final JSON flow.
- Supplies the active user root to the canonical worker mode loader. Targeting configuration comes from that user's profile; candidate narratives and proof points load only after the JD-only Block B importance pass, before matching and scoring.
- Preserves upstream `spend_tier` routing for explicitly selected Claude workers, reading it from the selected user profile. Codex is the runner default and resolves model/reasoning through the shared argument/profile/system hierarchy.
- Treats `--model` as an explicit override for either worker CLI and adds the Codex-only `--reasoning-effort minimal|low|medium|high|xhigh` override, which is forwarded to every Codex batch worker as `model_reasoning_effort`.
- Uses the same model/reasoning resolution for direct Codex batches, run handoff, and reviewed verification: explicit argument, selected-user profile, then `gpt-6.1-sol` / `medium`. Standalone batch defaults to Codex; explicit Claude selection remains supported.
- Preserves upstream pre-screen discards and their audit records under `users/{USER}/batch/logs/discard.log`; sourced helper tests fall back to the fixture-local batch directory without weakening runtime user routing.
- Injects `users/{USER}/modes/_custom.md` after the profile context and keeps the batch CV fact gate/output command on the same `{{USER_ROOT}}/output/{REPORT_NUM}-...` artifact path.

Future merge notes:

- Upstream now supplies the CLI dispatch abstraction, prompt caching, adaptive Claude rate-limit retries, and worker timeout controls. Preserve these directly; the fork still adds per-user routing, confirmation holds, configurable parallelism, and report/artifact identity checks.
- Keep the Codex command rooted at `PROJECT_DIR` so generated reports, tracker additions, and user-layer paths resolve the same way as normal career-ops commands.
- Preserve the schema-checked final JSON contract for Codex workers; do not regress to parsing the free-form transcript as the main completion signal.
- Preserve stale-state recovery and explicit missing-artifact failure reasons. They are needed because a headless worker can write partial artifacts or transcript JSON without producing the required final-message JSON.
- Preserve cleanup of the benign zero-length Finder `Icon\r` entry on lock initialization failure, dead-owner recovery, and normal release. Do not broaden it to delete arbitrary files from the lock directory.
- Keep report basename extraction process-free while the state lock is held; reintroducing an external command per report makes lock duration scale badly for long-lived profiles and causes healthy parallel workers to hit the 30-second timeout.
- Preserve runner-reserved report numbering for tracker TSVs if upstream changes batch merge behavior. Worker-side `applications.md` max calculations are unsafe under parallelism.
- Preserve report numbering beyond 999 if upstream changes `reserve-report-num.mjs`; scans for occupied slots and `--release` validation must accept any positive-width numeric prefix while artifact display can stay padded to at least 3 digits.
- Preserve upstream report-link normalization, but keep its filesystem roots user-scoped. Do not reintroduce root-level `data/applications.md`, root `reports/`, or `CAREER_OPS_TRACKER` as the normal production path.
- Keep upstream `--limit` or an equivalent bounded-run mechanism wired through the fork's user-scoped batch state; it is operationally useful when processing queues under usage limits.
- Preserve `--status` and `--watch` or equivalent progress visibility if upstream changes batch state layout; they should keep reading `users/{USER}/batch/batch-state.tsv`.
- Preserve the active-user requirement for `--status` and `--watch`; upstream root-batch fixtures need `CAREER_OPS_USERS_DIR` plus `--user test` in this fork.
- Preserve `local:jds/...` support because scan and pipeline flows can enqueue saved local JDs rather than only external URLs.
- Preserve upstream rate-limit pause semantics and Claude MCP isolation. If the worker command code is refactored again, test that `paused_rate_limit` does not consume retry budget and Claude workers still include `--strict-mcp-config`.
- Preserve optional parallel resolution as argument, profile `batch.parallel`, then `1`, including the `1-32` validation and logged source. Do not restore a shell-level default that masks the profile value.
- Preserve Codex `--reasoning-effort` validation and forwarding alongside the existing model override; run-workflow relies on both flags to carry its resolved profile values into every batch worker.
- If post-batch pipeline reconciliation is refactored, make sure the reconciler receives the user-scoped state, pipeline, and reports paths together; otherwise it can look for report files in the wrong reports directory.

## Batch Artifact Integrity And Verification Propagation

The fork treats the worker's report, tracker addition, and structured final JSON as one consistency boundary. A worker cannot be marked complete merely because each artifact exists independently, and confidential-employer rows cannot enter a Via-aware tracker without a supported agency or source channel.

Files:

- `batch/batch-prompt.md`
- `batch/batch-output-schema.json`
- `batch/validate-worker-artifacts.mjs`
- `batch/batch-runner.sh`
- `merge-tracker.mjs`
- `verify-pipeline.mjs`
- `run-workflow.mjs`
- `test-all.mjs`
- `tests/workflows/batch-artifacts.test.mjs`
- `tests/workflows/run-workflow.test.mjs`

What this customizes:

- Defines tracker additions as nine required TSV columns plus tagged optional fields. Direct named-employer rows normally have nine columns; agency-mediated and confidential-employer rows append `via={Agency-or-Portal}` rather than being forced into an exactly-nine-column contract.
- Extends the schema-checked worker result with `via`, `company_confidential`, and `tracker`, keeping those control fields explicit instead of inferring them from worker prose or artifact filenames.
- Requires `company_confidential: true` and `company: "?"` to carry a supported Via value. Workers prefer a named agency or recruiter, then a known application/discovery portal; they fail closed when the source material supports neither.
- Adds a deterministic artifact finalizer that parses the report's YAML Machine Summary and the tracker TSV, then validates company, role, score, Via, confidential-company state, and structured final-JSON artifact references as one unit.
- Allows one deliberately narrow repair: when the report has a valid Via and the tracker TSV omitted it, `--repair` fills its headed Via cell or appends the optional Via column with an aligned value. Headerless additions receive a tagged `via=` field. Existing field order and values are preserved. Conflicting Via values, missing report evidence, confidential employers without a channel, malformed optional fields, and other cross-artifact disagreements remain hard failures.
- Worker artifact URL checks percent-encode literal spaces in captured path/query values before identity comparison, accepting the equivalent encoded link without changing job IDs or relaxing exact manual-answer identity. Controls, credentials and private hosts remain invalid. These checks preserve recognized SPA `#/job/{id}` and `#/jobs/{id}` identities through the shared fragment helper. Tracking parameters and trailing slashes retain the strict dispatched-URL comparison; this gate does not adopt the merger's broader dedup equivalence.
- Runs artifact validation before either normal worker completion or timeout artifact recovery can mark a batch item completed. Validation failures are persisted as `artifact-validation:` batch errors for diagnosis and retry.
- Excludes `NNN-RESERVED.md` allocation sentinels from report discovery. A sentinel and a completed `NNN-company-date.md` report can coexist while a worker exits; only the non-reservation report may enter Machine Summary validation, and multiple real reports for one reserved number fail closed instead of depending on filesystem iteration order.
- Releases the allocation sentinel as soon as a concrete real report occupies the number, before cross-artifact validation. The real report itself keeps the number occupied, while genuine validation failures no longer leave misleading sentinel/report pairs behind.
- Adds `batch/batch-runner.sh --user {USER} --recover-artifact-failures` for historical false failures. Recovery launches no model workers and changes a failed row to completed only when its final JSON says completed and its non-reservation report plus tracker addition pass the same cross-artifact validator used by normal completion; incomplete or inconsistent sets remain failed and visible.
- Adds a second integrity gate in `merge-tracker.mjs`: when the destination tracker exposes a Via column, a `company=?` addition without `via=` stays pending and the merge exits nonzero. Legacy trackers without a Via column retain their migration-compatible behavior.
- Makes standalone batch verification authoritative: blocking `verify-pipeline.mjs` errors make `batch/batch-runner.sh` exit nonzero. The internal `--defer-verification` option is used only when `run-workflow.mjs` owns the final structured verification phase, avoiding two competing final gates.
- Makes `verify-pipeline.mjs --json` assign `process.exitCode` instead of terminating with `process.exit()`, allowing warning-heavy JSON larger than the pipe buffer to flush completely before Node exits.
- Makes `run-workflow.mjs` wait for child-process `close` and log-stream completion, capture verifier exit code `1` as structured JSON, retain that payload in the run summary, and report the actual blocking findings instead of an arbitrary truncated warning tail.
- Adds regression coverage for reservation-sentinel exclusion, ambiguous same-number report rejection, deterministic Via completion, cross-artifact Via mismatch rejection, untraceable confidential-employer rejection, merge-time blocking with pending-file preservation, verifier JSON above 64 KiB, and the coordinator's log-drain/structured-failure wiring.

Future merge notes:

- Keep the prompt, final JSON schema, artifact validator, runner gate, and tracker merge guard synchronized. Adding or renaming a cross-artifact field in only one layer weakens the completion contract or causes every worker to fail.
- Do not simplify the TSV rule to exactly nine fields. Batch additions require the canonical header and posting URL identity. Legacy standalone headerless rows remain supported by the merger. Tagged `via=` metadata is part of the integrity model for agency and confidential listings.
- Keep deterministic repair evidence-preserving and one-directional: a missing tracker Via may be copied from the report, but the validator must not invent a Via, overwrite a conflicting value, or mutate the report to match the tracker.
- Keep reservation sentinels out of report discovery. Do not reintroduce a first-match `NNN-*.md` lookup: directory ordering is not a completion contract, and selecting `NNN-RESERVED.md` falsely reports a missing Machine Summary even when the worker's real report is valid.
- Preserve pending TSVs on merge integrity failures so operators can inspect or retry them. Do not silently discard, merge, or renumber a blocked confidential-employer row.
- Preserve the standalone-versus-parent verification split: direct batch runs must fail on blocking verification errors, while the deterministic `run` coordinator may defer the batch-local check only because it immediately performs and records its own structured verification.
- Preserve Node's graceful stdout flush and the coordinator's `close`/stream-drain ordering. Reintroducing immediate `process.exit()` or resolving child phases on `exit` can truncate valid JSON and obscure the real failure.
- If upstream adds an equivalent artifact transaction, retire this layer only after testing missing Via repair, conflicting Via rejection, confidential-source enforcement, pending-file preservation, large verifier output, and structured coordinator failure propagation end to end.

## Custom Provider Layer

The fork adds a large structured provider surface for zero-token scanning and keeps local compatibility filters around some providers that upstream later adopted.

Files:

- `providers/_custom.mjs`
- `providers/pcsx.mjs`
- `providers/swissdevjobs.mjs`
- `providers/germantechjobs.mjs`
- `providers/devitjobs.mjs`
- `providers/devjobsde.mjs`
- `providers/itjobs.mjs`
- `providers/sapo.mjs`
- `providers/portalemprego.mjs`
- `providers/dice.mjs`
- `providers/euremotejobs.mjs`
- `providers/remoteineurope.mjs`
- `providers/workingnomads.mjs`
- `providers/englishjobs.mjs`
- `providers/jobsinenglish.mjs`
- `providers/jobsch.mjs`
- `providers/makeitingermany.mjs`
- `providers/rustjobs.mjs`
- `providers/arbeitsagentur.mjs`
- `templates/portals.example.yml`
- `test-all.mjs`

Provider contract regressions live in `tests/providers/fork-contract.test.mjs`; `verify-portals.mjs` applies its probe budget to raw browser responses as well as JSON/text requests.

What this customizes:

- Adds active structured parsers/fetchers for PCSX, DevITJobs-family boards, DEVjobs.de, jobs.ch, Jobs in English Denmark, Make it in Germany, EU Remote Jobs, ITJobs, SAPO Emprego, Portal Emprego, Dice, Remote in Europe, RustJobs.dev, and related English Jobs boards. Landing.jobs and NoDesk now use unchanged upstream first-party modules; their retired `_custom.mjs` parser branches have been removed.
- Upstream now also supplies first-party Workable, SmartRecruiters, Recruitee, SolidJobs, Workday, RemoteOK, Remotive, IBM, Working Nomads, Arbeitsagentur, Jobstreet, Glints, BambooHR, and Breezy provider modules. Keep those upstream modules separate from the custom provider layer instead of duplicating them in `providers/_custom.mjs`.
- Working Nomads is partly retired from the fork's custom-provider dispatcher: the provider module is now direct/upstream-style, while local config compatibility for `api`, inferred location, `api_params.q/category/location/tags`, and `published_within_days` remains in `providers/workingnomads.mjs`.
- Arbeitsagentur remains an upstream-style provider module, but the fork prefixes positively remote-titled postings with `Remote, ...`, excludes negative remote/homeoffice and explicit onsite claims, and uses `Deutschland` when the API omits a location. Bare `100%` and nationwide labels do not establish remote work.
- The current upstream Arbeitsagentur provider adds `remoteMatch: filter` and `remoteMaxPages` so server-side `homeoffice=nv_true` filtering can complement the fork's title-based remote normalization; preserve both paths because source configs may rely on either.
- The fork's Agentic Engineering Jobs HTML parser is retired in this merge. Upstream's documented REST API provider now supplies equivalent structured fields and avoids coupling the scanner to the board's card markup.
- Keeps small provider adapter modules so `scan.mjs` can load these sources through the upstream provider plugin contract.
- All 16 adapters forward `ctx`. JSON/text calls use upstream `providers/_http.mjs` transports and retry policy, preserving proxy/IP guards, response observation, timeouts, and bounded Retry-After. Async context isolates simultaneous calls. The obsolete `_custom-fetch.mjs` helper and embedded scanner write/filter code have been removed.
- DEVjobs.de and RustJobs.dev intercept browser requests through `ctx.fetchResponse`, block service workers, and refuse automatic redirects. Browser requests share the verifier's four-request probe budget. Source URLs require HTTPS without credentials/custom ports; fixed boards restrict source hostnames. PCSX permits employer-branded public HTTPS hosts and requires explicit `provider: pcsx` or legacy `api_provider: pcsx` for detection.
- PCSX, EU Remote Jobs, and Remote in Europe detail enrichment is off by default. Enable it with `fetchDetails: true`; `detailLimit` defaults to 20 and is capped at 100. Legacy `fetch_details`/`detail_limit` remain aliases, with camel-case settings taking precedence. Probes skip details and pagination respects `ctx.maxPages`. Individual failed details retain the list posting.
- PCSX deduplicates posting identities before detail enrichment and stops a repeated nonempty page with no new valid posting. Offsets still advance by raw response rows, including invalid rows; an invalid-only page does not establish repetition. Request and probe caps remain binding.
- PCSX carries the session cookies the API sets (`_vs`, `_vscid`) back to the same host. Microsoft throttles sessionless requests in a shared bucket: in 2026-10 they got `429 Please try again later` even when spaced, while session requests walked the whole board (2,391 postings in about 5.5 minutes). The API serves 10 rows per page whatever the page-size parameter and sends no `Retry-After` or rate-limit headers, so pages and opt-in detail requests are sequential and spaced, a 429 backs off within the PCSX retry policy, and a 429 that outlasts it after the first page keeps the newest pages read (`sort_by=timestamp`) with a stderr warning instead of failing the board.
- RustJobs.dev is not scannable since 2026-10: Vercel answers every path, `robots.txt` included, with a Security Checkpoint challenge (`429`, `x-vercel-mitigated: challenge`). The browser transport proxies documents through `ctx.fetchResponse`, so the challenge reaches the provider as an HTTP error; the provider reports it as unscannable rather than solving it. Keep the entry disabled until the board publishes an unchallenged source.
- Normalizes available descriptions and dates into `description` and epoch-ms `postedAt`, using upstream HTML/entity helpers. PCSX distinguishes posting `externalId` from employer `requisitionId` and rejects malformed response shapes. Working Nomads retains description/date fields. Employer HTTPS application URLs take precedence over board URLs, with the board retained as `sourceUrl`; unusable alternatives fall back to the board. DevITJobs exposes explicit annual salary bounds in the upstream numeric shape; unstructured salary strings remain `salaryText`.
- EU Remote Jobs reads the public server-rendered category pages (`careers_url`, then linked `/page/N/`), because the operator closed the RSS feed and REST API (401) and `/job-listings/` loads through `jm-ajax`. A legacy feed `api:` is ignored. Do not reintroduce the feed, `jm-ajax`, or robots-disallowed `search_*` query URLs.
- Portal Emprego treats a `div.no_results` that is the first child of `#listCont` as an explicit empty search, so a keyword with no results is skipped instead of failing the whole board.
- Jobs.ch search and pagination URLs encode spaces as `%20`: since 2026-10 the site answers `+` with a 301, which the no-redirect transport reported as `fetch failed`. A page that reports hits but carries no usable rows now throws instead of returning zero.
- DEVjobs.de and Make it in Germany are not scannable since 2026-10. DEVjobs.de answers Node's client with a Cloudflare managed challenge (`403`, `cf-mitigated: challenge`) on every HTML path, and its `robots.txt` disallows `/jobs/search?` and `/api/`; Make it in Germany serves a Radware "Verifying your browser" page everywhere, and its `robots.txt` disallows the `tx_solr[q]`/`tx_solr[filter]` parameters. Both providers now name the challenge, and the DEVjobs browser path reports Cloudflare's interstitial at once instead of waiting for it to clear. Keep both entries disabled; the Arbeitsagentur provider already carries the postings Make it in Germany relists.
- Extends the example portal config with these discovery sources and custom notes/parameters.
- Adds offline contract tests for every adapter, concurrent contexts, shared retries, request safety, browser transport/probe bounds, optional details, metadata, salary, malformed feeds, and remote classification.
- Keeps upstream provider tests intact for Workable, SmartRecruiters, Recruitee, SolidJobs, and scanner rediscovery behavior.

Future merge notes:

- If upstream adds one of these providers, compare behavior before keeping both. Prefer upstream modules when they produce equivalent fields and filtering; otherwise keep only the missing compatibility layer, as done for Working Nomads filters in this merge.
- Keep fork adapters on upstream context transports and retry helpers. Do not restore bare fetch, independent timeouts/backoff, automatic redirects, or unbounded detail enrichment. Browser-backed providers must remain within the same request guards and probe budget.
- Keep upstream Workable, SmartRecruiters, Recruitee, IBM, Arbeitsagentur, Jobstreet, Glints, BambooHR, and Breezy tests intact when changing scanner/provider plumbing; they are now part of the upstream provider baseline that the fork should build around.
- Preserve the Arbeitsagentur remote/no-remote normalization unless upstream adds an equivalent signal in the provider output or scan filtering layer.
- Keep Agentic Engineering Jobs on the upstream REST API path unless that API is removed; do not restore the retired HTML parser without a verified API failure and equivalent live-board regression evidence.
- 2026-10-21: the API failure is verified (every data-backed `/api/v1` endpoint answers 500 `INTERNAL_ERROR` while `/api/v1/health` is ok), but no live board exists to regress against: the homepage, `/jobs` and `sitemap.xml` are prerendered snapshots frozen at 2026-07-27 and uncached pages also 500. The homepage fallback was rejected because it would present that stale snapshot as live postings. The provider now fails with the request URL and API error code; see its header comment.
- `templates/portals.example.yml` is high-conflict. Preserve upstream example improvements, then reapply only still-useful local source definitions.

## Scan Company And Location Filters

The fork adds scanner-side policy filters so per-user portal configs can reject forbidden employers and tune location matching before offers are added to the pipeline.

Files:

- `scan.mjs`
- `test-all.mjs`
- `users/{USER}/portals.yml`

What this customizes:

- Adds exported `buildCompanyFilter(company_filter)` support in `scan.mjs`.
- Reads optional `company_filter.block` from the active user's `portals.yml`.
- Builds the global location filter from `location_filter`, but lets each tracked company or job-board entry override it with its own `location_filter`. This is useful for broad global filters plus source-specific exceptions such as Germany-only Arbeitsagentur boards.
- Rejects provider results whose `job.company` contains a blocked company keyword, case-insensitively.
- Applies the company block before title, location, URL, and company-role dedupe checks, so forbidden employers do not consume dedupe slots or enter `data/pipeline.md`.
- Prints `Filtered by company: N removed` in scan summaries when a company block list is configured.
- Adds `test-all.mjs` coverage that checks the scanner advertises the company block path and verifies `buildCompanyFilter` rejects configured employers while passing unrelated companies.
- Preserves upstream `content_filter` as a separate title/description filter; do not collapse it into the company block filter because the two policies answer different questions.
- Preserves upstream `data/blacklist.md` as a user-owned exact company block layer and `company_aliases` as a dedupe identity layer; neither replaces the fork's substring-based `company_filter.block` policy.
- Applies upstream posting-age, `postedAt`, fingerprint, and scan-run metrics inside the active user's pipeline/history/run files so scanner evidence never falls back to root `data/`.

Future merge notes:

- Preserve this hook while user profiles need hard employer exclusions such as direct partners, conflicts of interest, or blocked industries.
- If upstream adds first-class employer/company exclusion support, migrate `company_filter.block` configs to the upstream schema or keep this key as a compatibility alias.
- Keep the filter tolerant of missing or malformed company names; unknown company values should pass to downstream evaluation rather than being silently dropped.
- Preserve per-target `location_filter` precedence over the global filter. If upstream adds provider-specific scan filters, keep the current config shape as a compatibility alias or provide a migration for user portal configs.
- Keep LinkedIn authenticated scanning's `linkedin_searches.employer_blocklist` separate unless upstream unifies authenticated and zero-token scan filtering under one shared company-block schema.
- Preserve upstream metadata sanitization (`formatPipelineOffer` / `formatScanHistoryRow`) when changing filter order so hostile provider strings cannot write extra pipeline or TSV fields.

## Scanner Duplicate Reopen Semantics

The fork treats a reopened posting as the same opportunity when the scanner rediscovers a company/title match that previously closed.

Files:

- `scan.mjs`
- `test-all.mjs`
- `dashboard/internal/data/career.go`
- `dashboard/internal/data/career_test.go`
- `users/{USER}/data/applications.md`
- `users/{USER}/data/scan-history.tsv`

What this customizes:

- `scan.mjs` parses tracker rows by header names, splits company/title dedupe state into active, closed, and reopenable rows, and keeps the exact company/title key as the duplicate identity for this behavior.
- If a provider returns a live posting whose company/title matches a `Closed` row and no normal active row exists, the scanner counts it as a duplicate, does not append it to `users/{USER}/data/pipeline.md`, and reopens the original row in `users/{USER}/data/applications.md` by setting status to canonical `Evaluated`.
- Reopening updates the original tracker row's date to the scan date and appends `Reopened {YYYY-MM-DD}: duplicate live posting found at {URL}` to the notes column. The row number, score, PDF marker, report link, company, and role are preserved.
- If the scanner later finds another URL for an already reopened opportunity, it appends that URL only while the row remains Evaluated, preserving its original date. Applied, Responded, Assessment, Interview, Offer, Hired, Rejected, Discarded and SKIP decisions remain intact. An already-recorded or expired URL does not reopen the row. Requested liveness verification includes reopening candidates and requires an active verdict before reopening.
- Reopening uses the shared tracker transaction, rechecks the current status under the lock, and records only applied URL changes in scan history. Actual Closed-to-Evaluated transitions enter the status ledger with the existing `correction` source and a scanner note.
- Reopened duplicate URLs are written to `users/{USER}/data/scan-history.tsv` with status `reopened_closed_duplicate`, so URL enrichment and audit trails can see the fresh listing without turning it into a new application.
- Dashboard parsing extracts reopened URLs from tracker notes and uses the last reopened URL as the current job URL. This intentionally beats stale `**URL:**` values in old reports whose original posting has closed.
- Regression coverage lives in `test-all.mjs` for repeated scanner duplicate reopen writes and in `dashboard/internal/data/career_test.go` for latest-reopened-URL selection.

Future merge notes:

- Preserve the single-row invariant: closed reposts and duplicate-of-duplicate reposts should refresh the original tracker row, not create new tracker rows or pending pipeline items.
- Preserve `Evaluated` as the canonical reopened state. Dashboard may label this bucket as `OPEN`, but `OPEN` is not a tracker status.
- Keep reopened URL extraction ahead of report-header URL extraction in dashboard data parsing, otherwise old report headers can make the `o` open action point back to a stale closed URL.
- Keep `reopened_closed_duplicate` as a scan-history audit status unless upstream adds an equivalent explicit reopened/reposted status.

## CV Output Naming

The fork standardizes generated CV artifacts around the report number.

Files:

- `modes/pdf.md`
- `modes/latex.md`
- `batch/batch-prompt.md`
- `openai-tailor.mjs`
- `templates/README.md`

What this customizes:

- Requires generated CV artifacts to use `output/{REPORT_NUM}-{company-slug}-{YYYY-MM-DD}.{html|pdf|tex}`.
- Removes candidate-name/ad-hoc CV output names from the instructions.
- Keeps report, tracker, PDF, HTML, and LaTeX artifact names aligned.
- Adapts the headless OpenAI-compatible tailor to the same basename and prints an explicit-user PDF command. Upstream's role-slug filename addition is redundant here because each report number already identifies one company/role evaluation.

Future merge notes:

- Preserve this if local workflows rely on report-numbered artifacts.
- If upstream adopts the same naming contract, remove the local instruction patches and keep only any wording still needed for this fork.
- If upstream changes headless tailoring names again, preserve report-number identity and active-user output containment; human-readable role text belongs in the report/tracker rather than becoming a second artifact identity.

## Batch PDF Gate

The fork prevents batch workers from generating tailored CV PDFs for low-fit or explicitly skipped roles.

File:

- `batch/batch-prompt.md`

What this customizes:

- Adds a PDF gate before the batch worker creates CV HTML or calls `generate-pdf.mjs`.
- Uses upstream's shared `auto_pdf_score_threshold` config from `users/{USER}/config/profile.yml`, defaulting to `3.0`, so interactive pipeline and batch processing share the same score threshold.
- Skips HTML/PDF generation when `final_decision` is `Skip`, even if the numeric score is higher.
- Skips HTML/PDF generation when `_profile.md` applies an explicit hard stop, such as a blocked company/domain or consultancy/staff-augmentation model.
- When a batch worker does generate a tailored CV, it may reorder and rewrite bullets inside each Work Experience block for JD relevance, but it must preserve the reverse-chronological order of the experience blocks themselves.
- Requires the report header to say `**PDF:** not generated - run /career-ops pdf {company-slug} to create on demand` when the gate blocks PDF generation.
- Requires the tracker TSV PDF column to use `❌` and the worker JSON summary to use `"pdf": null` when no PDF is generated.

Future merge notes:

- The configurable score threshold is now upstream behavior and should be preserved. The remaining fork-specific gate is the extra block for `Skip` decisions and `_profile.md` hard stops.
- Preserve the Skip/hard-stop gate unless upstream adds an equivalent policy to avoid wasting time and artifacts on offers the candidate should not apply to.
- Keep the gate aligned with `modes/pipeline.md`, which now says the full auto-pipeline generates PDFs only when the offer score meets the resolved `auto_pdf_score_threshold`.
- If upstream changes the batch worker prompt format, reapply the rule at the first point after score/final decision are known and before any HTML/PDF artifact is written.
- Preserve the Work Experience ordering constraint if upstream rewrites the CV tailoring instructions; relevance sorting should not make an older role appear more recent than it was.

## CV Relevance, Emphasis, And Page Defaults

The fork lets a user profile enforce a readable page budget while tailoring project selection, experience depth, and visual emphasis to each job.

Files:

- `build-cv-html.mjs`
- `modes/pdf.md`
- `batch/batch-prompt.md`
- `users/{USER}/modes/_custom.md`

What this customizes:

- Tailored CVs include at most the 3-4 projects most relevant to the target role; less-relevant projects may be omitted rather than receiving mandatory compact entries.
- Work Experience remains reverse chronological, but each block excludes bullets that are less relevant to the JD or duplicate another section. The wording is intentionally an exclusion rule rather than a fixed "only the top N bullets" cap, so relevant supporting evidence can remain when it adds value.
- Structured CV payloads may use selective Markdown-style `**short phrase**` emphasis in the professional summary, experience bullets, project descriptions, and education descriptions. Upstream `generate-pdf.mjs` converts these markers to `<strong>` in its temporary rendering HTML. `build-cv-html.mjs` escapes source text and leaves the markers literal, so saved HTML previews do not show the PDF's bold emphasis.
- Direct-HTML generation may use `<strong>` for the same short, evidence-bearing phrases. Whole sentences should not be bolded, and emphasis must never introduce or imply a claim absent from the user's approved sources.
- Profiles using this balanced selection policy enforce a strict two-page result with `--max-pages=2 --strict-pages`; overflow must be editorially compressed and rerendered before the artifact is reported or indexed as successful. The profile must not infer a one-page target from geography or market convention, shrink template typography/margins, or fabricate content to fit.

Future merge notes:

- Preserve the asymmetric selection rule: Projects are capped at the 3-4 most relevant, while Work Experience uses relevance-based exclusion within every retained chronological block rather than a fixed bullet count.
- Preserve the PDF renderer's Markdown emphasis normalization. The earlier fork renderer and emphasis self-test in `build-cv-html.mjs` were dropped by the upstream merge; the current builder does not render `<strong>` from structured payload markers.
- If upstream adds native rich-text fields, migrate existing `**...**` payload support while documenting any change to saved HTML preview behavior.
- Do not implement the two-page limit through automatic truncation. Strict overflow should trigger an editorial rewrite and rerender; one-page output remains an explicit opt-in.

## CV experience parsing

The shared `lib/cv-markdown.mjs` parser also accepts experience headings written as `### Title, Company, YYYY-YYYY`, including commas inside company names. `cv-title-check.mjs`, `verify-cv-structure.mjs`, and the doctor's CV shape check use this interpretation. An explicit parenthesized Freelance, Self-employed, or Independent label supplies the employer key when a separate employer is absent; the source's literal title and dates remain intact. Locations and missing employers are not inferred. These entries remain scoped to recognized Experience sections and participate in title and chronological-order checks alongside upstream company/location headings. Regression tests use fictional source data in `tests/cv-inline-experience.test.mjs`.

Preserve this format support when merging upstream CV parser changes. Candidate CV files remain authoritative and do not require reformatting to make these checks run.

## CV Theme Overrides

The fork makes the HTML/PDF CV palette configurable from `config/profile.yml`.

Files:

- `generate-pdf.mjs`
- `templates/cv-template.html`
- `config/profile.example.yml`
- `modes/pdf.md`
- `batch/batch-prompt.md`

What this customizes:

- Adds CSS variables to the HTML CV template.
- Reads optional `cv.theme` keys from `config/profile.yml`.
- Injects safe CSS variable overrides at PDF render time.
- Documents supported keys such as `primary`, `accent`, `background`, `text`, `muted`, `rule`, and related color tokens.
- Preserves upstream ATS text normalization in `generate-pdf.mjs`; the theme override should layer on the normalized HTML rather than bypassing it.
- Preserves upstream temp-file `file://` rendering in `generate-pdf.mjs`, so local images/resources load through `page.goto(...)` while `cv.theme` overrides and user-scoped `cv.md` section validation still run before rendering.
- Fails PDF generation before Playwright launch if the rendered HTML still contains unresolved `{{PLACEHOLDER}}` tokens, so optional template fields must be resolved or omitted instead of leaking into candidate-facing PDFs.

Future merge notes:

- If upstream changes the CV template, keep the variable names stable or provide a migration for existing `cv.theme` configs.
- If upstream introduces first-class theming, compare key names and remove this local implementation if upstream covers the same use case.
- If upstream changes PDF rendering again, verify it still handles local images/resources, data-URL font inlining, `load` wait semantics, unresolved-placeholder rejection, `cv.theme`, and `users/{USER}/cv.md` validation in one focused smoke test.

## Dashboard Improvements

The fork keeps dashboard data per-user and improves date display in the Go dashboard.

Files:

- `package.json`
- `AGENTS.md`
- `.agents/skills/career-ops/SKILL.md`
- `README.md`
- `README.*.md`
- `CONTRIBUTING.md`
- `docs/SETUP.md`
- `docs/ARCHITECTURE.md`
- `dashboard/main.go`
- `dashboard/main_test.go`
- `dashboard/internal/data/career.go`
- `dashboard/internal/data/career_test.go`
- `dashboard/internal/data/derive.go`
- `dashboard/internal/data/derive_test.go`
- `dashboard/internal/model/career.go`
- `dashboard/internal/ui/screens/pipeline.go`
- `dashboard/internal/ui/screens/pipeline_test.go`

What this customizes:

- Requires dashboard builds and runs to use the per-user binary layout. The old root wrapper's removal is already incorporated upstream behavior, rather than an active fork delta.
- Dashboard binaries are built into `users/{USER}/`, e.g. `cd dashboard && go build -o ../users/{USER}/career-dashboard .`.
- Cross-compiled dashboard binaries are also written into `users/{USER}/`, e.g. Windows x64 uses `GOOS=windows GOARCH=amd64 go build -o ../users/{USER}/career-dashboard.exe .`.
- The dashboard infers the user folder from its own location or the current directory, so the per-user binary runs without `--path`; `--path` remains available for unusual layouts.
- Adds `ListingDate` to dashboard application data.
- Extracts listing/posting dates from reports when present.
- Reads `data/scan-history.tsv` before the old root-level fallback.
- Shows listing date in the dashboard, falling back to the tracker processed date when no listing date is known.
- Uses a dashboard-specific fast parse path for startup and refresh: `ParseApplicationsForDashboard(...)` reads the tracker plus cheap scan/batch indexes without opening every linked report file.
- Keeps the full `ParseApplications(...)` report-enrichment behavior for non-dashboard callers that still need eager report URL/listing-date fallback.
- Lazily hydrates dashboard report summary fields (`Archetype`, `TL;DR`, `Remote`, `Comp`, and report-derived listing date) only for rows in or near the visible viewport, then renders those details in place as async loads complete.
- Runs viewport report reads inside Bubble Tea commands and returns loaded data through `PipelineReportLoadedMsg`; file IO does not happen inside the main `Update` handler, so keyboard navigation is not blocked by report parsing.
- Tracks report paths already being loaded so fast scrolling does not enqueue duplicate reads for the same visible report.
- Treats the original job URL as action-lazy data: viewport summary prefetches do not parse `**URL:**`; if the selected row has no known URL and the user presses `o`, the dashboard loads that selected report with URL extraction enabled and opens it only after the load returns a URL.
- Customizes the dashboard tab row for triage: removes the visible `ALL` and `TOP ≥4` tabs, labels the canonical `Evaluated` bucket as `OPEN` and makes it the first/default tab, keeps `OFFER` between `INTERVIEW` and `REJECTED`, and renders the tabs inline in the title row between `CAREER PIPELINE` and the right-side offer/average summary.
- Adds a canonical `Closed` tracker status for postings that closed before application; `Closed` has its own dashboard tab, is excluded from actionable/active metrics, and takes over closed/expired aliases that previously collapsed into `Discarded`.
- Simplifies the dashboard chrome by removing the secondary status-count row (`Applied:x`, `Evaluated:x`, `Skip:x`, etc.) and the separate `Sort`/`View`/shown-count row; the current sort label now lives in the bottom help row beside the keyboard shortcuts.
- Makes the dashboard flat-only: grouped view mode and the `v` view toggle are removed because the compact inline tabs and table layout make grouped rendering redundant.
- Customizes dashboard table defaults for scanning: the date column is labelled `DATE` instead of `APPLIED`, the last-contact column is labelled `CONTACT` instead of `LAST`, and the `PDF` plus `CONTACT` columns are visible by default while `RPT` remains optional.
- Treats dashboard status changes as job-ad interactions for the `CONTACT` column: status cells remain canonical, while the dashboard appends a dated `Status changed to ...` note and derives `CONTACT` from the latest note/status ISO date or the tracker date fallback.
- Renders the selected dashboard row as one continuous highlight by applying the selection background to every cell, separator, and trailing fill area instead of wrapping the already-styled row after composition.
- Removes passive dashboard/viewer background fills from the dashboard title, status summary, help row, job viewer title/footer, fenced code blocks, and inline code so background highlighting is reserved for actual interactive selections.
- Rewrites a report's displayed `**Batch ID:**` header to `**Job ID:**` with the selected tracker row's number in the dashboard viewer. The underlying report file retains its original batch provenance; the displayed ID is the canonical user-facing tracker identity.
- Reserves six terminal cells for the dashboard's tracker ID column so `#11729` remains fully visible. The report viewer normalizes CRLF and legacy CR line endings before rendering, preventing carriage returns from overwriting terminal cells while preserving source files unchanged.
- Displays the report's `## Machine Summary` section after all other sections in the TUI viewer, including when it precedes the evaluation in the saved report. Its code block and nested headings move together; source report ordering remains unchanged for machine consumers.
- Restores the viewer's PDF header as a clickable filename instead of generic labels such as `Two-page A4 CV`. Paths stay within the selected user's output directory; missing files are labelled, and outside paths are rejected.
- Opens PDFs directly in the browser through a dashboard-owned HTTP server bound only to the host's Tailnet IP on an ephemeral port. Startup discovers its own Tailscale DNS name/IP once with a two-second timeout. Cmd-click on macOS or Ctrl-click on Windows/Linux opens the link in the viewing machine's browser. There are no VS Code links, application-opening confirmations, SSH account settings, or external redirects. Only opaque links registered by the viewer are accepted, and only regular PDFs inside the selected user's output directory are served. An `os.Root` directory handle prevents symlink escapes even after registration. Responses use `application/pdf` with inline disposition and support HEAD/range requests; unknown links and non-PDF targets are rejected. The server stops with the dashboard, so links last for that dashboard session. No separate web dashboard is needed. Missing Tailnet discovery or server startup failure displays an unavailable marker; the filename remains visible for manual opening. General report Markdown cannot supply arbitrary local-file targets.
- Preserves upstream derived fields, shared sort comparator, and new dashboard sort modes, but keeps the listing-date sort on the fork's `dashboardDate()` fallback so reports/scan-history listing dates win when available.
- Adds a `#id` sort mode to the dashboard sort cycle; it orders tracker rows numerically by ID with the newest/highest IDs first.
- Preserves upstream customizable columns / column picker behavior and cross-platform default-app open helpers while keeping user-root normalization for report/PDF targets.
- Preserves upstream in-viewer status editing and status-cell-only row refresh while keeping the fork's `NewViewerModelWithFileRoot(...)` report/PDF link rewriting against the resolved user folder.
- Preserves upstream EUR/GBP/CHF compensation parsing and additional international-city derivation in dashboard pipeline data without changing the fork's per-user dashboard root inference.
- Preserves upstream TUI language switching and localized status/column labels while keeping the fork's compact inline tab layout and responsive single-line help row.
- Adds `Hired` between `Offer` and `Rejected` without collapsing the fork's distinct `Closed` tab; `Hired` counts as having reached offer in analytics, while `Closed` remains pre-application and excluded from funnel progression.
- Combines upstream's discard-reason picker with the fork's contact semantics: a discard/skip transition and its reason are written together, while the Notes cell also retains the dated `Status changed to ...` interaction used by the `CONTACT` column.

Future merge notes:

- If upstream changes dashboard models or table rendering, preserve the listing-date fallback behavior unless upstream provides a better equivalent.
- Do not reintroduce the root dashboard wrapper unless upstream provides a better per-user binary flow.
- Keep upstream sort helper tests and add/adjust fork tests around listing-date fallback when dashboard parsing changes.
- Keep upstream column picker and OS-open tests intact when dashboard navigation changes; fork-specific tests should focus on user-root path inference and listing-date fallback.
- Keep status-picker tests and user-root PDF rewrite tests together if the viewer constructor changes again; both behaviors must coexist.
- Preserve the dashboard fast path on future parser changes: startup/refresh should not read every report, viewport summary prefetch should stay async and duplicate-suppressed, and URL extraction should remain tied to the explicit `o` open-original action unless the URL is displayed directly in the list.
- Preserve the fork's triage-oriented tab layout unless upstream adds equivalent configurability: dashboard label `OPEN` for canonical `Evaluated` first/default, `OFFER` visible between `INTERVIEW` and `REJECTED`, no visible `ALL` or `TOP ≥4`, and tabs rendered inline in the first TUI row between the title and summary.
- Preserve `Closed` as distinct from `Discarded`: closed/expired postings map to `Closed`, candidate-discarded rows map to `Discarded`, and actionable metrics keep `Closed` out of actionable views.
- Preserve the fork's lean dashboard chrome unless upstream adds equivalent configurability: no secondary status-count row, no separate sort/view/shown row, no grouped view toggle, and current sort shown only in the bottom help row.
- Preserve the fork's dashboard table defaults unless upstream adds user-configurable column presets: flat-only rows, `DATE`/`CONTACT` labels, and visible `PDF` plus `CONTACT` columns.
- Preserve the `CONTACT` interaction semantics: manual dashboard status changes should update the tracker notes with a dated interaction, and parser changes should continue reading the latest ISO date from notes plus legacy dated status cells before falling back to the tracker date.
- Preserve atomic discard updates together with `CONTACT` semantics: selecting a discard/skip reason must write status, dated interaction, and the `DISCARD:`/`SKIP:` tag in one tracker update without replacing existing notes.
- Preserve the selected-row highlight behavior when table rendering changes: the highlight should cover the full row across all visible columns, separators, and trailing whitespace.
- Keep passive dashboard/viewer chrome unhighlighted when theme or renderer code changes; only selected rows and active picker rows should use background fills.

## Scanner Documentation And Defaults

The fork updates user-facing scanner descriptions to match the expanded structured provider surface.

Files:

- `README.md`
- `AGENTS.md`
- `docs/SCRIPTS.md`
- `docs/CUSTOMIZATION.md`
- `templates/README.md`
- `templates/portals.example.yml`

What this customizes:

- Describes direct scanning beyond Greenhouse/Ashby/Lever, including PCSX and structured job portals.
- Clarifies broad-discovery search queries for boards where direct access is unreliable.
- Keeps scanner documentation aligned with the fork's provider modules.
- Documents upstream `scan_history.recheck_after_days`, salary filtering, `scan:full`, scan handoff follow-up, and portal validation while keeping all examples user-scoped.

Future merge notes:

- Reconcile upstream copy edits first, then update only the provider lists and behavior statements that remain fork-specific.
- Keep `scan-ats-full.mjs` and `validate-portals.mjs` user-scoped unless upstream introduces equivalent multi-user routing.
- If upstream changes scan-history TTL, salary filters, or rediscovery semantics, preserve the fork's company block filter and authenticated scan age filter as separate local policy layers.

## Scan Handoff Artifact And Mode

The fork persists the full Agent/WebSearch follow-up list from the zero-token scan and exposes a separate command mode to process it on demand.

Files:

- `scan.mjs`
- `modes/scan.md`
- `modes/scan-handoff.md`
- `.agents/skills/career-ops/SKILL.md`
- `AGENTS.md`
- `DATA_CONTRACT.md`
- `README.md`
- `test-all.mjs`

What this customizes:

- `scan.mjs` writes `users/{USER}/data/scan-handoff.json` on every non-dry-run scan, using schema `career-ops.scan-handoff.v1` and including the complete handoff list even when terminal output truncates after the first 25 entries.
- The handoff artifact is user-layer data because it reflects the active user's `portals.yml` and latest scan state; updates must not modify or delete it.
- `/career-ops scan` remains a zero-token scanner command and does not automatically continue into the handoff flow.
- `/career-ops scan-handoff` reads the saved artifact and runs the agent/WebSearch follow-up workflow from `modes/scan-handoff.md`, including Playwright liveness verification before WebSearch-derived URLs reach `users/{USER}/data/pipeline.md`.
- `test-all.mjs` covers the handoff JSON payload shape and field sanitization.

Future merge notes:

- Preserve the separation between `scan.mjs` as the deterministic zero-token producer and `scan-handoff` as the agent/WebSearch consumer unless upstream ships an equivalent explicit resume command.
- If upstream adds a handoff artifact, migrate to the upstream schema only if it remains user-scoped and stores the complete list, not just the terminal preview.
- Keep WebSearch-derived additions gated by Playwright liveness verification; search snippets must not decide posting activity.

## Run Full Workflow Mode

The fork exposes `/career-ops run` as the executable end-to-end coordinator. Standalone `scan` remains a discovery command; invoking it does not authorize evaluation or CV generation.

Files: `modes/run.md`, `.agents/skills/career-ops/SKILL.md`, `run-workflow.mjs`, `docs/SCRIPTS.md`.

- Drains existing pending work as well as newly scanned jobs. The old pending-count-delta gate is retired.
- Processes configured sources, current scan handoff, authenticated LinkedIn discovery, liveness, stable-ID synchronization, batch evaluation/CV output, tracker merge, reconciliation, and reviewed verification. Dayforce/Interamt are configured-source phases, HN uses the canonical scanner, and full ATS sweeps remain an explicit opt-in.
- Keeps posting-specific agency/JD holds, login/CAPTCHA requirements, quota pauses, and verifier decisions as visible pending actions while independent sources/jobs continue. Generic batch authorization never supplies a posting answer.
- Counts blocked `[!]` rows and unfinished batch jobs as remaining work. A completed sourcing subprocess or zero new discoveries never imply a completed inbox.
- Supports inbox-only runs, explicit dispatch limits, bounded recovery, exact-answer resume, paused-run resume, and validated verification checkpoint resume.

Future updates must inspect the executable runner and headless worker path against every changed upstream mode/command/data contract, even without a conflict in `run-workflow.mjs`. Prefer shared upstream workflow instructions and validators to copied rubrics. Verify actual queue behavior with isolated executable fixtures; source-text wiring checks alone are insufficient.

## Full ATS Discovery And Portal Validation

Upstream added reverse ATS discovery and portal schema validation. The fork keeps both features but routes their default files through the active user layer.

Files:

- `scan-ats-full.mjs`
- `validate-portals.mjs`
- `scan.mjs`
- `docs/SCRIPTS.md`
- `package.json`
- `test-all.mjs`

What this customizes:

- `scan-ats-full.mjs --user <username>` reads `users/{USER}/portals.yml`, writes to `users/{USER}/data/pipeline.md`, records `users/{USER}/data/scan-history.tsv`, and caches public ATS company directories under `users/{USER}/data/cache/ats-companies/`.
- Upstream `scan-ats-full.mjs --json` reserves stdout for one machine-readable result, sends human progress to stderr, reports degraded dataset/cap/undated metadata, and supports `--include-undated` and `--shuffle`; the fork keeps those semantics while still requiring `--user <username>` for real scans.
- `scan.mjs` exports `configureScanUserPaths(ctx)` so reverse ATS discovery can reuse the regular pipeline and scan-history writer without duplicating path logic.
- `validate-portals.mjs --user <username>` defaults to `users/{USER}/portals.yml`, while `--file` and `--self-test` remain data-independent for tests and template validation.
- `npm run scan:full -- --user <username>` and `npm run validate:portals -- --user <username>` are the normal production commands.

Future merge notes:

- If upstream changes the reverse scan writer or dedupe logic, keep it on the same configured scan helper path as `scan.mjs` so dedupe and pipeline format do not diverge.
- If upstream changes `--json` output again, keep stdout clean JSON in JSON mode and keep user/path logging on stderr; callers may parse stdout directly.
- If upstream makes portal validation part of CI only, keep explicit `--file` support for templates and explicit `--user` support for real user portals.

## Authenticated Scan Sessions

The fork adds a Playwright-backed authenticated scanner and keeps its browser sessions per career-ops user.

Files:

- `scan-auth.mjs`
- `scan-auth/linkedin.mjs`
- `modes/scan-auth.md`
- `package.json`
- `DATA_CONTRACT.md`
- `AGENTS.md`
- `.agents/skills/career-ops/SKILL.md`
- `README.md`
- `docs/SCRIPTS.md`
- `test-all.mjs`

What this customizes:

- Adds `node scan-auth.mjs --user <id> [--login] linkedin` / `npm run scan-auth -- --user <id> ...`.
- Routes authenticated scan data through the active user layer: `users/{USER}/portals.yml`, `users/{USER}/jds/`, `users/{USER}/data/pipeline.md`, and `users/{USER}/data/scan-history.tsv`.
- Stores persistent browser sessions outside the repo under `~/.scan-auth/users/{USER}/{PORTAL}/profile/`, so different users can keep separate LinkedIn sessions.
- Refuses to silently reuse the older shared profile path `~/.scan-auth/{PORTAL}/profile/`; if that legacy profile exists, the scanner warns and asks for a per-user login.
- Treats browser profiles as credential material and keeps `.scan-auth/` ignored if someone overrides the auth directory into the checkout.
- Exports LinkedIn `randomDelay()` for test coverage and accepts both fixed numeric delays and `[min, max]` ranges, falling back to default page delays for malformed config.
- Uses `scan-auth/linkedin-detail.mjs` to identify the selected LinkedIn JD through dedicated description containers or an English/Portuguese job-section heading. Company biographies and unscoped expandable text cannot satisfy readiness; hidden, mismatched and ambiguous descriptions remain unavailable. Expands only the JD's own control, at most once, and waits for full text within the same five-second allowance. Unexpanded teasers remain unavailable. Switching cards rejects unchanged text from the previous posting; loading never triggers another navigation or fetch.
- Recognizes LinkedIn's visually rendered `expandable-text-button` even when the button has `aria-hidden="true"`. This exception stays within the selected job section and never makes an aria-hidden panel or company biography eligible. Child spans of an already expanded button cannot trigger another expansion.
- Counts both readable captures and missing-JD holds toward `max_results_per_search`. Missing JDs count as extraction errors, and 15 consecutive failures stop the entire LinkedIn source across search boundaries; successful captures reset that counter. Other workflow sources and queued workers continue. The summary reports actual saved JD files, unavailable JDs, and blocked listings separately, and `run` forwards those counts instead of calling held URLs saved JDs.
- LinkedIn login, scanning and hold recovery reuse one tab in one browser window. Posting fetches run sequentially regardless of the evaluation worker parallelism. The persistent context's startup tab is reused, surplus tabs are closed, and the same tab survives between postings and searches.
- Adds `recover-linkedin-holds.mjs --user {USER}` for targeted recovery of saved LinkedIn missing-JD holds using that user's saved profile, verifying its authenticated session before fetching postings. It searches no new listings, navigates once per exact posting in the same tab with the five-second JD allowance, and resumes a durable `data/linkedin-recovery.json` ledger without repeating attempted postings. Document replacements and delayed posting selection share that original allowance instead of failing on a destroyed browser execution context; extraction still requires the exact posting ID. Valid captures become immutable local JDs with original-URL provenance and return to Pending under the shared lock; explicit closure notices move only the queue entry to Closed. Concurrent edits and terminal/active batch identities are protected. Login/authwall redirects and 15 consecutive extraction failures stop recovery with progress saved; login requirements are reported immediately rather than accumulating missing-JD results. `--retry-errors` retries technical failures after a correction, while `--retry-unavailable` explicitly starts a new attempt for previously unavailable cases too. Recovery does not launch evaluations or alter existing application lifecycle states.
- Extends `test-all.mjs` authenticated-scan coverage to verify fixed numeric delays and ranged delays, so future upstream merges do not regress LinkedIn delay config compatibility.

Future merge notes:

- If upstream adds authenticated scanning, preserve per-user session isolation unless upstream has an equivalent user-scoped profile model.
- Do not move browser profiles into tracked system paths. They contain cookies/local storage and should remain ignored credential data.
- Keep `scan-auth` aligned with `lib/user-context.mjs` whenever user resolution changes.
- Preserve numeric delay compatibility for LinkedIn scan throttling if upstream rewrites scan-auth timing helpers.

## LinkedIn Native Age Filter

The fork enforces authenticated LinkedIn search age limits through LinkedIn's native URL parameter rather than keyword text.

Files:

- `scan-auth/linkedin.mjs`
- `test-all.mjs`
- `users/{USER}/portals.yml`

What this customizes:

- Reads `linkedin_searches.date_posted` from the active user's `portals.yml`.
- Maps supported values to LinkedIn's native `f_TPR` search parameter: `24 -> r86400`, `Week -> r604800`, and `Month -> r2592000`.
- Builds URLs such as `https://www.linkedin.com/jobs/search-results/?keywords=Senior+Backend+Engineer&f_TPR=r604800`.
- Leaves the `keywords` query clean instead of appending text such as `posted in the past week`.
- Exports `buildLinkedInSearches(config)` so URL construction can be regression-tested without launching an authenticated browser session.
- Extends `test-all.mjs` coverage for `Week`, numeric YAML `24`, clean keyword text, and the unset case.

Future merge notes:

- Preserve URL-level age filtering while LinkedIn supports `f_TPR`; keyword suffixes are weaker and should not be restored as the primary filter.
- If upstream adds first-class LinkedIn age filtering, retire this local mapping only if upstream preserves the same `linkedin_searches.date_posted` contract or provides a clear migration for user portal configs.
- Keep the exported search builder or an equivalent testable boundary so future changes can verify generated URLs without touching per-user pipeline data.

## Long-Running Supervision And Execution Ownership

The fork keeps multi-minute career-ops workflows quiet while making the current root turn responsible for supervising each run through its terminal outcome. It also separates root-owned serial workflows from the direct-pipeline fan-out used for larger inboxes.

Files:

- `AGENTS.md`
- `.agents/skills/career-ops/SKILL.md`
- `modes/_shared.md`
- `modes/auto-pipeline.md`
- `modes/oferta.md`
- `modes/scan.md`
- `modes/run.md`
- `modes/scan-auth.md`
- `modes/pipeline.md`
- `modes/batch.md`
- `test-all.mjs`

What this customizes:

- Keeps the active agent turn open until `run`, `scan`, `scan-handoff`, `scan-auth`, `pipeline`, or `batch` reaches completion, requires user action, receives an explicit stop, encounters confirmed destructive risk, or exhausts safe recovery.
- Treats background and detached processes as work owned by the current turn. Agents poll process output and persisted state at least every 60 seconds, keep routine polls silent, and limit normal user-visible liveness updates to at most once every 10 minutes.
- Uses stdout/stderr, logs, artifacts, PID/session state, lock ownership, worker liveness, and persisted counters as progress evidence. Proven ownerless locks and stale `processing` entries are recovered before resuming with the same active user and parallelism.
- Finishes long-running work by confirming worker exit, reconciling pipeline state, merging tracker additions, running `node verify-runner.mjs --user {USER}`, and reporting completed, skipped, failed, seen, repaired, unresolved, and remaining counts.
- Keeps `run`, `scan`, `scan-handoff`, `scan-auth`, Playwright-assisted `apply`, and direct pipelines with one or two pending URLs serial in the root agent. `modes/scan.md` now expresses this as affirmative root-agent execution instead of recommending a background scan subagent.
- Uses one subagent per surviving URL when a direct pipeline has three or more pending URLs. The root agent coordinates the fan-out, reconciliation, tracker merge, and final verification.
- Requires every delegated pipeline prompt to carry `ACTIVE_USER`, `USER_ROOT=users/{ACTIVE_USER}`, one URL, an atomically reserved report number, and the loaded shared/profile/custom/pipeline instructions. The prompt states that all user-layer relative paths resolve inside `USER_ROOT`.
- Keeps each role's extraction, evaluation, and bounded company/compensation research within the agent assigned to that role, preserving one-role-per-worker scope.
- Starts one `batch/batch-runner.sh` invocation at a time directly from the root agent. Configured `--parallel N` workers remain bounded internal concurrency managed by that single root-owned runner.
- Resolves optional batch concurrency consistently for both run and direct batch execution: explicit `--parallel`, then active-user `batch.parallel`, then `1`. The run coordinator records the effective value and source in its final JSON.
- Adds `test-all.mjs` assertions for the cross-file supervision contract in `AGENTS.md`, the career-ops skill, pipeline mode, and batch mode.

Future merge notes:

- Preserve quiet polling together with terminal supervision; an equivalent upstream policy must cover process and persisted-state checks, safe recovery, reconciliation, verification, and terminal count reporting.
- Preserve the execution split: root-owned serial scan/auth/apply/small-pipeline work, one-worker-per-URL fan-out for direct pipelines with three or more surviving URLs, and one root-owned batch-runner invocation with script-managed internal parallelism.
- `run-workflow.mjs` and `batch/batch-runner.sh` resolve optional parallelism deterministically as explicit `--parallel`, then the active user's `config/profile.yml` `batch.parallel`, then system default `1`. The run summary records both the resolved value and its source.
- Keep delegated worker prompts explicit about `ACTIVE_USER`, `USER_ROOT`, user-layer path resolution, one assigned URL, and atomically reserved report numbers.
- Keep the supervision assertions synchronized with wording changes across instructions and mode files.

## Deterministic `run` Runner

The full workflow command is `/career-ops run {USER}`, implemented by `run-workflow.mjs` and exposed as `npm run run`. New diagnostics live under `data/workflow-runs/`. Historical `data/go-runs/` folders keep the same retention policy, and legacy ownership remains honored to prevent overlapping runners during upgrades. Go language and dashboard build commands keep their original names.

Files:

- `run-workflow.mjs`
- `scan.mjs`
- `scan-auth/linkedin.mjs`
- `resolve-parallel.mjs`
- `resolve-verify-warnings.mjs`
- `verify-runner.mjs`
- `apply-verification-review.mjs`
- `check-liveness.mjs`
- `pipeline-liveness.mjs`
- `sync-pipeline-batch.mjs`
- `verify-pipeline.mjs`
- `batch/batch-runner.sh`
- `lib/codex-config.mjs`
- `lib/runner-command.mjs`
- `lib/cli-launch.mjs`
- `lib/run-queue.mjs`
- `batch/manual-inputs.mjs`
- `batch/runner-ownership.mjs`
- `batch/state-store.mjs`
- `resolve-codex-config.mjs`
- `lib/run-summary.mjs`
- `lib/verification-review.mjs`
- `lib/openai-output-schema.mjs`
- `lib/duplicate-lifecycle.mjs`
- `lib/parallel-config.mjs`
- `lib/pipeline-queue.mjs`
- `lib/run-artifacts.mjs`
- `cleanup-runs.mjs`
- `schemas/run-handoff-output.schema.json`
- `schemas/verify-review-output.schema.json`
- `modes/verify.md`
- `tests/workflows/verify-review.test.mjs`
- `tests/workflows/run-workflow.test.mjs`
- `tests/workflows/run-cleanup.test.mjs`
- `package.json`
- `update-system.mjs`
- `config/profile.example.yml`
- `DATA_CONTRACT.md`
- `docs/SCRIPTS.md`
- `batch/README.md`
- `AGENTS.md`
- `.agents/skills/career-ops/SKILL.md`
- `modes/run.md`
- `modes/batch.md`

What this customizes:

- Processes the full existing inbox, including no-new-discovery runs, and constrains each batch dispatch with an exact URL/local-JD queue file. Stable IDs and terminal states prevent unrelated historical inputs or completed jobs from being evaluated again.
- Adds a terminal question/input footer to `run` only while an answer is needed, with logs scrolling above it. With no active question, it clears the input/help/counters, restores the full terminal for normal rolling output, and shows later questions on demand. It asks one question at a time, saves exact posting/reason answers internally in `data/manual-answers.json`, and lets the existing batch owner resume answered jobs in a free worker slot while independent jobs continue. It waits when only human input remains. `/later` defers the current question; Ctrl+D with text submits a multiline JD. On a missing-JD question, empty Ctrl+D or `/skip` followed by Enter saves an exact-posting empty response with `resolution: skip`. The batch owner records terminal `skipped` with reason `user-skipped-jd-unavailable` before any fetching, report reservation or agent launch. Reconciliation moves the item to Processed without inventing a report, score, CV or expiry verdict. That question stays resolved across restarts; empty Ctrl+D for other question types defers. `/finish` followed by Enter stops questions and exits after active work drains. Deferred holds return on restart. Ctrl+C stops owned processes. While a question is active, a persistent shortcut line stays below the input and uses compact labels on narrow terminals. The internal live selector records dispatch fingerprints so an unchanged answer cannot repeatedly dispatch a held job. Source login retries can run alongside batch work; verification rechecks run after batch ownership is released. Headless/JSON/quiet runs retain the nonwaiting answers-file API, and `--no-interactive` explicitly selects that behavior. `lib/run-terminal.mjs`, `lib/run-interactive.mjs`, `lib/run-live-inputs.mjs` and `lib/run-batch-sync.mjs` share presentation, validated answer persistence, bounded live scheduling and locked input synchronization with the coordinator.
- Styles individual fields in coordinator phases, all forwarded scanner/batch/verifier output, handoff progress, summaries and question controls through `lib/run-output.mjs`. Ordinary prose stays neutral; phase/company/role names are bold, job IDs magenta, counters cyan, success counts green, holds/actions yellow and failures red. Zero counters, paths, dates, durations and separators are muted; URLs are underlined cyan and protected from diagnostic-word matching. Mixed summary fields retain their own meaning rather than inheriting one colour for the line. Footer counters, titles and shortcut keys have separate styles; pasted input remains normal text. Styling preserves visible text and Unicode cursor/clipping calculations. Incoming terminal controls are stripped first; redirected output, JSON-mode progress, saved logs and structured state remain plain. `NO_COLOR`, `FORCE_COLOR=0` and `TERM=dumb` disable colour. New child scripts inherit the shared field formatter when forwarded by `run`; standalone behaviour is unchanged.
- Persists typed per-job holds under `batch/logs/{id}.hold.json` and gathers job/source/verifier actions in `data/manual-actions.json`. Exact URL-plus-reason answers resume only the corresponding hold; job content and silent/inferred agency values cannot resolve it. Missing-JD and agency holds write no completed artifacts and consume no retry.
- Ordinary job failures receive three automatic attempts in total before the interactive footer or headless manual-action list asks for help. Earlier failures stay in rolling status output while independent jobs continue. The persisted failure count survives restarts; an explicit retry after exhaustion grants one extra attempt. The coordinator, live selector, question broker and standalone batch share the three-failure default. Malformed worker confirmation payloads count as failed attempts rather than creating an unanswerable generic question. Valid holds must use the internal queue locator, including `local:jds/...`, rather than substituting a capture's public source/application URL. Missing-JD/agency holds and quota pauses retain their separate handling.
- Confirmed closed postings finish immediately as `closed` with reason `posting-closed`, without consuming a failed attempt, generating evaluation artifacts or asking a question. They move from Pending or blocked rows to Processed as Closed and remain terminal across restarts and retry flags. A uniquely matched existing Evaluated tracker row becomes Closed through the canonical status writer; other application statuses are preserved. Missing JD, login/loading/errors and absent search results do not establish closure. Worker final JSON uses `status: closed`, `reason: posting_closed`, exact internal posting/ID/reserved number and null artifact/scoring fields. Partial artifacts are quarantined before releasing the reservation; closed jobs never merge stale tracker additions.
- Failed-job prompts expose `/skip` in their help/footer. The exact-posting `job_failed` skip command is persisted as an empty answer with `resolution: skip`; the batch owner applies it even at the retry ceiling, without a fetch, report reservation or paid worker. It records terminal `skipped` with reason `user-skipped-failed-job`, preserves retry history, quarantines any partial unmerged tracker addition and reconciles the row to Processed without a report or score. The dismissal survives restarts and retry flags; it does not assert employer closure or alter tracker lifecycle states. Empty Ctrl+D still defers these prompts.
- Explicit submission, including Ctrl+D after a pasted JD, ends paste mode even when the terminal omits its paste-end marker. A new question resets paste state too, so Enter submits `/skip` or an ordinary answer instead of inserting a hidden newline. Newlines inside a paste still wait for explicit submission.
- Supports Codex and Claude in `run` only. OpenCode, Gemini, and Qwen are intentionally excluded from the coordinator; upstream direct-batch implementations remain available but are outside the fork's required support.
- Uses `lib/runner-command.mjs` for safe native/npm CLI launch, explicit Git Bash on Windows, preserved argv boundaries, and owned process-tree termination. Directory locks from `pipeline-lock.mjs` hold ownership through terminal cleanup; compatibility PID files do not overwrite another live owner.
- Batch ownership records the native OS PID in `batch-runner.pid.owner.lock/owner.json` and releases only its own token. The compatibility PID remains a Bash/MSYS PID; Windows legacy checks use Git Bash instead of treating it as a native PID. Ambiguous ownership prevents dispatch. Dead ownership is recovered through the shared atomic protocol.
- Recovery flags include normal pending work, with failed-job retry credit granted once on the first coordinator pass. Codex usage/session limits pause affected jobs without consuming their retry budget. An interactive job retry resumes only that posting; `--resume-paused` authorizes global recovery. Live dispatch keeps one valid numeric canonical ID per posting, excludes offer processes until reaped, and preserves failure counts across confirmation holds. A hold under another historical ID still gates the whole posting and resumes under that held identity; conflicting held/dispatched identities require explicit input/state repair. Leaving terminal input retains the same dispatch ledger and invocation limit. The current question and draft survive newly arriving questions; unchanged footer and queue/control contents are not repeatedly rewritten.
- Quota pauses apply across coordinator passes and future invocations, including a renewed pause during explicit resume. Legacy login/access/fetch-blocked rows accept exact `jd_unavailable` answers; other blocked errors specify a manual inbox edit after resolving their cause.
- Keeps identical core and web npm-launcher copies with a parity test because the web bundler deliberately confines resolution to `web/`. Core runner installations remain independent of the optional web app; production web builds validate that boundary.
- Uses locked fresh reads for liveness inbox rewrites and batch synchronization. Concurrent source/inbox additions survive, and later queue passes process newly appended runnable jobs within the bounded pass limit. LinkedIn is excluded from the bulk sweep.
- Loads canonical evaluation/CV modes from `batch/batch-prompt.md` instead of a copied rubric. Output format/template/page preferences, current fact/title/structure/keyword checks, opt-in ATS variants, JD archival, Skip/hard-stop gates, and flat primary report/CV identity apply to workers. The Machine Summary schema remains in that prompt as the shared schema authority.
- Preserves prefetch bytes: HTTP/API JDs are not erased by the local-JD branch. Explicit missing-JD answers keep original URL provenance. Artifact validation rejects an ATS variant replacing the primary PDF index and quarantines output written in violation of a hold.
- When HTTP/API prefetch leaves a remote JD empty, runs the shared read-only browser extractor once before agent dispatch, independent of the worker CLI's browser tools. A 35-second owned process limit covers Chromium cleanup; only substantive, untruncated text is passed as the JD. Failure preserves the worker's normal retrieval/hold path and records per-job browser diagnostics. Supplied/local JDs bypass rendering, and generic extraction blocks LinkedIn on initial requests, redirects and subresources so its authenticated-session rules remain intact.
- Saves provider descriptions/source metadata under the selected user's `data/posting-context/` before publishing new inbox rows. Batch workers receive queue source/notes plus a per-job context file with the scanner snapshot and exact-URL history. HN jobs use their individual hiring comments as posting identities, preserving full comment text and external/application links instead of treating the first homepage/GitHub link as a vacancy. Legacy HN homepage rows recover only a unique comment matching their original URL and header within their recorded hiring month, using at most two fixed-host API calls. Supplied JDs bypass recovery; ambiguous/deleted/unavailable sources stay unresolved. Workers must use source context and a targeted source/company/role search within the existing research budget before asking for a missing JD. Existing terminal jobs and unanswered holds are not silently reset or re-dispatched.
- Quarantines rejected worker additions and prevents merging a failed/held/active job's TSV even when it claims another report number. Completed batch additions must match their reserved report identity. Reconciliation uses the same pending-row parser as dispatch, including indentation and checkbox spacing.
- Consumes scan receipts, verifies handoff schema/counts against observed queue changes, retains source errors/partial results, and continues the other jobs. `completed` requires no remaining pending/blocked job, action, incomplete phase, or unresolved reviewed finding. Every terminal run stores `summary.json`; completed runs alone compact diagnostics.
- Exercises the real Windows coordinator with isolated offline scripts and mock workers, including npm Codex launch, Bash batch launch, mixed holds/answer resume, legacy backlog, partial discovery, recovery bounds, concurrent additions, and model forwarding. Separate worker and reviewed-verification fixtures validate the downstream contracts without paid jobs.
- Validation of these repairs: `node test-all.mjs --quick` passed 14,537 checks with zero failures and 18 platform/environment or existing upstream-reference warnings. The executable queue suite passed 33 cases; independent final review passed 55 focused cases and found no remaining concrete blocker. Web type checking and production build passed, as did an isolated raw pipeline check and updater/private-data guards. Paid workers and live end-to-end sourcing were not exercised.

- Validates the verification review schema locally before a Codex call. `lib/openai-output-schema.mjs` rejects unsupported `uniqueItems` keywords, while deterministic response validation enforces unique duplicate tracker IDs and report paths. Keep API-compatible schemas and post-response semantic checks together rather than dropping the uniqueness requirement.
- Adds an executable, user-scoped coordinator for doctor, discovery unless skipped, schema-constrained handoff from the latest usable scan, authenticated LinkedIn unless skipped, existing/new inbox processing, and reviewed verification. Zero discoveries still drain the backlog.
- Keeps scan, LinkedIn scan, liveness, queue synchronization, batch execution, tracker merge, reconciliation, and verification deterministic and directly script-driven.
- Uses schema-constrained Codex invocations for the browser/WebSearch handoff phase and a standalone read-only verification reviewer. Handoff additions are cross-checked against persisted pending counts. Verification review is deterministically chunked at 5 findings per one-off call. Independent dependency lanes run concurrently using the shared parallel setting, while overlapping tracker/report/orphan identities remain sequential and carry prior lane decisions forward as binding context. The parent validates the aggregate contract and overlapping duplicate keepers before any repair is considered. After duplicate repair it runs an intermediate raw check and applies only decisions whose exact finding fingerprint still exists, preventing a stale patch from overwriting state changed by the duplicate resolver.
- Preserves `verify-pipeline.mjs` as the broad raw detector: every error and warning is still emitted. `verify-runner.mjs` filters only findings whose level, stable ID, and complete canonical payload SHA-256 match a prior `mark_seen` record, then reviews every remaining finding, applies supported deterministic decisions, and runs the raw verifier again for up to three passes.
- Stores verified false positives, legitimate exceptions, and informational findings in the append-only user ledger `data/verification-reviews.jsonl`. An exact unchanged finding no longer resurfaces in reviewed verification, while any changed message/details payload gets a new fingerprint and is reviewed again. Raw verification never hides these findings.
- Resolves confirmed duplicate tracker/report groups through the existing duplicate resolver, which validates exact candidate partitions, merges tracker history, archives losing reports/output artifacts, backs up state, and records `data/duplicate-resolutions.jsonl`.
- Preserves duplicate lifecycle order as `Hired > Offer > Interview > Assessment > Responded > Rejected > Applied > Evaluated > Skip/Closed/Discarded`. The most advanced row becomes the keeper together with its existing tracker ID, report, HTML, PDF, and links. Equal-status copies proven to be the same canonical posting keep the most recent complete evaluation, then the highest ID, without escalating a safe identity tie to human review. Losing notes are merged and losing artifacts are backed up and archived. The ledger records the reviewer keeper, effective lifecycle keeper, and override.
- Adds deterministic orphan handling: restore a valid lost tracker row from a matching preserved `batch/tracker-additions/merged/*.tsv` when available, or reconstruct date/company/role/score/status/Via from a complete verified report when the historical TSV no longer exists or its reusable batch slot now contains another job. The applier revalidates the TSV row number and linked report at mutation time, falls back without failing the run when provenance is stale or malformed, and records the requested TSV, actual source, and fallback reason in `data/verification-actions.jsonl`. An occupied report number receives a fresh ID and its report plus matching HTML/PDF/TeX artifacts are renamed as one backed-up transaction. Confirmed redundant/obsolete orphan reports and matching output artifacts are archived. Bounded tracker patches cover company, Via, canonical status, score, and report-link findings. These actions use timestamped backups.
- Makes orphan action metadata deterministic after the reviewer chooses the outcome. For `archive_orphan`, `verify-runner.mjs` derives `report_file` from the raw verifier finding and fixes `tracker_tsv` to `null`; the model cannot omit the required object or redirect an archive to another path. Restore report paths are fixed to verifier evidence and optional tracker TSV paths are canonicalized from project-relative `users/{USER}/batch/...` output to the user-root-relative `batch/tracker-additions/merged/*.tsv` contract before semantic validation. A null TSV explicitly selects report-derived restoration; the model never selects the resulting number or rename targets. The restore parser also accepts the two historical merged artifacts whose separators were stored as literal `\t` text; current batch artifact validation continues to reject that malformed representation, so this compatibility path does not weaken new writes.
- Makes duplicate action metadata type-specific before checkpointing. Tracker duplicate findings retain only `keeper_tracker_num` and `duplicate_tracker_nums`; report duplicate findings retain only `keeper_report_file` and `duplicate_report_files`. Redundant cross-type fields are mechanically cleared, report paths are canonicalized to the exact `reports/...` candidates emitted by the verifier, exact warning candidates are semantically revalidated, and tracker/report plans with the same exact candidate report set must still agree on canonical identity. A broader report warning may contain orphaned reports beyond a tracker-backed subset; its whole-group decision therefore does not override an evidence-backed decision for that exact subset. This prevents a valid duplicate judgment from failing late because a reviewer copied the combined identity or user-root paths into both warning types.
- Keeps each overlapping tracker/report/orphan dependency component contiguous inside its review lane, so exact paired findings normally share one five-finding prompt. Paired disposition or keeper conflicts retry only that chunk with explicit consistency feedback. If bounded retries still disagree, or either side is manual, the whole exact component becomes `manual_review` rather than failing the run or applying half a resolution. When both sides confirm the duplicate, the tracker-selected canonical identity mechanically determines the report keeper.
- Scopes aggregate duplicate consistency to decisions active in the current pass, so exact pairs fully settled earlier cannot produce missing-decision failures. When a repair creates or changes one side of an exact pair while the other side still has an unchanged seen record, the runner reactivates the seen counterpart and reviews both together. This prevents a one-sided action from relying on stale paired judgement after tracker state changes.
- Treats active tracker links and report contents as current identity while retaining batch completion logs as historical provenance only. Orphan checks use the exact linked report filename, so a tracker link cannot accidentally claim every active file sharing its numeric prefix. A report-number collision is resolved through those exact orphan findings: the linked file owns the old identity, while each unlinked file is independently restored under a fresh ID or archived. Prompt review remains required only when the evidence cannot support either bounded disposition.
- Keeps broad company/title duplicate warnings, and additionally emits exact tracker/report subgroups when only a subset shares one canonical posting URL. This lets prompt review resolve the proven subset and record the mixed broad group as seen without merging distinct repostings.
- Canonical posting identity removes standard source, referral, and feed tracking parameters such as `src` and `feed_run`, and treats a stable terminal posting UUID on one host as authoritative when its descriptive slug changes. When historical evidence still produces a strict nested group covered by a broader confirmed group, aggregate reconciliation keeps only the maximal mutation and records both nested tracker/report findings as informational seen decisions. This prevents overlapping resolver actions and guarantees that every keeper belongs to the exact warning candidate set it partitions.
- Migrates a legacy tracker lacking the Via column before prompt review, then reverifies so missing per-row Via values become bounded evidence-backed patches rather than a schema-wide wave of human-review decisions.
- Allows tracker duplicate repair to proceed when a losing row already points at a missing report. Removing the duplicate row remains valid; the resolver no longer manufactures an implicit archive plan for a file that does not exist.
- Aggregates all semantic contract errors in a five-finding reviewer response and retries only that failed chunk, passing the complete validation feedback and previous response back for correction. `--review-retries N` defaults to two and is bounded to zero through five. A malformed item no longer discards valid independent chunk work or hides later invalid items behind the first error.
- Writes an atomic checkpoint only after a complete chunk is normalized and semantically validated. Actions remain pass-atomic: no duplicate, orphan, tracker, or seen-ledger mutation starts until every lane and the aggregate duplicate-consistency check succeed. A fresh invocation ignores prior run artifacts; `--resume-run RUN_ID` explicitly reuses only checkpoints whose signature matches the active user, exact findings, and prior lane decisions. Matching checkpoints are normalized and semantically revalidated under the current contract when loaded, while their original decision chain remains available solely for matching later checkpoints from the same historical run. Each successful deterministic action phase also writes an atomic result checkpoint. If duplicate repair commits but the following apply phase fails, resume requires an exact match with the saved post-duplicate verification, normalizes/revalidates the saved applicable decisions, retains the completed duplicate result, and retries apply without prompting reviewers again. After every completed apply/reverify boundary, the runner also saves the exact post-review verification state. A later `--resume-run` whose current findings match that checkpoint continues at the next pass and reuses the already committed duplicate/apply action results, rather than replaying the completed repair pass. Raw/invalid reviewer outputs are never resumable decisions. Retry, checkpoint, and normalization counts are exposed under `review_resilience`.
- Keeps the prompt reviewer read-only. Only `resolve-verify-warnings.mjs` and `apply-verification-review.mjs` may mutate data, and both revalidate prompt output against deterministic verifier evidence. Unsupported, conflicting, ambiguous, or high-severity findings use `manual_review` and keep reviewed verification `partial`.
- Keeps manual-review decisions visible in direct human runs: after the normal compact summary (and any operational error), every still-active manual item is repeated as `human review, job(s) #..., {finding code} → needs_human_review`. This recap is non-enumerable runner state used only by the human renderer, so `--json` retains its existing machine contract and stdout purity.
- Makes the parent `run` summary expose every unresolved verifier item immediately after the aggregate verification count, including its severity, stable finding code, and sanitized message. Machine-readable `--json` output retains the verifier fields and also exposes typed manual actions and phase issues.
- Also repeats every other still-unresolved raw finding at the end of a direct human run with its warning/error level, related tracker/report IDs, and issue code. Manual items stay in their dedicated block and are excluded from the general unresolved block. Both recap collections are non-enumerable and never appear in `--json` output.
- Adds an idempotent `pipeline.md` to `batch-input.tsv` synchronizer with stable IDs so the resumable batch runner cannot silently miss newly scanned jobs.
- Adds JSON output to `check-liveness.mjs` plus a deterministic pipeline wrapper that moves only confirmed-expired rows and uses `set-status.mjs` for any matching tracker row.
- Exposes the complete review/action/reverify lifecycle independently as `/career-ops verify`, `npm run verify -- --user {USER}`, and `node verify-runner.mjs --user {USER}`. `npm run verify:raw` remains the unreviewed detector. The `run` coordinator delegates its final integrity phase to the same reviewed runner, so standalone and end-to-end behavior cannot drift.
- Serializes concurrent `run`, batch, and reviewed-verification runs with per-user directory ownership locks, owns child process groups for stop handling, and writes phase logs under the user root. Setup can block the run; an authenticated-source login becomes a pending action while independent inbox work continues. Completion requires an empty pending/blocked queue and clean source/verification results.
- Establishes a consistent public CLI output contract. Manual invocations stream bounded operational progress to stdout and finish with only a compact summary plus the actual failure text. `--json` opts into the complete machine result, keeps stdout as a single parseable JSON object, and routes progress to stderr. Internal orchestrators pass `--json` explicitly when parsing child results. Doctor and the batch runner retain their existing compact human output and persisted state artifacts.
- Adds user-scoped run-artifact retention through `npm run cleanup:runs -- --user {USER}`. It deletes timestamped directories under both `data/verify-runs/` and `data/workflow-runs/` once they are strictly older than 10 days, and refuses cleanup while another workflow or verify runner is active for that user. The workflow runner applies the same cleanup at startup.
- Compacts only terminal `completed` workflow and reviewed-verification runs to a single `summary.json`. Failed, interrupted, partial, and blocked runs keep their full diagnostic and resume artifacts until the fixed 10-day cleanup removes the entire run directory.
- Prints the reviewed verifier's run ID and artifact directory immediately after acquiring its per-user lock, before the first phase starts. Interrupted runs therefore expose the exact value accepted by `--resume-run`; JSON mode sends these early lines to stderr so stdout remains parseable.
- Streams zero-token target/provider start and completion, handoff task activity, LinkedIn search prompts, queue deltas, batch job start/completion, and one short line per reviewed finding after its five-finding call completes: `reviewed X/Y, job(s) #{related IDs}, {issue code} → {classification}`. Tracker IDs are preferred, with report IDs used for report-only and orphan findings. Full rationale, evidence, and action details stay in run artifacts and the opt-in JSON result. `--quiet` retains the phase-log-only behavior.
- Registers the runner, helpers, shared library, tests, and JSON schema in the updater-managed system layer so updates do not leave a partial coordinator.
- Resolves Codex model and reasoning independently as runner argument, active-user `profile.yml`, then GPT 6.1 Sol (`gpt-6.1-sol`) with medium reasoning, forwarding both values to handoff, reviewed verification, and every Codex batch worker through the shared resolver.
- Resolves parallelism independently as runner argument, active-user `batch.parallel`, then `1`, records `parallel` and `parallel_source`, and passes the resolved value explicitly to the batch and reviewed-verification runners. Verification uses it only for isolated read-only review lanes; deterministic repair and ledger mutation remain serialized in the parent.

Future merge notes:

- Preserve the strict handoff output schema and observed-state cross-check; do not make agent prose a control signal.
- Preserve the verification schema preflight and deterministic array-uniqueness checks. Schema compatibility changes must retain the duplicate-resolution semantic contract and its tests.
- Preserve the read-only prompt/deterministic mutation boundary. New action types must validate against raw verifier evidence, remain user-scoped, acquire the appropriate lock, back up affected artifacts, append an audit record, and be followed by raw re-verification.
- Preserve lifecycle-first duplicate identity: Rejected stays between Responded and Applied, the most advanced row and its original artifacts remain active, and reviewer-selected identity is only an equal-status tiebreaker. Keep losing-artifact backup/archive, rollback, and keeper-override ledger coverage.
- Duplicate repair revalidates the reviewed candidates against a fresh local scan under the tracker lock, with a bounded ten-minute allowance for large trackers. A timeout applies no duplicate repairs and retains the review checkpoints for `--resume-verify`; keep the exact candidate identity checks when changing this allowance.
- When a completed review awaits duplicate repair, resume can reuse the whole review if every current finding retains its exact evidence fingerprint and only already-resolved notices disappeared. Revalidate the saved user/root/tracker and all decisions, then continue deterministic repairs without launching reviewers again. Changed evidence, new findings, missing unresolved findings, or invalid decisions retain the normal checkpoint/review path.
- Orphan detection respects report links in both the Report and Notes cells, including historical re-evaluations, matching the applier's archive protection. After duplicate repair, a pending apply checkpoint resumes only decisions whose full finding fingerprints still match; disappeared findings are dropped, and changed or new findings remain for a later review pass.
- Reviewed verification handles soft historical JD archive warnings automatically before launching reviewers. It searches exact-URL saved captures and scanner snapshots, then makes bounded first-party ATS/structured-posting reads with at most three concurrent recovery tasks. A recovered capture records source and recovery time separately from the historical evaluation. If the original description cannot be recovered, it persists a known gap in `data/jd-archive-maintenance.json` and acknowledges that exact warning as informational in the review ledger. Raw coverage warnings remain visible; a gap never counts as an archive or a user answer. Unchanged gaps do not repeat network work or become TUI questions, newly saved local evidence is still discovered, and changed report/source fingerprints resurface automatically. `verify-runner.mjs --retry-archive-gaps` explicitly retries known gaps. LinkedIn remains local-evidence-only in this maintenance path; missing JDs for new batch evaluations retain their existing gates.
- Preserve exact-payload seen fingerprints. Never weaken them to warning code, company/role, or finding ID alone; changed evidence must resurface. Keep the seen ledger user-owned and append-only, and keep raw verifier output unsuppressed.
- Preserve five-finding review chunks, dependency-safe lane partitioning, per-lane prior-decision context, isolated reviewer artifacts, aggregate duplicate-keeper consistency, aggregated per-chunk semantic validation, bounded retries, signature-checked validated checkpoints, serialized pass-atomic mutations, severity-based `manual_review`, and the completed-versus-partial final status contract; finding volume must not make a single unconstrained prompt or silently downgrade review requirements.
- Preserve deterministic action metadata. Reviewers may classify an orphan but must not control archive paths; derive them from the verifier finding. Keep normal runs fresh and checkpoint reuse explicitly opt-in through `--resume-run`, with user/finding/prior-decision signature validation.
- Preserve stable batch IDs and append-only synchronization because `batch-state.tsv` references those IDs across retries and resumes.
- Preserve human-streaming output as the default and require `--json` for machine consumers. In JSON mode, keep stdout to one lossless JSON object and progress on stderr; keep `--quiet` available for unattended callers that want log-only phase details.
- Keep `verify-pipeline.mjs --json` finding IDs, codes, and evidence stable enough for schema-constrained review, exact fingerprints, and deterministic action validation. If a raw finding payload intentionally changes, expect its old seen record not to match and let it resurface for review.

## Sourcing lane and Hacker News parity

`scan-hn.mjs` narrows a temporary copy of the selected user's portals configuration and invokes the canonical `scan.mjs` provider pipeline. Title/seniority, company, location, country, visa, blacklist, and dedup rules therefore match normal scans. An API key no longer silently turns this sourcing wrapper into a paid Gemini pass. It uses a private temporary `CAREER_OPS_SCAN_HANDOFF` lane; main-scan handoff artifacts are never snapshot-restored or overwritten by HN, including concurrent/forced-stop cases.

The workflow queue, liveness helper, synchronizer, authenticated scanner, and reconciler honor explicit pipeline lanes consistently. Normal production paths remain selected-user paths. New helpers and the Codex resolver are updater-managed system files; holds, answers, diagnostics, and manual actions remain user-owned.

## Local Maintenance Skill

The fork adds a repo-local skill for upstream merge maintenance.

File:

- `.agents/skills/update-main/SKILL.md`

What this customizes:

- Defines the local `update-main` workflow: fetch `upstream/main`, merge onto the current branch, adapt local work around upstream, and report behavior changes.

Future merge notes:

- Keep this if local agents use `$career-ops:update-main`.
- If upstream adds an equivalent workflow, either remove this file or reduce it to fork-specific conflict policy.

## Personal Data And Generated Artifact Hygiene

The fork expands ignored local/user artifacts.

Files:

- `.gitignore`

What this customizes:

- Adds ignores for `users/`, all legacy root `interview-prep/*`, `voice-dna.md`, and `.scan-auth/`. Scan-summary, article-digest, and editor-folder ignores already exist in the incorporated upstream base; duplicate ignore lines are historical residue, not additional behavior.
- The old tracked root story bank was already removed upstream. Keep user story banks under `users/{USER}/interview-prep/story-bank.md`; the deletion itself is retired as a fork patch.

Future merge notes:

- Preserve the data-contract intent even if upstream reorganizes user-layer folders.
- If upstream starts tracking a generic story-bank template, keep the template outside ignored user-specific paths.

## Posting extraction

The personal `extract-jd.mjs` and `extract-pdf.mjs` helpers were removed because they navigated to hardcoded postings on every invocation. Use upstream `fetch-jd.mjs` or `browser-extract.mjs` with an explicit target.

## Repository Icon Synchronization

Files:

- `web/src/app/icon.svg`
- `web/public/bimi-logo.svg`
- `favicon.svg`

What this customizes:

- Keeps a root-level favicon copy of the web app icon so repository-aware tools can display career-ops with its branded icon.
- Registers `favicon.svg` in `update-system.mjs` as system-layer content so updater coverage validation includes the fork-owned repository icon.

Future merge notes:

- Treat `web/src/app/icon.svg` as the canonical visual source; whenever it changes, update `web/public/bimi-logo.svg` and `favicon.svg` so all three SVG surfaces stay identical.
- When adding another repository-level icon, review all existing icon surfaces and update this inventory with the new synchronization relationship.

## Other Small Deltas

Files:

- `README.md`
- `docs/SCRIPTS.md`
- `templates/README.md`
- `AGENTS.md`

What this customizes:

- Keeps references to fork-added commands, providers, and behavior in sync with the code above.
- Adjusts one Gemini free-tier model reference in `README.md`.

Future merge notes:

- Treat documentation conflicts as a signal to check whether the underlying customization still exists.
- Remove local documentation lines when the corresponding code customization is removed.

## Closed postings and JD archives

`check-jd-archive.mjs` treats canonical `Closed` postings as inactive for historical archive coverage, alongside Rejected, Discarded, SKIP, and Hired. It leaves the shared lifecycle definition unchanged, so the scanner can still reopen a Closed entry. Returning that entry to Evaluated restores the archive warning; Applied, Interview, and Offer entries retain coverage checks. Fresh reports without a tracker still require an archived JD. `tests/jd-archive-closed.test.mjs` covers closure, aliases, reactivation, and active applications. Keep this distinction when updating upstream archive rules; blanket report-age exemptions must not suppress findings on active applications.

## Retired fork patches

- Landing.jobs and NoDesk adapters now use unchanged upstream first-party provider modules. Their retired `_custom.mjs` implementations, the duplicated Working Nomads parser and the unused Greenhouse/Ashby/Lever dispatcher branches have been removed. Active custom adapters retain shared filtering/date helpers, PCSX parsing and the live probe guard.
- Agentic Engineering Jobs uses the upstream REST API provider. The old HTML-card parser and its markup-specific tests are retired; remaining comment/format differences in that module add no runtime behavior.
- The root story-bank deletion and dashboard wrapper removal are already incorporated upstream behavior. Preserve per-user story-bank ownership and dashboard binary placement rather than carrying those historical deletions as independent patches.
- The independent `_custom-fetch.mjs` retry helper is retired. Fork providers now use upstream context transports, shared retries, HTML normalization, and entity decoding.
- The fork's private copy of the directory-lock protocol in `pipeline-lock.mjs`, its inline Block G signals 8–17, its web personalization section scanner, its private web `runSetStatus`, and its updater `dataRoots` template-variant code are retired in favor of upstream's `lib/dir-lock.mjs`, `modes/oferta-signals/`, core `sectionState`, `core-cli.ts` and `snapshotConfiguredTemplateVariantsAcrossProfiles` (integration at 8f489289).
- Upstream's own `sync-batch-input.mjs` implementation and Bash `run_worker` watchdog are not carried: the former forwards to the fork's synchronizer, the latter is replaced by `worker-process.mjs`.

## Redundancy Checklist For Future Upstream Updates

On every upstream update, explicitly check whether upstream now includes:

- Any provider currently implemented in `providers/_custom.mjs`.
- Any fork provider adapter now covered by upstream first-party modules such as RemoteOK, Remotive, IBM, or Working Nomads. Working Nomads is already on the upstream-style module path; only the fork's local filter compatibility should remain unless upstream adds equivalent filters.
- Provider context/transport changes, including raw browser-response accounting, proxy/IP guards, timeouts, and shared retry policy.
- Report-numbered CV artifact naming.
- Deterministic HTML CV rendering that preserves active-user containment, selected system templates, supported local/data-image photos, and report-linked artifact names.
- Config-driven CV theme tokens.
- Per-user dashboard binary build/run flow.
- Dashboard listing-date parsing/display.
- Batch runner support for both Claude and Codex workers.
- Schema-checked Codex batch worker final JSON via `--output-last-message`.
- Cross-artifact batch validation equivalent to the fork's report/TSV/final-JSON consistency gate, confidential-employer Via requirement, bounded deterministic repair, merge-time pending-file preservation, and structured verifier failure propagation.
- Optional profile-driven batch parallelism with argument -> `batch.parallel` -> `1` precedence and bounded validation.
- Codex model/reasoning argument -> profile -> GPT 6.1 Sol/medium resolution across every Codex call owned by the deterministic run coordinator.
- Deterministic `run-workflow.mjs` orchestration with strict handoff and verification-review schemas, stable queue synchronization, duplicate resolution, orphan restoration/archive, bounded tracker patches, and human-review-preserving final status.
- Bounded batch runs through `--limit` are now upstream baseline; preserve only the fork-specific user-scoped/Codex integration around the flag.
- Batch status/watch progress monitoring through user-scoped batch state.
- User-scoped `spend_tier`, pre-screen discard logs, CV fact validation, salary/funnel/stats/upskill analytics, reply matching, invite matching, and canonical status updates.
- `local:jds/...` batch input handling.
- Conditional batch PDF generation for `Skip` decisions and profile hard stops. Score-threshold configuration is now upstream behavior through `auto_pdf_score_threshold`.
- Per-user adaptation for upstream tracker report-link normalization and `merge-tracker.mjs --migrate`.
- Per-user adaptation for upstream `merge-tracker.mjs` filesystem locking and atomic writes.
- Per-user adaptation for upstream `reserve-report-num.mjs`, `scan-ats-full.mjs`, `validate-portals.mjs`, and `generate-cover-letter.mjs`. The allocator's concurrency, tracker-occupancy, ownership-token, range-safety, and arbitrary-width behavior are now upstream baseline; preserve only active-user routing, fixture overrides, and the fork's fail-closed report/tracker ID-parity guard.
- Per-user adaptation for upstream `assessment-log.mjs`, `cv-templates.mjs`, `img-to-pdf.mjs`, and template-aware `build-cv-latex.mjs`.
- Per-user adaptation for upstream `verify-portals.mjs`, `reconcile-pipeline.mjs`, pipeline liveness sweeps, `doctor.mjs --strict`, and any new scan/batch helpers that read `portals.yml`, `data/`, or `batch/`.
- Per-user adaptation for upstream token aggregation and evaluator usage logs; no summary command may fall back to root `batch/` or `reports/`.
- User-scoped scan handoff artifacts at `users/{USER}/data/scan-handoff.json` plus the explicit `/career-ops scan-handoff` follow-up mode.
- Explicit `/career-ops run` full queue processing with conditional handoff, configured sources, independent manual actions, and non-fatal source/company failures.
- Report-number reservation past 999 and reconciler report lookup through explicit `--reports` paths.
- Per-target scan `location_filter` overrides and Arbeitsagentur remote-title/no-remote normalization.
- User-scoped `voice-dna.md` behavior, if upstream keeps treating root `voice-dna.md` as a user file.
- Antigravity skill entrypoint materialization in `update-system.mjs`.
- Upstream dead-link/liveness gates in `modes/oferta.md` and `modes/auto-pipeline.md` that still respect user-layer reports and Playwright verification rules.
- Upstream Playwright MCP doctor warning that remains available through `doctor.mjs --user {USER} --json`.
- Upstream Release Please component-tag parsing in `update-system.mjs`.
- Upstream Docker/scaffolder tooling that preserves the user-layer data contract.
- Upstream cover-letter and interview modes that route generated artifacts and context through `users/{USER}/`.
- Generic JD/PDF extraction commands.
- Dashboard configurability equivalent to the fork's combined `Hired` + `Closed` inline-tab layout, lazy report hydration, compact column defaults, and per-user root inference.
- Dashboard discard-reason handling equivalent to the fork's combined atomic reason write, dated status interaction, existing Notes preservation, distinct `Closed` state, and user-root report containment.
- Equivalent user-layer ignores for interview prep, scan summaries, `article-digest.md`, and editor folders.
- A per-user, locked batch-input synchronizer with stable IDs recovered from batch state; if upstream's `sync-batch-input.mjs` gains these, retire `sync-pipeline-batch.mjs`/`lib/run-batch-sync.mjs` instead of the forward.
- `CAREER_OPS_PROFILE` threaded through headless batch prompts and the run coordinator; if upstream does this, lift the run/batch lane's deliberate profile-override limitation.
- `Closed` (not `Discarded`) as the state for expired Evaluated rows in `check-liveness.mjs --tracker` and localized liveness sweeps.
- A web launcher that keeps the system checkout and the selected user's data root separate.

If upstream covers one of these, prefer deleting the local customization over carrying duplicate behavior.
