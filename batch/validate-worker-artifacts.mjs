#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { basename, resolve, dirname } from 'path';
import { isMainModule } from '../lib/is-main-module.mjs';
import { loadYaml } from '../lib/yaml-document.mjs';
import { normalizeVia, looksLikeTsvHeaderRow, resolveTsvColumns } from '../tracker-parse.mjs';
import { hasEmbeddedJdArchive } from '../check-jd-archive.mjs';
import { loadAnswers, validLocal, validUrl } from './manual-inputs.mjs';
import { promoteKnownFragmentIdentity } from '../url-key.mjs';
import { getProfilePath } from '../path-resolver.mjs';

function clean(value) {
  const text = value == null ? '' : String(value).trim();
  return text === '—' ? '' : text;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return args[index + 1];
}

export function parseMachineSummary(reportContent) {
  const match = reportContent.match(/##\s*Machine Summary\s*\n+```(?:yaml|yml)\s*\n([\s\S]*?)\n```/i);
  if (!match) throw new Error('report is missing a YAML Machine Summary');
  const parsed = loadYaml(match[1]);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('report Machine Summary is not an object');
  }
  return parsed;
}

export function parseTrackerAddition(content) {
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
  const header = lines[0]?.split('\t');
  if (looksLikeTsvHeaderRow(header)) {
    const { map, missing, duplicates } = resolveTsvColumns(header);
    if (missing.length || duplicates.length) throw new Error('tracker addition has an invalid header');
    if (lines.length !== 2) throw new Error('headered tracker addition must contain exactly one data row');
    const parts = lines[1].split('\t');
    if (parts.length !== header.length) throw new Error('tracker addition width disagrees with its header');
    const at = name => clean(parts[map[name]]);
    return { line: lines[1], parts, headered: true, num: at('num'), company: at('company'), role: at('role'), score: at('score'), via: at('via'), status: at('status'), pdf: at('pdf'), report: at('report'), url: at('url') };
  }
  if (lines.length !== 1) throw new Error(`tracker addition must contain exactly one non-empty line (found ${lines.length})`);
  const parts = lines[0].split('\t');
  if (parts.length < 9) throw new Error(`tracker addition must contain at least 9 tab-separated columns (found ${parts.length})`);

  const extras = parts.slice(9).map(value => value.trim()).filter(Boolean);
  const viaFields = extras.filter(value => /^via=/i.test(value));
  const untagged = extras.filter(value => !/^via=/i.test(value));
  if (viaFields.length > 1) throw new Error('tracker addition contains more than one via= field');
  if (untagged.length > 1) throw new Error('tracker addition contains more than one untagged optional field');

  return {
    line: lines[0],
    parts,
    num: parts[0].trim(),
    company: parts[2].trim(),
    role: parts[3].trim(),
    score: parts[5].trim(),
    status: parts[4].trim(), pdf: parts[6].trim(), report: parts[7].trim(),
    via: viaFields.length ? clean(viaFields[0].replace(/^via=/i, '')) : '',
  };
}

function sameVia(left, right) {
  return normalizeVia(clean(left)) === normalizeVia(clean(right));
}

function scoreNumber(score) {
  const match = clean(score).match(/^([0-9]+(?:\.[0-9]+)?)\/5$/);
  return match ? Number(match[1]) : null;
}

export function postingIdentity(value) {
  if (validLocal(value)) return value;
  // Browser-captured application links can contain literal spaces in a path or
  // query value. Compare their encoded identity, while keeping control bytes,
  // private hosts and credentials subject to the same public-URL validation.
  const encoded = typeof value === 'string' ? value.replaceAll(' ', '%20') : value;
  if (!validUrl(encoded)) return null;
  const url = new URL(encoded);
  promoteKnownFragmentIdentity(url);
  url.hash = '';
  url.searchParams.sort();
  return url.href;
}

export function allowedPostingIdentities(expectedUrl, userRoot, answersPath, user) {
  const allowed = new Set([postingIdentity(expectedUrl)].filter(Boolean));
  if (userRoot && validLocal(expectedUrl, userRoot) && existsSync(resolve(userRoot, expectedUrl.slice(6)))) {
    const text = readFileSync(resolve(userRoot, expectedUrl.slice(6)), 'utf8');
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (frontmatter) {
      const metadata = loadYaml(frontmatter[1]);
      for (const field of ['application_url', 'source_url']) {
        const identity = postingIdentity(metadata?.[field]);
        if (identity) allowed.add(identity);
      }
    }
  }
  if (answersPath) for (const answer of loadAnswers(answersPath, user, userRoot)) {
    if (answer.url === expectedUrl && answer.reason === 'jd_unavailable' && answer.employer_url) allowed.add(postingIdentity(answer.employer_url));
  }
  return allowed;
}

export function validateWorkerArtifacts({ reportPath, trackerPath, finalPath = null, repair = false, strictWorkflow = false, userRoot = null, reportNum = null, expectedUrl = null, answersPath = null, user = null }) {
  const reportContent = readFileSync(reportPath, 'utf8');
  const report = parseMachineSummary(reportContent);
  let trackerContent = readFileSync(trackerPath, 'utf8');
  let tracker = parseTrackerAddition(trackerContent);
  let repaired = false;
  const errors = [];
  const reportCompany = clean(report.company);
  const reportRole = clean(report.role);
  const reportVia = clean(report.via);
  const confidential = report.company_confidential;

  if (strictWorkflow) {
    if (!hasEmbeddedJdArchive(reportContent)) errors.push('report must archive the substantive JD verbatim');
    const num = String(reportNum ?? tracker.num);
    if (Number(tracker.num) !== Number(num) || !basename(reportPath).startsWith(`${num}-`)) errors.push('report/tracker number disagrees with reserved report number');
    const reportLink = tracker.report.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    const expectedReport = resolve(reportPath);
    const linkedReport = reportLink && resolve(userRoot || dirname(dirname(reportPath)), reportLink[2].replaceAll('\\', '/'));
    if (!reportLink || Number(reportLink[1]) !== Number(num) || linkedReport !== expectedReport) errors.push('tracker report link must target the validated reserved report');
    if (expectedUrl) {
      const allowed = allowedPostingIdentities(expectedUrl, userRoot, answersPath, user);
      if (!allowed.has(postingIdentity(tracker.url))) errors.push('tracker URL disagrees with expected posting identity');
    }
    const blocked = report.final_decision === 'Skip' || (Array.isArray(report.hard_stops) && report.hard_stops.length > 0);
    if (blocked && tracker.status !== 'SKIP') errors.push('Skip/hard stops require tracker SKIP');
    if (blocked && tracker.pdf === '✅') errors.push('Skip/hard stops cannot have a primary PDF');
    if (/^(null|undefined)$/i.test(tracker.via)) errors.push('direct Via must be an empty TSV field, never a null string');
    if (userRoot) {
      // The batch lane reads the selected user's own profile, like run-workflow.mjs.
      const profilePath = getProfilePath(userRoot);
      const profile = existsSync(profilePath) ? loadYaml(readFileSync(profilePath, 'utf8')) : {};
      if (['text', 'latex'].includes(profile?.cv?.output_format) && tracker.pdf === '✅') errors.push('configured text/latex output cannot claim a PDF');
      const threshold = profile?.auto_pdf_score_threshold ?? 3;
      if (tracker.pdf === '✅' && (typeof report.score !== 'number' || report.score < threshold)) errors.push('primary PDF is below the configured score gate');
      const primaryPdf = resolve(userRoot, 'output', basename(reportPath).replace(/\.md$/, '.pdf'));
      if (tracker.pdf === '✅' && !existsSync(primaryPdf)) errors.push('primary PDF must exist at the flat report-linked path');
      const indexPath = resolve(userRoot, 'data/pdf-index.tsv');
      if (tracker.pdf === '✅' && existsSync(indexPath)) {
        const indexed = readFileSync(indexPath, 'utf8').split(/\r?\n/).map(line => line.split('\t')).filter(fields => Number(fields[0]) === Number(num) && (!fields[5] || fields[5] === 'cv'));
        if (indexed.some(fields => basename(fields[1].replaceAll('\\', '/')) !== basename(primaryPdf))) errors.push('secondary CV overwrote the primary PDF index identity');
      }
    }
  }

  if (!reportCompany) errors.push('Machine Summary company is missing');
  if (!reportRole) errors.push('Machine Summary role is missing');
  if (typeof confidential !== 'boolean') errors.push('Machine Summary company_confidential must be boolean');
  if (typeof confidential === 'boolean' && confidential !== (reportCompany === '?')) {
    errors.push(`company_confidential=${confidential} disagrees with company=${JSON.stringify(reportCompany)}`);
  }
  if (tracker.company !== reportCompany) {
    errors.push(`tracker company ${JSON.stringify(tracker.company)} disagrees with report company ${JSON.stringify(reportCompany)}`);
  }
  if (tracker.role !== reportRole) {
    errors.push(`tracker role ${JSON.stringify(tracker.role)} disagrees with report role ${JSON.stringify(reportRole)}`);
  }
  if (reportCompany === '?' && !reportVia) {
    errors.push('confidential employer requires a named Via channel in the Machine Summary');
  }
  if (reportVia && /[\t\r\n]/.test(reportVia)) {
    errors.push('Machine Summary via contains a tab or newline');
  }

  if (reportVia && !tracker.via && repair && errors.length === 0) {
    if (tracker.headered) {
      const header = trackerContent.split(/\r?\n/).find(line => line.trim()).split('\t');
      const { map } = resolveTsvColumns(header);
      const parts = [...tracker.parts];
      if (map.via === undefined) {
        header.push('via');
        parts.push(reportVia);
      } else parts[map.via] = reportVia;
      trackerContent = `${header.join('\t')}\n${parts.join('\t')}\n`;
    } else {
      trackerContent = `${tracker.line}\tvia=${reportVia}\n`;
    }
    writeFileSync(trackerPath, trackerContent, 'utf8');
    tracker = parseTrackerAddition(trackerContent);
    repaired = true;
  }

  if (reportVia && !tracker.via) errors.push(`tracker addition is missing via=${reportVia}`);
  if (!reportVia && tracker.via) errors.push(`tracker Via ${JSON.stringify(tracker.via)} is absent from the Machine Summary`);
  if (reportVia && tracker.via && !sameVia(reportVia, tracker.via)) {
    errors.push(`tracker Via ${JSON.stringify(tracker.via)} disagrees with report Via ${JSON.stringify(reportVia)}`);
  }

  const reportScore = typeof report.score === 'number' ? report.score
    : typeof report.score === 'string' && report.score.trim() !== '' ? Number(report.score) : NaN;
  const trackerScore = scoreNumber(tracker.score);
  if (strictWorkflow && (!Number.isFinite(reportScore) || reportScore < 0 || reportScore > 5)) errors.push('completed report score must be finite and between 0 and 5');
  if (strictWorkflow && (trackerScore === null || !Number.isFinite(trackerScore) || trackerScore < 0 || trackerScore > 5)) errors.push('completed tracker score must be a valid score between 0 and 5');
  if (Number.isFinite(reportScore) && trackerScore !== null && Math.abs(reportScore - trackerScore) > 0.0001) {
    errors.push(`tracker score ${tracker.score} disagrees with report score ${report.score}`);
  }

  if (finalPath) {
    const final = JSON.parse(readFileSync(finalPath, 'utf8'));
    if (final.status === 'completed') {
      if (typeof final.score !== 'number' || !Number.isFinite(final.score) || final.score < 0 || final.score > 5) errors.push('completed final JSON score must be finite and between 0 and 5');
      if (Number.isFinite(reportScore) && final.score !== reportScore) errors.push('final JSON score disagrees with report');
      if (clean(final.company) !== reportCompany) errors.push('final JSON company disagrees with Machine Summary');
      if (clean(final.role) !== reportRole) errors.push('final JSON role disagrees with Machine Summary');
      if (!sameVia(final.via, reportVia)) errors.push('final JSON via disagrees with Machine Summary');
      if (final.company_confidential !== confidential) errors.push('final JSON company_confidential disagrees with Machine Summary');
      if (!clean(final.tracker)) errors.push('completed final JSON must include the tracker path');
      if (clean(final.tracker) && basename(clean(final.tracker)) !== basename(trackerPath)) errors.push('final JSON tracker path disagrees with the tracker artifact');
      if (clean(final.report) && resolve(clean(final.report)) !== resolve(reportPath)) errors.push('final JSON report path disagrees with the report artifact');
      if (strictWorkflow) {
        if (String(final.report_num) !== String(reportNum ?? tracker.num)) errors.push('final JSON number disagrees with reserved report number');
        if (!clean(final.report)) errors.push('completed final JSON must include the report path');
        if (final.id !== undefined && String(final.id) !== basename(trackerPath, '.tsv')) errors.push('final JSON job ID disagrees with tracker addition');
        if ((final.pdf !== null) !== (tracker.pdf === '✅')) errors.push('final JSON PDF disagrees with tracker PDF');
        if (final.pdf !== null) {
          const expected = resolve(userRoot || dirname(dirname(reportPath)), 'output', basename(reportPath).replace(/\.md$/, '.pdf'));
          if (resolve(final.pdf) !== expected || !existsSync(expected)) errors.push('primary PDF must exist at the flat report-linked path');
        }
      }
    }
  }

  return { valid: errors.length === 0, repaired, errors, report, tracker };
}

const invokedDirectly = isMainModule(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes('--help')) {
    console.log('Usage: node batch/validate-worker-artifacts.mjs --report PATH --tracker PATH [--final PATH] [--repair] [--strict-workflow] [--user-root PATH] [--report-num N] [--expected-url URL] [--answers-file PATH] [--user USER]');
    process.exit(0);
  }
  try {
    const args = process.argv.slice(2);
    const reportPath = option(args, '--report');
    const trackerPath = option(args, '--tracker');
    const finalPath = option(args, '--final');
    if (!reportPath || !trackerPath) throw new Error('--report and --tracker are required');
    const result = validateWorkerArtifacts({ reportPath, trackerPath, finalPath, repair: args.includes('--repair'), strictWorkflow: args.includes('--strict-workflow'), userRoot: option(args, '--user-root'), reportNum: option(args, '--report-num'), expectedUrl: option(args, '--expected-url'), answersPath: option(args, '--answers-file'), user: option(args, '--user') || process.env.CAREER_OPS_USER });
    if (!result.valid) {
      console.error(result.errors.join('; '));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ status: 'valid', company: result.tracker.company, role: result.tracker.role, via: result.tracker.via || null }));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
