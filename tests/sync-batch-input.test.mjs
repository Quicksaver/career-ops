// tests/sync-batch-input.test.mjs — pipeline.md "Pending" -> batch-input.tsv (#3391).
//
// Covers the exported parser helpers (localized section headers, variable-width
// rows, labeled segments, dedupe, batch row format), imported directly, and the
// fork CLI, which forwards to sync-pipeline-batch.mjs for an explicit user.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, existsSync, readFileSync, writeFileSync } from 'fs';

console.log('\nsync-batch-input — pipeline "Pending" -> batch-input.tsv');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'sync-batch-input.mjs')).href);
  const { parsePending, urlsFromTsv, maxTsvId, planBatchRows, buildNotes, lineUrl, lineCompany, extractLabels, isSafePublicHttpUrl } = mod;
  const check = (label, cond) => (cond ? pass(label) : fail(label));

  // ── section-header matching (lib/pipeline-sections.mjs, shared with reconcile-pipeline) ──
  const pendingUnder = (heading) => parsePending(`${heading}\n- [ ] https://example.com/h | Acme | Role\n`).length === 1;
  check('English header is recognised', pendingUnder('## Pending'));
  check('Spanish header is recognised', pendingUnder('## Pendientes'));
  check('German header is recognised', pendingUnder('## Offen'));
  check('French header is recognised', pendingUnder('## En attente'));
  check('a non-pending header is not matched', !pendingUnder('## Processed'));

  // ── url / company / label extraction ──
  check('bare URL parses', lineUrl('https://example.com/1') === 'https://example.com/1');
  check('url stops at the first pipe', lineUrl('https://example.com/2 | Acme | Role') === 'https://example.com/2');
  check('company is the second positional cell', lineCompany('https://example.com/3 | Acme | Role') === 'Acme');
  check('a bare row has no company', lineCompany('https://example.com/4') === '');
  const labels = extractLabels('https://example.com/5 | Acme | Role | note: curated | trust: 80 missing_apply_url');
  check('note label extracts', labels.note === 'curated');
  check('trust label extracts with flags', labels.trust === '80 missing_apply_url');
  check('unlabelled rows yield no labels', Object.keys(extractLabels('https://example.com/6 | Acme | Role')).length === 0);
  check(
    'notes are labelled segments joined by pipes',
    buildNotes({ note: 'curated', trust: '80 missing_apply_url' }) === 'note: curated | trust: 80 missing_apply_url',
  );

  // ── parsePending: variable-width rows + localized headers ──
  const es = parsePending([
    '## Pendientes',
    '- [ ] https://example.com/1',
    '- [ ] https://example.com/2 | Acme | Backend Engineer | Remote',
    '- [ ] https://example.com/3 | Beta | SA | Remote | 180000 | note: curated',
    '## Procesadas',
    '- [x] https://example.com/4 | Gamma | Done',
  ].join('\n'));
  check('three pending rows parsed under a Spanish header', es.length === 3);
  check('bare row has empty company/notes', es[0].company === '' && es[0].notes === '');
  check('4-column row keeps company', es[1].company === 'Acme');
  check('labelled segment becomes notes', es[2].notes === 'note: curated');

  const processed = parsePending([
    '## Pending',
    '- [ ] https://example.com/9 | Acme | Role',
    '',
    '- [ ] https://example.com/10 | Beta | Role | note: curated',
  ].join('\n'));
  check('blank lines are skipped', processed.length === 2);

  check('public HTTPS URLs are accepted', isSafePublicHttpUrl('https://example.com/jobs/1'));
  check('localhost URLs are rejected', !isSafePublicHttpUrl('http://localhost:3000/jobs'));
  check('private IPv4 URLs are rejected', !isSafePublicHttpUrl('https://10.0.0.5/jobs'));
  check('IPv4 shorthand loopback URLs are rejected', !isSafePublicHttpUrl('http://2130706433/jobs'));
  check('IPv6 loopback URLs are rejected', !isSafePublicHttpUrl('http://[::1]/jobs'));
  check('local/internal hostnames are rejected', !isSafePublicHttpUrl('https://metadata.google.internal/compute'));
  check('IPv4-compatible IPv6 loopback is rejected', !isSafePublicHttpUrl('http://[::127.0.0.1]/'));
  check('normalized IPv4-compatible IPv6 loopback is rejected', !isSafePublicHttpUrl('http://[0:0:0:0:0:0:7f00:1]/'));
  check('IPv4-compatible IPv6 private is rejected', !isSafePublicHttpUrl('http://[::10.0.0.1]/'));
  check('unspecified IPv6 address is rejected', !isSafePublicHttpUrl('http://[::]/'));
  const filteredP = parsePending([
    '## Pending',
    '- [ ] http://[::127.0.0.1]/admin | Bad | Role',
    '- [ ] https://example.com/safe | Good | Role',
  ].join('\n'));
  check('IPv4-compatible IPv6 loopback is filtered from pending', filteredP.length === 1 && filteredP[0].url === 'https://example.com/safe');
  const filtered = parsePending([
    '## Pending',
    '- [ ] http://127.0.0.1/admin | Bad | Role',
    '- [ ] https://example.com/safe | Good | Role',
  ].join('\n'));
  check('unsafe pending URLs are filtered before batch rows are planned', filtered.length === 1 && filtered[0].url === 'https://example.com/safe');

  // ── urlsFromTsv / maxTsvId (existing input + state) ──
  const inputTsv = [
    '# batch-input.tsv header comment',
    'id\turl\tsource\tnotes',
    '1\thttps://queued.example/1\tpipeline\tpriority',
    '2\thttps://queued.example/2\tGreenhouse\t',
    '',
  ].join('\n');
  const inputUrls = urlsFromTsv(inputTsv, 1);
  check('existing input URLs are collected from the url column', inputUrls.has('https://queued.example/1'));
  check('header comment, header row, and blanks are ignored', inputUrls.size === 2);
  check('maxTsvId reads the largest numeric id', maxTsvId(inputTsv) === 2);
  check('maxTsvId ignores the header row', maxTsvId('id\turl\n7\tx\n') === 7);
  check('maxTsvId is 0 with no numeric ids', maxTsvId('# only comments\n') === 0);

  const stateTsv = [
    'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
    '1\thttps://done.example/1\tcompleted\t2026-08-25\t2026-08-25\t1\t3.5\t\t0',
    '5\thttps://done.example/5\tcompleted\t2026-08-26\t2026-08-26\t1\t4\t\t0',
  ].join('\n');
  const stateUrls = urlsFromTsv(stateTsv, 1);
  check('batch-state URLs are collected from column 2', stateUrls.has('https://done.example/1'));
  check('maxTsvId covers state rows too', maxTsvId(stateTsv) === 5);

  // ── planBatchRows: dedupe + numeric-id row format ──
  const pending = parsePending([
    '## Pending',
    '- [ ] https://new.example/1 | Acme | Role',
    '- [ ] https://queued.example/1 | Beta | Role',
    '- [ ] https://new.example/3 | Gamma | Role | trust: 90 suspicious_domain',
    '- [ ] https://new.example/2', // bare
  ].join('\n'));
  const existing = new Set([...inputUrls, ...stateUrls]);
  const startedId = Math.max(maxTsvId(inputTsv), maxTsvId(stateTsv)) + 1;
  const rows = planBatchRows(pending, existing, startedId);
  check('queued and processed URLs are deduped', rows.length === 3);
  check('ids are allocated sequentially after the highest existing id', rows[0].id === 6 && rows[2].id === 8);
  check('a fresh entry carries id/url/source/notes tabs', rows[0].row === '6\thttps://new.example/1\tpipeline\t');
  check('labelled segments ride into notes', rows.some((r) => r.notes === 'trust: 90 suspicious_domain'));
  check('a bare row keeps empty notes', rows.some((r) => r.row === '8\thttps://new.example/2\tpipeline\t'));
  check('every row uses the pipeline source', rows.every((r) => r.row.includes('\tpipeline\t')));
  check('every id is a positive integer', rows.every((r) => Number.isInteger(r.id) && r.id > 0));

  const duplicateRows = planBatchRows([
    { url: 'https://dupe.example/1', company: 'A', notes: '' },
    { url: 'https://dupe.example/1', company: 'B', notes: '' },
  ], new Set(), 10);
  check('duplicates inside one pending section are queued once', duplicateRows.length === 1);
  check('startId honours an explicit starting id', duplicateRows[0].id === 10);

  const unsafeFieldRows = planBatchRows([
    { url: 'https://fields.example/1', company: 'Acme\tInc', notes: 'line1\nline2\rline3' },
  ], new Set(), 3);
  check('embedded tabs/newlines are sanitized before TSV row construction', unsafeFieldRows[0].row === '3\thttps://fields.example/1\tpipeline\tline1 line2 line3');
  check('sanitized batch rows remain four columns', unsafeFieldRows[0].row.split('\t').length === 4);

  // ── SSRF: bracketed unspecified IPv6 address ──
  check('bracketed unspecified IPv6 ([::]) is rejected', !isSafePublicHttpUrl('http://[::]/'));
  check('bracketed unspecified IPv6 with port is rejected', !isSafePublicHttpUrl('http://[::]:8080/'));
  check('bracketed IPv4-compatible IPv6 loopback is rejected', !isSafePublicHttpUrl('http://[::127.0.0.1]/'));
  check('bracketed IPv4-compatible IPv6 private is rejected', !isSafePublicHttpUrl('http://[::10.0.0.1]/'));

  // ── CLI: a thin forward to the fork's per-user synchronizer ──
  // The fork's sync-pipeline-batch.mjs owns this step (pipeline lock, stable
  // IDs recovered from batch-state, ID-conflict detection). The CLI only runs
  // for an explicit user and writes users/{USER}/batch/, never the checkout.
  const usersDir = realpathSync(mkdtempSync(join(tmpdir(), 'sync-batch-input-users-')));
  const userRoot = join(usersDir, 'fixture');
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CAREER_OPS_/i.test(key)));
  function runCli(args, extraEnv = {}) {
    const res = spawnSync(process.execPath, [join(ROOT, 'sync-batch-input.mjs'), ...args], {
      cwd: ROOT, encoding: 'utf-8', timeout: 15000,
      env: { ...baseEnv, CAREER_OPS_USERS_DIR: usersDir, ...extraEnv },
    });
    return { exitCode: res.status ?? 1, stdout: res.stdout || '', stderr: res.stderr || '' };
  }
  try {
    mkdirSync(join(userRoot, 'data'), { recursive: true });
    mkdirSync(join(userRoot, 'batch'), { recursive: true });
    writeFileSync(join(userRoot, 'data', 'pipeline.md'), [
      '# Pipeline', '', '## Offen',
      '- [ ] https://jobs.example.org/de-1 | Fictional GmbH | Engineer',
      '- [ ] local:jds/fictional-role.md | Fictional | Local capture',
      '- [ ] https://jobs.example.org/recovered | Fictional | Recovered', '',
      '## Processed', '',
    ].join('\n'));
    writeFileSync(join(userRoot, 'batch', 'batch-state.tsv'),
      'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n7\thttps://jobs.example.org/recovered\tfailed\t-\t-\t-\t-\tfixture\t1\n');
    const inputPath = join(userRoot, 'batch', 'batch-input.tsv');

    for (const flag of ['--input', '--state', '--pipeline']) {
      const res = runCli(['--user', 'fixture', flag, join(usersDir, 'elsewhere.tsv')]);
      check(`${flag} path overrides are refused`, res.exitCode === 1 && res.stderr.includes(`${flag} is not supported`));
    }
    check('an --input=value override is refused too', runCli(['--user', 'fixture', `--input=${join(usersDir, 'x.tsv')}`]).exitCode === 1);
    const noUser = runCli(['--dry-run']);
    check('no selected user exits with an error', noUser.exitCode !== 0 && /No career-ops user selected/.test(noUser.stderr + noUser.stdout));
    check('a path-like user is refused', runCli(['--user', '../fixture', '--dry-run']).exitCode !== 0);
    check('--help documents the explicit user', /--user <id>/.test(runCli(['--help']).stdout));

    const dry = runCli(['--user', 'fixture', '--dry-run', '--json']);
    const dryResult = dry.exitCode === 0 ? JSON.parse(dry.stdout.trim()) : null;
    check('dry run reads the localized Pending header and reports the additions', dryResult?.status === 'completed' && dryResult.added === 3 && dryResult.dry_run === true);
    check('dry run writes no batch input', !existsSync(inputPath));

    const real = runCli(['--user', 'fixture', '--json']);
    const result = real.exitCode === 0 ? JSON.parse(real.stdout.trim()) : null;
    const rows = existsSync(inputPath) ? readFileSync(inputPath, 'utf8').trim().split('\n').slice(1).map(line => line.split('\t')) : [];
    check('the sync writes the selected user batch input', result?.added === 3 && rows.length === 3);
    check('local:jds rows reach the batch input (the runner applies its own containment checks)', rows.some(row => row[1] === 'local:jds/fictional-role.md'));
    check('a URL known to batch-state keeps its stable ID', rows.some(row => row[0] === '7' && row[1] === 'https://jobs.example.org/recovered' && row[2] === 'pipeline-recovered'));
    check('new IDs start after the highest known ID', rows.filter(row => row[2] === 'pipeline').every(row => Number(row[0]) > 7));
    const again = runCli(['--user', 'fixture', '--json']);
    check('a second sync is idempotent', again.exitCode === 0 && JSON.parse(again.stdout.trim()).added === 0);

    writeFileSync(inputPath, 'id\turl\tsource\tnotes\n7\thttps://jobs.example.org/other\tmanual\t\n');
    const conflict = runCli(['--user', 'fixture', '--json']);
    check('an input/state ID conflict fails closed', conflict.exitCode === 1 && JSON.parse(conflict.stdout.trim()).state_conflicts?.[0]?.id === '7');
  } finally {
    rmSync(usersDir, { recursive: true, force: true });
  }

  // ── planBatchRows deduplication within single iteration ──
  const sameUrlPending = [
    { url: 'https://dupe-in-batch.example/a', company: 'A', notes: '' },
    { url: 'https://dupe-in-batch.example/a', company: 'B', notes: 'note: second' },
    { url: 'https://dupe-in-batch.example/b', company: 'C', notes: '' },
    { url: 'https://dupe-in-batch.example/a', company: 'D', notes: '' },
  ];
  const dedupedRows = planBatchRows(sameUrlPending, new Set(), 20);
  check('same URL in three pending entries yields one row', dedupedRows.length === 2);
  check('first occurrence of duplicated URL is kept', dedupedRows.some((r) => r.url === 'https://dupe-in-batch.example/a' && r.notes === ''));
  check('second unique URL is included', dedupedRows.some((r) => r.url === 'https://dupe-in-batch.example/b'));
  check('duplicated rows have sequential ids', dedupedRows[0].id === 20 && dedupedRows[1].id === 21);

  // ── TSV cell returns empty for undefined/null input ──
  // tsvCell is not exported; test indirectly via planBatchRows and parsePending
  const nullNotesRows = planBatchRows([
    { url: 'https://nullnotes.example/1', company: '', notes: null },
    { url: 'https://nullnotes.example/2', company: '', notes: undefined },
  ], new Set(), 30);
  check('null notes become empty in TSV', nullNotesRows[0].row === '30\thttps://nullnotes.example/1\tpipeline\t');
  check('undefined notes become empty in TSV', nullNotesRows[1].row === '31\thttps://nullnotes.example/2\tpipeline\t');
} catch (err) {
  fail(`sync-batch-input test suite threw: ${err?.message ?? err}`);
}
