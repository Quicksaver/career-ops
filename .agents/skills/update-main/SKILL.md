---
description: Update current branch with changes from main, report on new features and altered behaviors.
name: update-main
---

**This skill does not require a user profile selection.**

Study @CUSTOMIZED.md. Treat it as the current inventory of fork-specific behavior, conflict-prone files, and customizations that may become redundant when upstream adds equivalent features.

Keep `CUSTOMIZED.md` readable for humans: do not hard-wrap prose lines; let editors wrap long lines visually. Keep headings, lists, tables, and code blocks structurally formatted.

Fetch and merge `main` branch from `upstream` remote onto current branch, preserving this fork's intentional customizations without blocking new upstream behavior.

Remember incoming changes have been purposefully merged, the ongoing branch work is accessory and any conflicts should be resolved by working our changes around the incoming ones as necessary.

Update `CUSTOMIZED.md` before finishing:

- Update the generated-from refs, ahead/behind counts, and diff size.
- Add new fork customizations introduced by the merge or conflict resolution.
- Remove or mark retired customizations that upstream made redundant.
- Keep conflict notes tied to concrete files and behaviors, not vague history.

Run the relevant validation for touched areas. At minimum, use the repo's standard quick checks when the merge touches scripts, modes, providers, dashboard, or tracker behavior:

```bash
node test-all.mjs --quick
node verify-pipeline.mjs
```

If the dashboard changed, also run Go tests in `dashboard/`.

Finally, report on new features or behaviors introduced by the upstream merge, highlight those that can impact the customized behavior or functionality, or that should be otherwise specifically addressed.
