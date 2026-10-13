# career-ops web (alpha)

An **experimental, opt-in web UI** for career-ops. It is a local-first *view* over
the exact same user files the CLI reads and writes (`users/{USER}/data/pipeline.md`,
`users/{USER}/data/applications.md`, `users/{USER}/reports/`, `users/{USER}/config/`): no parallel engine, no separate
database, no server. If you never run it, nothing about your CLI workflow changes.

> **Status: alpha.** Expect rough edges. Feedback →
> [Discussion #1142](https://github.com/santifer/career-ops/discussions/1142) ·
> roadmap context → [Discussion #156](https://github.com/santifer/career-ops/discussions/156).

## Quick start

Requires Node 22+ (see [Tests](#tests) — `npm test`'s glob discovery needs it).

```bash
cd web
npm ci
# Add CAREER_OPS_USER=<username> to web/.env.local before starting.
npm run dev
```

Replace `<username>` with the career-ops user you want to use before running the server. For an existing `.env.local`, add or update `CAREER_OPS_USER` in that file. The web app requires a valid user ID, matching the CLI's 1-64-character format. Missing or invalid IDs stop development and production servers with an actionable error. All candidate files resolve under that user's folder.

Open http://localhost:3000.

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
- **CV generation never asks the agent to write:** the `pdf` worker tailors your
  CV and emits it inline in a `<<cv-html>>` envelope; the backend parses that
  envelope, writes the HTML, and renders the PDF itself. Job postings and
  evaluation reports are untrusted input that reaches this agent, so the safest
  thing is for it to hold no write tool at all — on Claude Code every write-capable
  tool is disallowed for this mode (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`
  and `Bash`). Other CLIs are invoked with a bare prompt and keep their own default
  tool access, so on those the agent still *holds* write tools — what the pipeline
  guarantees is that the CV which gets rendered is the one the backend parsed out of
  the envelope, never a file an agent wrote behind it.
- **Additive:** the web is isolated from the core's packaging, CI and release
  automation. The CLI works exactly the same without it.

## Development

```bash
npm run dev          # dev server (Turbopack)
npm test             # unit suites (node --test, no framework)
npx tsc --noEmit     # typecheck
npm run build        # production build
```

Set `CAREER_OPS_ROOT=/path/to/checkout` in `web/.env.local` to point the app at a different career-ops system checkout. `CAREER_OPS_USER=<username>` is required to select `users/<username>`; set `CAREER_OPS_USERS_DIR=/path/to/users` only for non-standard user roots or tests. Relative users-directory overrides resolve against the system checkout, as they do in the CLI. System scripts, tracker aliases, canonical states, tracker locks, and matching helpers continue to load from the system checkout. Production builds and unit tests can run without a selected user; starting a server or accessing candidate data requires one.
