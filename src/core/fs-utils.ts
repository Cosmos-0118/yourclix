import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runCommand } from "./exec.js";

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
  if (paths.length === 0) {
    return 0;
  }

  let index = 0;
  let total = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, paths.length) },
    async () => {
      while (index < paths.length) {
        const currentIndex = index;
        index += 1;
        total += await pathSizeFast(paths[currentIndex]);
      }
    },
  );

  await Promise.all(workers);
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
