import fs from "node:fs/promises";
import os from "node:os";
import fg from "fast-glob";

export async function findBrokenSymlinks(): Promise<string[]> {
  const home = os.homedir();

  const candidates = await fg([`${home}/**/*`], {
    dot: true,
    followSymbolicLinks: false,
    onlyFiles: false,
    suppressErrors: true,
    deep: 4,
  });

  const broken: string[] = [];
  for (const targetPath of candidates) {
    try {
      const stat = await fs.lstat(targetPath);
      if (!stat.isSymbolicLink()) {
        continue;
      }

      await fs.stat(targetPath);
    } catch {
      broken.push(targetPath);
    }
  }

  return broken;
}

export async function removeBrokenSymlinks(
  paths: string[],
  dryRun: boolean,
): Promise<number> {
  if (paths.length === 0) {
    return 0;
  }

  if (dryRun) {
    return paths.length;
  }

  let removed = 0;
  for (const targetPath of paths) {
    try {
      await fs.unlink(targetPath);
      removed += 1;
    } catch {
      // Ignore per-path deletion errors and continue with remaining entries.
    }
  }

  return removed;
}
