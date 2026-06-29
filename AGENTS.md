# Career-Ops -- AI Job Search Pipeline

## Origin

This system was built and used by [santifer](https://santifer.io) to evaluate 740+ job offers, generate 100+ tailored CVs, and land a Head of Applied AI role. The archetypes, scoring logic, negotiation scripts, and proof point structure all reflect his specific career search in AI/automation roles.

The portfolio that goes with this system is also open source: [cv-santiago](https://github.com/santifer/cv-santiago).

**It will work out of the box, but it's designed to be made yours.** If the archetypes don't match your career, the modes are in the wrong language, or the scoring doesn't fit your priorities -- just ask. You (AI Agent) can edit the user's files. The user says "change the archetypes to data engineering roles" and you do it. That's the whole point.

## Data Contract (CRITICAL)

There are two layers. Read `DATA_CONTRACT.md` for the full list.

**User Layer (NEVER auto-updated, personalization goes HERE):**
- `users/{USER}/cv.md`, `users/{USER}/config/profile.yml`, `users/{USER}/modes/_profile.md`, `users/{USER}/modes/_custom.md`, `users/{USER}/article-digest.md`, `users/{USER}/portals.yml`
- `users/{USER}/data/*`, `users/{USER}/reports/*`, `users/{USER}/output/*`, `users/{USER}/interview-prep/*`, `users/{USER}/jds/*`, `users/{USER}/writing-samples/*`, `users/{USER}/batch/*`

**System Layer (auto-updatable, DON'T put user data here):**
- `modes/_shared.md`, `modes/oferta.md`, all other modes
- `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `OPENCODE.md`, `*.mjs` scripts, `dashboard/*`, `templates/*`, `batch/*`

**THE RULE: When the user asks to customize candidate facts or scoring inputs (archetypes, narrative, negotiation scripts, proof points, location policy, comp targets), write to `users/{USER}/modes/_profile.md` or `users/{USER}/config/profile.yml`. When the user asks for procedural house rules, output preferences, or workflow overrides, write to `users/{USER}/modes/_custom.md` seeded from `modes/_custom.template.md` if needed. NEVER edit `modes/_shared.md` for user-specific content.** This ensures system updates don't overwrite their customizations.

## Active User (CRITICAL)

All career-ops commands require an active user. User-specific data is centralized under `users/{USER}/`, which is gitignored.

Resolve the user before any career-ops work:
1. If the current command explicitly includes a user (`/career-ops go <username>`, `/career-ops scan <username>`, `/career-ops scan-auth <username> linkedin`, `/career-ops pipeline <username>`, or `--user <username>`), use it.
2. Otherwise, if this conversation already established an active user from a previous career-ops command, reuse it.
3. Otherwise, stop immediately and ask which career-ops user to use. Do not inspect or modify user-layer files before the user is known.

Valid user IDs use letters, numbers, dots, underscores, or hyphens. Do not accept path-like IDs.

After resolving the active user, remove the explicit user token or `--user` flag before mode routing. Example: `/career-ops scan <username>` means mode `scan` with user `<username>`.

When running scripts, pass the active user explicitly:
- `node scan.mjs --user {USER}`
- `node verify-pipeline.mjs --user {USER}`
- `node merge-tracker.mjs --user {USER}`
- `batch/batch-runner.sh --user {USER}`

Dashboard TUI binaries are per-user artifacts. When building the dashboard, compile from `dashboard/` into the active user's folder:
- Current platform: `cd dashboard && go build -o ../users/{USER}/career-dashboard .`
- Windows x64: `cd dashboard && GOOS=windows GOARCH=amd64 go build -o ../users/{USER}/career-dashboard.exe .`
- Linux x64: `cd dashboard && GOOS=linux GOARCH=amd64 go build -o ../users/{USER}/career-dashboard .`
- macOS arm64: `cd dashboard && GOOS=darwin GOARCH=arm64 go build -o ../users/{USER}/career-dashboard .`

Run the per-user binary without `--path`; it infers the user folder from its own location or the current directory. Keep `--path` optional for unusual layouts, e.g. `career-dashboard --path /path/to/career-ops --user {USER}` or `career-dashboard --path /path/to/users/{USER}`.

## Long-Running Command Quiet Mode

When the user asks you to run `go`, `scan`, `scan-handoff`, `scan-auth`, `pipeline`, or `batch`, keep the conversation quiet while the command is running:
- Start the command, then reserve user-visible updates for meaningful events rather than routine "still running" or "currently at phase X" messages.
- Keep long-running commands alive through long duration, high match counts, deeper-than-expected pagination, and larger/noisier-than-anticipated output. Long authenticated scans, especially LinkedIn, can legitimately take a long time. Let the process finish so it can persist its output.
- Stop a running long-running command only when the user explicitly says to stop, the command exits/fails, it requests login/CAPTCHA/account verification/other user action, or there is a confirmed destructive/data-corruption risk. For abnormal behaviour outside those blockers, report the concern at the allowed quiet-mode cadence and keep monitoring.
- Poll the process internally only as needed for liveness. If it is still running normally, wait at least 10 minutes between user-visible status updates.
- Treat command stdout/stderr as the progress source. Keep phase-by-phase progress in the command output rather than paraphrasing it back to the user.
- For Codex tool sessions, keep routine `write_stdin` polls silent. Poll with the longest supported wait, and if the tool returns before 10 minutes, continue polling silently until the command completes or a real action is needed.
- Reserve user-visible messages for completion, failure, required action, suspected hangs, concrete warnings, and explicit status requests.
- Report immediately only when the command completes, fails, asks for login/CAPTCHA/user action, appears hung, or produces a concrete warning that changes what the user should do.
- If a user explicitly asks for status while the command is running, answer once with the current observed state, then return to quiet monitoring.

## Source-of-Truth Boundary (CRITICAL)

User-facing content (CV, cover letters, form answers, recruiter outreach, application form responses) is generated **exclusively** from these files plus statements the user makes directly in the current conversation:

- `users/{USER}/cv.md`
- `users/{USER}/article-digest.md`
- `users/{USER}/config/profile.yml`
- `users/{USER}/modes/_profile.md`
- `users/{USER}/modes/_custom.md`
- `users/{USER}/writing-samples/`
- `users/{USER}/voice-dna.md` (voice/style only — governs *how* text reads, never introduces factual claims)
- `users/{USER}/interview-prep/story-bank.md` and `users/{USER}/interview-prep/{company}-{role}.md` (the user's own STAR stories and interview-prep notes — same trust level as `cv.md`; consumed by the `interview` and `apply`/`match-star` modes)

Anything not in this list is **out of scope for content generation**, including:

- Auto-memory at `~/.claude/projects/.../memory/` — see scope clarification below
- Any directory outside the career-ops project — for example, parent-directory repos containing the user's product code, sibling project directories, or other unrelated codebases on the same machine
- Cross-session inferences about the user's work that have not been written into one of the in-scope files
- Knowledge from other Claude Code projects on the same machine

**Rule from the original design (santifer's case study):** *"Keywords get reformulated, never fabricated."* Reorder, reframe, emphasise — but never invent. If a claim isn't backed by an in-scope file, ask the user. If they cannot or do not want to add it, the output goes without it. Silence on a topic is fine; manufactured detail is not.

**Authorship claims are non-negotiable.** Never claim the user authored a project, repo, library, tool, framework, or open-source artefact unless explicitly attributed to them in `cv.md` or `article-digest.md`. Tool-of-trade conflation (the user uses X → the user built X) is the most common fabrication pattern and is explicitly forbidden.

### Auto-memory scope (clarification, not exception)

The auto-memory layer at `~/.claude/projects/.../memory/` is reserved for **behavioural steering only**:

- User preferences (style, tone, formatting, communication cadence)
- Process rules and corrections (don't do X, always do Y)
- Operational state (active relationships, applied roles, observed patterns, outcome learnings)
- External references (where to find things in other systems)

Auto-memory **never** holds content claims about the user's work, technical accomplishments, authorship, or anything that would appear verbatim or near-verbatim in CV/cover output. If a fact belongs in user-facing content, it lives in the user-layer files, not in memory.

### Where rules live

Rules belong in files the harness reads automatically — `CLAUDE.md`, `CODEX.md`, `AGENTS.md`, `modes/*.md`, `MEMORY.md`. Do not create sidecar documentation that requires manual loading. Reinforcement-without-enforcement decays.

## Update Check

On the first message of each session, run the update checker silently:

```bash
node update-system.mjs check
```

Parse the JSON output:
- `{"status": "update-available", "local": "1.0.0", "remote": "1.1.0", "changelog": "..."}` → tell the user:
  > "career-ops update available (v{local} → v{remote}). Your data (CV, profile, tracker, reports) will NOT be touched. Want me to update?"
  If yes → run `node update-system.mjs apply`. If no → run `node update-system.mjs dismiss`.
- `{"status": "up-to-date"}` → say nothing
- `{"status": "dismissed"}` → say nothing
- `{"status": "offline"}` → say nothing
- `{"status": "no-remote-version"}` → say nothing (checker reached GitHub but neither VERSION nor the latest release tag parsed as semver — treat as a silent non-failure, same as offline)

The user can also say "check for updates" or "update career-ops" at any time to force a check.
To rollback: `node update-system.mjs rollback`

## What is career-ops

AI-powered, CLI-agnostic job search automation: pipeline tracking, offer evaluation, CV generation, portal scanning, batch processing. Runs on any AI coding CLI that follows the [open agent skill standard](https://agentskills.io) (Claude Code, Codex, OpenCode, Qwen, Copilot, Kimi, Antigravity CLI, Grok Build CLI). Legacy Gemini API evaluation remains available through `gemini-eval.mjs`.

### Codex invocation

- **Interactive Codex:** run `codex` in the repo root. Slash commands are not guaranteed in Codex, so ask Codex to run the requested mode directly if `/career-ops` is unavailable.
- **Headless Codex:** use `codex exec "prompt"` for one-shot workers.
- **Examples:** `Run career-ops scan mode for <username>`, `Run career-ops pipeline mode for <username>`, `Run career-ops pdf mode for <username>`, `Run career-ops tracker mode for <username>`, `Evaluate this JD with career-ops auto-pipeline for <username>: https://company.com/jobs/123`

### Main Files

| File | Function |
|------|----------|
| `users/{USER}/data/applications.md` | Application tracker |
| `users/{USER}/data/pipeline.md` | Inbox of pending URLs |
| `users/{USER}/data/scan-history.tsv` | Scanner dedup history |
| `users/{USER}/data/scan-handoff.json` | Full Agent/WebSearch handoff list from the latest zero-token scan |
| `users/{USER}/portals.yml` | Query and company config |
| `templates/cv-template.html` | HTML template for CVs |
| `templates/cv-template.tex` | LaTeX/Overleaf template for CVs |
| `generate-pdf.mjs` | Playwright: HTML to PDF |
| `generate-latex.mjs` | LaTeX CV validator + pdflatex compiler |
| `users/{USER}/article-digest.md` | Compact proof points from portfolio (optional) |
| `users/{USER}/interview-prep/story-bank.md` | Accumulated STAR+R stories across evaluations |
| `users/{USER}/interview-prep/{company}-{role}.md` | Company-specific interview intel reports |
| `analyze-patterns.mjs` | Pattern analysis script (JSON output) |
| `followup-cadence.mjs` | Follow-up cadence calculator (JSON output) |
| `data/follow-ups.md` | Follow-up history tracker |
| `scan.mjs` | Zero-token portal scanner — hits Greenhouse/Ashby/Lever/PCSX APIs plus structured providers such as Landing.jobs, SwissDevJobs, GermanTechJobs, DevITJobs, EU Remote Jobs, ITJobs, SAPO Emprego, Portal Emprego, Dice, Remote in Europe, Working Nomads, and NoDesk directly, zero LLM cost |
| `scan-auth.mjs` | Authenticated portal scanner — uses per-user Playwright browser profiles under `~/.scan-auth/users/{USER}/{PORTAL}/profile` |
| `check-liveness.mjs` | Job posting liveness checker |
| `liveness-core.mjs` | Shared liveness logic (expired signals win over generic Apply text) |
| `users/{USER}/reports/` | Evaluation reports (format: `{###}-{company-slug}-{YYYY-MM-DD}.md`). Blocks A-F + G (Posting Legitimacy). Header includes `**Legitimacy:** {tier}`. |

### First Run — Onboarding (IMPORTANT)

**Before doing ANYTHING else, check if the system is set up.** On the first message of each session, run the cold-start check — one deterministic source of truth (this doc and `doctor.mjs` share the same prerequisite list, so they can never drift):

```bash
node doctor.mjs --user {USER} --json
```

Output: `{"onboardingNeeded": <bool>, "missing": [...], "warnings": [...]}`, where `missing` lists whichever of `cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml` are absent. `warnings` is reserved for non-blocking setup signals.

If `warnings` includes a Playwright MCP/project-config warning, do not report that Playwright tools are unavailable until you check the actual runtime tool registry. In Codex, use `tool_search` for Playwright/browser tools; in other CLIs, use the equivalent MCP/tool discovery mechanism. The doctor check can only inspect project config files, while some environments lazy-load MCP tools without a repo-local `.mcp.json` or `.claude/settings*.json`.

0. Has an active user been explicitly specified in this conversation? If not, stop and ask which user to use before running the cold-start check.

- If `modes/_profile.md` is in `missing`, copy it silently from `modes/_profile.template.md` to `users/{USER}/modes/_profile.md` (the user's customization file — never overwritten by updates). It's then resolved.
- If the user needs procedural house rules or output preferences and `users/{USER}/modes/_custom.md` is missing, copy it from `modes/_custom.template.md` first and edit the user-layer copy only.
- **If, after that, `onboardingNeeded` is still true (any of `cv.md` / `config/profile.yml` / `portals.yml` is missing), enter onboarding mode.** Do NOT proceed with evaluations, scans, or any other mode until the basics are in place. Guide the user step by step:

#### Step 1: CV (required)
If `users/{USER}/cv.md` is missing, ask:
> "I don't have your CV yet. You can either:
> 1. Paste your CV here and I'll convert it to markdown
> 2. Paste your LinkedIn URL and I'll extract the key info
> 3. Tell me about your experience and I'll draft a CV for you
>
> Which do you prefer?"

Create `users/{USER}/cv.md` from whatever they provide. Make it clean markdown with standard sections (Summary, Experience, Projects, Education, Skills).

#### Step 2: Profile (required)
If `users/{USER}/config/profile.yml` is missing, copy from `config/profile.example.yml` and then ask:
> "I need a few details to personalize the system:
> - Your full name and email
> - Your location and timezone
> - What roles are you targeting? (e.g., 'Senior Backend Engineer', 'AI Product Manager')
> - Your salary target range
>
> I'll set everything up for you."

Fill in `users/{USER}/config/profile.yml` with their answers. For archetypes and targeting narrative, store the user-specific mapping in `users/{USER}/modes/_profile.md` or `users/{USER}/config/profile.yml` rather than editing `modes/_shared.md`.

#### Step 3: Portals (recommended)
If `users/{USER}/portals.yml` is missing:
> "I'll set up the job scanner with 45+ pre-configured companies. Want me to customize the search keywords for your target roles?"

Copy `templates/portals.example.yml` → `users/{USER}/portals.yml`. If they gave target roles in Step 2, update `title_filter.positive` to match.

#### Step 4: Tracker
If `users/{USER}/data/applications.md` doesn't exist, create it:
```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
```

#### Step 5: Get to know the user (important for quality)

After the basics are set up, proactively ask for more context. The more you know, the better your evaluations will be:

> "The basics are ready. But the system works much better when it knows you well. Can you tell me more about:
> - What makes you unique? What's your 'superpower' that other candidates don't have?
> - What kind of work excites you? What drains you?
> - Any deal-breakers? (e.g., no on-site, no startups under 20 people, no Java shops)
> - Your best professional achievement — the one you'd lead with in an interview
> - Any projects, articles, or case studies you've published?
>
> The more context you give me, the better I filter. Think of it as onboarding a recruiter — the first week I need to learn about you, then I become invaluable."

Store any insights the user shares in `users/{USER}/config/profile.yml` (under narrative), `users/{USER}/modes/_profile.md`, or in `users/{USER}/article-digest.md` if they share proof points. Do not put user-specific archetypes or framing into `modes/_shared.md`.

**After every evaluation, learn.** If the user says "this score is too high, I wouldn't apply here" or "you missed that I have experience in X", update your understanding in `users/{USER}/modes/_profile.md`, `users/{USER}/config/profile.yml`, or `users/{USER}/article-digest.md`. The system should get smarter with every interaction without putting personalization into system-layer files.

#### Step 6: Ready
Once all files exist, confirm:
> "You're all set! You can now:
> - Paste a job URL to evaluate it
> - Run the scan entrypoint for your CLI to search portals: `/career-ops scan`, `/career-ops-scan`, or ask Codex to run `scan`
> - Open the command menu for your CLI: `/career-ops`, the CLI-specific alias, or ask Codex to show the available career-ops modes
>
> Everything is customizable — just ask me to change anything.
>
> Tip: Having a personal portfolio dramatically improves your job search. If you don't have one yet, the author's portfolio is also open source: github.com/santifer/cv-santiago — feel free to fork it and make it yours."

Then suggest automation:
> "Want me to scan for new offers automatically? I can set up a recurring scan every few days so you don't miss anything. Just say 'scan every 3 days' and I'll configure it."

If the user accepts, use the `/loop` or `/schedule` skill (if available) to set up a recurring scan entrypoint for their CLI (`/career-ops scan`, `/career-ops-scan`, or the equivalent Codex prompt). If those aren't available, suggest adding a cron job or remind them to run the scan mode periodically.

### Personalization

This system is designed to be customized by YOU (AI Agent). When the user asks you to change archetypes, translate modes, adjust scoring, add companies, or modify negotiation scripts -- do it directly. You read the same files you use, so you know exactly what to edit.

**Common customization requests:**
- "Change the archetypes to [backend/frontend/data/devops] roles" → edit `users/{USER}/modes/_profile.md` or `users/{USER}/config/profile.yml`
- "Translate the modes to English" → edit all files in `modes/`
- "Add these companies to my portals" → edit `users/{USER}/portals.yml`
- "Update my profile" → edit `users/{USER}/config/profile.yml`
- "Change the CV template design" → edit `templates/cv-template.html`
- "Adjust the scoring weights" → edit `users/{USER}/modes/_profile.md` for user-specific weighting, or edit `modes/_shared.md` and `batch/batch-prompt.md` only when changing the shared system defaults for everyone

### Language Modes

Default modes are in `modes/` (English). Additional language-specific modes are available:

- **German (DACH market):** `modes/de/` — native German translations with DACH-specific vocabulary (13. Monatsgehalt, Probezeit, Kündigungsfrist, AGG, Tarifvertrag, etc.). Includes `_shared.md`, `angebot.md` (evaluation), `bewerben.md` (apply), `pipeline.md`.
- **French (Francophone market):** `modes/fr/` — native French translations with France/Belgium/Switzerland/Luxembourg-specific vocabulary (CDI/CDD, convention collective SYNTEC, RTT, mutuelle, prévoyance, 13e mois, intéressement/participation, titres-restaurant, CSE, portage salarial, etc.). Includes `_shared.md`, `offre.md` (evaluation), `postuler.md` (apply), `pipeline.md`.
- **Arabic (Middle East / Arab market):** `modes/ar/` — native Arabic translations with Arab region-specific vocabulary (مكافأة نهاية الخدمة, التأمينات الاجتماعية, راتب إجمالي/صافي, فترة التجربة, فترة الإخطار, البدلات, etc.). Includes `_shared.md`, `fursah.md` (evaluation), `takdeem.md` (apply), `pipeline.md`.
- **Japanese (Japan market):** `modes/ja/` — native Japanese translations with Japan-specific vocabulary (正社員, 業務委託, 賞与, 退職金, みなし残業, 年俸制, 36協定, 通勤手当, 住宅手当, etc.). Includes `_shared.md`, `kyujin.md` (evaluation), `oubo.md` (apply), `pipeline.md`.
- **Turkish (Turkey market):** `modes/tr/` — native Turkish translations with Turkey-specific vocabulary (SGK, kıdem tazminatı, ihbar süresi, brüt/net maaş, AGİ, BES, yemek kartı, yol yardımı, TÜFE zammı, etc.). Includes `_shared.md`, `is-ilani.md` (evaluation), `basvuru.md` (apply), `pipeline.md`.

**When to use German modes:** If the user is targeting German-language job postings, lives in DACH, or asks for German output. Either:
1. User says "use German modes" → read from `modes/de/` instead of `modes/`
2. User sets `language.modes_dir: modes/de` in `users/{USER}/config/profile.yml` → always use German modes
3. You detect a German JD → suggest switching to German modes

**When to use French modes:** If the user is targeting French-language job postings, lives in France/Belgium/Switzerland/Luxembourg/Quebec, or asks for French output. Either:
1. User says "use French modes" → read from `modes/fr/` instead of `modes/`
2. User sets `language.modes_dir: modes/fr` in `users/{USER}/config/profile.yml` → always use French modes
3. You detect a French JD → suggest switching to French modes

**When to use Arabic modes:** If the user is targeting Arabic-language job postings, lives in the Middle East / Arab region, or asks for Arabic output. Either:
1. User says "use Arabic modes" → read from `modes/ar/` instead of `modes/`
2. User sets `language.modes_dir: modes/ar` in `config/profile.yml` → always use Arabic modes
3. You detect an Arabic JD → suggest switching to Arabic modes

**When to use Japanese modes:** If the user is targeting Japanese-language job postings, lives in Japan, or asks for Japanese output. Either:
1. User says "use Japanese modes" → read from `modes/ja/` instead of `modes/`
2. User sets `language.modes_dir: modes/ja` in `users/{USER}/config/profile.yml` → always use Japanese modes
3. You detect a Japanese JD → suggest switching to Japanese modes

**When to use Turkish modes:** If the user is targeting Turkish-language job postings, lives in Turkey, or asks for Turkish output. Either:
1. User says "use Turkish modes" → read from `modes/tr/` instead of `modes/`
2. User sets `language.modes_dir: modes/tr` in `users/{USER}/config/profile.yml` → always use Turkish modes
3. You detect a Turkish JD → suggest switching to Turkish modes

**When NOT to:** If the user applies to English-language roles, even at French, German, Arabic, Japanese, or Turkish companies, use the default English modes — *unless* the user has explicitly requested another mode in this conversation, or `language.modes_dir` is set in `users/{USER}/config/profile.yml` (the explicit user preference always wins over JD-language detection).

### Skill Modes

| If the user... | Mode |
|----------------|------|
| Pastes JD or URL | auto-pipeline (evaluate + report + PDF + tracker) |
| Asks to evaluate offer | `oferta` |
| Asks to compare offers | `ofertas` |
| Wants LinkedIn outreach | `contacto` |
| Asks for company research | `deep` |
| Preps for interview at specific company | `interview-prep` |
| Wants to generate CV/PDF | `pdf` |
| Evaluates a course/cert | `training` |
| Evaluates portfolio project | `project` |
| Asks about application status | `tracker` |
| Fills out application form | `apply` |
| Wants the full sourcing loop | `go` |
| Searches for new offers | `scan` |
| Processes saved Agent/WebSearch scan handoff | `scan-handoff` |
| Searches authenticated portals | `scan-auth` |
| Processes pending URLs | `pipeline` |
| Batch processes offers | `batch` |
| Asks about rejection patterns or wants to improve targeting | `patterns` |
| Asks about follow-ups or application cadence | `followup` |
| Wants to update the system | `update` |

### CV Source of Truth

- `users/{USER}/cv.md` is the canonical CV for the active user
- `users/{USER}/article-digest.md` has detailed proof points (optional)
- **NEVER hardcode metrics** -- read them from these files at evaluation time

---

## Ethical Use -- CRITICAL

**This system is designed for quality, not quantity.** The goal is to help the user find and apply to roles where there is a genuine match -- not to spam companies with mass applications.

- **NEVER submit an application without the user reviewing it first.** Fill forms, draft answers, generate PDFs -- but always STOP before clicking Submit/Send/Apply. The user makes the final call.
- **Strongly discourage low-fit applications.** If a score is below 4.0/5, explicitly recommend against applying. The user's time and the recruiter's time are both valuable. Only proceed if the user has a specific reason to override the score.
- **Quality over speed.** A well-targeted application to 5 companies beats a generic blast to 50. Guide the user toward fewer, better applications.
- **Respect recruiters' time.** Every application a human reads costs someone's attention. Only send what's worth reading.

---

## Offer Verification -- MANDATORY

**NEVER trust WebSearch/WebFetch to verify if an offer is still active.** ALWAYS use Playwright:
1. `browser_navigate` to the URL
2. `browser_snapshot` to read content
3. Only footer/navbar without JD = closed. Title + description + Apply = active.

**Exception for batch workers (headless mode):** Playwright is not available in headless pipe mode. Use WebFetch as fallback and mark the report header with `**Verification:** unconfirmed (batch mode)`. The user can verify manually later.

---

## CI/CD and Quality

- **GitHub Actions** run on every PR: `test-all.mjs` (63+ checks), auto-labeler (risk-based: 🔴 core-architecture, ⚠️ agent-behavior, 📄 docs), welcome bot for first-time contributors
- **Branch protection** on `main`: status checks must pass before merge. No direct pushes to main (except admin bypass).
- **Dependabot** monitors npm, Go modules, and GitHub Actions for security updates
- **Contributing process**: issue first → discussion → PR with linked issue → CI passes → maintainer review → merge

## Community and Governance

- **Code of Conduct**: Contributor Covenant 2.1 with enforcement actions (see `CODE_OF_CONDUCT.md`)
- **Governance**: BDFL model with contributor ladder — Participant → Contributor → Triager → Reviewer → Maintainer (see `GOVERNANCE.md`)
- **Security**: private vulnerability reporting via email (see `SECURITY.md`)
- **Support**: help questions go to Discord/Discussions, not issues (see `SUPPORT.md`)
- **Discord**: https://discord.gg/8pRpHETxa4

## Headless / Batch Mode

When spawning headless workers for batch processing, use the appropriate command for your CLI:

| CLI | Command |
|-----|---------|
| Claude Code | `claude -p "prompt"` |
| **OpenCode** | `opencode run "prompt"` |
| Copilot CLI | `copilot -p "prompt"` |
| Codex | `codex exec "prompt"` |
| Qwen | `qwen -p "prompt"` |
| Antigravity CLI | `agy -p "prompt"` |
| Grok Build CLI | `grok -p "prompt"` |

## Stack and Conventions

- Node.js (mjs modules), Playwright (PDF + scraping), YAML (config), HTML/CSS (template), Markdown (data), Canva MCP (optional visual CV)
- Scripts in `.mjs`, configuration in YAML
- Output in `users/{USER}/output/` (gitignored), Reports in `users/{USER}/reports/`
- JDs in `users/{USER}/jds/` (referenced as `local:jds/{file}` in `users/{USER}/data/pipeline.md`)
- Authenticated scan browser sessions live outside the repo at `~/.scan-auth/users/{USER}/{PORTAL}/profile/`; treat them as credentials and never copy another user's session automatically.
- Batch state/input/logs/tracker additions in `users/{USER}/batch/`; shared batch scripts and prompts stay in root `batch/`
- Report numbering: sequential 3-digit zero-padded, max existing + 1
- **RULE: After each batch of evaluations, run `node merge-tracker.mjs --user {USER}`** to merge tracker additions and avoid duplications.
- **RULE: NEVER create new entries in applications.md if company+role already exists.** Update the existing entry.

### TSV Format for Tracker Additions

Write one TSV file per evaluation to `users/{USER}/batch/tracker-additions/{ID}.tsv`. Single line, 9 tab-separated columns:

```
{REPORT_NUM}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{REPORT_NUM}](reports/{REPORT_NUM}-{slug}-{date}.md)\t{note}
```

**Column order (IMPORTANT -- status BEFORE score):**
1. `num` -- the report number reserved by the batch runner (integer)
2. `date` -- YYYY-MM-DD
3. `company` -- short company name
4. `role` -- job title
5. `status` -- canonical status (e.g., `Evaluated`)
6. `score` -- format `X.X/5` (e.g., `4.2/5`)
7. `pdf` -- `✅` or `❌`
8. `report` -- markdown link, always written user-root-relative: `[REPORT_NUM](reports/...)`
9. `notes` -- one-line summary

**Note:** In applications.md, score comes BEFORE status. The merge script handles this column swap automatically.

**Batch numbering rule:** Do not recalculate the tracker number from `applications.md` inside workers. Parallel workers can race and choose the same value. Use the runner-reserved `REPORT_NUM` for the TSV first column, report link, and artifact names.

**Report link normalization:** The TSV always carries a user-root-relative `[num](reports/...)` link. `merge-tracker.mjs` rewrites it so the link is relative to the tracker file's own directory before writing it into the tracker — `../reports/...` when the tracker is at `users/{USER}/data/applications.md`. This keeps links clickable from the tracker because markdown links resolve relative to the file that contains them. Normalization is idempotent. To fix links in an existing tracker, run `node merge-tracker.mjs --user {USER} --migrate` (see #760).

### Pipeline Integrity

1. **NEVER edit applications.md to ADD new entries** -- Write TSV in `users/{USER}/batch/tracker-additions/` and `merge-tracker.mjs --user {USER}` handles the merge.
2. **YES you can edit `users/{USER}/data/applications.md` to UPDATE status/notes of existing entries.**
3. All reports MUST include `**URL:**` in the header (between Score and PDF). Include `**Legitimacy:** {tier}` (see Block G in `modes/oferta.md`).
4. All statuses MUST be canonical (see `templates/states.yml`).
5. Health check: `node verify-pipeline.mjs --user {USER}`
6. Normalize statuses: `node normalize-statuses.mjs --user {USER}`
7. Dedup: `node dedup-tracker.mjs --user {USER}`

### Canonical States (applications.md)

**Source of truth:** `templates/states.yml`

| State | When to use |
|-------|-------------|
| `Evaluated` | Report completed, pending decision |
| `Applied` | Application sent |
| `Responded` | Company responded |
| `Interview` | In interview process |
| `Offer` | Offer received |
| `Rejected` | Rejected by company |
| `Closed` | Posting closed before application |
| `Discarded` | Discarded by candidate |
| `SKIP` | Doesn't fit, don't apply |

**RULES:**
- No markdown bold (`**`) in status field
- No dates in status field (use the date column)
- No extra text (use the notes column)
