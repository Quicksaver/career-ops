# Mode: scan-handoff — Agent/WebSearch scan follow-up

Processes the handoff file written by the zero-token scanner at `users/{USER}/data/scan-handoff.json`.

Use this mode when `/career-ops scan` reports:

```text
Agent/WebSearch handoff: N companies not handled by zero-token providers
```

## Scope

This mode does not rerun `node scan.mjs`. It resumes from the latest saved handoff artifact and covers companies whose `portals.yml` entries requested `scan_method: websearch` but had no zero-token provider.

## Input File

Read `users/{USER}/data/scan-handoff.json`.

Expected schema:

```json
{
  "schema": "career-ops.scan-handoff.v1",
  "generated_at": "2026-06-27T00:00:00.000Z",
  "scan_date": "2026-06-27",
  "count": 1,
  "items": [
    {
      "company": "Example",
      "method": "websearch",
      "query": "\"Example\" careers jobs"
    }
  ]
}
```

If the file is missing, ask the user to run `/career-ops scan {USER}` first. If `items` is empty, report that there is no scan handoff work.

## Workflow

Before processing, read `modes/scan.md` and follow its filtering, deduplication, liveness, and pipeline-writing rules unless this file gives a narrower instruction.

For each item:

1. Use the existing `modes/scan.md` Level 1 and Level 3 rules:
   - Prefer Playwright navigation when `query` is a careers URL.
   - Use WebSearch for search queries.
   - Extract `{title, url, company}` for relevant roles.
2. Apply the same title/location/company relevance from `users/{USER}/portals.yml`.
3. Deduplicate against:
   - `users/{USER}/data/scan-history.tsv`
   - `users/{USER}/data/pipeline.md`
   - `users/{USER}/data/applications.md`
4. Verify every WebSearch-derived URL with Playwright before adding it to the pipeline. WebSearch snippets alone must never decide liveness.
5. Add active, deduped offers to `users/{USER}/data/pipeline.md` as:

```text
- [ ] {url} | {company} | {title}
```

6. Record accepted and skipped URLs in `users/{USER}/data/scan-history.tsv` using the same statuses as `modes/scan.md`:
   - `added`
   - `skipped_title`
   - `skipped_dup`
   - `skipped_expired`

## Output

Print a concise summary:

```text
Scan handoff — {YYYY-MM-DD}
Processed companies: N
New offers added: N
Duplicates skipped: N
Expired discarded: N
Errors: N

→ Run /career-ops pipeline {USER} to evaluate new listings.
```

If a company requires a better `careers_url`, update `users/{USER}/portals.yml` only when the replacement is confirmed by Playwright.
