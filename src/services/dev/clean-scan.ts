import path from "node:path";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import {
  DEV_CLEAN_MAX_DEPTH,
  DEV_CLEAN_MAX_TARGETS,
  DEV_CLEAN_PROJECT_ROOTS,
  DEV_CLEAN_SKIP_DIRS,
  DEV_CURRENT_PACKAGE_ROOT,
  DEV_INSTALL_SOURCE_ROOT,
} from "./constants.js";
import type { ProtectedTargetsFilter } from "./types.js";

export function shouldSkipDevCleanDir(name: string): boolean {
  if (DEV_CLEAN_SKIP_DIRS.has(name)) {
    return true;
  }

  return name.startsWith(".") && name !== ".config";
}

export function isSameOrNestedPath(targetPath: string, basePath: string): boolean {
  const target = path.resolve(targetPath);
  const base = path.resolve(basePath);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

function getProtectedDevCleanupRoots(): string[] {
  return dedupeNestedTargets([
    process.cwd(),
    DEV_CURRENT_PACKAGE_ROOT,
    DEV_INSTALL_SOURCE_ROOT,
  ]);
}

export function filterProtectedDevCleanupTargets(
  paths: string[],
): ProtectedTargetsFilter {
  const protectedNodeModulesRoots = getProtectedDevCleanupRoots().map((root) =>
    path.join(root, "node_modules"),
  );

  let skippedProtected = 0;
  const filtered = paths.filter((targetPath) => {
    const isProtected = protectedNodeModulesRoots.some((protectedRoot) =>
      isSameOrNestedPath(targetPath, protectedRoot),
    );
    if (isProtected) {
      skippedProtected += 1;
      return false;
    }
    return true;
  });

  return { filtered, skippedProtected };
}

async function listDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

export async function collectNodeModulesTargets(home: string): Promise<{
  paths: string[];
  truncated: boolean;
}> {
  const queue: Array<{ dir: string; depth: number }> = [];
  for (const root of DEV_CLEAN_PROJECT_ROOTS) {
    queue.push({ dir: path.join(home, root), depth: 0 });
  }
  queue.push({ dir: process.cwd(), depth: 0 });

  const seenDirs = new Set<string>();
  const targets: string[] = [];

  while (queue.length > 0 && targets.length < DEV_CLEAN_MAX_TARGETS) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const resolved = path.resolve(current.dir);
    if (seenDirs.has(resolved)) {
      continue;
    }
    seenDirs.add(resolved);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(resolved, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const fullPath = path.join(resolved, entry.name);

      if (entry.name === "node_modules") {
        targets.push(fullPath);
        if (targets.length >= DEV_CLEAN_MAX_TARGETS) {
          break;
        }
        continue;
      }

      if (current.depth >= DEV_CLEAN_MAX_DEPTH) {
        continue;
      }

      if (shouldSkipDevCleanDir(entry.name)) {
        continue;
      }

      queue.push({ dir: fullPath, depth: current.depth + 1 });
    }
  }

  return {
    paths: targets,
    truncated: targets.length >= DEV_CLEAN_MAX_TARGETS,
  };
}

async function collectXcodeDerivedDataTargets(home: string): Promise<string[]> {
  return listDirectories(path.join(home, "Library/Developer/Xcode/DerivedData"));
}

export async function scanDevCleanupTargets(home: string): Promise<{
  paths: string[];
  truncated: boolean;
}> {
  const [nodeModulesResult, xcodeTargets] = await Promise.all([
    collectNodeModulesTargets(home),
    collectXcodeDerivedDataTargets(home),
  ]);

  return {
    paths: dedupeNestedTargets([...nodeModulesResult.paths, ...xcodeTargets]),
    truncated: nodeModulesResult.truncated,
  };
}

function isNestedPath(childPath: string, parentPath: string): boolean {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  if (child === parent) {
    return false;
  }

  return child.startsWith(`${parent}${path.sep}`);
}

export function dedupeNestedTargets(paths: string[]): string[] {
  const sorted = [...new Set(paths)].sort((a, b) => a.length - b.length);
  const selected: string[] = [];

  for (const candidate of sorted) {
    const covered = selected.some((existing) => isNestedPath(candidate, existing));
    if (!covered) {
      selected.push(candidate);
    }
  }

  return selected;
}
