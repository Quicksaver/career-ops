# career-ops web (alpha)

An **experimental, opt-in web UI** for career-ops. It is a local-first *view* over
the exact same user files the CLI reads and writes (`users/{USER}/data/pipeline.md`,
`users/{USER}/data/applications.md`, `users/{USER}/reports/`, `users/{USER}/config/`): no parallel engine, no separate
database, no server. If you never run it, nothing about your CLI workflow changes.

> **Status: alpha.** Expect rough edges. Feedback →
> [Discussion #1142](https://github.com/santifer/career-ops/discussions/1142) ·
> roadmap context → [Discussion #156](https://github.com/santifer/career-ops/discussions/156).

## Quick start

Requires Node 20+.

```bash
cd web
npm ci
npm run dev
```

Open http://localhost:3000. In this fork, set `CAREER_OPS_USER=<username>` so the app reads the same active user folder as the CLI. Without that variable, it falls back to the upstream single-root layout for compatibility.

## What works today

- **Pipeline** — your tracker as a sortable, filterable table; status changes
  write back through the core's own scripts.
- **Explore** — the free reverse-ATS scan with an honest partial-dataset
  indicator, plus AI-assisted discovery (bring your own CLI/keys).
- **Apply** — assisted form prefill with a hard rule inherited from the core:
  **it never submits for you** — you always press the button.
- **Today / Analytics / CV / Config** — action queue, funnel, CV editing with
  preview, settings.

## Safety

- **Local-first:** the local web app runs entirely on your machine — no cloud,
  no account needed. Your CV and data stay in your own files.
- **Never auto-submits:** the apply flow drafts and prefills; submitting is
  always a human action.
- **Additive:** the web is isolated from the core's packaging, CI and release
  automation. The CLI works exactly the same without it.

## Development

```bash
npm run dev          # dev server (Turbopack)
npx tsc --noEmit     # typecheck
npm run build        # production build
```

Set `CAREER_OPS_ROOT=/path/to/checkout` in `web/.env.local` to point the app at a different career-ops system checkout. Set `CAREER_OPS_USER=<username>` to select `users/<username>`; set `CAREER_OPS_USERS_DIR=/path/to/users` only for non-standard user roots or tests.
