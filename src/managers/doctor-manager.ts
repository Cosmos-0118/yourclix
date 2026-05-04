import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import dns from "node:dns/promises";
import chalk from "chalk";
import { bytesToHuman } from "../core/format.js";
import { CommandProgress } from "../core/progress.js";
import { pathSizeFast } from "../core/fs-utils.js";
import { runCommand } from "../core/exec.js";
import { getOutdatedPackages } from "./brew-manager.js";
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

async function pathExistsStat(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Only dirs where broken symlinks commonly matter — not a whole-home crawl.
 */
async function countBrokenSymlinksUnder(
  dir: string,
  maxDepth: number,
  currentDepth = 0,
): Promise<number> {
  if (!(await pathExistsStat(dir))) {
    return 0;
  }

  let broken = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    try {
      const st = await fs.lstat(full);
      if (st.isSymbolicLink()) {
        try {
          await fs.stat(full);
        } catch {
          broken += 1;
        }
      }
      if (
        ent.isDirectory() &&
        currentDepth < maxDepth
      ) {
        broken += await countBrokenSymlinksUnder(
          full,
          maxDepth,
          currentDepth + 1,
        );
      }
    } catch {
      continue;
    }
  }

  return broken;
}

async function countBrokenSymlinksScoped(home: string): Promise<number> {
  const roots: Array<{ path: string; maxDepth: number }> = [
    { path: "/opt/homebrew/bin", maxDepth: 0 },
    { path: "/usr/local/bin", maxDepth: 0 },
    { path: path.join(home, "bin"), maxDepth: 0 },
    { path: path.join(home, ".config"), maxDepth: 2 },
  ];

  let total = 0;
  for (const { path: root, maxDepth } of roots) {
    total += await countBrokenSymlinksUnder(root, maxDepth);
  }
  return total;
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
  const progress = new CommandProgress("System Doctor", 7);

  const targets = [
    path.join(home, "Downloads"),
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    path.join(home, "Library/Containers"),
  ];

  const sizeChecks = await progress.step(
    "Analyzing disk-heavy directories (targeted folders)",
    async () =>
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
    path.join(home, "Library/Developer/Xcode/iOS DeviceSupport"),
    path.join(home, "Library/Developer/CoreSimulator"),
    path.join(home, ".npm/_cacache"),
    path.join(home, ".cache/pnpm"),
    path.join(home, "Library/Caches/Yarn"),
    path.join(home, "Library/Application Support/Code/Cache"),
    path.join(home, "Library/Application Support/Code/CachedData"),
    path.join(home, "Library/Application Support/Code/User/workspaceStorage"),
    path.join(home, "Library/Containers/com.docker.docker/Data"),
    path.join(home, ".gradle/caches"),
    path.join(home, "Library/Caches/Homebrew"),
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

  const brokenCount = await progress.step(
    "Scanning broken symlinks (brew bins, ~/.config, ~/bin)",
    async () => countBrokenSymlinksScoped(home),
  );

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

  const outdatedPkgs = await progress.step(
    "Checking Homebrew package freshness",
    async () => getOutdatedPackages(),
  );

  const brewOutdatedCount =
    outdatedPkgs.formulae.length + outdatedPkgs.casks.length;
  if (brewOutdatedCount > 0) {
    issues.push({
      id: "brew-outdated",
      title: "Outdated Homebrew packages",
      description: `${brewOutdatedCount} outdated (${outdatedPkgs.formulae.length} formulae, ${outdatedPkgs.casks.length} casks)`,
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

  const networkReachable = await progress.step(
    "Checking network reachability (DNS)",
    async () => {
      try {
        await dns.resolve("apple.com");
        await dns.resolve("github.com");
        return true;
      } catch {
        return false;
      }
    },
  );

  if (!networkReachable) {
    issues.push({
      id: "network-reachability",
      title: "Network connectivity appears unstable",
      description: "DNS could not resolve apple.com or github.com",
      safeToFix: false,
      command: "your net fix",
      recommendedCommand: "your net fix",
      severity: "warn",
    });
  }

  const gitIdentity = await progress.step(
    "Checking Git identity configuration",
    async () => {
      const list = await runCommand("git", ["config", "--global", "--list"], {
        allowFailure: true,
      });
      const text = list.stdout;
      const hasName = /^user\.name\s*=\s*\S/m.test(text);
      const hasEmail = /^user\.email\s*=\s*\S/m.test(text);
      return { hasName, hasEmail };
    },
  );

  if (!gitIdentity.hasName || !gitIdentity.hasEmail) {
    issues.push({
      id: "git-identity-missing",
      title: "Git identity is not fully configured",
      description: "Missing global user.name or user.email can break commits",
      safeToFix: false,
      command: "git config --global user.name \"Your Name\" && git config --global user.email \"you@example.com\"",
      recommendedCommand:
        "git config --global user.name \"Your Name\" && git config --global user.email \"you@example.com\"",
      severity: "warn",
    });
  }

  return { issues, largeDirectories, developerCaches, diskFreePercent };
}

export function printDoctorSummary(report: DoctorReport): void {
  if (!report.issues.length) {
    console.log(chalk.green("No major issues found."));
  } else {
    const order = ["critical", "warn", "info"] as const;
    const severityMeta: Record<
      (typeof order)[number],
      { header: string; marker: string; color: (text: string) => string }
    > = {
      critical: {
        header: "CRITICAL",
        marker: "[CRIT]",
        color: chalk.red,
      },
      warn: {
        header: "WARNING",
        marker: "[WARN]",
        color: chalk.yellow,
      },
      info: {
        header: "INFO",
        marker: "[INFO]",
        color: chalk.cyan,
      },
    };

    console.log(chalk.bold("System health report"));
    console.log(chalk.dim("Severity legend: [CRIT] immediate action, [WARN] should fix soon, [INFO] optional optimization."));

    for (const severity of order) {
      const group = report.issues.filter((issue) => (issue.severity ?? "warn") === severity);
      if (group.length === 0) {
        continue;
      }

      const meta = severityMeta[severity];
      console.log(meta.color(chalk.bold(`\n${meta.header}`)));
      for (const issue of group) {
        console.log(meta.color(`- ${meta.marker} ${issue.title}: ${issue.description}`));
        const recommended = issue.recommendedCommand ?? issue.command;
        if (recommended) {
          console.log(`  Next step: ${recommended}`);
        }
        console.log(chalk.dim(`  Safe auto-fix: ${issue.safeToFix ? "yes" : "no"}`));
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
