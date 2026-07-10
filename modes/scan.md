# Mode: scan — Portal Scanner (Job Discovery)

Scans configured job portals, filters by title relevance, and adds new offers to the pipeline for subsequent evaluation.

> **Nota (v1.8+):** El escáner por defecto (`scan.mjs` / `npm run scan`) es **zero-token** y usa fuentes estructuradas: parsers locales configurados por empresa, APIs públicas compatibles como Greenhouse/Ashby/Lever/PCSX y providers estructurados como Landing.jobs, EU Remote Jobs, ITJobs, SAPO Emprego, Portal Emprego y Dice. Los niveles con Playwright/WebSearch descritos abajo son el flujo **agente** (ejecutado por Claude/Codex), no lo que hace `scan.mjs`. Si una empresa no tiene parser local, API compatible ni provider estructurado soportado, `scan.mjs` la ignorará; para esos casos, el agente debe completar manualmente el Nivel 1 (Playwright) o Nivel 3 (WebSearch). **Indeed PT entra en esta categoría**: sus URLs de búsqueda son útiles para descubrimiento, pero el portal suele bloquear fetches genéricos y navegadores headless con desafíos anti-bot.
>
> **Rule (v1.8+):** If a company's local parser completes successfully in Level 0, the agent **must not** repeat that company in Playwright (Level 1) or API (Level 2). In Level 3, general queries remain active, but results from companies already covered by a parser are discarded. See [Rule: Successful Local Parser](#rule-successful-local-parser--no-expensive-scraping-repetition).

## Recommended Execution

Execute as a worker/subagent if your CLI supports it, to avoid consuming the main interactive context:

```python
Agent(
    subagent_type="general-purpose",
    prompt="[content of this file + specific data]",
    run_in_background=True
)
```

The spawned subagent is a **single-pass worker**: it runs the scan with the parsers/APIs/Playwright/WebSearch named below, directly. It must **not** spawn further subagents or invoke other skills (see `modes/_shared.md` → Subagent delegation). Scanning is bounded by `portals.yml`; it is never an open-ended research task.

## Politica de ruido durante ejecucion

Mientras `node scan.mjs --user {USER}` o el flujo de scan del agente siga activo, no enviar mensajes rutinarios de "sigue corriendo" ni narrar cada fase. Usar stdout/stderr como fuente de progreso, verificar liveness internamente, y solo informar al usuario al completar, fallar, requerir accion, detectar bloqueo, o como maximo una vez cada 10 minutos si todo sigue normal. En sesiones de herramientas Codex, no narrar polls rutinarios de `write_stdin`; usar el mayor tiempo de espera soportado y seguir esperando en silencio si la herramienta vuelve antes de 10 minutos. Si el usuario pide estado explicitamente, responder una vez con el estado observado y volver a monitoreo silencioso.

## Configuración

Leer `users/{USER}/portals.yml` que contiene:
- `search_queries`: Lista de queries WebSearch con `site:` filters por portal (descubrimiento amplio, incluido Indeed cuando solo conviene usarlo como discovery source)
- `tracked_companies`: Empresas específicas con `careers_url` para navegación directa
- `tracked_companies[].parser`: Parser local opcional para páginas SSR o HTML estable
- `title_filter`: Keywords positive/negative/seniority_boost para filtrado de títulos

## Discovery Strategy (4 Levels)

### Level 0 — Local Parser (CHEAPEST)

**Para cada empresa en `tracked_companies` con `parser:` configurado:** ejecutar el parser local definido en `users/{USER}/portals.yml`. Este nivel es ideal cuando la página de careers usa SSR o HTML estable y ya existe un script JavaScript, Python, o de otro runtime local que extrae los jobs sin ayuda del agente.

Recommended Contract:

```yaml
- name: Example Company
  careers_url: https://example.com/careers
  scan_method: local_parser
  parser:
    command: node
    script: scripts/parsers/example-company-jobs.js
    format: jobs-json-v1
  enabled: true
```

Typically, the parser is company-specific and already knows the URL, selectors, and pagination. `args` is optional: use it however it helps the script author, for example, to reuse it across companies, pass `{careers_url}` or `{company}`, activate a debug flag, save a JSON snapshot, or control any parser-specific behavior.

The parser must output JSON to stdout:

Array format:

```json
[
  { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
]
```

Object format with `jobs`:

```json
{
  "jobs": [
    { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
  ]
}
```

Object format with `results`:

```json
{
  "results": [
    { "title": "Senior AI Engineer", "url": "https://example.com/jobs/123", "location": "Remote" }
  ]
}
```

`company` is optional; if not provided, `scan.mjs` uses the name from `tracked_companies`.

El escáner no necesita conservar el JSON completo después de leer stdout. Si un parser también genera un artefacto para auditoría o depuración, guardarlo en `users/{USER}/data/parser-output/{company}/` y mantenerlo fuera de git.

### Rule: Successful Local Parser — No Expensive Scraping Repetition

The goal of `scan_method: local_parser` is to **reduce tokens**: prevent the LLM from rescraping the same company using Playwright or redundant APIs.

During the agent's scan, keep the **`local_parser_ok`** set in memory. This set contains the names of companies (`tracked_companies[].name`) for which Level 0 completed successfully:

- `parser.command` + `parser.script` exist and the script executed without a fatal error.
- stdout was valid JSON (`[]`, `{ jobs: [] }`, or `{ results: [] }`).
- There was no timeout or process crash.

| Level | If the company is in `local_parser_ok` |
|-------|----------------------------------------|
| **1 — Playwright** | **Skip** — do not `browser_navigate` to its `careers_url` (most expensive token-consuming method) |
| **2 — API** | **Skip** — do not WebFetch its `api:` (already covered by parser; `scan.mjs` does not use API after a successful parser either) |
| **3 — WebSearch** | Run **general** queries (`site:`, role titles); **discard** any hit whose normalized company matches `local_parser_ok` |

**Exceptions:**

- Parser **failed** → the company is **not** added to `local_parser_ok`; Levels 1 and 2 apply normally (same criteria as the fallback in `scan.mjs` when the parser fails and an ATS API is available).
- Level 3: do not deactivate cross-cutting queries (`site:jobs.ashbyhq.com`, `site:boards.greenhouse.io`, etc.) — these are used to discover **new** companies. Only filter out results for companies already in `tracked_companies` with a successful parser.
- Do not create dedicated `search_queries` for a company with an active local parser (e.g. `site:jobs.ashbyhq.com/cohere "AI Engineer"`); use the parser or, if it fails, Playwright/API.

**Nivel 0 recomendado:** ejecutar `node scan.mjs --user {USER}` (o `npm run scan -- --user {USER}`) al inicio del workflow del agente. Eso cubre parsers locales + APIs en un solo paso zero-token y devuelve qué empresas usaron `local-parser` con éxito.

### Level 1 — Direct Playwright (PRIMARY)

**For each company in `tracked_companies` that is not in `local_parser_ok`:** Navigate to its `careers_url` with Playwright (`browser_navigate` + `browser_snapshot`), read ALL visible job listings, and extract the title + URL for each. This is the most reliable method because:
- It views the page in real time (not cached Google results)
- It works with SPAs (Ashby, Lever, Workday)
- It detects new offers instantly
- It does not depend on Google indexing

**Cada empresa DEBE tener `careers_url` en `users/{USER}/portals.yml`.** Si no la tiene, buscarla una vez, guardarla, y usar en futuros scans.

> **Opt-in — CLI extractor (`scan.extractor: cli`).** When `users/{USER}/config/profile.yml` sets `scan.extractor: cli`, run `node browser-extract.mjs <careers_url> --mode listing` for each company instead of `browser_navigate` + `browser_snapshot`. It renders the page headlessly and returns compact JSON — `{ "url": ..., "jobs": [{ "title", "url" }] }` — so the listing enters context at a fraction of a full snapshot's tokens (~2–3× smaller here). Read the `jobs` array directly; then apply `title_filter` as usual. **Fall back silently** to `browser_navigate` + `browser_snapshot` if the command errors (it prints `{ "error", "code" }` and exits non-zero) or isn't present — never let the flag break a scan. Default (`scan.extractor` absent or `mcp`): the `browser_navigate` + `browser_snapshot` flow above.

### Level 2 — ATS APIs / Feeds (COMPLEMENTARY)

For companies with a public API or structured feed **that are not in `local_parser_ok`**, use the JSON/XML response as a fast complement to Level 1. This is faster than Playwright and reduces visual scraping errors.

**Current Support (variables inside `{}`):**
- Full provider table: [Supported job boards](../docs/SUPPORTED_JOB_BOARDS.md)

- **Greenhouse**: `https://boards-api.greenhouse.io/v1/boards/{company}/jobs`
- **Ashby**: `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`
- **BambooHR**: list `https://{company}.bamboohr.com/careers/list`; job details `https://{company}.bamboohr.com/careers/{id}/detail`
- **Lever**: `https://api.(eu.)?lever.co/v0/postings/{company}`
- **Teamtailor**: `https://{company}.teamtailor.com/jobs.rss`
- **Workday**: `https://{company}.{shard}.myworkdayjobs.com/wday/cxs/{company}/{site}/jobs`
- **Landing.jobs**: `https://landing.jobs/feed` (Atom) como fuente estructurada principal; páginas públicas `https://landing.jobs/jobs?q={query}` y facets `/jobs/for/{slug}` útiles para descubrir filtros, pero menos adecuadas para scraping/paginación zero-token
- **EU Remote Jobs**: `https://euremotejobs.com/job-listings/feed/` y variantes `?paged={N}` como fuente estructurada principal; feeds de categoría como `https://euremotejobs.com/job-category/engineering/feed/` también existen, pero el feed global paginado encaja mejor como provider zero-token
- **ITJobs**: `https://www.itjobs.pt/emprego` y variantes filtradas (`?date=24h&work_model=1&page=N`, `?date=24h&work_model=2&page=N`)
- **SAPO Emprego**: `https://emprego.sapo.pt/offers` y variantes filtradas (`?pesquisa=ai&categoria=informatica-tecnologias&modelo=teletrabalho,hibrido&pagina=N`)
- **Portal Emprego**: `https://www.portalemprego.pt/anuncios/` y variantes SEO (`/anuncios/pesquisa-ai/mostrar-20/pagina-N/`)
- **Dice**: `https://www.dice.com/jobs` y variantes de búsqueda (`?q={query}&page={N}&pageSize=20`), leyendo el payload de resultados embebido en SSR con links canónicos `/job-detail/{guid}`
- **Breezy**: `https://{company}.breezy.hr/json`

**Parsing Conventions by Provider:**
- `greenhouse`: `jobs[]` → `title`, `absolute_url`, `location.name`
- `ashby`: GET REST API → `jobs[]` with `title`, `jobUrl`, `location` (fold in `secondaryLocations[]`), `compensation` (`minValue`/`maxValue`/`currency`), and `publishedAt`; slug derived from `careers_url` pattern `jobs.ashbyhq.com/{slug}`
- `bamboohr`: list `result[]` → `jobOpeningName`, `id`, `location` (city + state; append "Remote" when `isRemote`); build detail URL `https://{company}.bamboohr.com/careers/{id}/detail`; to read full JD, make a GET request to the detail URL and use `result.jobOpening` (`jobOpeningName`, `description`, `datePosted`, `minimumExperience`, `compensation`, `jobOpeningShareUrl`)
- `lever`: root array `[]` → `text`, `hostedUrl` (fallback: `applyUrl`), `categories.location`, `descriptionPlain`
- `teamtailor`: RSS items → `title`, `link`, `location` (from the `tt:` city/country block)
- `workday`: `jobPostings[]`/`jobPostings` (based on tenant) → `title`, `externalPath` or URL built from the host, `locationsText` (fallback: derive from the URL path)
- `landingjobs`: Atom `<entry>` → `title`, `id`/URL pública, `author > name` (empresa), `lj:city`, `lj:country`, `lj:remote_policy`, `lj:category`, `lj:job_type`, `published`, `updated`
- `euremotejobs`: RSS `<item>` → `title`, `link`, `pubDate`, `content:encoded`; extraer `company` y `location` desde párrafos normalizados del contenido
- `itjobs`: HTML SSR `ul.listing > li` → `div.list-title a` (`title`, `href`), `div.list-name a` (`company`), `div.list-details` (`location` y metadatos como remoto/híbrido/salario)
- `sapo`: HTML SSR / Vue props `:offers='[...]'` → `offer_name`, `link`, `company_name`, `location`, `job_district`, `job_work_hours`; detalle con JSON-LD `JobPosting`
- `portalemprego`: HTML SSR `#listCont a.d-flex[href^="/emprego/"]` → `div.title h5` (`title`), `href`, `span.company`, `span.city`, `span.type`, `span.postedDate`
- `dice`: payload embebido `jobList.data[]` → `title`, `detailsPageUrl`, `companyName`, `jobLocation.displayName`, `salary`, `employmentType`, `easyApply`, `workplaceTypes`, `postedDate`; paginación desde `jobList.meta.pageCount`
- `breezy`: top-level array `[]` → `name`, `url` (absolute), `location.name` (or city/state/country + `is_remote`), `published_date`

> **Caution — do not infer absence from a truncated read.** Careers SPAs paginate and lazy-load; a `browser_snapshot` or WebFetch of the page (and any LLM summary of that HTML) can silently drop rows, showing only the first screen of roles. Never conclude "role X is not posted" or "only N roles exist" from such a read. When the company has a public ATS API, hit it directly (append `?content=true` where the provider supports it) before making any presence/absence claim — the API returns the full board in one structured response.

### Level 3 — WebSearch Queries (BROAD DISCOVERY)

Los `search_queries` con `site:` filters cubren portales de forma transversal (todos los Ashby, todos los Greenhouse, etc.). Útil para descubrir empresas NUEVAS que aún no están en `tracked_companies`, pero los resultados pueden estar desfasados. También es el encaje correcto para portales tipo **Indeed PT** cuando el entorno no puede atravesar su capa anti-bot de forma fiable.
Tras filtrar hits de empresas en `local_parser_ok`, los resultados restantes se deduplican con Niveles 0-2.

**Perfil de capacidad de Indeed PT (recomendado):**
- **Búsqueda pública útil:** `https://pt.indeed.com/jobs?q={query}&l={location}`
- **Filtros observables en URL:** `q`, `l`, `start`, `fromage`, `radius`, `jt`, `sc`
- **Buen uso en career-ops:** descubrimiento en Nivel 3 / `search_queries`
- **Mal encaje por defecto:** provider zero-token en `scan.mjs`, porque HTTP directo y Chromium headless suelen recibir bloqueo / Cloudflare

**Perfil de capacidad de Landing.jobs (recomendado):**
- **Mejor superficie zero-token:** `https://landing.jobs/feed`
- **Metadatos disponibles en feed:** título, empresa, URL pública canónica, ciudad/país, remote policy, categoría, tipo de contrato, salario, fechas de publicación/actualización y extracto largo del JD
- **Búsqueda pública útil:** `https://landing.jobs/jobs?q={query}` y facets `/jobs/for/{slug}`, `/jobs/in/{slug}`
- **Encaje óptimo en career-ops:** provider zero-token basado en feed, con filtros cliente opcionales (`q`, `category`, `remote_policy`, `country`, `city`, `job_type`, `published_within_days`)
- **Motivo:** el feed es estable y estructurado; las páginas HTML públicas sirven para descubrir filtros, pero no exponen una paginación/SSR suficientemente limpia para scraping robusto

**Perfil de capacidad de EU Remote Jobs (recomendado):**
- **Mejor superficie zero-token:** `https://euremotejobs.com/job-listings/feed/` con paginación `?paged={N}`
- **Metadatos disponibles:** URL canónica de detalle, título, fecha de publicación y resumen largo/normalizado en `content:encoded`; desde ese contenido se puede extraer ubicación y, en muchos casos, empresa
- **Superficies alternativas:** páginas SSR como `/job-category/engineering/` y `/jobs/all-remote-jobs/`, pero son menos estables que el feed para un parser mantenible
- **Encaje óptimo en career-ops:** provider zero-token basado en RSS, con paginación limitada por `api_max_pages`
- **Motivo:** reduce fragilidad frente a cambios de HTML y evita depender de WebSearch para un portal que ya expone archivo estructurado público

**Perfil de capacidad de Dice (recomendado):**
- **Mejor superficie zero-token:** `https://www.dice.com/jobs` leyendo el payload `jobList` embebido en la respuesta SSR
- **Metadatos disponibles:** URL canónica de detalle, empresa, título, ubicación mostrada, salario, tipo de empleo, easy-apply, workplace types, `postedDate` y `pageCount`
- **Filtros públicos observables:** `q`, `location`, `includeRemote`, `filters.workplaceTypes`, `employmentType`, `postedDate`, `employerType`, `page`, `pageSize`
- **Encaje óptimo en career-ops:** provider zero-token basado en SSR+JSON embebido, con una lista corta de queries semilla (`q`) y paginación acotada
- **Motivo:** ofrece datos estructurados y paginación fiable sin depender de scraping frágil de tarjetas ni de WebSearch genérico

> **Caution — Level-3 hits can be weeks stale.** WebSearch is fed by a search index that lags the live board, so a result can describe a posting that has already closed. Treat every Level-3 hit as unverified: before adding it to `users/{USER}/data/pipeline.md` or evaluating it, confirm liveness against the real posting (`node check-liveness.mjs <url>` for ATS-hosted pages, or Playwright for non-ATS pages). Unlike the real-time ATS responses in Level 2, a Level-3 snippet is never proof a role is still open.

**Execution Priority:**
1. Level 0: Local Parser → companies with a configured `parser:` and existing script; build `local_parser_ok`
2. Level 1: Playwright → `tracked_companies` with a `careers_url`, **except** `local_parser_ok`
3. Level 2: API → `tracked_companies` with an `api:`, **except** `local_parser_ok`
4. Level 3: WebSearch → all `search_queries` with `enabled: true`; discard hits from companies in `local_parser_ok`

Levels are additive — they are executed in order, and results are merged and deduplicated. Companies in `local_parser_ok` **do not** go through Levels 1 or 2; in Level 3, they only contribute transversal discovery (other companies on the same portal).

## Workflow

1. **Leer configuración**: `users/{USER}/portals.yml`
2. **Leer historial**: `users/{USER}/data/scan-history.tsv` → URLs ya vistas
3. **Leer dedup sources**: `users/{USER}/data/applications.md` + `users/{USER}/data/pipeline.md`

3.5. **Nivel 0 — Local parser** (`scan.mjs`, zero-token):
   Inicializar `local_parser_ok = []`.
   Preferir ejecutar `node scan.mjs --user {USER}` una vez para cubrir todos los parsers + APIs zero-token; si se hace manualmente, repetir la lógica siguiente.
   Para cada empresa en `tracked_companies` con `enabled: true`, `parser.command` y script existente:
   a. Ejecutar `parser.command` con `parser.script` + `parser.args` usando ejecución local sin shell
   b. Expandir placeholders `{careers_url}` y `{company}` en argumentos
   c. Leer JSON de stdout (`[]`, `{ jobs: [] }`, o `{ results: [] }`)
   d. Normalizar cada job a `{title, url, company, location}`
   e. Resolver URLs relativas contra `careers_url`
   f. Si el parser falla, registrar error, intentar fallback por API ATS si existe, y continuar con las demás empresas (**no** añadir a `local_parser_ok`)
   g. Si el parser termina con éxito (pasos c–e sin error fatal), añadir `entry.name` a `local_parser_ok` y acumular jobs en candidatos

4. **Level 1 — Playwright Scan** (parallel in batches of 3-5):
   For each company in `tracked_companies` with `enabled: true`, a defined `careers_url`, and a **name not listed in `local_parser_ok`**:
   a. `browser_navigate` to `careers_url`.
   b. `browser_snapshot` to read all job listings.
   c. If the page has filters/departments, navigate the relevant sections.
   d. For each job listing, extract: `{title, url, company}`.
   e. If the page has pagination, navigate subsequent pages.
   f. Accumulate in the candidates list.
   g. If `careers_url` fails (404, redirect), attempt `scan_query` as a fallback and note it to update the URL later.

5. **Level 2 — ATS APIs / Feeds** (parallel):
   For each company in `tracked_companies` with a defined `api:` or configured `provider:`, `enabled: true`, and a **name not listed in `local_parser_ok`**:
   a. WebFetch the API/feed URL.
   b. If `provider` / `api_provider` is defined, use its parser; if undefined, infer by domain (`boards-api.greenhouse.io`, `api.ashbyhq.com`, `api.(eu.)?lever.co`, `/api/pcsx/search`, `landing.jobs/feed`, `*.bamboohr.com`, `*.teamtailor.com`, `*.myworkdayjobs.com`, `*.breezy.hr`, `www.itjobs.pt/emprego`, `emprego.sapo.pt/offers`, `www.portalemprego.pt/anuncios`, `www.dice.com/jobs`).
   c. For **Ashby**, send a GET request to `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` (slug from `careers_url`). Parse `jobs[]` → `title`, `jobUrl`, `location` (fold in `secondaryLocations[]`), `compensation`. No GraphQL needed.
   d. For **BambooHR**, the list only returns basic metadata. For each relevant item, retrieve the `id`, make a GET request to `https://{company}.bamboohr.com/careers/{id}/detail`, and extract the full JD from `result.jobOpening`. Use `jobOpeningShareUrl` as the public URL if present; otherwise, use the detail URL.
   e. For **Workday**, send a JSON POST request with at least `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}` and paginate by `offset` until results are exhausted.
   e2. For **EU Remote Jobs**, GET `https://euremotejobs.com/job-listings/feed/` and paginate with `?paged=N` up to `api_max_pages` or until a page adds no new items; derive company/location from `content:encoded` where present.
   e3. For **ITJobs**, GET the configured listing page with query-string filters and paginate by `page`; fan out multi-value filters and deduplicate by URL.
   e4. For **Portal Emprego**, use server-rendered SEO pages under `/anuncios/pesquisa-{slug}/mostrar-20/` and paginate by `/pagina-N/`.
   e5. For **SAPO Emprego**, GET result pages with query-string filters and parse the embedded `:offers` plus `:pagination` payload.
   e6. For **Dice**, GET `https://www.dice.com/jobs`, parse embedded SSR `jobList.data[]`, and paginate using `jobList.meta.pageCount` up to `api_max_pages`.
   f. For each job, extract and normalize: `{title, url, company, location}`.
   g. Accumulate in the candidates list (deduplicated against Level 1).

6. **Level 3 — WebSearch Queries** (parallel if possible):
   For each query in `search_queries` with `enabled: true` (general queries by portal/role — not dedicated queries for a company with an active local parser):
   a. Execute WebSearch with the defined `query`.
   b. From each result, extract: `{title, url, company}`.
      - **title**: from the result title (before " @ " or " | ")
      - **url**: URL of the result
      - **company**: after " @ " in the title, or extract from the domain/path
   c. **Skip** the result if the normalized `company` matches any name in `local_parser_ok`.
   d. Accumulate the rest in the candidates list (deduplicated against Levels 0+1+2).

6. **Filtrar por título** usando `title_filter` de `users/{USER}/portals.yml`:
   - Al menos 1 keyword de `positive` debe aparecer en el título (case-insensitive)
   - 0 keywords de `negative` deben aparecer
   - `seniority_boost` keywords dan prioridad pero no son obligatorios

6b. **Filtrar por ubicación (opcional)** usando `location_filter` de `users/{USER}/portals.yml`:
   - Si el bloque `location_filter` está ausente, todas las ubicaciones pasan (comportamiento por defecto)
   - Ubicación vacía en una oferta → pasa (no penalizar datos faltantes)
   - Cualquier keyword de `block` presente → rechazar (precedencia sobre allow)
   - `allow` vacío → pasa (ya superó block)
   - `allow` no vacío → debe coincidir al menos una keyword
   - Todas las coincidencias son case-insensitive substring
   - La ubicación se persiste como 7ª columna en `scan-history.tsv` para auditoría posterior

6c. **Filter by Posting Age (Optional)** using `max_posting_age_days` from `portals.yml`:
   - Opt-in. If the key is absent, 0, or non-positive, all ages pass (default behavior).
   - An offer is skipped only when the provider supplied a posting date (`postedAt`) AND it is older than N days.
   - Offers from providers that expose no date always pass (do not penalize missing data).

7. **Deduplicate** against 3 sources:
   - `scan-history.tsv` → exact URL already seen
   - `applications.md` → normalized company + role already evaluated
   - `pipeline.md` → exact URL already in pending or processed list

7.1. **Cross-listing check (#1597)** — automatic in `scan.mjs`, warn only:
   - Each new offer's JD body (when the provider's list API ships one, e.g. Lever) is fingerprinted (64-bit SimHash, stored as the 8th `scan-history.tsv` column).
   - A near-identical body seen within 90 days under a **different company** is flagged in the scan summary — the usual cause is an agency re-posting a direct listing with the employer name stripped, which URL and company+role dedup both miss.
   - Nothing is dropped automatically. If one side is an agency, apply through ONE channel only (see the Via channel workflow, #1596) — a double submission burns the candidate with both parties.
   - Offers without a usable description get no fingerprint and are never flagged (no body → no signal, no false positives).

7.5. **Verify Liveness of WebSearch Results (Level 3)** — BEFORE adding to pipeline:

   WebSearch results can be outdated (Google caches results for weeks or months). To avoid evaluating expired offers, verify every new URL coming from Level 3 using Playwright. Levels 1 and 2 are inherently real-time and do not require this verification.

   For each new Level 3 URL (sequential — NEVER parallel Playwright):
   a. `browser_navigate` to the URL.
   b. `browser_snapshot` to read the content.
   c. Classify:
      - **Active**: visible job title + role description + visible Apply/Submit/Apply Now control inside the main content area. Do not count generic header/navbar/footer text.
      - **Expired** (any of these signals):
        - Final URL contains `?error=true` (Greenhouse redirects here when an offer is closed).
        - Page contains: "job no longer available" / "no longer open" / "position has been filled" / "this job has expired" / "page not found".
        - Only navbar and footer are visible, with no JD content (content < ~300 characters).
   d. If expired: record in `scan-history.tsv` with status `skipped_expired` and discard.
   e. If active: continue to step 8.

   **Do not interrupt the entire scan if a single URL fails.** If `browser_navigate` errors (timeout, 403, etc.), mark as `skipped_expired` and continue with the next one.

8. **For each new verified offer that passes filters**:
   a. Add to the `pipeline.md` "Pending" section: `- [ ] {url} | {company} | {title}`
   b. Record in `scan-history.tsv`: `{url}\t{date}\t{query_name}\t{title}\t{company}\tadded`

9. **Offers filtered by title**: record in `scan-history.tsv` with status `skipped_title`.
10. **Duplicate offers**: record with status `skipped_dup`.
11. **Expired offers (Level 3)**: record with status `skipped_expired`.

## Extraction of Title and Company from WebSearch Results

WebSearch results typically come in the format: `"Job Title @ Company"`, `"Job Title | Company"`, or `"Job Title — Company"`.

Extraction patterns by portal:
- **Ashby**: `"Senior AI PM (Remote) @ EverAI"` → title: `Senior AI PM`, company: `EverAI`
- **Greenhouse**: `"AI Engineer at Anthropic"` → title: `AI Engineer`, company: `Anthropic`
- **Lever**: `"Product Manager - AI @ Temporal"` → title: `Product Manager - AI`, company: `Temporal`

Generic regex: `(.+?)(?:\s*[@|—–-]\s*|\s+at\s+)(.+?)$`

## Private URLs

If a non-publicly accessible URL is found:
1. Save the JD in `jds/{company}-{role-slug}.md`.
2. Add to `pipeline.md` as: `- [ ] local:jds/{company}-{role-slug}.md | {company} | {title}`

## Scan History

`users/{USER}/data/scan-history.tsv` tracks ALL seen URLs. Each row has nine tab-separated columns:

| # | Column | Example | Notes |
|---|--------|---------|-------|
| 1 | `url` | `https://jobs.lever.co/acme/123` | Canonical posting URL |
| 2 | `first_seen` | `2026-02-10` | ISO date the URL was first encountered |
| 3 | `portal` | `Ashby — AI PM` | Query name from `portals.yml` |
| 4 | `title` | `PM AI` | Job title as returned by the ATS |
| 5 | `company` | `Acme` | Company name |
| 6 | `status` | `added` | `added`, `skipped_dup`, `skipped_title`, `skipped_expired` |
| 7 | `location` | `Remote — Europe` | Location string (may be empty); persisted for later auditing |
| 8 | `jd_fingerprint` | `a3f1c8d2e4b70592` | 64-bit SimHash of the JD text (16 hex chars); empty when no usable body was available |
| 9 | `postedAt` | `2026-02-08` | ISO date the role was originally posted (as reported by the ATS); empty when not available |

```tsv
url	first_seen	portal	title	company	status	location	jd_fingerprint	postedAt
https://...	2026-02-10	Ashby — AI PM	PM AI	Acme	added	Remote	a3f1c8d2e4b70592	2026-02-08
```

### Cross-listing detection

The `jd_fingerprint` column exists to catch a specific double-submission hazard: the same role posted by the direct employer **and** by a recruitment agency, often with the employer name stripped from the agency listing. URL dedup and company+role dedup both miss this pair because the URLs and company names are different — but agencies rarely rewrite the requirements text, so a near-identical JD body is a reliable signal.

How it works:

- When the ATS provider's list API returns a description field (e.g. Lever's `descriptionPlain`), the scanner computes a **64-bit SimHash** of the normalized text and stores it as the 8th column.
- SimHash is locality-sensitive: near-duplicate texts land within a few bits of each other. The scanner flags any two rows from **different companies** whose fingerprints are ≥ 92 % similar (at most 5 of 64 bits differ) and that appeared within a 90-day window.
- The check is **warn-only**: nothing is dropped automatically. If one side is an agency, apply through ONE channel only — a double submission burns the candidate with both parties.
- Postings without a usable description get an **empty fingerprint** and are never flagged. No body → no signal, no false positives.
- The fingerprint is computed **locally** from the text already returned by the API. No extra network request is made and the JD body itself is not stored in the TSV.

## Output Summary

```text
Portal Scan — {YYYY-MM-DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━
Queries executed: N
Offers found: N total
Filtered by title: N relevant
Duplicates: N (already evaluated or in pipeline)
Expired discarded: N (dead links, Level 3)
New added to pipeline.md: N
Agent/WebSearch handoff: N
Handoff file: users/{USER}/data/scan-handoff.json

  + {company} | {title} | {query_name}
  ...

→ Run /career-ops pipeline to evaluate the new offers.
→ Run /career-ops scan-handoff to process unsupported companies from the saved handoff file.
→ In CLIs without slash commands, ask the agent to run `pipeline` or `scan-handoff` for the active user.
```

## Managing careers_url

Every company in `tracked_companies` must have a `careers_url` — the direct URL to its offers page. This avoids searching for it every time.

**RULE: Always use the corporate careers URL of the company; fallback to the direct ATS endpoint only if no corporate careers page exists.**

The `careers_url` should point to the company's own careers page whenever available. Many companies use Workday, Greenhouse, or Lever under the hood, but expose vacancy IDs only through their corporate domain. Using the direct ATS URL when a corporate careers page exists can cause false 410 errors because job IDs do not match.

| ✅ Correct (corporate) | ❌ Incorrect as first choice (direct ATS) |
|---|---|
| `https://careers.mastercard.com` | `https://mastercard.wd1.myworkdayjobs.com` |
| `https://openai.com/careers` | `https://job-boards.greenhouse.io/openai` |
| `https://stripe.com/jobs` | `https://jobs.lever.co/stripe` |

Fallback: if you only have the direct ATS URL, navigate first to the company's website and locate their corporate careers page. Use the direct ATS URL only if the company does not have its own corporate careers page.

**Known Patterns by Platform:**
- **Ashby:** `https://jobs.ashbyhq.com/{slug}`
- **Greenhouse:** `https://job-boards.greenhouse.io/{slug}` or `https://job-boards.eu.greenhouse.io/{slug}`
- **Lever:** `https://jobs.(eu.)?lever.co/{slug}`
- **BambooHR:** list `https://{company}.bamboohr.com/careers/list`; detail `https://{company}.bamboohr.com/careers/{id}/detail`
- **Teamtailor:** `https://{company}.teamtailor.com/jobs`
- **Workday:** `https://{company}.{shard}.myworkdayjobs.com/{site}`
- **Custom:** The company's own URL (e.g. `https://openai.com/careers`)

**API/Feed Patterns by Platform:**
- **Ashby API:** `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`
- **BambooHR API:** list `https://{company}.bamboohr.com/careers/list`; detail `https://{company}.bamboohr.com/careers/{id}/detail` (`result.jobOpening`)
- **Lever API:** `https://api.(eu.)?lever.co/v0/postings/{company}`
- **Teamtailor RSS:** `https://{company}.teamtailor.com/jobs.rss`
- **Workday API:** `https://{company}.{shard}.myworkdayjobs.com/wday/cxs/{company}/{site}/jobs`

**Si `careers_url` no existe** para una empresa:
1. Intentar el patrón de su plataforma conocida
2. Si falla, hacer un WebSearch rápido: `"{company}" careers jobs`
3. Navegar con Playwright para confirmar que funciona
4. **Guardar la URL encontrada en `users/{USER}/portals.yml`** para futuros scans

**If `careers_url` returns 404 or redirect:**
1. Note it in the output summary.
2. Attempt `scan_query` as a fallback.
3. Mark it for manual update.

## Maintenance of portals.yml

- **ALWAYS save `careers_url`** when adding a new company.
- Add new queries as interesting portals or roles are discovered.
- Deactivate noisy queries with `enabled: false`.
- Adjust filter keywords as target roles evolve.
- Add companies to `tracked_companies` when you want to follow them closely.
- Verify `careers_url` periodically — companies change ATS platforms.
