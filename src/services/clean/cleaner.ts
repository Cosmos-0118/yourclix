import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import boxen from "boxen";
import fg from "fast-glob";
import { bytesToHuman, pad } from "../core/format.js";
import { CommandProgress } from "../core/progress.js";
import {
  filterToAncestorRoots,
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

const SAFETY_SKIP_REASONS = ["protected-path", "newer-than-"];

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

  const rule = chalk.dim("─".repeat(52));
  console.log(chalk.bold("\nScan summary"));
  console.log(rule);
  for (const result of results) {
    console.log(
      `  ${pad(result.category, 24)} ${chalk.cyan(bytesToHuman(result.bytes))}  ${chalk.dim(`${result.paths.length} paths`)}`,
    );
  }

  console.log(rule);
  const total = results.reduce((sum, item) => sum + item.bytes, 0);
  console.log(
    `  ${pad("Estimated reclaimable", 24)} ${chalk.bold.cyan(bytesToHuman(total))}`,
  );
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

  if (!selectedCandidates.length) {
    console.log(
      chalk.yellow("No eligible cleanup candidates after safety checks."),
    );
    if (options.verbose) {
      printSkippedBreakdown(skipped);
    } else {
      console.log(chalk.dim(`  ${summarizeSkippedInline(skipped)}`));
    }

    const overrideCandidates = safetySkipped
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

function printSkippedBreakdown(skipped: SkipRecord[]): void {
  if (skipped.length === 0) {
    return;
  }

  const reasonCounts = new Map<string, number>();
  for (const entry of skipped) {
    reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
  }

  console.log(chalk.bold("\nSkipped breakdown"));
  for (const [reason, count] of [...reasonCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  • ${formatSkipReasonShort(reason)}: ${count}`);
  }
}

function printSkippedSummary(skipped: SkipRecord[], verbose: boolean): void {
  if (skipped.length === 0) {
    return;
  }

  const reasonCounts = new Map<string, number>();
  for (const entry of skipped) {
    reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
  }

  console.log(chalk.bold("\nSkipped paths"));
  for (const [reason, count] of [...reasonCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${chalk.dim("•")} ${formatSkipReasonShort(reason)}: ${count}`);
  }

  if (!verbose) {
    const home = os.homedir();
    const buckets = bucketSkippedPaths(skipped, home);
    if (buckets.length > 0) {
      console.log(chalk.dim("\n  By location (use --verbose for full paths):"));
      for (const { label, count } of buckets.slice(0, 8)) {
        console.log(chalk.dim(`    ${count} under ${label}`));
      }
      if (buckets.length > 8) {
        console.log(
          chalk.dim(`    … and ${buckets.length - 8} more location group(s)`),
        );
      }
    }
    return;
  }

  const sample = skipped.slice(0, 12);
  console.log(chalk.dim("\n  Paths:"));
  for (const entry of sample) {
    console.log(
      chalk.dim(`    ${entry.path} (${formatSkipReasonShort(entry.reason)})`),
    );
  }
  if (skipped.length > sample.length) {
    console.log(
      chalk.dim(
        `    … ${skipped.length - sample.length} more (truncated; narrow scan with filters if needed)`,
      ),
    );
  }
}

function summarizeSkippedInline(skipped: SkipRecord[]): string {
  const reasonCounts = new Map<string, number>();
  for (const entry of skipped) {
    const label = formatSkipReasonShort(entry.reason);
    reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1);
  }

  const parts = [...reasonCounts.entries()].map(([k, v]) => `${v} ${k}`);
  const home = os.homedir();
  const top = topLocationBucket(
    skipped.map((s) => s.path),
    home,
  );

  let line = `Safety filters skipped ${skipped.length} path(s) (${parts.join(", ")}).`;
  if (top) {
    line += ` Largest group under ${top}.`;
  }
  return line;
}

function bucketSkippedPaths(
  skipped: SkipRecord[],
  home: string,
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of skipped) {
    const label = pathBucketForDisplay(entry.path, home);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function topLocationBucket(paths: string[], home: string): string | null {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const label = pathBucketForDisplay(p, home);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [label, count] of counts) {
    if (count > n) {
      n = count;
      best = label;
    }
  }
  return best;
}

function pathBucketForDisplay(fullPath: string, home: string): string {
  const rel = path.relative(home, fullPath);
  if (rel.startsWith("..")) {
    return "(outside home)";
  }

  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length >= 2 && parts[0] === "Library") {
    return `~/Library/${parts[1]}`;
  }

  if (parts.length >= 1) {
    return `~/${parts[0]}`;
  }

  return "~";
}

function formatSkipReasonShort(reason: string): string {
  if (reason === "protected-path") {
    return "protected";
  }

  if (reason.startsWith("newer-than-")) {
    const age = reason.replace("newer-than-", "");
    return `retention (${age})`;
  }

  if (reason === "permission-denied") {
    return "permission denied";
  }

  if (reason === "not-found") {
    return "not found";
  }

  return reason;
}

function isSafetySkipReason(reason: string): boolean {
  return SAFETY_SKIP_REASONS.some((prefix) => reason.startsWith(prefix));
}
