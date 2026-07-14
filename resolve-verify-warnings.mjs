#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'fs';
import { basename, dirname, extname, join, relative, sep } from 'path';
import {
  getUserContext,
  printUserContextErrorAndExit,
  userPath,
} from './lib/user-context.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import {
  acquireTrackerLock,
  canonicalizeTrackerPath,
  cell,
  rebuildRow,
  trackerLockDirFor,
  writeFileAtomic,
} from './tracker-utils.mjs';
import { normalizeReportLink } from './tracker-links.mjs';
import {
  mostAdvancedDuplicateRow,
  statusUsesGeneratedArtifacts,
} from './lib/duplicate-lifecycle.mjs';

const HELP = `Apply validated duplicate resolutions from reviewed verification.

Usage: node resolve-verify-warnings.mjs --user <id> \\
  --verification <verify.json> --triage <triage.json> [--json]

Only confirmed possible_duplicate_tracker and duplicate_reports_same_role
decisions can mutate data. Every other finding remains owned by the reviewed
verification coordinator.`;

let context;
try {
  context = getUserContext(process.argv.slice(2));
} catch (error) {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    console.log(HELP);
    process.exit(0);
  }
  printUserContextErrorAndExit(error);
}

if (context.args.includes('-h') || context.args.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}

function optionValue(name) {
  const index = context.args.indexOf(name);
  if (index < 0 || !context.args[index + 1] || context.args[index + 1].startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return context.args[index + 1];
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new Error(`Cannot parse ${label} (${path}): ${error.message}`);
  }
}

function sameMembers(left, right) {
  const a = [...left].sort((x, y) => String(x).localeCompare(String(y)));
  const b = [...right].sort((x, y) => String(x).localeCompare(String(y)));
  return a.length === b.length && a.every((value, index) => String(value) === String(b[index]));
}

function reportTarget(reportCell) {
  const match = String(reportCell || '').match(/\]\(([^)]+)\)/);
  return match ? basename(match[1]) : null;
}

function reportNumber(file) {
  const match = basename(file).match(/^(\d+)-/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function appendNote(base, additions) {
  return cell([base, ...additions].filter(Boolean).join(' | '));
}

function promotedPdfCell(sourceCell, keeperStem, appsPath, outputRoot, sourcePdfExists) {
  const source = String(sourceCell || '');
  const match = source.match(/^\[([^\]]+)\]\(([^)]+\.pdf)\)$/i);
  if (!match && !sourcePdfExists) return source;
  const target = relative(dirname(appsPath), join(outputRoot, `${keeperStem}.pdf`)).split(sep).join('/');
  return `[${match?.[1] || 'PDF'}](${target})`;
}

async function main() {
  const verificationPath = optionValue('--verification');
  const triagePath = optionValue('--triage');
  const verification = readJson(verificationPath, 'verification JSON');
  const triage = readJson(triagePath, 'triage JSON');
  const warningMap = new Map((verification.warnings || []).map(warning => [warning.id, warning]));
  const decisions = Array.isArray(triage.warnings) ? triage.warnings : [];
  const duplicateDecisions = decisions.filter(item => item.classification === 'confirmed_duplicate');

  const trackerPlans = [];
  const reportPlans = [];
  const seenTrackers = new Set();
  const seenReports = new Set();

  for (const decision of duplicateDecisions) {
    const warning = warningMap.get(decision.warning_id);
    if (!warning) throw new Error(`Duplicate decision references unknown warning ${decision.warning_id}`);
    if (warning.code !== decision.warning_code) {
      throw new Error(`${decision.warning_id}: warning_code does not match deterministic verification`);
    }
    const resolution = decision.duplicate_resolution;
    if (!resolution || typeof resolution !== 'object') {
      throw new Error(`${decision.warning_id}: confirmed_duplicate requires duplicate_resolution`);
    }

    if (warning.code === 'possible_duplicate_tracker') {
      if (resolution.keeper_report_file !== null || resolution.duplicate_report_files.length !== 0) {
        throw new Error(`${decision.warning_id}: tracker warning cannot resolve report files`);
      }
      const candidates = warning.details?.tracker_nums || [];
      const chosen = [resolution.keeper_tracker_num, ...resolution.duplicate_tracker_nums];
      if (!Number.isInteger(resolution.keeper_tracker_num) || resolution.duplicate_tracker_nums.length === 0 ||
          !sameMembers(candidates, chosen)) {
        throw new Error(`${decision.warning_id}: tracker resolution must partition the exact warning candidates`);
      }
      for (const num of chosen) {
        if (seenTrackers.has(num)) throw new Error(`Tracker #${num} appears in more than one duplicate resolution`);
        seenTrackers.add(num);
      }
      trackerPlans.push({ warning, decision, resolution });
      continue;
    }

    if (warning.code === 'duplicate_reports_same_role') {
      if (resolution.keeper_tracker_num !== null || resolution.duplicate_tracker_nums.length !== 0) {
        throw new Error(`${decision.warning_id}: report warning cannot resolve tracker rows`);
      }
      const candidates = warning.details?.files || [];
      const chosen = [resolution.keeper_report_file, ...resolution.duplicate_report_files];
      if (!resolution.keeper_report_file || resolution.duplicate_report_files.length === 0 ||
          !sameMembers(candidates, chosen)) {
        throw new Error(`${decision.warning_id}: report resolution must partition the exact warning candidates`);
      }
      for (const file of chosen) {
        if (!/^reports\/[A-Za-z0-9._-]+\.md$/.test(file)) {
          throw new Error(`${decision.warning_id}: invalid report path ${file}`);
        }
        if (seenReports.has(file)) throw new Error(`${file} appears in more than one duplicate resolution`);
        seenReports.add(file);
      }
      reportPlans.push({ warning, decision, resolution });
      continue;
    }

    throw new Error(`${decision.warning_id}: ${warning.code} is never auto-remediable`);
  }

  if (duplicateDecisions.length === 0) {
    return {
      status: 'completed', duplicate_groups: 0, tracker_rows_removed: 0,
      reports_archived: 0, reports_promoted: 0,
      artifacts_archived: 0, artifacts_promoted: 0, ledger: null,
    };
  }

  const appsPath = canonicalizeTrackerPath(userPath(context, 'data/applications.md'));
  if (!existsSync(appsPath)) throw new Error('applications.md is missing');
  const reportsRoot = userPath(context, 'reports');
  const outputRootPath = userPath(context, 'output');
  const outputRoot = existsSync(outputRootPath) ? realpathSync(outputRootPath) : outputRootPath;
  const originalTracker = readFileSync(appsPath, 'utf-8');
  const lines = originalTracker.split('\n');
  const colmap = resolveColumns(lines);
  const trackerRows = new Map();
  for (let index = 0; index < lines.length; index++) {
    const row = parseTrackerRow(lines[index], colmap);
    if (!row) continue;
    if (trackerRows.has(row.num)) throw new Error(`Tracker number #${row.num} is not unique; deterministic verification must be repaired first`);
    trackerRows.set(row.num, { ...row, index });
  }

  for (const plan of trackerPlans) {
    for (const num of [plan.resolution.keeper_tracker_num, ...plan.resolution.duplicate_tracker_nums]) {
      if (!trackerRows.has(num)) throw new Error(`${plan.warning.id}: tracker #${num} no longer exists`);
    }
  }

  // A confirmed duplicate tracker row can carry its own report even when the
  // report-title heuristic did not emit a separate duplicate-report warning.
  // Archive that losing report as a deterministic consequence of removing the
  // row, using the model-selected tracker keeper as the canonical identity.
  const explicitlyResolvedReports = new Set(reportPlans.flatMap(plan => [
    plan.resolution.keeper_report_file,
    ...plan.resolution.duplicate_report_files,
  ]));
  const implicitlyResolvedReports = new Set();
  for (const plan of trackerPlans) {
    const keeperRow = trackerRows.get(plan.resolution.keeper_tracker_num);
    const keeperName = reportTarget(keeperRow.report);
    if (!keeperName) continue;
    const trackerReportNames = new Set([
      keeperName,
      ...plan.resolution.duplicate_tracker_nums
        .map(num => reportTarget(trackerRows.get(num).report))
        .filter(Boolean),
    ]);
    const explicitOverlap = reportPlans.find(reportPlan =>
      [reportPlan.resolution.keeper_report_file, ...reportPlan.resolution.duplicate_report_files]
        .map(file => file?.split('/').pop())
        .filter(Boolean)
        .some(name => trackerReportNames.has(name)));
    if (explicitOverlap && basename(explicitOverlap.resolution.keeper_report_file) !== keeperName) {
      throw new Error(`${plan.warning.id}: report keeper must match model-selected tracker keeper #${keeperRow.num}`);
    }
    const duplicates = plan.resolution.duplicate_tracker_nums
      .map(num => reportTarget(trackerRows.get(num).report))
      .filter(name => name && name !== keeperName)
      .map(name => `reports/${name}`)
      .filter(file => !explicitlyResolvedReports.has(file) && !implicitlyResolvedReports.has(file));
    if (duplicates.length === 0) continue;
    for (const file of duplicates) implicitlyResolvedReports.add(file);
    reportPlans.push({
      warning: plan.warning,
      decision: plan.decision,
      derived: true,
      resolution: {
        keeper_tracker_num: null,
        duplicate_tracker_nums: [],
        keeper_report_file: `reports/${keeperName}`,
        duplicate_report_files: duplicates,
      },
    });
  }

  const artifactPromotions = [];
  for (const plan of trackerPlans) {
    const keeperRow = trackerRows.get(plan.resolution.keeper_tracker_num);
    const candidateRows = [
      keeperRow,
      ...plan.resolution.duplicate_tracker_nums.map(num => trackerRows.get(num)),
    ];
    const lifecycleSource = mostAdvancedDuplicateRow(candidateRows, keeperRow.num);
    plan.lifecycleSource = lifecycleSource;
    if (!lifecycleSource || lifecycleSource.num === keeperRow.num ||
        !statusUsesGeneratedArtifacts(lifecycleSource.status)) continue;
    const keeperFile = reportTarget(keeperRow.report);
    const sourceFile = reportTarget(lifecycleSource.report);
    if (!keeperFile || !sourceFile || keeperFile === sourceFile) continue;
    const reportPlan = reportPlans.find(candidate =>
      basename(candidate.resolution.keeper_report_file) === keeperFile &&
      candidate.resolution.duplicate_report_files.some(file => basename(file) === sourceFile));
    if (!reportPlan) {
      throw new Error(`${plan.warning.id}: used tracker #${lifecycleSource.num} report cannot be promoted into keeper #${keeperRow.num}`);
    }
    const keeperStem = keeperFile.slice(0, -extname(keeperFile).length);
    const sourceStem = sourceFile.slice(0, -extname(sourceFile).length);
    const promotion = {
      warning_id: plan.warning.id,
      keeper_tracker_num: keeperRow.num,
      source_tracker_num: lifecycleSource.num,
      preserved_status: lifecycleSource.status,
      keeper_report_file: `reports/${keeperFile}`,
      source_report_file: `reports/${sourceFile}`,
      keeper_stem: keeperStem,
      source_stem: sourceStem,
      source_pdf_exists: existsSync(join(outputRoot, `${sourceStem}.pdf`)),
    };
    artifactPromotions.push(promotion);
    reportPlan.promotions = [...(reportPlan.promotions || []), promotion];
    plan.artifactPromotion = promotion;
  }

  for (const plan of reportPlans) {
    for (const file of [plan.resolution.keeper_report_file, ...plan.resolution.duplicate_report_files]) {
      if (!existsSync(join(context.userRoot, file))) throw new Error(`${plan.warning.id}: ${file} no longer exists`);
    }
  }

  const lock = await acquireTrackerLock(trackerLockDirFor(appsPath), { tracker: appsPath });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = userPath(context, `data/warning-triage-backups/${stamp}`);
  const reportArchiveRoot = userPath(context, `reports/duplicates/${stamp}`);
  const outputArchiveRoot = userPath(context, `output/duplicates/${stamp}`);
  const moved = [];
  let trackerRowsRemoved = 0;
  let reportsArchived = 0;
  let reportsPromoted = 0;
  let artifactsArchived = 0;
  let artifactsPromoted = 0;

  try {
    mkdirSync(backupRoot, { recursive: true });
    copyFileSync(appsPath, join(backupRoot, 'applications.md'));
    const removeIndices = new Set();

    for (const plan of trackerPlans) {
      const keeper = trackerRows.get(plan.resolution.keeper_tracker_num);
      const duplicates = plan.resolution.duplicate_tracker_nums.map(num => trackerRows.get(num));
      const bestStatus = plan.lifecycleSource.status;
      const parts = lines[keeper.index].split('|').map(value => value.trim());
      parts[colmap.status] = bestStatus;
      if (colmap.pdf != null && plan.artifactPromotion?.source_pdf_exists) {
        parts[colmap.pdf] = promotedPdfCell(
          plan.lifecycleSource.pdf,
          plan.artifactPromotion.keeper_stem,
          appsPath,
          outputRoot,
          true,
        );
      }
      const mergedNotes = duplicates.flatMap(row => {
        const marker = `Deduplicated tracker #${row.num} into #${keeper.num} (${stamp.slice(0, 10)})`;
        return row.notes ? [marker, `#${row.num} notes: ${row.notes}`] : [marker];
      });
      if (colmap.notes != null) parts[colmap.notes] = appendNote(parts[colmap.notes], mergedNotes);
      lines[keeper.index] = rebuildRow(parts);
      for (const duplicate of duplicates) removeIndices.add(duplicate.index);
      trackerRowsRemoved += duplicates.length;
    }

    for (const plan of reportPlans) {
      const keeperFile = basename(plan.resolution.keeper_report_file);
      const keeperNum = reportNumber(keeperFile);
      if (!keeperNum) throw new Error(`${plan.warning.id}: keeper report has no numeric prefix`);
      for (const duplicateRelative of plan.resolution.duplicate_report_files) {
        const duplicateFile = basename(duplicateRelative);
        const promotion = (plan.promotions || []).find(item => basename(item.source_report_file) === duplicateFile);
        for (let index = 0; index < lines.length; index++) {
          if (removeIndices.has(index)) continue;
          const row = parseTrackerRow(lines[index], colmap);
          if (!row || reportTarget(row.report) !== duplicateFile) continue;
          const parts = lines[index].split('|').map(value => value.trim());
          parts[colmap.report] = normalizeReportLink(
            `[${keeperNum}](reports/${keeperFile})`,
            dirname(appsPath),
            context.userRoot,
          );
          if (colmap.notes != null) {
            parts[colmap.notes] = appendNote(parts[colmap.notes], [`Report ${duplicateFile} deduplicated into ${keeperFile}`]);
          }
          lines[index] = rebuildRow(parts);
        }

        if (promotion) {
          const keeperReport = join(reportsRoot, keeperFile);
          const sourceReport = join(reportsRoot, duplicateFile);
          const backupReportDir = join(backupRoot, 'reports');
          mkdirSync(backupReportDir, { recursive: true });
          const backupKeeperReport = join(backupReportDir, keeperFile);
          const backupSourceReport = join(backupReportDir, duplicateFile);
          copyFileSync(keeperReport, backupKeeperReport);
          copyFileSync(sourceReport, backupSourceReport);
          mkdirSync(reportArchiveRoot, { recursive: true });
          const archivedKeeperReport = join(reportArchiveRoot, keeperFile);
          renameSync(keeperReport, archivedKeeperReport);
          moved.push({ from: keeperReport, to: archivedKeeperReport, backup: backupKeeperReport });
          const marker = `<!-- career-ops superseded_by_used_duplicate: reports/${keeperFile}; source_report: reports/${duplicateFile}; warning_id: ${plan.warning.id}; resolved_at: ${new Date().toISOString()} -->\n`;
          writeFileAtomic(archivedKeeperReport, marker + readFileSync(archivedKeeperReport, 'utf-8'));
          renameSync(sourceReport, keeperReport);
          moved.push({ from: sourceReport, to: keeperReport, backup: backupSourceReport });
          reportsArchived++;
          reportsPromoted++;

          for (const extension of ['.html', '.pdf']) {
            const sourceArtifact = join(outputRoot, `${promotion.source_stem}${extension}`);
            if (!existsSync(sourceArtifact)) continue;
            const keeperArtifact = join(outputRoot, `${promotion.keeper_stem}${extension}`);
            const backupOutputDir = join(backupRoot, 'output');
            mkdirSync(backupOutputDir, { recursive: true });
            const backupSourceArtifact = join(backupOutputDir, basename(sourceArtifact));
            copyFileSync(sourceArtifact, backupSourceArtifact);
            if (existsSync(keeperArtifact)) {
              const backupKeeperArtifact = join(backupOutputDir, basename(keeperArtifact));
              copyFileSync(keeperArtifact, backupKeeperArtifact);
              mkdirSync(outputArchiveRoot, { recursive: true });
              const archivedKeeperArtifact = join(outputArchiveRoot, basename(keeperArtifact));
              renameSync(keeperArtifact, archivedKeeperArtifact);
              moved.push({ from: keeperArtifact, to: archivedKeeperArtifact, backup: backupKeeperArtifact });
              artifactsArchived++;
            }
            renameSync(sourceArtifact, keeperArtifact);
            moved.push({ from: sourceArtifact, to: keeperArtifact, backup: backupSourceArtifact });
            artifactsPromoted++;
          }
          continue;
        }

        const sourceReport = join(reportsRoot, duplicateFile);
        const backupReportDir = join(backupRoot, 'reports');
        mkdirSync(backupReportDir, { recursive: true });
        const backupReport = join(backupReportDir, duplicateFile);
        copyFileSync(sourceReport, backupReport);
        mkdirSync(reportArchiveRoot, { recursive: true });
        const archivedReport = join(reportArchiveRoot, duplicateFile);
        renameSync(sourceReport, archivedReport);
        moved.push({ from: sourceReport, to: archivedReport, backup: backupReport });
        const marker = `<!-- career-ops duplicate_of: reports/${keeperFile}; warning_id: ${plan.warning.id}; resolved_at: ${new Date().toISOString()} -->\n`;
        writeFileAtomic(archivedReport, marker + readFileSync(archivedReport, 'utf-8'));
        reportsArchived++;

        const stem = duplicateFile.slice(0, -extname(duplicateFile).length);
        for (const extension of ['.html', '.pdf']) {
          const sourceArtifact = join(outputRoot, `${stem}${extension}`);
          if (!existsSync(sourceArtifact)) continue;
          const backupOutputDir = join(backupRoot, 'output');
          mkdirSync(backupOutputDir, { recursive: true });
          const backupArtifact = join(backupOutputDir, basename(sourceArtifact));
          copyFileSync(sourceArtifact, backupArtifact);
          mkdirSync(outputArchiveRoot, { recursive: true });
          const archivedArtifact = join(outputArchiveRoot, basename(sourceArtifact));
          renameSync(sourceArtifact, archivedArtifact);
          moved.push({ from: sourceArtifact, to: archivedArtifact, backup: backupArtifact });
          artifactsArchived++;
        }
      }
    }

    const repairedLines = lines.filter((_, index) => !removeIndices.has(index));
    writeFileAtomic(appsPath, repairedLines.join('\n'));

    const ledgerPath = userPath(context, 'data/duplicate-resolutions.jsonl');
    const resolvedAt = new Date().toISOString();
    const ledgerLines = [
      ...trackerPlans.map(plan => JSON.stringify({
        resolved_at: resolvedAt,
        action: 'tracker_dedup',
        warning_id: plan.warning.id,
        warning_code: plan.warning.code,
        keeper_tracker_num: plan.resolution.keeper_tracker_num,
        duplicate_tracker_nums: plan.resolution.duplicate_tracker_nums,
        lifecycle_source_tracker_num: plan.lifecycleSource.num,
        lifecycle_status_preserved: plan.lifecycleSource.status,
        used_artifacts_promoted: Boolean(plan.artifactPromotion),
        rationale: plan.decision.rationale,
        evidence: plan.decision.evidence,
        backup_root: backupRoot,
      })),
      ...artifactPromotions.map(promotion => JSON.stringify({
        resolved_at: resolvedAt,
        action: 'promote_used_duplicate_artifacts',
        warning_id: promotion.warning_id,
        keeper_tracker_num: promotion.keeper_tracker_num,
        source_tracker_num: promotion.source_tracker_num,
        preserved_status: promotion.preserved_status,
        keeper_report_file: promotion.keeper_report_file,
        source_report_file: promotion.source_report_file,
        backup_root: backupRoot,
      })),
      ...reportPlans.map(plan => JSON.stringify({
        resolved_at: resolvedAt,
        action: 'report_dedup',
        derived_from_tracker_resolution: Boolean(plan.derived),
        warning_id: plan.warning.id,
        warning_code: plan.warning.code,
        keeper_report_file: plan.resolution.keeper_report_file,
        duplicate_report_files: plan.resolution.duplicate_report_files,
        rationale: plan.decision.rationale,
        evidence: plan.decision.evidence,
        backup_root: backupRoot,
      })),
    ];
    const existingLedger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf-8').replace(/\s*$/, '\n') : '';
    writeFileAtomic(ledgerPath, existingLedger + ledgerLines.join('\n') + '\n');

    return {
      status: 'completed',
      duplicate_groups: duplicateDecisions.length,
      tracker_rows_removed: trackerRowsRemoved,
      reports_archived: reportsArchived,
      reports_promoted: reportsPromoted,
      artifacts_archived: artifactsArchived,
      artifacts_promoted: artifactsPromoted,
      ledger: ledgerPath,
      backup: backupRoot,
    };
  } catch (error) {
    writeFileAtomic(appsPath, originalTracker);
    for (const item of moved.reverse()) {
      try {
        if (existsSync(item.to)) {
          mkdirSync(dirname(item.from), { recursive: true });
          rmSync(item.from, { force: true });
          renameSync(item.to, item.from);
          if (item.backup && existsSync(item.backup)) copyFileSync(item.backup, item.from);
        }
      } catch {}
    }
    throw error;
  } finally {
    lock.release();
  }
}

try {
  const result = await main();
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
