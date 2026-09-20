import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { CommandProgress } from "../../core/progress.js";
import {
  bytesToHuman,
  compactPath,
  pluralize,
  terminalWidth,
  wrapText,
} from "../../core/format.js";
import { panel } from "../../core/task-ui.js";
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
    console.log(chalk.yellow(wrapText(
      `Scan limit reached (${DEV_CLEAN_MAX_TARGETS} node_modules folders). Restricting scope to keep memory usage stable.`,
      Math.max(20, terminalWidth() - 2),
    ).join("\n")));
  }

  if (protectedFiltered.skippedProtected > 0) {
    console.log(
      chalk.yellow(
        `Skipped ${pluralize(protectedFiltered.skippedProtected, "protected node_modules target")} required by current CLI/workspace.`,
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

  const targetSummary = [
    `Total: ${pluralize(targetInfos.length, "target")}`,
    `node_modules: ${pluralize(nodeModules.length, "folder")} (${bytesToHuman(nodeModulesBytes)})`,
    `Xcode DerivedData: ${pluralize(xcodeDerivedData.length, "folder")} (${bytesToHuman(xcodeBytes)})`,
  ];
  if (otherTargets.length > 0) {
    targetSummary.push(`Other: ${pluralize(otherTargets.length, "target")} (${bytesToHuman(otherBytes)})`);
  }
  targetSummary.push(`Discovered size: ${bytesToHuman(totalBytes)}`);
  if (!dryRun) {
    targetSummary.push("Disk space remains in the undo backup until it is pruned.");
  }
  panel(targetSummary.join("\n"), "Developer cleanup targets", (line) => chalk.green(line));

  const largestTargets = [...targetInfos]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
  if (largestTargets.length > 0) {
    console.log(chalk.dim("Largest targets"));
    for (const target of largestTargets) {
      printTargetLine(target.path, target.bytes);
    }
  }

  const preview = targetInfos.slice(0, 20);
  if (preview.length > 0) {
    console.log(chalk.dim("Sample targets (first 20)"));
    for (const target of preview) {
      printTargetLine(target.path, target.bytes);
    }
  }

  if (targetInfos.length > preview.length) {
    console.log(
      chalk.dim(`… and ${pluralize(targetInfos.length - preview.length, "more target")}.`),
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
    `Moving ${pluralize(targetInfos.length, "filesystem target")} to undo backup`,
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
  const summary = [
    `${actionWord}: ${pluralize(removedCount, "target")}`,
    `${dryRun ? "Potential reclaim" : "Backup size"}: ${bytesToHuman(reclaimedBytes)}`,
  ];
  if (!dryRun && backupId) {
    summary.push("Disk space is not freed until the undo backup is pruned.");
    summary.push(`Backup: ~/.your-backups/${backupId}`);
    summary.push(`Undo: your undo restore ${backupId}`);
  }
  panel(summary.join("\n"), "Developer cleanup complete", (line) => chalk.green(line));

  if (backupWarnings.length > 0) {
    console.log(chalk.yellow("Backup warnings:"));
    for (const warning of backupWarnings.slice(0, 10)) {
      console.log(chalk.dim(wrapText(`- ${warning}`, Math.max(20, terminalWidth() - 2)).join("\n")));
    }
    if (backupWarnings.length > 10) {
      console.log(chalk.dim(`… and ${pluralize(backupWarnings.length - 10, "more warning")}.`));
    }
  }

}

function printTargetLine(targetPath: string, bytes: number): void {
  const line = `- ${compactPath(targetPath)} (${bytesToHuman(bytes)})`;
  console.log(chalk.dim(wrapText(line, Math.max(20, terminalWidth() - 2)).join("\n")));
}
