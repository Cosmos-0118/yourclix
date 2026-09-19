import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { CommandProgress } from "../../core/progress.js";
import { bytesToHuman } from "../../core/format.js";
import { pathSizeFast } from "../../core/fs-utils.js";
import { confirm } from "../../core/prompt.js";
import { undoManager } from "../../core/undo-manager.js";
import { DEV_CLEAN_MAX_TARGETS } from "./constants.js";
import {
  filterProtectedDevCleanupTargets,
  scanDevCleanupTargets,
} from "./clean-scan.js";
import type { CleanupTargetInfo } from "./types.js";

export async function devClean(dryRun = false, yes = false): Promise<void> {
  const progress = new CommandProgress("Developer Cleanup", 2);
  const home = os.homedir();
  const found = await progress.step("Scanning cleanup targets", async () =>
    scanDevCleanupTargets(home),
  );

  const protectedFiltered = filterProtectedDevCleanupTargets(found.paths);

  const targetInfos: CleanupTargetInfo[] = [];
  for (const target of protectedFiltered.filtered) {
    let category: CleanupTargetInfo["category"] = "other";
    if (target.endsWith(`${path.sep}node_modules`)) {
      category = "node_modules";
    } else if (
      target.includes(
        `${path.sep}Library${path.sep}Developer${path.sep}Xcode${path.sep}DerivedData${path.sep}`,
      )
    ) {
      category = "xcode_derived_data";
    }

    let bytes = 0;
    try {
      bytes = await pathSizeFast(target);
    } catch {
      bytes = 0;
    }

    targetInfos.push({ path: target, bytes, category });
  }

  if (found.truncated) {
    console.log(
      chalk.yellow(
        `Scan limit reached (${DEV_CLEAN_MAX_TARGETS} node_modules folders). Restricting scope to keep memory usage stable.`,
      ),
    );
  }

  if (protectedFiltered.skippedProtected > 0) {
    console.log(
      chalk.yellow(
        `Skipped ${protectedFiltered.skippedProtected} protected node_modules target(s) required by current CLI/workspace.`,
      ),
    );
  }

  const nodeModules = targetInfos.filter(
    (entry) => entry.category === "node_modules",
  );
  const xcodeDerivedData = targetInfos.filter(
    (entry) => entry.category === "xcode_derived_data",
  );
  const otherTargets = targetInfos.filter((entry) => entry.category === "other");
  const totalBytes = targetInfos.reduce((sum, entry) => sum + entry.bytes, 0);
  const nodeModulesBytes = nodeModules.reduce((sum, entry) => sum + entry.bytes, 0);
  const xcodeBytes = xcodeDerivedData.reduce((sum, entry) => sum + entry.bytes, 0);
  const otherBytes = otherTargets.reduce((sum, entry) => sum + entry.bytes, 0);

  console.log(chalk.bold("Developer cleanup targets"));
  console.log(`- Total: ${targetInfos.length}`);
  console.log(
    `- node_modules: ${nodeModules.length} (${bytesToHuman(nodeModulesBytes)})`,
  );
  console.log(
    `- Xcode DerivedData: ${xcodeDerivedData.length} (${bytesToHuman(xcodeBytes)})`,
  );
  if (otherTargets.length > 0) {
    console.log(`- Other: ${otherTargets.length} (${bytesToHuman(otherBytes)})`);
  }
  console.log(chalk.cyan(`Discovered size: ${bytesToHuman(totalBytes)}`));
  if (!dryRun) {
    console.log(chalk.dim("Disk space remains in the undo backup until it is pruned."));
  }

  const largestTargets = [...targetInfos]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
  if (largestTargets.length > 0) {
    console.log(chalk.dim("Largest targets"));
    for (const target of largestTargets) {
      console.log(chalk.dim(`- ${target.path} (${bytesToHuman(target.bytes)})`));
    }
  }

  const preview = targetInfos.slice(0, 20);
  if (preview.length > 0) {
    console.log(chalk.dim("Sample targets (first 20)"));
    for (const target of preview) {
      console.log(chalk.dim(`- ${target.path} (${bytesToHuman(target.bytes)})`));
    }
  }

  if (targetInfos.length > preview.length) {
    console.log(
      chalk.dim(`...and ${targetInfos.length - preview.length} more target(s).`),
    );
  }

  if (targetInfos.length === 0) {
    console.log(chalk.green("No developer cleanup targets found."));
    return;
  }

  const approved = await confirm("Proceed with developer cleanup?", yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  let removedCount = 0;
  let reclaimedBytes = 0;
  let backupId: string | null = null;
  let backupWarnings: string[] = [];
  await progress.step(
    `Moving ${targetInfos.length} filesystem targets to undo backup`,
    async () => {
      if (dryRun) {
        removedCount = targetInfos.length;
        reclaimedBytes = totalBytes;
        return;
      }

      const result = await undoManager.createBackup(
        targetInfos.map((target) => target.path),
        "dev-clean",
      );
      backupId = result.metadata.id;
      removedCount = result.metadata.filesCount;
      reclaimedBytes = result.metadata.byteSize;
      backupWarnings = result.warnings;
    },
  );

  const actionWord = dryRun ? "Would remove" : "Moved to undo backup";
  console.log(chalk.bold("Developer cleanup summary"));
  console.log(chalk.green(`- ${actionWord}: ${removedCount} targets`));
  console.log(
    chalk.cyan(`- ${dryRun ? "Potential reclaim" : "Backup size"}: ${bytesToHuman(reclaimedBytes)}`),
  );
  if (!dryRun && backupId) {
    console.log(
      chalk.yellow("- Disk space is not freed until the undo backup is pruned."),
    );
    console.log(chalk.green(`- Backup: ~/.your-backups/${backupId}`));
    console.log(chalk.dim(`- Undo: your undo restore ${backupId}`));
  }

  if (backupWarnings.length > 0) {
    console.log(chalk.yellow("Backup warnings:"));
    for (const warning of backupWarnings.slice(0, 10)) {
      console.log(chalk.dim(`- ${warning}`));
    }
    if (backupWarnings.length > 10) {
      console.log(chalk.dim(`...and ${backupWarnings.length - 10} more warning(s).`));
    }
  }

  console.log(chalk.green("Developer cleanup complete."));
}
