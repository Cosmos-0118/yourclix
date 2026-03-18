import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../core/exec.js";

const SHELL_FILES = [".zprofile", ".zshrc"];
const PATH_MARKER = "# your CLI managed PATH";

export interface PathManagerResult {
  commandPath: string[];
  addedToCurrentSession: string[];
  addedToShellFiles: string[];
  fallbackApplied: string[];
}

function splitPath(input: string): string[] {
  return input
    .split(":")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasPathEntry(pathValue: string, candidate: string): boolean {
  return splitPath(pathValue).includes(candidate);
}

async function existsDir(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function getNpmGlobalBin(): Promise<string | null> {
  const prefix = await runCommand("npm", ["prefix", "-g"], {
    allowFailure: true,
  });
  if (prefix.code !== 0 || !prefix.stdout.trim()) {
    return null;
  }

  return path.join(prefix.stdout.trim(), "bin");
}

async function appendPathLineIfMissing(
  filePath: string,
  dirPath: string,
): Promise<boolean> {
  const exportLine = `export PATH=\"${dirPath}:$PATH\"`;

  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    content = "";
  }

  if (content.includes(exportLine)) {
    return false;
  }

  const next = `${content.trimEnd()}\n\n${PATH_MARKER}\n${exportLine}\n`;
  await fs.writeFile(filePath, next, "utf8");
  return true;
}

async function verifyCommandWithPath(
  command: string,
  pathValue: string,
): Promise<boolean> {
  const result = await runCommand("which", [command], {
    allowFailure: true,
    env: {
      ...process.env,
      PATH: pathValue,
    },
  });

  return result.code === 0;
}

export async function ensureManagedPath(
  commandToVerify = "your",
): Promise<PathManagerResult> {
  const discovered: string[] = [];
  const home = os.homedir();
  const npmBin = await getNpmGlobalBin();

  for (const candidate of [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local/bin"),
    npmBin,
  ]) {
    if (!candidate) {
      continue;
    }

    if (await existsDir(candidate)) {
      discovered.push(candidate);
    }
  }

  const currentPath = process.env.PATH ?? "";
  const addedToCurrentSession: string[] = [];

  let nextPath = currentPath;
  for (const dirPath of discovered) {
    if (!hasPathEntry(nextPath, dirPath)) {
      nextPath = `${dirPath}:${nextPath}`;
      addedToCurrentSession.push(dirPath);
    }
  }

  process.env.PATH = nextPath;

  const addedToShellFiles: string[] = [];
  for (const shellFile of SHELL_FILES) {
    const fullPath = path.join(home, shellFile);
    for (const dirPath of discovered) {
      const changed = await appendPathLineIfMissing(fullPath, dirPath);
      if (changed) {
        addedToShellFiles.push(`${shellFile}:${dirPath}`);
      }
    }
  }

  const fallbackApplied: string[] = [];
  const resolved = await verifyCommandWithPath(
    commandToVerify,
    process.env.PATH ?? "",
  );
  if (!resolved) {
    // Fallback: sync PATH into launch services so future login shells inherit a healthy PATH.
    await runCommand("launchctl", ["setenv", "PATH", process.env.PATH ?? ""], {
      allowFailure: true,
    });
    fallbackApplied.push("launchctl:setenv:PATH");
  }

  return {
    commandPath: discovered,
    addedToCurrentSession,
    addedToShellFiles,
    fallbackApplied,
  };
}
