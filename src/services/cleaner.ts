import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import fg from "fast-glob";
import { bytesToHuman, pad } from "../core/format.js";
import { CommandProgress } from "../core/progress.js";
import {
  pathSizeFast,
  removePath,
  sumPathSizesFast,
} from "../core/fs-utils.js";
import { getCleanerScanCategories } from "../managers/clean-scan-manager.js";
import { confirm } from "../core/prompt.js";
import type { CleanerOptions, ScanResult } from "../core/types.js";
import {
  applyCleanerHeuristics,
  getCleanerHeuristicPolicy,
  type HeuristicSkipRecord,
  type ValidatedDeletionCandidate,
} from "./clean-heuristics.js";
import { undoManager } from "../core/undo-manager.js";

interface DeletionCandidate {
  path: string;
  bytes: number;
  category: string;
  mtimeMs: number;
}

type SkipRecord = HeuristicSkipRecord;

export async function scanCleanerTargets(
  mode: CleanerOptions["mode"],
): Promise<ScanResult[]> {
  const eligible = getCleanerScanCategories(mode);

  const progress = new CommandProgress(
    `Cleaner Scan (${mode.toUpperCase()})`,
    eligible.length,
  );

  const results: ScanResult[] = [];
  for (const target of eligible) {
    const result = await progress.step(
      `Scanning ${target.category}`,
      async () => {
        const matches = await fg(target.globs, {
          dot: true,
          onlyFiles: false,
          onlyDirectories: false,
          unique: true,
          suppressErrors: true,
        });

        const distinct = [...new Set(matches)];
        const bytes = await sumPathSizesFast(distinct, 12);

        return {
          category: target.category,
          paths: distinct,
          bytes,
        } satisfies ScanResult;
      },
    );

    if (result.paths.length > 0) {
      progress.info(
        `${result.category}: ${bytesToHuman(result.bytes)} across ${result.paths.length} paths`,
      );
      if (result.paths.length > 2000) {
        progress.info(
          `${result.category}: large result set detected (${result.paths.length} paths).`,
        );
      }
      results.push(result);
    } else {
      progress.info(`${result.category}: no cleanup candidates`);
    }
  }

  return results;
}

export function printCleanerResults(results: ScanResult[]): void {
  if (!results.length) {
    console.log(chalk.green("No cleanup candidates found."));
    return;
  }

  console.log(chalk.bold("Cleanup scan results"));
  for (const result of results) {
    console.log(
      `- ${pad(result.category, 20)} ${bytesToHuman(result.bytes)} (${result.paths.length} paths)`,
    );
  }

  const total = results.reduce((sum, item) => sum + item.bytes, 0);
  console.log(chalk.cyan(`Estimated reclaimable: ${bytesToHuman(total)}`));
}

export async function executeCleaner(
  results: ScanResult[],
  options: CleanerOptions,
): Promise<void> {
  const targets = results.flatMap((item) =>
    item.paths.map((targetPath) => ({
      path: targetPath,
      category: item.category,
    })),
  );

  if (!targets.length) {
    return;
  }

  const policy = getCleanerHeuristicPolicy(
    options.mode,
    options.olderThanDays ?? 14,
  );

  const scanProgress = new CommandProgress("Cleanup Preflight", 1);
  const { candidates, skipped } = await scanProgress.step(
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
      };
    },
  );

  if (!candidates.length) {
    console.log(
      chalk.yellow("No eligible cleanup candidates after safety checks."),
    );
    printSkippedDetails(skipped);
    return;
  }

  const approved = await confirm(
    `Delete ${candidates.length} paths in ${options.mode.toUpperCase()} mode? ` +
      `(risky paths must be older than ${policy.olderThanDays} day(s))`,
    Boolean(options.yes),
  );

  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  const progress = new CommandProgress("Cleanup Execution", 1);
  let deletedCount = 0;
  let reclaimedBytes = 0;
  let backupId: string | null = null;

  await progress.step(`Removing ${candidates.length} valid paths`, async () => {
    if (options.dryRun) {
      // In dry-run, just simulate deletion
      deletedCount = candidates.length;
      reclaimedBytes = candidates.reduce((sum, c) => sum + c.bytes, 0);
    } else {
      // Create backup of all files to be deleted
      const candidatePaths = candidates.map((c) => c.path);
      const backup = await undoManager.createBackup(
        candidatePaths,
        "clean",
        [options.mode],
      );
      backupId = backup.id;

      // All files were successfully moved to backup
      deletedCount = backup.filesCount;
      reclaimedBytes = backup.byteSize;
    }
  });

  const skippedCount = skipped.length;
  const actionWord = options.dryRun ? "Would remove" : "Removed";
  const reclaimedLabel = options.dryRun ? "Potential reclaim" : "Reclaimed";

  console.log(chalk.bold("Cleanup summary"));
  console.log(chalk.green(`- ${actionWord}: ${deletedCount} paths`));
  console.log(chalk.yellow(`- Skipped: ${skippedCount} paths`));
  console.log(
    chalk.cyan(
      `- Retention gate: risky targets older than ${policy.olderThanDays} day(s)`,
    ),
  );
  console.log(
    chalk.cyan(`- ${reclaimedLabel}: ${bytesToHuman(reclaimedBytes)}`),
  );

  if (backupId && !options.dryRun) {
    console.log(
      chalk.green(
        `\n✓ Files backed up to: ~/.your-backups/${backupId}`,
      ),
    );
    console.log(chalk.dim(`  Restore with: your undo restore ${backupId}`));
  }

  printSkippedDetails(skipped);
}

function getSkipReason(error: unknown): string {
  const err = error as NodeJS.ErrnoException;
  if (!err || typeof err !== "object") {
    return "unknown";
  }

  if (err.code === "ENOENT") {
    return "not-found";
  }

  if (err.code === "EACCES" || err.code === "EPERM") {
    return "permission-denied";
  }

  if (err.code) {
    return err.code.toLowerCase();
  }

  return err.message || "unknown";
}

export async function runCleanerSelfCheck(
  mode: CleanerOptions["mode"] = "basic",
): Promise<void> {
  const testDir = path.join(os.homedir(), "Library/Caches/yourclix-selfcheck");
  const testFile = path.join(testDir, "payload.bin");
  const progress = new CommandProgress("Cleaner Self-Check", 5);

  try {
    await progress.step("Creating temporary cache payload", async () => {
      await fs.rm(testDir, { recursive: true, force: true });
      await fs.mkdir(testDir, { recursive: true });
      const payload = Buffer.alloc(4 * 1024 * 1024, 1);
      await fs.writeFile(testFile, payload);
    });

    const createdBytes = await progress.step(
      "Measuring test payload size",
      async () => pathSizeFast(testDir),
    );
    progress.info(`Test payload size: ${bytesToHuman(createdBytes)}`);

    const scanResults = await progress.step("Running cleaner scan", async () =>
      scanCleanerTargets(mode),
    );
    const foundInCategory = scanResults.find((entry) =>
      entry.paths.includes(testDir),
    );

    if (!foundInCategory) {
      throw new Error(
        "Self-check failed: test cache path was not detected by scanner.",
      );
    }

    progress.info(`Detected in category: ${foundInCategory.category}`);

    await progress.step("Executing targeted cleanup", async () =>
      executeCleaner(
        [
          {
            category: "Self-Check Test",
            paths: [testDir],
            bytes: createdBytes,
          },
        ],
        { mode, dryRun: false, yes: true },
      ),
    );

    await progress.step("Verifying deletion outcome", async () => {
      const stillExists = await fs
        .lstat(testDir)
        .then(() => true)
        .catch(() => false);

      if (stillExists) {
        throw new Error(
          "Self-check failed: test cache path still exists after cleanup.",
        );
      }
    });

    console.log(chalk.green("Cleaner self-check passed."));
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

function printSkippedDetails(skipped: SkipRecord[]): void {
  if (skipped.length === 0) {
    return;
  }

  const reasonCounts = new Map<string, number>();
  for (const entry of skipped) {
    reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
  }

  console.log(chalk.bold("Skipped reasons"));
  for (const [reason, count] of reasonCounts) {
    console.log(`- ${reason}: ${count}`);
  }

  const sample = skipped.slice(0, 5);
  if (sample.length > 0) {
    console.log(chalk.dim("Sample skipped paths"));
    for (const entry of sample) {
      console.log(chalk.dim(`- ${entry.path} (${entry.reason})`));
    }
  }
}
