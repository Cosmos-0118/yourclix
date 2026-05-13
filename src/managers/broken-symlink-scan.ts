import fs from "node:fs/promises";
import path from "node:path";

export interface BrokenSymlinkScanInput {
  home: string;
  symlinkScanDepth: number;
  ignorePatterns: string[];
}

function pathMatchesIgnore(fullPath: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const n = fullPath.replace(/\\/g, "/");

  for (const raw of patterns) {
    const p = raw.replace(/\\/g, "/").toLowerCase();
    if (p.includes("node_modules") && /(^|\/)node_modules(\/|$)/i.test(n)) {
      return true;
    }
    if (p.includes(".git") && /(^|\/)\.git(\/|$)/i.test(n)) {
      return true;
    }
    if (p.includes(".trash") && /(^|\/)\.Trash(\/|$)/i.test(n)) {
      return true;
    }
  }

  return false;
}

async function pathExistsStat(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectBrokenSymlinksUnder(
  dir: string,
  maxDepth: number,
  ignorePatterns: string[],
  currentDepth = 0,
): Promise<string[]> {
  const out: string[] = [];
  if (!(await pathExistsStat(dir))) {
    return out;
  }

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (pathMatchesIgnore(full, ignorePatterns)) {
      continue;
    }

    try {
      const st = await fs.lstat(full);
      if (st.isSymbolicLink()) {
        try {
          await fs.stat(full);
        } catch {
          out.push(full);
        }
      }
      if (ent.isDirectory() && currentDepth < maxDepth) {
        out.push(
          ...(await collectBrokenSymlinksUnder(
            full,
            maxDepth,
            ignorePatterns,
            currentDepth + 1,
          )),
        );
      }
    } catch {
      continue;
    }
  }

  return out;
}

/**
 * Bounded scan aligned with doctor diagnosis roots (never whole-home).
 * Uses `symlinkScanDepth` for `~/.config` only; bin roots stay shallow.
 */
export async function collectBrokenSymlinkPaths(
  input: BrokenSymlinkScanInput,
): Promise<string[]> {
  const { home, symlinkScanDepth, ignorePatterns } = input;
  const configDepth = Math.min(Math.max(symlinkScanDepth, 1), 8);

  const roots: Array<{ path: string; maxDepth: number }> = [
    { path: "/opt/homebrew/bin", maxDepth: 0 },
    { path: "/usr/local/bin", maxDepth: 0 },
    { path: path.join(home, "bin"), maxDepth: 0 },
    { path: path.join(home, ".config"), maxDepth: configDepth },
  ];

  const seen = new Set<string>();
  const merged: string[] = [];

  for (const { path: root, maxDepth } of roots) {
    const found = await collectBrokenSymlinksUnder(
      root,
      maxDepth,
      ignorePatterns,
    );
    for (const p of found) {
      const resolved = path.resolve(p);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        merged.push(resolved);
      }
    }
  }

  return merged;
}

export async function countBrokenSymlinksScoped(
  home: string,
  symlinkScanDepth: number,
  ignorePatterns: string[],
): Promise<number> {
  const paths = await collectBrokenSymlinkPaths({
    home,
    symlinkScanDepth,
    ignorePatterns,
  });
  return paths.length;
}
