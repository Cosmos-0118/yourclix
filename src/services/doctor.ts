import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import chalk from "chalk";
import fg from "fast-glob";
import { bytesToHuman } from "../core/format.js";
import { CommandProgress } from "../core/progress.js";
import { pathSize } from "../core/fs-utils.js";
import { runCommand } from "../core/exec.js";
import type { Issue } from "../core/types.js";

export interface DoctorReport {
  issues: Issue[];
  largeDirectories: Array<{ path: string; bytes: number }>;
}

export async function runDoctor(): Promise<DoctorReport> {
  const issues: Issue[] = [];
  const home = os.homedir();
  const progress = new CommandProgress("System Doctor", 3);

  const targets = [
    path.join(home, "Downloads"),
    path.join(home, "Developer"),
    path.join(home, "Library/Caches"),
  ];

  const sizeChecks = await progress.step(
    "Analyzing disk-heavy directories",
    async () =>
      Promise.all(
        targets.map(async (target) => ({
          path: target,
          bytes: await pathSize(target),
        })),
      ),
  );

  const largeDirectories = sizeChecks
    .sort((a, b) => b.bytes - a.bytes)
    .filter((entry) => entry.bytes > 2 * 1024 ** 3);

  if (largeDirectories.length > 0) {
    issues.push({
      id: "large-directories",
      title: "Large directories detected",
      description: `${largeDirectories.length} directories exceed 2 GB`,
      command: "your space",
      safeToFix: false,
    });
  }

  const brokenCount = await progress.step(
    "Scanning broken symlinks",
    async () => {
      const brokenSymlinks = await fg([`${home}/**/*`], {
        dot: true,
        followSymbolicLinks: false,
        onlyFiles: false,
        suppressErrors: true,
        deep: 4,
      });

      return countBrokenSymlinks(brokenSymlinks);
    },
  );
  if (brokenCount > 0) {
    issues.push({
      id: "broken-symlinks",
      title: "Broken symlinks found",
      description: `${brokenCount} broken symlinks detected`,
      safeToFix: true,
      command: "find ~ -xtype l -delete",
    });
  }

  const brewOutdated = await progress.step(
    "Checking Homebrew package freshness",
    async () =>
      runCommand("brew", ["outdated"], {
        allowFailure: true,
      }),
  );
  if (brewOutdated.stdout.trim()) {
    const outdatedCount = brewOutdated.stdout
      .split("\n")
      .filter(Boolean).length;
    issues.push({
      id: "brew-outdated",
      title: "Outdated Homebrew packages",
      description: `${outdatedCount} packages are outdated`,
      safeToFix: true,
      command: "your brew upgrade",
    });
  }

  return { issues, largeDirectories };
}

async function countBrokenSymlinks(paths: string[]): Promise<number> {
  let count = 0;

  for (const targetPath of paths) {
    try {
      const stat = await fs.lstat(targetPath);
      if (!stat.isSymbolicLink()) {
        continue;
      }

      await fs.stat(targetPath);
    } catch {
      count += 1;
    }
  }

  return count;
}

export function printDoctorReport(report: DoctorReport): void {
  if (!report.issues.length) {
    console.log(chalk.green("No major issues found."));
  } else {
    console.log(chalk.bold("System health report"));
    for (const issue of report.issues) {
      console.log(chalk.yellow(`- ${issue.title}: ${issue.description}`));
      if (issue.command) {
        console.log(`  Suggested command: ${issue.command}`);
      }
    }
  }

  if (report.largeDirectories.length) {
    console.log(chalk.bold("\nLarge directories"));
    for (const entry of report.largeDirectories.slice(0, 8)) {
      console.log(`- ${entry.path}: ${bytesToHuman(entry.bytes)}`);
    }
  }
}
