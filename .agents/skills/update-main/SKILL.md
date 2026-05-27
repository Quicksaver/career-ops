---
description: Update current branch with changes from main, report on new features and altered behaviors.
name: update-main
---

Update the current branch with `upstream/main`, preserving this fork's intentional customizations without blocking new upstream behavior.

## Customization Inventory

Read `CUSTOMIZED.md` before merging. Treat it as the current inventory of fork-specific behavior, conflict-prone files, and customizations that may become redundant when upstream adds equivalent features.

Keep `CUSTOMIZED.md` readable for humans: do not hard-wrap prose lines; let editors wrap long lines visually. Keep headings, lists, tables, and code blocks structurally formatted.

## Update Workflow

1. Run the repo hygiene check first:

```bash
node update-system.mjs check
```

2. Fetch upstream and inspect both incoming changes and current fork delta:

```bash
git fetch upstream main
git diff --stat HEAD..upstream/main
git diff --name-status HEAD..upstream/main
git log --oneline --left-right --cherry-pick HEAD...upstream/main
git diff --stat upstream/main..HEAD
git diff --name-status upstream/main..HEAD
```

3. Read `CUSTOMIZED.md` and identify which listed customizations touch the incoming upstream files. Pay special attention to sections whose files appear in the incoming diff.

4. Merge `upstream/main` into the current branch.

5. Resolve conflicts with this policy: upstream changes are purposeful and should be kept as the baseline; adapt fork customizations around upstream instead of discarding upstream behavior. Use `CUSTOMIZED.md` to decide which local behavior must be preserved, which can be deleted as redundant, and which documentation needs updating.

6. After the merge, reassess the redundancy checklist in `CUSTOMIZED.md`. If upstream now provides an equivalent implementation for any local customization, prefer deleting the fork copy over carrying duplicate behavior.

7. Update `CUSTOMIZED.md` before finishing:

- Update the generated-from refs, ahead/behind counts, and diff size.
- Add new fork customizations introduced by the merge or conflict resolution.
- Remove or mark retired customizations that upstream made redundant.
- Keep conflict notes tied to concrete files and behaviors, not vague history.

8. Run the relevant validation for touched areas. At minimum, use the repo's standard quick checks when the merge touches scripts, modes, providers, dashboard, or tracker behavior:

```bash
node test-all.mjs --quick
node verify-pipeline.mjs
```

If the dashboard changed, also run Go tests in `dashboard/`.

## Reporting

Report the upstream behavior changes that landed, the customizations preserved from `CUSTOMIZED.md`, any customizations removed because upstream made them redundant, and the validation commands run. Highlight anything that can impact custom functionality or should be addressed in a follow-up.
