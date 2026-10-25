---
description: Merge upstream main, adapt fork workflows including the full workflow runner, and report usage changes.
name: update-main
---

**This skill does not require a user profile selection.**

Study @FORK.md. Treat it as the current inventory of fork-specific behavior, conflict-prone files, and customizations that may become redundant when upstream adds equivalent features.

Fetch and merge `main` branch from `upstream` remote onto current branch, preserving this fork's intentional customizations without blocking new upstream behavior.

Treat every update as an end-to-end compatibility change, even when `run-workflow.mjs` itself has no merge conflict. Compare the incoming commands, modes, providers, filters, data contracts, worker schemas, CV checks, tracker/status side effects, and manual-input rules with the executable path used by `run`, batch workers, liveness, reconciliation, and reviewed verification. Adapt the fork to the current upstream behavior and retire duplicate implementations; preserve only the intentional differences documented in `FORK.md`.

During the merge, use `modes/run.md` as the authoritative runner contract. Check whether upstream changes require adapting queue dispatch, manual-action collection, answer matching, recovery bounds, or completion criteria. Update the affected runner code and fixtures together so the merged workflow still processes independent jobs while preserving unresolved choices and stopping recovery at its configured limits.

After adapting upstream changes, check both interactive modes and headless workers against the same canonical workflow, including any changes to model or CLI selection. New checks or configuration options are not integrated merely because their files exist: prove they are reached by the runner, or document a deliberate limitation in `FORK.md`.

Update `FORK.md` before finishing:

- Update the generated-from refs, ahead/behind counts, and diff size.
- Add new fork customizations introduced by the merge or conflict resolution.
- Remove or mark retired customizations that upstream made redundant.
- Keep conflict notes tied to concrete files and behaviors, not vague history.

Run the relevant validation for touched areas. At minimum, use the repo's standard quick checks when the merge touches scripts, modes, providers, dashboard, or tracker behavior:

```bash
node test-all.mjs --quick
```

Run raw pipeline verification against an isolated temporary user fixture. Use an actual user's data only when that user and validation are authorized; maintenance alone does not authorize user-data inspection or onboarding. When incoming changes can affect queue flow, add or run executable runner fixtures covering existing backlog, mixed success/manual holds, exact-answer resume, partial discovery, failures/recovery, concurrent inbox additions, and the selected output format. On Windows, exercise the real Git Bash/CLI launch path and owned process-tree cleanup. Passing source-text wiring assertions alone does not establish end-to-end compatibility.

If the dashboard changed, also run Go tests in `dashboard/`.

Commit and push.

Before reporting, bring every user's configuration up to date with the incorporated range, so their next runs use what fits them. This step is authorized for every directory under the users root (`users/`, or `CAREER_OPS_USERS_DIR`): it may read each user's `config/profile.yml`, `modes/_profile.md` and `portals.yml`, and edit only `portals.yml`.

- Add new providers and boards that suit the user's target roles, locations and markets. Probe each with `verify-portals.mjs` or `audit-portals.mjs` first. Enable the ones that answer and return relevant postings; add the rest disabled, with a comment saying why.
- Apply new per-entry source options where the user's profile calls for them.
- Migrate existing entries whose source changed (moved URL, new provider id, retired board). Disable dead entries rather than deleting them.
- Keep comments and unrelated entries, back up each file before writing it, and finish with `verify-pipeline.mjs --user {USER}` reporting no unclaimed portal entries.
- Do not change other user settings. List new profile options that would suit a user as proposals in the report.

Finally, report usage changes over the actual incorporated-base-to-new-base range, distinguishing new features from behavior already present in the fork. Explain which changes apply automatically, need user configuration, or intentionally remain unsupported, and state the evidence and limits of `run` validation. Report each user's source changes, including entries left disabled and why, and the proposed settings.
