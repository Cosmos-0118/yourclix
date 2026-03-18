import os from "node:os";
import path from "node:path";
import type { RunLevel } from "../core/types.js";

export interface CleanerHeuristicPolicy {
  mode: RunLevel;
  olderThanDays: number;
  ageGatedCategories: Set<string>;
  protectedPaths: string[];
}

const AGE_GATED_CATEGORIES = new Set<string>([
  "Temporary Workspace Data",
  "Developer Project Junk",
  "Communications Attachments",
  "iOS and Device Backups",
  "System Logs and Temp",
]);

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
): CleanerHeuristicPolicy {
  const home = os.homedir();
  const protectedPaths = [
    process.cwd(),
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
    ageGatedCategories: AGE_GATED_CATEGORIES,
    protectedPaths,
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

    const withSlash =
      protectedRoot.endsWith(path.sep) ? protectedRoot : (
        `${protectedRoot}${path.sep}`
      );
    if (normalizedTarget.startsWith(withSlash)) {
      return true;
    }
  }

  return false;
}
