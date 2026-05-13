import fs from "node:fs/promises";

export interface RemoveBrokenSymlinksResult {
  removed: number;
  failures: Array<{ path: string; error: string }>;
}

export async function removeBrokenSymlinks(
  paths: string[],
  dryRun: boolean,
): Promise<RemoveBrokenSymlinksResult> {
  if (paths.length === 0) {
    return { removed: 0, failures: [] };
  }

  if (dryRun) {
    return { removed: paths.length, failures: [] };
  }

  let removed = 0;
  const failures: Array<{ path: string; error: string }> = [];

  for (const targetPath of paths) {
    try {
      await fs.unlink(targetPath);
      removed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ path: targetPath, error: message || "unknown" });
    }
  }

  return { removed, failures };
}
