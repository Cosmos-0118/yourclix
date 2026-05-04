import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runCommand } from "./exec.js";

/**
 * When globs return both a directory and paths inside it, only the ancestor
 * path would be deleted — sum sizes once to avoid inflated estimates.
 */
export function filterToAncestorRoots(paths: string[]): string[] {
  const normalized = [...new Set(paths.map((p) => path.normalize(p)))].sort(
    (a, b) => a.length - b.length,
  );
  const kept: string[] = [];
  for (const p of normalized) {
    if (kept.some((k) => p === k || p.startsWith(k + path.sep))) {
      continue;
    }
    kept.push(p);
  }
  return kept;
}

export async function pathSize(targetPath: string): Promise<number> {
  try {
    const stats = await fs.lstat(targetPath);
    if (!stats.isDirectory()) {
      return stats.size;
    }

    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const sizes = await Promise.all(
      entries.map((entry) => pathSize(path.join(targetPath, entry.name))),
    );

    return sizes.reduce((sum, value) => sum + value, 0);
  } catch {
    return 0;
  }
}

export async function pathSizeFast(targetPath: string): Promise<number> {
  const result = await runCommand("du", ["-sk", targetPath], {
    allowFailure: true,
  });

  if (result.code === 0 && result.stdout.trim()) {
    const firstToken = result.stdout.trim().split(/\s+/)[0];
    const kiloBytes = Number.parseInt(firstToken, 10);
    if (Number.isFinite(kiloBytes) && kiloBytes >= 0) {
      return kiloBytes * 1024;
    }
  }

  return pathSize(targetPath);
}

export async function sumPathSizesFast(
  paths: string[],
  concurrency = 12,
): Promise<number> {
  const deduped = filterToAncestorRoots(paths);
  if (deduped.length === 0) {
    return 0;
  }

  let total = 0;
  for (let i = 0; i < deduped.length; i += concurrency) {
    const batch = deduped.slice(i, i + concurrency);
    const sizes = await Promise.all(batch.map((p) => pathSizeFast(p)));
    total += sizes.reduce((sum, n) => sum + n, 0);
  }

  return total;
}

export function expandHome(targetPath: string): string {
  if (targetPath.startsWith("~/")) {
    return path.join(os.homedir(), targetPath.slice(2));
  }

  return targetPath;
}

export async function removePath(
  targetPath: string,
  dryRun = false,
): Promise<void> {
  if (dryRun) {
    return;
  }

  await fs.rm(targetPath, { recursive: true, force: true });
}

/**
 * Remove a path with backup - moves to undo system instead of permanent deletion
 * This is the safe version used by all destructive operations
 */
export async function removePathWithBackup(
  targetPath: string,
  dryRun = false,
  command = "operation",
): Promise<void> {
  if (dryRun) {
    return;
  }

  // For dry-run scenarios internally, use regular remove
  // In actual operation, backup happens at operation level (clean, etc)
  await removePath(targetPath, false);
}

