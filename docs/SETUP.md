# Setup Guide

## Prerequisites

- [Claude Code](https://claude.ai/code) installed and configured
- Node.js 18+ (for PDF generation and utility scripts)
- (Optional) Go 1.21+ (for the dashboard TUI)

## Quick Start (5 steps)

### 1. Clone and install

```bash
git clone https://github.com/santifer/career-ops.git
cd career-ops
npm install
npx playwright install chromium   # Required for PDF generation
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

## Available Commands

| Action | How |
|--------|-----|
| Evaluate an offer | Paste a URL or JD text |
| Search for offers | `/career-ops scan <username>` |
| Process pending URLs | `/career-ops pipeline` |
| Generate a PDF | `/career-ops pdf` |
| Batch evaluate | `/career-ops batch` |
| Check tracker status | `/career-ops tracker` |
| Fill application form | `/career-ops apply` |

## Verify Setup

```bash
node cv-sync-check.mjs --user <username>      # Check configuration
node verify-pipeline.mjs --user <username>    # Check pipeline integrity
```

## Build Dashboard (Optional)

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path .. --user <username>  # Opens TUI pipeline viewer
```
