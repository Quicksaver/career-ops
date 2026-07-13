#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { normalizeVia } from '../tracker-parse.mjs';

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
  const parsed = yaml.load(match[1]);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('report Machine Summary is not an object');
  }
  return parsed;
}

export function parseTrackerAddition(content) {
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
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

export function validateWorkerArtifacts({ reportPath, trackerPath, finalPath = null, repair = false }) {
  const report = parseMachineSummary(readFileSync(reportPath, 'utf8'));
  let trackerContent = readFileSync(trackerPath, 'utf8');
  let tracker = parseTrackerAddition(trackerContent);
  let repaired = false;
  const errors = [];
  const reportCompany = clean(report.company);
  const reportRole = clean(report.role);
  const reportVia = clean(report.via);
  const confidential = report.company_confidential;

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
    trackerContent = `${tracker.line}\tvia=${reportVia}\n`;
    writeFileSync(trackerPath, trackerContent, 'utf8');
    tracker = parseTrackerAddition(trackerContent);
    repaired = true;
  }

  if (reportVia && !tracker.via) errors.push(`tracker addition is missing via=${reportVia}`);
  if (!reportVia && tracker.via) errors.push(`tracker Via ${JSON.stringify(tracker.via)} is absent from the Machine Summary`);
  if (reportVia && tracker.via && !sameVia(reportVia, tracker.via)) {
    errors.push(`tracker Via ${JSON.stringify(tracker.via)} disagrees with report Via ${JSON.stringify(reportVia)}`);
  }

  const reportScore = typeof report.score === 'number' ? report.score : Number(report.score);
  const trackerScore = scoreNumber(tracker.score);
  if (Number.isFinite(reportScore) && trackerScore !== null && Math.abs(reportScore - trackerScore) > 0.0001) {
    errors.push(`tracker score ${tracker.score} disagrees with report score ${report.score}`);
  }

  if (finalPath) {
    const final = JSON.parse(readFileSync(finalPath, 'utf8'));
    if (final.status === 'completed') {
      if (clean(final.company) !== reportCompany) errors.push('final JSON company disagrees with Machine Summary');
      if (clean(final.role) !== reportRole) errors.push('final JSON role disagrees with Machine Summary');
      if (!sameVia(final.via, reportVia)) errors.push('final JSON via disagrees with Machine Summary');
      if (final.company_confidential !== confidential) errors.push('final JSON company_confidential disagrees with Machine Summary');
      if (!clean(final.tracker)) errors.push('completed final JSON must include the tracker path');
      if (clean(final.tracker) && basename(clean(final.tracker)) !== basename(trackerPath)) errors.push('final JSON tracker path disagrees with the tracker artifact');
      if (clean(final.report) && resolve(clean(final.report)) !== resolve(reportPath)) errors.push('final JSON report path disagrees with the report artifact');
    }
  }

  return { valid: errors.length === 0, repaired, errors, report, tracker };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = process.argv.slice(2);
    const reportPath = option(args, '--report');
    const trackerPath = option(args, '--tracker');
    const finalPath = option(args, '--final');
    if (!reportPath || !trackerPath) throw new Error('--report and --tracker are required');
    const result = validateWorkerArtifacts({ reportPath, trackerPath, finalPath, repair: args.includes('--repair') });
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
