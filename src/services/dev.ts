import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { ActionableError } from "../core/actionable-error.js";
import { runCommand } from "../core/exec.js";
import { buildManualRecoveryDetails } from "../core/reconfigure.js";
import { printNextCommands } from "../core/next-steps.js";
import { CommandProgress } from "../core/progress.js";
import { firstCommandOutput } from "../core/verification.js";
import { bytesToHuman } from "../core/format.js";
import { pathSizeFast, removePath } from "../core/fs-utils.js";
import { confirm } from "../core/prompt.js";

interface CleanupTargetInfo {
  path: string;
  bytes: number;
  category: "node_modules" | "xcode_derived_data" | "other";
}

const DEV_CLEAN_PROJECT_ROOTS = [
  "Developer",
  "Projects",
  "Code",
  "Work",
  "Desktop",
  "Downloads",
];

const DEV_CLEAN_SKIP_DIRS = new Set([
  ".git",
  ".Trash",
  "Library",
  "Applications",
  "Movies",
  "Music",
  "Pictures",
  "Public",
  "Volumes",
  "node_modules",
]);

const DEV_CLEAN_MAX_TARGETS = 2500;
const DEV_CLEAN_MAX_DEPTH = 8;
const DEV_INSTALL_SOURCE_ROOT = path.join(os.homedir(), ".your", "source");
const DEV_CURRENT_PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

interface ProtectedTargetsFilter {
  filtered: string[];
  skippedProtected: number;
}

function shouldSkipDevCleanDir(name: string): boolean {
  if (DEV_CLEAN_SKIP_DIRS.has(name)) {
    return true;
  }

  return name.startsWith(".") && name !== ".config";
}

function isSameOrNestedPath(targetPath: string, basePath: string): boolean {
  const target = path.resolve(targetPath);
  const base = path.resolve(basePath);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

function getProtectedDevCleanupRoots(): string[] {
  return dedupeNestedTargets([
    process.cwd(),
    DEV_CURRENT_PACKAGE_ROOT,
    DEV_INSTALL_SOURCE_ROOT,
  ]);
}

function filterProtectedDevCleanupTargets(paths: string[]): ProtectedTargetsFilter {
  const protectedNodeModulesRoots = getProtectedDevCleanupRoots().map((root) =>
    path.join(root, "node_modules"),
  );

  let skippedProtected = 0;
  const filtered = paths.filter((targetPath) => {
    const isProtected = protectedNodeModulesRoots.some((protectedRoot) =>
      isSameOrNestedPath(targetPath, protectedRoot),
    );
    if (isProtected) {
      skippedProtected += 1;
      return false;
    }
    return true;
  });

  return { filtered, skippedProtected };
}

async function listDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

async function collectNodeModulesTargets(home: string): Promise<{
  paths: string[];
  truncated: boolean;
}> {
  const queue: Array<{ dir: string; depth: number }> = [];
  for (const root of DEV_CLEAN_PROJECT_ROOTS) {
    queue.push({ dir: path.join(home, root), depth: 0 });
  }
  queue.push({ dir: process.cwd(), depth: 0 });

  const seenDirs = new Set<string>();
  const targets: string[] = [];

  while (queue.length > 0 && targets.length < DEV_CLEAN_MAX_TARGETS) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const resolved = path.resolve(current.dir);
    if (seenDirs.has(resolved)) {
      continue;
    }
    seenDirs.add(resolved);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(resolved, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const fullPath = path.join(resolved, entry.name);

      if (entry.name === "node_modules") {
        targets.push(fullPath);
        if (targets.length >= DEV_CLEAN_MAX_TARGETS) {
          break;
        }
        continue;
      }

      if (current.depth >= DEV_CLEAN_MAX_DEPTH) {
        continue;
      }

      if (shouldSkipDevCleanDir(entry.name)) {
        continue;
      }

      queue.push({ dir: fullPath, depth: current.depth + 1 });
    }
  }

  return {
    paths: targets,
    truncated: targets.length >= DEV_CLEAN_MAX_TARGETS,
  };
}

async function collectXcodeDerivedDataTargets(home: string): Promise<string[]> {
  return listDirectories(path.join(home, "Library/Developer/Xcode/DerivedData"));
}

async function scanDevCleanupTargets(home: string): Promise<{
  paths: string[];
  truncated: boolean;
}> {
  const [nodeModulesResult, xcodeTargets] = await Promise.all([
    collectNodeModulesTargets(home),
    collectXcodeDerivedDataTargets(home),
  ]);

  return {
    paths: dedupeNestedTargets([...nodeModulesResult.paths, ...xcodeTargets]),
    truncated: nodeModulesResult.truncated,
  };
}

function isNestedPath(childPath: string, parentPath: string): boolean {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  if (child === parent) {
    return false;
  }

  return child.startsWith(`${parent}${path.sep}`);
}

function dedupeNestedTargets(paths: string[]): string[] {
  const sorted = [...new Set(paths)].sort((a, b) => a.length - b.length);
  const selected: string[] = [];

  for (const candidate of sorted) {
    const covered = selected.some((existing) => isNestedPath(candidate, existing));
    if (!covered) {
      selected.push(candidate);
    }
  }

  return selected;
}

interface DevResetPlan {
  brewPackage: string;
  verifyCommand: string;
  verifyArgs: string[];
}

function getDevResetPlan(tool: string): DevResetPlan {
  switch (tool) {
    case "node":
      return {
        brewPackage: "node",
        verifyCommand: "node",
        verifyArgs: ["--version"],
      };
    case "python":
      return {
        brewPackage: "python",
        verifyCommand: "python3",
        verifyArgs: ["--version"],
      };
    case "ruby":
      return {
        brewPackage: "ruby",
        verifyCommand: "ruby",
        verifyArgs: ["--version"],
      };
    case "rust":
      return {
        brewPackage: "rust",
        verifyCommand: "rustc",
        verifyArgs: ["--version"],
      };
    case "go":
      return {
        brewPackage: "go",
        verifyCommand: "go",
        verifyArgs: ["version"],
      };
    default:
      throw new ActionableError({
        code: "DEV_RESET_UNSUPPORTED_TOOL",
        summary: `Unsupported tool reset target: ${tool}`,
        nextSteps: [
          "Use one of the supported targets: node, python, ruby, rust, go",
          "Run: your dev reset node",
        ],
      });
  }
}

function buildDevManualRecovery(tool: string, plan: DevResetPlan): string[] {
  const verifyCommand = `${plan.verifyCommand} ${plan.verifyArgs.join(" ")}`;
  return buildManualRecoveryDetails("Manual recovery checklist:", [
    `Run: brew uninstall ${plan.brewPackage}`,
    `Run: brew install ${plan.brewPackage}`,
    `Run: ${verifyCommand}`,
    `Run: your dev reset ${tool}`,
  ]);
}

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

export async function devReset(tool: string, dryRun = false): Promise<void> {
  const plan = getDevResetPlan(tool);
  const title =
    tool === "node" ? "Node"
    : tool === "python" ? "Python"
    : tool === "ruby" ? "Ruby"
    : tool === "rust" ? "Rust"
    : tool === "go" ? "Go"
    : tool;
  const progress = new CommandProgress(`Developer Reset (${tool})`, 3);

  const uninstallResult = await progress.step(
    `Uninstalling existing ${title}`,
    async () =>
      runCommand("brew", ["uninstall", plan.brewPackage], {
        dryRun,
        allowFailure: true,
      }),
  );

  const installResult = await progress.step(
    `Installing fresh ${title}`,
    async () =>
      runCommand("brew", ["install", plan.brewPackage], {
        dryRun,
        allowFailure: true,
      }),
  );

  const verifyResult = await progress.step(
    `Verifying ${title} is available`,
    async () =>
      runCommand(plan.verifyCommand, plan.verifyArgs, {
        dryRun,
        allowFailure: true,
      }),
  );

  const failedDetails: string[] = [];
  if (uninstallResult.code !== 0) {
    failedDetails.push(
      `Uninstall failed: ${uninstallResult.stderr || uninstallResult.stdout || "unknown error"}`,
    );
  }
  if (installResult.code !== 0) {
    failedDetails.push(
      `Install failed: ${installResult.stderr || installResult.stdout || "unknown error"}`,
    );
  }
  if (verifyResult.code !== 0) {
    failedDetails.push(
      `Verification failed: ${verifyResult.stderr || verifyResult.stdout || "unknown error"}`,
    );
  }

  if (!dryRun && failedDetails.length > 0) {
    console.log(chalk.bold(`Developer reset failed for ${tool}.`));
    for (const detail of failedDetails) {
      console.log(chalk.yellow(`- ${detail}`));
    }

    for (const line of buildDevManualRecovery(tool, plan)) {
      console.log(chalk.dim(line));
    }

    throw new ActionableError({
      code: "DEV_RESET_VERIFICATION_FAILED",
      summary: `Developer reset verification failed for ${tool}.`,
      details: failedDetails,
      nextSteps: buildDevManualRecovery(tool, plan),
    });
  }

  if (!dryRun) {
    console.log(
      chalk.green(
        `Verification output: ${firstCommandOutput(verifyResult)}`,
      ),
    );
  }

  console.log(chalk.green(`Developer environment reset complete for ${tool}.`));
  printNextCommands("Next commands:", [
    `your doctor`,
    `${plan.verifyCommand} ${plan.verifyArgs.join(" ")}`,
  ]);
}
