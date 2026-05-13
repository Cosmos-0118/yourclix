import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { runCommand } from "../../core/exec.js";
import { bytesToHuman } from "../../core/format.js";
import { pathSizeFast } from "../../core/fs-utils.js";
import { CommandProgress } from "../../core/progress.js";

/** Default scan roots — typical hoard locations, not full-disk crawls. */
const TARGET_DISK_FOLDERS = [
  "Downloads",
  "Desktop",
  "Documents",
  path.join("Library", "Containers"),
] as const;

interface SpaceNode {
  name: string;
  fullPath: string;
  bytes: number;
  children: SpaceNode[];
  isDirectory: boolean;
}

interface CandidatePath {
  name: string;
  fullPath: string;
  isDirectory: boolean;
}

const MAX_CHILDREN_SCAN = 30;
const MAX_CHILDREN_EXPAND = 8;
const MAX_CHILDREN_RENDER = 10;
const MAX_CHILDREN_RENDER_DEEP = 5;
const SIZE_CONCURRENCY = 8;
const DU_BATCH_SIZE = 40;

export async function analyzeSpace(
  basePath?: string,
  depth = 2,
): Promise<void> {
  if (!basePath) {
    const home = os.homedir();
    const progress = new CommandProgress("Disk Space Analyzer", 2);

    console.log(
      chalk.dim(
        "Targeted scan: Downloads, Desktop, Documents, Library/Containers — not the whole disk. " +
          "On APFS, clone/shared blocks can make summed sizes exceed physical disk usage.",
      ),
    );

    const root = await progress.step(
      `Building usage trees (depth ${depth})`,
      async () => buildSyntheticHomeSummary(home, depth),
    );

    progress.tick("Rendering visual tree");
    printTree(root, "");
    return;
  }

  const progress = new CommandProgress("Disk Space Analyzer", 2);

  const root = await progress.step(
    `Building usage tree for ${basePath} (depth ${depth})`,
    async () => buildTree(basePath, depth),
  );

  progress.tick("Rendering visual tree");
  printTree(root, "");
}

async function buildSyntheticHomeSummary(
  home: string,
  depth: number,
): Promise<SpaceNode> {
  const children: SpaceNode[] = [];

  for (const rel of TARGET_DISK_FOLDERS) {
    const fullPath = path.join(home, rel);
    try {
      const subtree = await buildTree(fullPath, depth);
      children.push(subtree);
    } catch {
      children.push({
        name: path.basename(fullPath) || rel,
        fullPath,
        bytes: 0,
        children: [],
        isDirectory: true,
      });
    }
  }

  children.sort((a, b) => b.bytes - a.bytes);
  const bytes = children.reduce((sum, child) => sum + child.bytes, 0);

  return {
    name: "~ (Downloads · Desktop · Documents · Containers)",
    fullPath: home,
    bytes,
    children,
    isDirectory: true,
  };
}

async function buildTree(
  targetPath: string,
  depth: number,
): Promise<SpaceNode> {
  const stats = await fs.stat(targetPath);
  const isDirectory = stats.isDirectory();

  if (!isDirectory || depth <= 0) {
    return {
      name: path.basename(targetPath) || targetPath,
      fullPath: targetPath,
      bytes: stats.size,
      children: [],
      isDirectory,
    };
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const candidatePaths: CandidatePath[] = entries
    .filter((entry) => !entry.name.startsWith("."))
    .slice(0, MAX_CHILDREN_SCAN)
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(targetPath, entry.name),
      isDirectory: entry.isDirectory(),
    }));

  const sizeMap = await getPathSizesBatch(
    candidatePaths.map((entry) => entry.fullPath),
  );

  const children = await mapLimit(
    candidatePaths,
    SIZE_CONCURRENCY,
    async (item) => {
      const bytes =
        sizeMap.get(item.fullPath) ?? (await pathSizeFast(item.fullPath));
      return {
        name: item.name,
        fullPath: item.fullPath,
        bytes,
        children: [] as SpaceNode[],
        isDirectory: item.isDirectory,
      } satisfies SpaceNode;
    },
  );

  children.sort((a, b) => b.bytes - a.bytes);

  if (depth > 1) {
    const expandable = children
      .filter((child) => child.isDirectory)
      .slice(0, MAX_CHILDREN_EXPAND);

    await mapLimit(expandable, SIZE_CONCURRENCY, async (child) => {
      const expanded = await buildTree(child.fullPath, depth - 1);
      child.children = expanded.children;
      child.bytes = expanded.bytes;
    });

    children.sort((a, b) => b.bytes - a.bytes);
  }

  const bytes = children.reduce((sum, child) => sum + child.bytes, 0);
  return {
    name: path.basename(targetPath) || targetPath,
    fullPath: targetPath,
    bytes,
    children,
    isDirectory: true,
  };
}

async function getPathSizesBatch(
  paths: string[],
): Promise<Map<string, number>> {
  const output = new Map<string, number>();
  if (paths.length === 0) {
    return output;
  }

  for (let index = 0; index < paths.length; index += DU_BATCH_SIZE) {
    const chunk = paths.slice(index, index + DU_BATCH_SIZE);
    const result = await runCommand("du", ["-sk", ...chunk], {
      allowFailure: true,
    });

    if (result.code !== 0 || !result.stdout.trim()) {
      continue;
    }

    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) {
        continue;
      }

      const kiloBytes = Number.parseInt(match[1], 10);
      const fullPath = match[2];
      if (Number.isFinite(kiloBytes) && kiloBytes >= 0) {
        output.set(fullPath, kiloBytes * 1024);
      }
    }
  }

  return output;
}

function printTree(node: SpaceNode, prefix: string): void {
  console.log(`${prefix}${node.name} (${bytesToHuman(node.bytes)})`);

  const children = node.children.slice(0, MAX_CHILDREN_RENDER);
  children.forEach((child, index) => {
    const isLast = index === children.length - 1;
    const branch = isLast ? "└── " : "├── ";
    const nextPrefix = `${prefix}${isLast ? "    " : "│   "}`;

    console.log(
      `${prefix}${branch}${child.name} (${bytesToHuman(child.bytes)})`,
    );
    if (child.children.length > 0) {
      printTreeChildren(child, nextPrefix);
    }
  });
}

function printTreeChildren(node: SpaceNode, prefix: string): void {
  const children = node.children.slice(0, MAX_CHILDREN_RENDER_DEEP);
  children.forEach((child, index) => {
    const isLast = index === children.length - 1;
    const branch = isLast ? "└── " : "├── ";
    console.log(
      `${prefix}${branch}${child.name} (${bytesToHuman(child.bytes)})`,
    );
  });
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const current = nextIndex;
        nextIndex += 1;

        if (current >= items.length) {
          return;
        }

        results[current] = await mapper(items[current], current);
      }
    },
  );

  await Promise.all(workers);
  return results;
}
