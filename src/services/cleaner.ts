import fs from "node:fs/promises";
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

interface DeletionCandidate {
  path: string;
  bytes: number;
}

interface SkipRecord {
  path: string;
  reason: string;
}

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
          onlyDirectories: false,
          unique: true,
          suppressErrors: true,
        });

        const distinct = [...new Set(matches)].slice(0, 2000);
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
  const targets = results.flatMap((item) => item.paths);
  if (!targets.length) {
    return;
  }

  const approved = await confirm(
    `Delete ${targets.length} paths in ${options.mode.toUpperCase()} mode?`,
    Boolean(options.yes),
  );

  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  const scanProgress = new CommandProgress("Cleanup Preflight", 1);
  const { candidates, skipped } = await scanProgress.step(
    "Validating target paths",
    async () => {
      const validCandidates: DeletionCandidate[] = [];
      const skippedTargets: SkipRecord[] = [];

      for (const target of targets) {
        try {
          await fs.lstat(target);
          const bytes = await pathSizeFast(target);
          validCandidates.push({ path: target, bytes });
        } catch (error) {
          skippedTargets.push({
            path: target,
            reason: getSkipReason(error),
          });
        }
      }

      return { candidates: validCandidates, skipped: skippedTargets };
    },
  );

  const progress = new CommandProgress("Cleanup Execution", 1);
  let deletedCount = 0;
  let reclaimedBytes = 0;
  await progress.step(`Removing ${candidates.length} valid paths`, async () => {
    for (const candidate of candidates) {
      try {
        await removePath(candidate.path, Boolean(options.dryRun));
        deletedCount += 1;
        reclaimedBytes += candidate.bytes;
      } catch (error) {
        skipped.push({
          path: candidate.path,
          reason: getSkipReason(error),
        });
      }
    }
  });

  const skippedCount = skipped.length;
  const actionWord = options.dryRun ? "Would remove" : "Removed";
  const reclaimedLabel = options.dryRun ? "Potential reclaim" : "Reclaimed";

  console.log(chalk.bold("Cleanup summary"));
  console.log(chalk.green(`- ${actionWord}: ${deletedCount} paths`));
  console.log(chalk.yellow(`- Skipped: ${skippedCount} paths`));
  console.log(
    chalk.cyan(`- ${reclaimedLabel}: ${bytesToHuman(reclaimedBytes)}`),
  );

  if (skippedCount > 0) {
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
