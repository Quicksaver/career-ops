# Setup Guide

## Prerequisites

- An AI coding CLI — [Claude Code](https://claude.ai/code), Gemini CLI, Codex, Qwen Code, OpenCode, GitHub Copilot CLI, Antigravity CLI, or Grok Build CLI
- [Node.js](https://nodejs.org) 18+ and `git` (`npx` ships with Node — the installer refuses to run without them) — note: the Gemini CLI integration requires Node.js 20+
- (Optional) Go 1.21+ (for the dashboard TUI)

## Quick Start

### Recommended — one command

```bash
npx @santifer/career-ops init
```

`npx` ships with Node.js — it runs the installer once without installing anything globally. This clones the latest release into `./career-ops` and installs dependencies. Then move into the workspace and open your AI CLI:

```bash
cd career-ops
claude   # or gemini / codex / qwen / opencode / agy / grok
```

**On first launch, career-ops walks you through setup by chatting** — it asks for your CV, your details (name, target roles, salary), and sets up the job scanner with pre-configured companies. Nothing to edit by hand: just answer its questions. Then paste a job offer URL or description and it evaluates it, writes a report, generates a tailored PDF, and tracks it.

If you are using Codex, start the interactive session with `codex`. Slash commands are not guaranteed in Codex, so use the same mode names in a prompt if `/career-ops` is unavailable:

```text
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode.
Run the career-ops pipeline mode.
Run the career-ops pdf mode.
Run the career-ops tracker mode.
```

For one-shot workers or batch tasks in Codex, use `codex exec`:

```bash
codex exec "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
codex exec "Run career-ops scan mode in this repo."
codex exec "Run career-ops pipeline mode for <username>."
codex exec "Run career-ops pdf mode for the latest evaluated role."
codex exec "Run career-ops tracker mode and summarize the current statuses."
```

### Advanced — clone manually

<details>
<summary>Prefer to clone the repo yourself?</summary>

```bash
git clone https://github.com/santifer/career-ops.git
cd career-ops
npm install
```

### 2. Choose and configure your user

```bash
export CAREER_OPS_USER=<username>
mkdir -p users/<username>/config users/<username>/modes
cp config/profile.example.yml users/<username>/config/profile.yml
cp modes/_profile.template.md users/<username>/modes/_profile.md
```

Edit `users/<username>/config/profile.yml` with your personal details: name, email, target roles, narrative, proof points. User data is gitignored and centralized under `users/{USER}/`.

### 3. Add your CV

Create `users/<username>/cv.md` with your full CV in markdown format. This is the source of truth for all evaluations and PDFs for that user.

(Optional) Create `users/<username>/article-digest.md` with proof points from your portfolio projects/articles.

### 4. Configure portals

```bash
cp templates/portals.example.yml users/<username>/portals.yml
```

Edit `users/<username>/portals.yml`:
- Update `title_filter.positive` with keywords matching your target roles
- Add companies you want to track in `tracked_companies`
- Customize `search_queries` for your preferred job boards

### 5. Start using

Open Claude Code in this directory:

```bash
claude
```

Then paste a job offer URL or description. Career-ops will automatically evaluate it, generate a report, create a tailored PDF, and track it.

Then open your AI CLI in the folder — the same first-run onboarding applies. Use this path if you want to track a specific branch, contribute, or audit the code before installing dependencies.

</details>

### PDF rendering (one-time)

PDFs are rendered with a headless Chromium. Install it once per machine:

```bash
npx playwright install chromium
```

## Available Commands

| Action | How |
|--------|-----|
| Evaluate an offer | Paste a URL or JD text |
| Search for offers | `/career-ops scan <username>` or ask the agent to run `scan` for `<username>` |
| Search authenticated portals | `/career-ops scan-auth <username> linkedin` |
| Process pending URLs | `/career-ops pipeline <username>` or ask the agent to run `pipeline` for `<username>` |
| Generate a PDF | `/career-ops pdf --user <username>` or ask the agent to run `pdf` for `<username>` |
| Batch evaluate | `/career-ops batch <username>` or use `codex exec "Run career-ops batch mode for <username> ..."` |
| Check tracker status | `/career-ops tracker --user <username>` or ask the agent to run `tracker` for `<username>` |
| Fill application form | `/career-ops apply --user <username>` or ask the agent to run `apply` for `<username>` |

## Verify Setup

```bash
node cv-sync-check.mjs --user <username>      # Check configuration
node verify-pipeline.mjs --user <username>    # Check pipeline integrity
```

## Build Dashboard (Optional)

```bash
cd dashboard
go build -o ../users/<username>/career-dashboard .
../users/<username>/career-dashboard  # Opens TUI pipeline viewer

# Cross-compile for Windows x64
GOOS=windows GOARCH=amd64 go build -o ../users/<username>/career-dashboard.exe .
```

The dashboard binary is meant to live inside `users/<username>/`, where it can infer the tracker/report path without `--path`. Pass `--path` only when you need to override that location.
