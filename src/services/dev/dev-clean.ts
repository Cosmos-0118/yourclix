import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { runCommand } from "../../core/exec.js";
import { CommandProgress } from "../../core/progress.js";
import { bytesToHuman } from "../../core/format.js";
import { pathSizeFast, removePath } from "../../core/fs-utils.js";
import { confirm } from "../../core/prompt.js";
import { DEV_CLEAN_MAX_TARGETS } from "./constants.js";
import {
  filterProtectedDevCleanupTargets,
  scanDevCleanupTargets,
} from "./clean-scan.js";
import type { CleanupTargetInfo } from "./types.js";

export async function devClean(dryRun = false, yes = false): Promise<void> {
  const progress = new CommandProgress("Developer Cleanup", 3);
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
  console.log(chalk.cyan(`Estimated reclaimable: ${bytesToHuman(totalBytes)}`));

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

  const approved = await confirm("Proceed with developer cleanup?", yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  let removedCount = 0;
  let reclaimedBytes = 0;
  const failedTargets: Array<{ path: string; reason: string }> = [];
  await progress.step(
    `Removing ${targetInfos.length} filesystem targets`,
    async () => {
      for (const target of targetInfos) {
        try {
          await removePath(target.path, dryRun);
          removedCount += 1;
          reclaimedBytes += target.bytes;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          failedTargets.push({ path: target.path, reason: message || "unknown" });
        }
      }
    },
  );

  await progress.step("Cleaning package manager caches", async () => {
    await runCommand("npm", ["cache", "clean", "--force"], {
      dryRun,
      allowFailure: true,
    });
    await runCommand("pnpm", ["store", "prune"], {
      dryRun,
      allowFailure: true,
    });
    await runCommand("python3", ["-m", "pip", "cache", "purge"], {
      dryRun,
      allowFailure: true,
    });
    await runCommand("gradle", ["--stop"], { dryRun, allowFailure: true });
  });

  const actionWord = dryRun ? "Would remove" : "Removed";
  console.log(chalk.bold("Developer cleanup summary"));
  console.log(chalk.green(`- ${actionWord}: ${removedCount} targets`));
  console.log(
    chalk.cyan(`- ${dryRun ? "Potential reclaim" : "Reclaimed"}: ${bytesToHuman(reclaimedBytes)}`),
  );
  console.log(chalk.yellow(`- Failed: ${failedTargets.length} targets`));

  if (failedTargets.length > 0) {
    const sampleFailed = failedTargets.slice(0, 10);
    console.log(chalk.dim("Sample failures"));
    for (const failed of sampleFailed) {
      console.log(chalk.dim(`- ${failed.path} (${failed.reason})`));
    }
  }

  console.log(chalk.green("Developer cleanup complete."));
}
