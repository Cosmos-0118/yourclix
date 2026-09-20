import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import {
  filterToAncestorRoots,
  pathSizesFast,
} from "../../core/fs-utils.js";
import { confirmAction } from "../../core/task-ui.js";
import { CommandProgress } from "../../core/progress.js";
import { bytesToHuman, pluralize } from "../../core/format.js";
import type { CleanerOptions, ScanResult } from "../../core/types.js";
import { undoManager } from "../../core/undo-manager.js";
import { getProjectArtifactSkipReason } from "./cleaner-project-guard.js";
import {
  applyCleanerHeuristics,
  getCleanerHeuristicSkipReason,
  getCleanerHeuristicPolicy,
  type ValidatedDeletionCandidate,
} from "./clean-heuristics.js";
import {
  getSkipReason,
  printSkippedBreakdown,
  printSkippedSummary,
  summarizeSkippedInline,
  type SkipRecord,
} from "./cleaner-skip-ui.js";

export interface PreflightOutcome {
  candidates: ValidatedDeletionCandidate[];
  skipped: SkipRecord[];
  eligibleBytes: number;
  policy: ReturnType<typeof getCleanerHeuristicPolicy>;
}

/**
 * Pure preflight: resolves scan results into eligible deletion candidates
 * plus skip records, with no console output and no prompting. Shared by the
 * plain `executeCleaner` orchestrator and the interactive TUI dashboard.
 */
export async function preflightCleaner(
  results: ScanResult[],
  options: Pick<CleanerOptions, "mode" | "olderThanDays">,
): Promise<PreflightOutcome | null> {
  const pathToCategory = new Map<string, string>();
  for (const item of results) {
    for (const targetPath of item.paths) {
      if (!pathToCategory.has(targetPath)) {
        pathToCategory.set(targetPath, item.category);
      }
    }
  }

  const rootPaths = filterToAncestorRoots([...pathToCategory.keys()]);
  const normalizedPathToCategory = new Map(
    [...pathToCategory.entries()].map(([targetPath, category]) => [
      path.normalize(targetPath),
      category,
    ]),
  );
  const targets = rootPaths
    .map((targetPath) => ({
      path: targetPath,
      category: normalizedPathToCategory.get(path.normalize(targetPath)),
    }))
    .filter(
      (target): target is { path: string; category: string } =>
        Boolean(target.category),
    );

  if (!targets.length) {
    return null;
  }

  const policy = getCleanerHeuristicPolicy(
    options.mode,
    options.olderThanDays ?? 14,
  );

  const validCandidatesWithoutSizes: ValidatedDeletionCandidate[] = [];
  const skippedTargets: SkipRecord[] = [];

  for (const target of targets) {
    try {
      const stat = await fs.lstat(target.path);

      if (target.category === "Developer Project Junk") {
        const projectSkipReason = await getProjectArtifactSkipReason(
          target.path,
        );
        if (projectSkipReason) {
          skippedTargets.push({
            path: target.path,
            reason: projectSkipReason,
            category: target.category,
            bytes: 0,
            mtimeMs: stat.mtimeMs,
          });
          continue;
        }
      }

      const candidateWithoutSize = {
        path: target.path,
        category: target.category,
        bytes: 0,
        mtimeMs: stat.mtimeMs,
      } satisfies ValidatedDeletionCandidate;
      const heuristicSkipReason = getCleanerHeuristicSkipReason(
        candidateWithoutSize,
        policy,
      );
      if (heuristicSkipReason) {
        skippedTargets.push({
          ...candidateWithoutSize,
          reason: heuristicSkipReason,
        });
        continue;
      }

      validCandidatesWithoutSizes.push(candidateWithoutSize);
    } catch (error) {
      skippedTargets.push({
        path: target.path,
        reason: getSkipReason(error),
      });
    }
  }

  const sizes = await pathSizesFast(
    validCandidatesWithoutSizes.map((candidate) => candidate.path),
  );
  const validCandidates = validCandidatesWithoutSizes.map((candidate) => ({
    ...candidate,
    bytes: sizes.get(path.normalize(candidate.path)) ?? 0,
  }));
  const filtered = applyCleanerHeuristics(validCandidates, policy);
  const candidates = filtered.candidates;
  const skipped = [...skippedTargets, ...filtered.skipped];
  const eligibleBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);

  return { candidates, skipped, eligibleBytes, policy };
}

export interface BackupOutcome {
  deletedCount: number;
  reclaimedBytes: number;
  backupId: string | null;
  backupWarnings: string[];
}

/**
 * Pure backup execution: moves candidates into the undo backup (or simulates
 * it for `--dry-run`), with no console output. Shared by the plain
 * `executeCleaner` orchestrator and the interactive TUI dashboard.
 */
export async function runCleanerBackup(
  candidates: ValidatedDeletionCandidate[],
  options: Pick<CleanerOptions, "mode" | "dryRun">,
): Promise<BackupOutcome> {
  if (options.dryRun) {
    return {
      deletedCount: candidates.length,
      reclaimedBytes: candidates.reduce((sum, c) => sum + c.bytes, 0),
      backupId: null,
      backupWarnings: [],
    };
  }

  const candidatePaths = candidates.map((c) => c.path);
  const { metadata, warnings } = await undoManager.createBackup(
    candidatePaths,
    "clean",
    [options.mode],
  );

  return {
    deletedCount: metadata.filesCount,
    reclaimedBytes: metadata.byteSize,
    backupId: metadata.id,
    backupWarnings: warnings,
  };
}

export function buildCleanupSummaryPanel(
  outcome: BackupOutcome,
  skippedCount: number,
  policy: { olderThanDays: number },
  dryRun: boolean,
): { title: string; body: string[] } {
  const actionWord = dryRun ? "Would remove" : "Moved to undo backup";
  const reclaimedLabel = dryRun ? "Potential reclaim" : "Backup size";

  const summaryBody = [
    chalk.bold.white(`${actionWord}: ${pluralize(outcome.deletedCount, "path")}`),
    chalk.gray(`Skipped by safety checks: ${pluralize(skippedCount, "path")}`),
    chalk.gray(`Retention: targets must be older than ${policy.olderThanDays} days`),
    "",
    chalk.cyan.bold(`${reclaimedLabel}: ${bytesToHuman(outcome.reclaimedBytes)}`),
  ];

  if (!dryRun && outcome.backupId) {
    summaryBody.push(
      chalk.yellow("Disk space is not freed until this undo backup is pruned."),
    );
    summaryBody.push(
      "",
      chalk.green(`Backup: ~/.your-backups/${outcome.backupId}`),
      chalk.dim(`Undo: your undo restore ${outcome.backupId}`),
    );
  }

  return { title: dryRun ? "Dry run" : "Cleanup complete", body: summaryBody };
}

export async function executeCleaner(
  results: ScanResult[],
  options: CleanerOptions,
): Promise<void> {
  const scanProgress = new CommandProgress("Cleanup Preflight", 1);
  const outcome = await scanProgress.step("Validating target paths", () =>
    preflightCleaner(results, options),
  );

  if (!outcome) {
    return;
  }

  const { candidates, skipped, eligibleBytes, policy } = outcome;

  console.log(chalk.cyan(
    `Eligible after safety checks: ${pluralize(candidates.length, "path")}, ${bytesToHuman(eligibleBytes)}`,
  ));

  if (!candidates.length) {
    console.log(chalk.yellow("No eligible cleanup candidates after safety checks."));
    if (options.verbose) {
      printSkippedBreakdown(skipped);
    } else {
      console.log(chalk.dim(summarizeSkippedInline(skipped)));
    }
    return;
  }

  console.log(
    chalk.dim(`Retention policy: targets must be older than ${policy.olderThanDays} days.`),
  );
  const approved = await confirmAction(
    `Move ${pluralize(candidates.length, "path")} to the undo backup in ${options.mode.toUpperCase()} mode?`,
    Boolean(options.yes),
  );

  if (!approved) {
    console.log(chalk.yellow("Cancelled."));
    return;
  }

  const progress = new CommandProgress("Cleanup Execution", 1);
  const backupOutcome = await progress.step(
    `Moving ${candidates.length} valid paths to undo backup`,
    () => runCleanerBackup(candidates, options),
  );

  const { title, body } = buildCleanupSummaryPanel(
    backupOutcome,
    skipped.length,
    policy,
    Boolean(options.dryRun),
  );
  const headingColor = options.dryRun ? chalk.blue : chalk.green;
  console.log(headingColor.bold(title));
  console.log(body.join("\n"));

  printSkippedSummary(skipped, Boolean(options.verbose));

  if (backupOutcome.backupWarnings.length > 0) {
    console.log(chalk.yellow.bold("Warnings"));
    console.log(backupOutcome.backupWarnings.map((w) => chalk.yellow(`• ${w}`)).join("\n"));
  }
}
