import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import chalk from "chalk";
import fg from "fast-glob";
import { bytesToHuman } from "../core/format.js";
import { CommandProgress } from "../core/progress.js";
import { pathSizeFast } from "../core/fs-utils.js";
import { runCommand } from "../core/exec.js";
import type { Issue } from "../core/types.js";

export interface DoctorReport {
  issues: Issue[];
  largeDirectories: Array<{ path: string; bytes: number }>;
  developerCaches: Array<{ path: string; bytes: number }>;
  diskFreePercent: number;
}

interface DoctorConfig {
  largeDirectoryThresholdBytes: number;
  devCacheThresholdBytes: number;
  lowDiskPercentThreshold: number;
  symlinkScanDepth: number;
  ignorePatterns: string[];
}

const DEFAULT_CONFIG: DoctorConfig = {
  largeDirectoryThresholdBytes: 2 * 1024 ** 3,
  devCacheThresholdBytes: 1 * 1024 ** 3,
  lowDiskPercentThreshold: 15,
  symlinkScanDepth: 4,
  ignorePatterns: ["**/.git/**", "**/node_modules/**"],
};

const DOCTOR_CONFIG_PATH = path.join(
  os.homedir(),
  ".your-config",
  "doctor.json",
);

async function loadDoctorConfig(): Promise<DoctorConfig> {
  try {
    const raw = await fs.readFile(DOCTOR_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<DoctorConfig>;

    return {
      largeDirectoryThresholdBytes:
        parsed.largeDirectoryThresholdBytes ??
        DEFAULT_CONFIG.largeDirectoryThresholdBytes,
      devCacheThresholdBytes:
        parsed.devCacheThresholdBytes ?? DEFAULT_CONFIG.devCacheThresholdBytes,
      lowDiskPercentThreshold:
        parsed.lowDiskPercentThreshold ??
        DEFAULT_CONFIG.lowDiskPercentThreshold,
      symlinkScanDepth:
        parsed.symlinkScanDepth ?? DEFAULT_CONFIG.symlinkScanDepth,
      ignorePatterns: parsed.ignorePatterns ?? DEFAULT_CONFIG.ignorePatterns,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function countBrokenSymlinks(
  paths: string[],
  ignorePatterns: string[],
): Promise<number> {
  let count = 0;

  for (const targetPath of paths) {
    if (ignorePatterns.some((pattern) => targetPath.includes(pattern.replace(/\*\*/g, "")))) {
      continue;
    }

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

async function getDiskFreePercent(targetPath: string): Promise<number> {
  try {
    const stats = await fs.statfs(targetPath);
    const totalBlocks = Number(stats.blocks);
    const availableBlocks = Number(stats.bavail);
    if (!Number.isFinite(totalBlocks) || totalBlocks <= 0) {
      return 100;
    }

    return (availableBlocks / totalBlocks) * 100;
  } catch {
    return 100;
  }
}

export async function runDoctorChecks(): Promise<DoctorReport> {
  const issues: Issue[] = [];
  const home = os.homedir();
  const config = await loadDoctorConfig();
  const progress = new CommandProgress("System Doctor", 5);

  const targets = [
    path.join(home, "Downloads"),
    path.join(home, "Developer"),
    path.join(home, "Library/Caches"),
  ];

  const sizeChecks = await progress.step("Analyzing disk-heavy directories", async () =>
    Promise.all(
      targets.map(async (target) => ({
        path: target,
        bytes: await pathSizeFast(target),
      })),
    ),
  );

  const largeDirectories = sizeChecks
    .sort((a, b) => b.bytes - a.bytes)
    .filter((entry) => entry.bytes > config.largeDirectoryThresholdBytes);

  if (largeDirectories.length > 0) {
    issues.push({
      id: "large-directories",
      title: "Large directories detected",
      description: `${largeDirectories.length} directories exceed configured threshold`,
      command: "your space",
      recommendedCommand: "your space",
      severity: "warn",
      safeToFix: false,
    });
  }

  const developerCacheTargets = [
    path.join(home, "Library/Developer/Xcode/DerivedData"),
    path.join(home, "Library/Developer/CoreSimulator"),
    path.join(home, ".npm"),
    path.join(home, ".cache/pnpm"),
    path.join(home, "Library/Application Support/Code/Cache"),
    path.join(home, "Library/Application Support/Code/CachedData"),
    path.join(home, "Library/Application Support/Code/User/workspaceStorage"),
    path.join(home, "Library/Containers/com.docker.docker"),
  ];

  const developerCachesRaw = await progress.step(
    "Analyzing developer caches",
    async () =>
      Promise.all(
        developerCacheTargets.map(async (target) => ({
          path: target,
          bytes: await pathSizeFast(target),
        })),
      ),
  );

  const developerCaches = developerCachesRaw.filter(
    (entry) => entry.bytes > config.devCacheThresholdBytes,
  );

  if (developerCaches.length > 0) {
    issues.push({
      id: "dev-caches",
      title: "Large developer caches detected",
      description: `${developerCaches.length} developer cache locations exceed configured threshold`,
      command: "your space",
      recommendedCommand: "your space",
      severity: "warn",
      safeToFix: false,
    });
  }

  const brokenCount = await progress.step("Scanning broken symlinks", async () => {
    const allPaths = await fg([`${home}/**/*`], {
      dot: true,
      followSymbolicLinks: false,
      onlyFiles: false,
      suppressErrors: true,
      deep: config.symlinkScanDepth,
      ignore: config.ignorePatterns,
    });

    return countBrokenSymlinks(allPaths, config.ignorePatterns);
  });

  if (brokenCount > 0) {
    issues.push({
      id: "broken-symlinks",
      title: "Broken symlinks found",
      description: `${brokenCount} broken symlinks detected`,
      safeToFix: true,
      command: "your fix",
      recommendedCommand: "your fix",
      severity: "warn",
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
    const outdatedCount = brewOutdated.stdout.split("\n").filter(Boolean).length;
    issues.push({
      id: "brew-outdated",
      title: "Outdated Homebrew packages",
      description: `${outdatedCount} packages are outdated`,
      safeToFix: true,
      command: "your brew optimize",
      recommendedCommand: "your brew optimize",
      severity: "info",
    });
  }

  const diskFreePercent = await getDiskFreePercent(home);
  if (diskFreePercent < config.lowDiskPercentThreshold) {
    issues.push({
      id: "low-disk-space",
      title: "Low disk space",
      description: `Only ${diskFreePercent.toFixed(1)}% free disk space remains`,
      safeToFix: false,
      command: "your space",
      recommendedCommand: "your space",
      severity: "critical",
    });
  }

  return { issues, largeDirectories, developerCaches, diskFreePercent };
}

export function printDoctorSummary(report: DoctorReport): void {
  if (!report.issues.length) {
    console.log(chalk.green("No major issues found."));
  } else {
    const order = ["critical", "warn", "info"] as const;
    console.log(chalk.bold("System health report"));

    for (const severity of order) {
      const group = report.issues.filter((issue) => (issue.severity ?? "warn") === severity);
      if (group.length === 0) {
        continue;
      }

      console.log(chalk.bold(`\n${severity.toUpperCase()}`));
      for (const issue of group) {
        console.log(chalk.yellow(`- ${issue.title}: ${issue.description}`));
        const recommended = issue.recommendedCommand ?? issue.command;
        if (recommended) {
          console.log(`  You can address this with: ${recommended}`);
        }
      }
    }
  }

  if (report.largeDirectories.length) {
    console.log(chalk.bold("\nLarge directories"));
    for (const entry of report.largeDirectories.slice(0, 8)) {
      console.log(`- ${entry.path}: ${bytesToHuman(entry.bytes)}`);
    }
  }

  if (report.developerCaches.length) {
    console.log(chalk.bold("\nDeveloper caches"));
    for (const entry of report.developerCaches.slice(0, 8)) {
      console.log(`- ${entry.path}: ${bytesToHuman(entry.bytes)}`);
    }
  }

  console.log(
    chalk.dim(`Disk free: ${report.diskFreePercent.toFixed(1)}%`),
  );
}
