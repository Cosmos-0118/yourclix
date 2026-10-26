import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunLevel } from "../core/types.js";

export interface CleanerHeuristicPolicy {
  mode: RunLevel;
  olderThanDays: number;
  ageGatedCategories: Set<string>;
  protectedPaths: string[];
  home: string;
  tmpDir: string;
}

export function getDefaultRetentionDays(mode: RunLevel): number {
  if (mode === "basic") {
    return 14;
  }

  if (mode === "deep") {
    return 30;
  }

  return 45;
}

export function normalizeRetentionDays(days: number, mode: RunLevel): number {
  const fallback = getDefaultRetentionDays(mode);
  if (!Number.isFinite(days)) {
    return fallback;
  }

  const rounded = Math.round(days);
  return Math.min(3650, Math.max(1, rounded));
}

export function buildCleanerHeuristicPolicy(
  mode: RunLevel,
  olderThanDays: number,
  context: { home?: string; tmpDir?: string } = {},
): CleanerHeuristicPolicy {
  const home = context.home ?? os.homedir();
  const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const protectedPaths = [
    // Protect the CLI's live dependency tree while it is running, but do not
    // treat the user's entire current project as untouchable. The old cwd
    // entry made `your clean` effectively a no-op whenever it was launched
    // from a developer repository.
    path.join(process.cwd(), "node_modules"),
    path.join(packageRoot, "node_modules"),
    path.join(packageRoot, "dist"),
    path.join(home, ".your-backups"),
    path.join(home, ".your"),
    path.join(home, ".cache/codex-runtimes"),
    path.join(home, ".cache/ms-playwright"),
    path.join(home, ".cache/puppeteer"),
    path.join(home, "Library/Caches/ms-playwright"),
    path.join(home, "Library/Caches/puppeteer"),
    path.join(home, ".cache/uv"),
    path.join(home, "Library/Caches/uv"),
    path.join(home, ".gradle/caches"),
    path.join(home, ".m2/repository"),
    path.join(home, ".android/avd"),
    path.join(home, ".colima/default"),
    path.join(home, "Library/Developer/Xcode/Archives"),
    path.join(home, "Library/Developer/CoreSimulator/Profiles/Runtimes"),
    path.join(home, "Library/Application Support/MobileSync"),
    path.join(home, "Library/Messages"),
    path.join(home, "Library/Mail"),
    path.join(home, ".vscode/extensions"),
    path.join(home, ".cursor/extensions"),
    path.join(home, "Library/Application Support/Code/User"),
    path.join(home, "Library/Application Support/Code/extensions"),
    path.join(home, "Library/Application Support/Cursor/User"),
    path.join(home, "Library/Application Support/Cursor/extensions"),
  ].map((entry) => path.resolve(entry));

  return {
    mode,
    olderThanDays: normalizeRetentionDays(olderThanDays, mode),
    ageGatedCategories: new Set(["*"]),
    protectedPaths,
    home,
    tmpDir: context.tmpDir ?? os.tmpdir(),
  };
}

export function isProtectedCleanupPath(
  targetPath: string,
  protectedPaths: string[],
): boolean {
  const normalizedTarget = path.resolve(targetPath);

  for (const protectedRoot of protectedPaths) {
    if (normalizedTarget === protectedRoot) {
      return true;
    }

    const withSlash = protectedRoot.endsWith(path.sep)
      ? protectedRoot
      : `${protectedRoot}${path.sep}`;
    if (normalizedTarget.startsWith(withSlash)) {
      return true;
    }
    if (protectedRoot.startsWith(`${normalizedTarget}${path.sep}`)) {
      return true;
    }
  }

  return false;
}
