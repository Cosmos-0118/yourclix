import fs from "node:fs/promises";
import chalk from "chalk";
import boxen from "boxen";
import {
  filterToAncestorRoots,
  pathSizeFast,
} from "../../core/fs-utils.js";
import { confirm } from "../../core/prompt.js";
import { CommandProgress } from "../../core/progress.js";
import { bytesToHuman } from "../../core/format.js";
import type { CleanerOptions, ScanResult } from "../../core/types.js";
import { undoManager } from "../../core/undo-manager.js";
import {
  applyCleanerHeuristics,
  getCleanerHeuristicPolicy,
  type ValidatedDeletionCandidate,
} from "./clean-heuristics.js";
import {
  getSkipReason,
  isSafetySkipReason,
  printSkippedBreakdown,
  printSkippedSummary,
  summarizeSkippedInline,
  type SkipRecord,
} from "./cleaner-skip-ui.js";

function buildSafetyOverrideCandidates(
  safetySkipped: SkipRecord[],
): ValidatedDeletionCandidate[] {
  return safetySkipped
    .filter((entry) => isSafetySkipReason(entry.reason))
    .map((entry) => {
      if (!entry.category) {
        return null;
      }

      return {
        path: entry.path,
        category: entry.category,
        bytes: entry.bytes ?? 0,
        mtimeMs: entry.mtimeMs ?? Date.now(),
      } satisfies ValidatedDeletionCandidate;
    })
    .filter((entry): entry is ValidatedDeletionCandidate => entry !== null);
}

export async function executeCleaner(
  results: ScanResult[],
  options: CleanerOptions,
): Promise<void> {
  const pathToCategory = new Map<string, string>();
  for (const item of results) {
    for (const targetPath of item.paths) {
      if (!pathToCategory.has(targetPath)) {
        pathToCategory.set(targetPath, item.category);
      }
    }
  }

  const rootPaths = filterToAncestorRoots([...pathToCategory.keys()]);
  const targets = rootPaths.map((targetPath) => ({
    path: targetPath,
    category: pathToCategory.get(targetPath)!,
  }));

  if (!targets.length) {
    return;
  }

  const policy = getCleanerHeuristicPolicy(
    options.mode,
    options.olderThanDays ?? 14,
  );

  const scanProgress = new CommandProgress("Cleanup Preflight", 1);
  const { candidates, skipped, safetySkipped } = await scanProgress.step(
    "Validating target paths",
    async () => {
      const validCandidates: ValidatedDeletionCandidate[] = [];
      const skippedTargets: SkipRecord[] = [];

      for (const target of targets) {
        try {
          const stat = await fs.lstat(target.path);
          const bytes = await pathSizeFast(target.path);
          validCandidates.push({
            path: target.path,
            category: target.category,
            bytes,
            mtimeMs: stat.mtimeMs,
          });
        } catch (error) {
          skippedTargets.push({
            path: target.path,
            reason: getSkipReason(error),
          });
        }
      }

      const filtered = applyCleanerHeuristics(validCandidates, policy);
      return {
        candidates: filtered.candidates,
        skipped: [...skippedTargets, ...filtered.skipped],
        safetySkipped: filtered.skipped,
      };
    },
  );

  let selectedCandidates = candidates;
  let usedSafetyOverride = false;
  const overrideCandidates = buildSafetyOverrideCandidates(safetySkipped);

  if (!selectedCandidates.length) {
    if (overrideCandidates.length > 0) {
      console.log(
        chalk.yellow(
          `No paths are eligible under the default safety rules. ` +
            `${overrideCandidates.length} target(s) matched but were held back only by protected-path or age rules; you can approve an override to delete those.`,
        ),
      );
    } else {
      console.log(
        chalk.yellow("No eligible cleanup candidates after safety checks."),
      );
    }
    if (options.verbose) {
      printSkippedBreakdown(skipped);
    } else {
      console.log(chalk.dim(`  ${summarizeSkippedInline(skipped)}`));
    }

    if (overrideCandidates.length === 0) {
      return;
    }

    const overrideApproval = await confirm(
      `Delete ${overrideCandidates.length} path(s) in ${options.mode.toUpperCase()} mode? ` +
        `This overrides automatic safety blocks (protected paths and retention rules). ` +
        `Age rule: older than ${policy.olderThanDays} day(s) where applicable.`,
      Boolean(options.yes),
    );

    if (!overrideApproval) {
      console.log(chalk.yellow("Cancelled."));
      return;
    }

    selectedCandidates = overrideCandidates;
    usedSafetyOverride = true;
  }

  if (!usedSafetyOverride) {
    const approved = await confirm(
      `Delete ${selectedCandidates.length} path(s) in ${options.mode.toUpperCase()} mode? ` +
        `(risky paths must be older than ${policy.olderThanDays} day(s))`,
      Boolean(options.yes),
    );

    if (!approved) {
      console.log(chalk.yellow("Cancelled."));
      return;
    }
  }

  const progress = new CommandProgress("Cleanup Execution", 1);
  let deletedCount = 0;
  let reclaimedBytes = 0;
  let backupId: string | null = null;
  let backupWarnings: string[] = [];

  await progress.step(`Removing ${selectedCandidates.length} valid paths`, async () => {
    if (options.dryRun) {
      deletedCount = selectedCandidates.length;
      reclaimedBytes = selectedCandidates.reduce((sum, c) => sum + c.bytes, 0);
    } else {
      const candidatePaths = selectedCandidates.map((c) => c.path);
      const { metadata, warnings } = await undoManager.createBackup(
        candidatePaths,
        "clean",
        [options.mode],
      );
      backupId = metadata.id;
      deletedCount = metadata.filesCount;
      reclaimedBytes = metadata.byteSize;
      backupWarnings = warnings;
    }
  });

  const skippedCount = skipped.length;
  const actionWord = options.dryRun ? "Would remove" : "Removed";
  const reclaimedLabel = options.dryRun ? "Potential reclaim" : "Reclaimed";

  const summaryBody = [
    chalk.bold.white(`${actionWord}: ${deletedCount} path(s)`),
    chalk.gray(`Not deleted (skipped earlier): ${skippedCount} path(s)`),
    chalk.gray(
      `Retention policy: risky targets older than ${policy.olderThanDays} day(s)`,
    ),
    "",
    chalk.cyan.bold(`${reclaimedLabel}: ${bytesToHuman(reclaimedBytes)}`),
  ];

  if (backupId && !options.dryRun) {
    summaryBody.push(
      "",
      chalk.green(`Backup: ~/.your-backups/${backupId}`),
      chalk.dim(`Undo: your undo restore ${backupId}`),
    );
  }

  console.log(
    boxen(summaryBody.join("\n"), {
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      margin: { top: 1, bottom: 0 },
      borderStyle: "round",
      borderColor: options.dryRun ? "blue" : "green",
      title: options.dryRun ? "Dry run" : "Cleanup complete",
    }),
  );

  printSkippedSummary(skipped, Boolean(options.verbose));

  if (backupWarnings.length > 0) {
    console.log(
      boxen(
        [
          chalk.yellow.bold("Warnings"),
          "",
          ...backupWarnings.map((w) => chalk.yellow(`• ${w}`)),
        ].join("\n"),
        {
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          margin: { top: 1, bottom: 0 },
          borderStyle: "round",
          borderColor: "yellow",
        },
      ),
    );
  }
}
