import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CommandProgress } from "../core/progress.js";
import { bytesToHuman } from "../core/format.js";
import { pathSize } from "../core/fs-utils.js";

interface SpaceNode {
  name: string;
  fullPath: string;
  bytes: number;
  children: SpaceNode[];
}

export async function analyzeSpace(
  basePath?: string,
  depth = 2,
): Promise<void> {
  const progress = new CommandProgress("Disk Space Analyzer", 2);
  const rootPath = basePath ?? os.homedir();
  const root = await progress.step(
    `Building usage tree for ${rootPath} (depth ${depth})`,
    async () => buildTree(rootPath, depth),
  );
  progress.tick("Rendering visual tree");
  printTree(root, "");
}

async function buildTree(
  targetPath: string,
  depth: number,
): Promise<SpaceNode> {
  const stats = await fs.stat(targetPath);
  if (!stats.isDirectory() || depth <= 0) {
    return {
      name: path.basename(targetPath),
      fullPath: targetPath,
      bytes: stats.size,
      children: [],
    };
  }

  const childrenDirents = await fs.readdir(targetPath, { withFileTypes: true });
  const children = await Promise.all(
    childrenDirents
      .filter((entry) => !entry.name.startsWith("."))
      .slice(0, 20)
      .map((entry) => buildTree(path.join(targetPath, entry.name), depth - 1)),
  );

  const childSize = await Promise.all(
    children.map((child) => pathSize(child.fullPath)),
  );
  children.forEach((child, index) => {
    child.bytes = childSize[index];
  });

  const bytes = children.reduce((sum, child) => sum + child.bytes, 0);
  return {
    name: path.basename(targetPath) || targetPath,
    fullPath: targetPath,
    bytes,
    children: children.sort((a, b) => b.bytes - a.bytes),
  };
}

function printTree(node: SpaceNode, prefix: string): void {
  console.log(`${prefix}${node.name} (${bytesToHuman(node.bytes)})`);

  const limitedChildren = node.children.slice(0, 10);
  limitedChildren.forEach((child, index) => {
    const isLast = index === limitedChildren.length - 1;
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
  const limitedChildren = node.children.slice(0, 5);
  limitedChildren.forEach((child, index) => {
    const isLast = index === limitedChildren.length - 1;
    const branch = isLast ? "└── " : "├── ";
    console.log(
      `${prefix}${branch}${child.name} (${bytesToHuman(child.bytes)})`,
    );
  });
}
