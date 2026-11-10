// Keep a job linked to its most recent CV when a duplicate report folds into it.
//
// A re-evaluation writes a new report with its own CV, named after the new
// report number. When verification resolves that report as a duplicate of the
// job's original report, the original stays the keeper and the new report is
// archived together with its output. Without this step the newer CV went to
// output/duplicates/ and the job kept linking the older one, or none.
//
// promoteNewerCv() moves a duplicate's CV to the keeper when it is newer than
// the keeper's current CV: the PDF and its HTML take the keeper's report number
// and keep the duplicate's slug and date, the keeper report's **PDF:** line
// names the new file, and data/pdf-index.tsv files it under the keeper's
// number. The keeper's previous CV is retired: moved to backupDir when one is
// given, deleted otherwise.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { withPipelineLock } from '../pipeline-lock.mjs';
import { writeFileAtomic } from '../tracker-utils.mjs';

// The header generate-pdf.mjs writes. generate-pdf.mjs resolves the active user
// when it is imported, so its manifest helpers are not imported here.
export const MANIFEST_HEADER = '# report\tpdf\thtml\tformat\tdate\tkind - written by generate-pdf.mjs, do not edit';

const PDF_LINE = /^\*\*PDF:\*\*[ \t]*(.*)$/m;
const URL_LINE = /^\*\*URL:\*\*.*$/m;

const normKey = (value) => (value || '').trim().replace(/^0+(?=\d)/, '');

function localDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function indexRows(lines) {
  return lines.filter((line) => line.trim() && !line.startsWith('#')).map((line) => line.split('\t'));
}

/** The CV row the manifest holds for a report number: the last CV or untagged row. */
function cvRowFor(rows, reportNum) {
  return rows.filter((f) => normKey(f[0]) === normKey(reportNum) && (f[5] || '').trim() !== 'cover').at(-1) || null;
}

/**
 * Put a CV row last in the manifest, superseding the report's CV slot the way
 * applyManifestRow() in generate-pdf.mjs does: a cover letter row stays, and so
 * does every other report's row.
 */
function upsertCvRow(lines, row) {
  const kept = lines.filter((line) => {
    if (!line.trim() || line.startsWith('#')) return false;
    const fields = line.split('\t');
    if (fields[1] === row[1]) return false;
    return normKey(fields[0]) !== normKey(row[0]) || (fields[5] || '').trim() === 'cover';
  });
  return [...kept, row.join('\t')];
}

function siblingHtml(pdf) {
  const html = pdf.replace(/\.pdf$/i, '.html');
  return existsSync(html) ? html : null;
}

/**
 * The keeper's current CV: the report's **PDF:** line, else its manifest row,
 * else the PDF named after the report. Only files that exist count.
 */
function currentCv(userRoot, reportPath, reportText, rows, reportNum) {
  const linked = reportText.match(PDF_LINE)?.[1].match(/(\S+\.pdf)\b/i)?.[1];
  if (linked) {
    const pdf = join(userRoot, linked);
    if (existsSync(pdf)) return { pdf, html: siblingHtml(pdf) };
  }
  const row = cvRowFor(rows, reportNum);
  if (row?.[1] && existsSync(join(userRoot, row[1]))) {
    const html = row[2] && existsSync(join(userRoot, row[2])) ? join(userRoot, row[2]) : null;
    return { pdf: join(userRoot, row[1]), html };
  }
  const pdf = join(userRoot, 'output', `${basename(reportPath, '.md')}.pdf`);
  return existsSync(pdf) ? { pdf, html: siblingHtml(pdf) } : null;
}

/**
 * Move a duplicate report's CV to its keeper when it is the newer one.
 *
 * @param {object} options
 * @param {string} options.userRoot - The selected user's data root.
 * @param {string} options.indexPath - data/pdf-index.tsv for that user.
 * @param {string} options.keeperReport - Absolute path of the keeper report.
 * @param {string} options.candidatePdf - Absolute path of the duplicate's PDF.
 * @param {string|null} [options.backupDir] - Where the keeper's previous CV
 *   goes; null deletes it.
 * @returns {Promise<{promoted: boolean, pdf: string|null,
 *   moves: {from: string, to: string}[], restores: {path: string, content: string|null}[]}>}
 *   `pdf` is the promoted CV relative to userRoot. `moves` and `restores` let a
 *   caller undo the change: rename each `to` back to `from` in reverse order,
 *   and write each `content` back to its `path` (null meaning delete).
 */
export async function promoteNewerCv({ userRoot, indexPath, keeperReport, candidatePdf, backupDir = null }) {
  const result = { promoted: false, pdf: null, moves: [], restores: [] };
  if (!existsSync(candidatePdf) || !existsSync(keeperReport)) return result;
  const keeperNum = basename(keeperReport).match(/^0*(\d+)-/)?.[1];
  if (!keeperNum) return result;

  const rel = (p) => relative(userRoot, p).split(sep).join('/');
  const reportText = readFileSync(keeperReport, 'utf-8');
  const originalIndex = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8') : null;
  const rows = indexRows(originalIndex ? originalIndex.split('\n') : []);
  const current = currentCv(userRoot, keeperReport, reportText, rows, keeperNum);
  if (current && statSync(current.pdf).mtimeMs >= statSync(candidatePdf).mtimeMs) return result;

  const stem = basename(candidatePdf, '.pdf');
  const targetStem = `${keeperNum}-${stem.replace(/^\d+-/, '')}`;
  const outputDir = join(userRoot, 'output');
  const target = { pdf: join(outputDir, `${targetStem}.pdf`), html: join(outputDir, `${targetStem}.html`) };
  const candidateHtml = join(dirname(candidatePdf), `${stem}.html`);
  // The duplicate's own row names it where it was generated, which is output/
  // unless the resolver has not archived it yet.
  const candidatePaths = new Set([rel(candidatePdf), `output/${basename(candidatePdf)}`]);
  const candidateRow = rows.filter((f) => candidatePaths.has(f[1])).at(-1);
  const format = candidateRow?.[3] || cvRowFor(rows, keeperNum)?.[3] || 'a4';

  const retire = (file) => {
    if (!file || !existsSync(file) || file === candidatePdf || file === candidateHtml) return;
    if (!backupDir) return rmSync(file, { force: true });
    mkdirSync(backupDir, { recursive: true });
    const to = join(backupDir, basename(file));
    renameSync(file, to);
    result.moves.push({ from: file, to });
  };
  retire(current?.pdf);
  retire(current?.html);
  retire(target.pdf);
  retire(target.html);

  mkdirSync(outputDir, { recursive: true });
  if (candidatePdf !== target.pdf) {
    renameSync(candidatePdf, target.pdf);
    result.moves.push({ from: candidatePdf, to: target.pdf });
  }
  if (existsSync(candidateHtml) && candidateHtml !== target.html) {
    renameSync(candidateHtml, target.html);
    result.moves.push({ from: candidateHtml, to: target.html });
  }

  const pdfLine = `**PDF:** ${rel(target.pdf)}`;
  const updatedReport = PDF_LINE.test(reportText)
    ? reportText.replace(PDF_LINE, pdfLine)
    : reportText.replace(URL_LINE, (line) => `${line}\n${pdfLine}`);
  if (updatedReport !== reportText) {
    result.restores.push({ path: keeperReport, content: reportText });
    writeFileAtomic(keeperReport, updatedReport);
  }

  await withPipelineLock(indexPath, () => {
    const fresh = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8').split('\n') : [];
    // The duplicate's own row names a file that no longer exists there.
    const kept = fresh.filter((line) => line.startsWith('#') || !candidatePaths.has(line.split('\t')[1]));
    const lines = upsertCvRow(kept, [
      keeperNum,
      rel(target.pdf),
      existsSync(target.html) ? rel(target.html) : '',
      format,
      localDate(statSync(target.pdf).mtimeMs),
      'cv',
    ]);
    mkdirSync(dirname(indexPath), { recursive: true });
    writeFileAtomic(indexPath, `${MANIFEST_HEADER}\n${lines.join('\n')}\n`);
  });
  result.restores.push({ path: indexPath, content: originalIndex });

  result.promoted = true;
  result.pdf = rel(target.pdf);
  return result;
}
