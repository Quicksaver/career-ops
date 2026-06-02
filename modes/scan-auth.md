# Mode: scan-auth — Authenticated portal scanner

Runs the authenticated portal scanner (Playwright with persistent browser profiles), then processes results into the pipeline.

Supported portals: `linkedin` (more coming soon).

## Prerequisites

The user must have logged in at least once for the target portal:
```bash
node scan-auth.mjs --user {USER} --login <portal>
```
If the scanner reports "Not logged in", tell the user to run the above command **in a separate terminal window** (not via `!` prefix or Bash tool -- the login flow opens an interactive browser that requires direct user interaction).

Sessions are per career-ops user and portal:

```text
~/.scan-auth/users/{USER}/{PORTAL}/profile/
```

Do not reuse or copy a different user's session automatically. Browser profiles contain cookies and local storage and should be treated as credentials.

## Quiet monitoring

While `node scan-auth.mjs --user {USER} <portal>` is running, do not send routine "still running" updates or narrate each scanner phase. Use stdout/stderr as the progress source, check liveness internally, and report only completion, failure, required login/CAPTCHA/user action, a suspected hang, or at most one normal liveness update every 10 minutes. In Codex tool sessions, do not narrate routine `write_stdin` polls; use the longest supported wait and keep waiting silently if the tool returns before 10 minutes. If the user explicitly asks for status, answer once with the current observed state and then return to quiet monitoring.

## Workflow

### 1. Run the scanner

If a portal is specified, scan only that portal. If no portal is specified, scan **all supported portals** by running `node scan-auth.mjs --user {USER} <portal>` for each one in sequence.

Supported portals: `linkedin`

```bash
node scan-auth.mjs --user {USER} linkedin
```

The scanner:
- Reads `users/{USER}/portals.yml` for keywords, experience level, date filter, and employer blocklist
- Launches Chromium with a persistent profile (`~/.scan-auth/users/{USER}/{PORTAL}/profile`)
- Searches the portal for each keyword, extracts job details
- Applies title filter and employer blocklist
- Dedupes against `users/{USER}/data/scan-history.tsv` (LinkedIn job IDs + company::title keys from all portals)
- Saves accepted JDs to `users/{USER}/jds/{company}-{role-slug}.md` with frontmatter
- Appends accepted listings to `users/{USER}/data/pipeline.md` as `- [ ] local:{jd_file} | {company} | {title}`
- Records all entries (accepted + skipped) to `users/{USER}/data/scan-history.tsv`

The scanner handles everything end-to-end — no post-processing step is needed.

### 2. Print summary

```
{Portal} Scan — {YYYY-MM-DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Scanner found: N listings
New to pipeline: N
Duplicates skipped: N
Errors: N

  + {company} | {title}
  ...

→ Run /career-ops pipeline {USER} to evaluate new listings.
```

## Error handling

- If the scanner exits with an error, show the error message to the user
- If `<portal>-scan-results.json` has entries in `errors`, report them
- If scanner reports CAPTCHA or login issues, tell the user to run `node scan-auth.mjs --user {USER} --login <portal>` **in a separate terminal window** and browse the portal manually to warm the session
