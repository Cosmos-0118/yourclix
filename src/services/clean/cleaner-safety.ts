import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../../core/exec.js";
import { ui } from "../../core/ui.js";
import { isTrustedTemporaryRoot } from "../../managers/clean-scan-manager.js";
import {
  isProtectedCleanupPath,
  type CleanerHeuristicPolicy,
} from "../../managers/clean-heuristics-manager.js";

export interface CleanerActivity {
  paths: string[];
  commands?: string[];
  available: boolean;
}

export interface CleanerInspection {
  bytes: number;
  newestMtimeMs: number;
  dev: number;
  ino: number;
  reason: string | null;
}

/** One snapshot per preflight; never recurse through lsof +D on large trees. */
export async function readCleanerActivity(): Promise<CleanerActivity> {
  const read = async (command: string, args: string[]) => {
    try {
      return await runCommand(command, args, { allowFailure: true });
    } catch (error) {
      ui.throwIfCancelled();
      return {
        code: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const uid = String(process.getuid?.() ?? os.userInfo().uid);
  const result = await read("lsof", ["-nP", "-F", "n", "-u", uid]);
  const processes = await read("ps", ["-axo", "uid=,command="]);
  const commands = processes.stdout.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match?.[1] === uid ? [match[2]] : [];
  });
  const paths = result.stdout
    .split("\n")
    .filter((line) => line.startsWith("n/"))
    .map((line) => canonicalPath(line.slice(1).replace(/ \(deleted\)$/, "")));
  return {
    paths: [...new Set(paths)],
    commands,
    available:
      result.code === 0 &&
      !result.stderr.trim() &&
      processes.code === 0 &&
      !processes.stderr.trim(),
  };
}

/** macOS exposes these system aliases; other symlinked parents are rejected. */
function canonicalPath(value: string): string {
  return path
    .resolve(value)
    .replace(/^\/var\//, "/private/var/")
    .replace(/^\/tmp\//, "/private/tmp/");
}

function nested(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export async function inspectCleanerTarget(
  targetPath: string,
  policy: CleanerHeuristicPolicy,
  activity: CleanerActivity,
  options: { now?: number; maxEntries?: number } = {},
): Promise<CleanerInspection> {
  let bytes = 0;
  let newestMtimeMs = 0;
  let dev = 0;
  let ino = 0;
  const result = (reason: string | null): CleanerInspection => ({
    bytes,
    newestMtimeMs,
    dev,
    ino,
    reason,
  });
  const target = path.resolve(targetPath);
  if (isProtectedCleanupPath(target, policy.protectedPaths))
    return result("protected-path");
  if (!activity.available) return result("activity-check-unavailable");
  const canonical = canonicalPath(target);
  if (activity.paths.some((open) => nested(open, canonical)))
    return result("in-use");
  const commands = activity.commands ?? [];
  if (
    commands.some(
      (command) => command.includes(target) || command.includes(canonical),
    )
  )
    return result("in-use");
  if (
    target.includes("/.bun/install/cache/") &&
    commands.some((command) => /(?:^|[\s/])bun(?:\s|$)/.test(command))
  )
    return result("in-use");
  if (
    target.includes("/.npm/") &&
    commands.some((command) => /(?:^|[\s/])(?:npm|npx)(?:\s|$)/.test(command))
  )
    return result("in-use");
  if (
    target.includes("/.gradle/") &&
    commands.some((command) =>
      /GradleDaemon|GradleWrapperMain|(?:^|[\s/])gradle(?:\s|$)/.test(command),
    )
  )
    return result("in-use");
  const home = path.resolve(policy.home);
  const temporaryRoot = policy.tmpDir;
  const inTemp =
    isTrustedTemporaryRoot(temporaryRoot) &&
    nested(canonical, canonicalPath(temporaryRoot)) &&
    canonical !== canonicalPath(temporaryRoot);
  const inSystemDiagnostics =
    policy.mode === "system" &&
    path.dirname(target) === "/Library/Logs/DiagnosticReports" &&
    /\.(crash|ips)$/.test(target);
  if (
    (!nested(target, home) || target === home) &&
    !inTemp &&
    !inSystemDiagnostics
  )
    return result("outside-cleanup-roots");

  try {
    // Reject a symlink in any parent component, not just at the matched leaf.
    if (canonicalPath(await fs.realpath(target)) !== canonical)
      return result("symlink-path");
    const rootStat = await fs.lstat(target);
    dev = rootStat.dev;
    ino = rootStat.ino;
    const uid = process.getuid?.() ?? os.userInfo().uid;
    const cutoff =
      (options.now ?? Date.now()) - policy.olderThanDays * 86400000;
    const stack = [target];
    const seen = new Set<string>();
    let visited = 0;
    while (stack.length) {
      ui.throwIfCancelled();
      if (++visited > (options.maxEntries ?? 50000))
        return result("inspection-limit");
      const current = stack.pop()!;
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) return result("symlink-path");
      if (stat.dev !== dev) return result("different-filesystem");
      if (stat.uid !== uid) return result("different-owner");
      if (!stat.isDirectory() && !stat.isFile()) return result("special-file");
      newestMtimeMs = Math.max(newestMtimeMs, stat.mtimeMs);
      if (!Number.isFinite(stat.mtimeMs) || stat.mtimeMs > cutoff)
        return result(`newer-than-${policy.olderThanDays}d`);
      const key = `${stat.dev}:${stat.ino}`;
      if (!seen.has(key)) {
        bytes += stat.blocks * 512;
        seen.add(key);
      }
      if (stat.isDirectory()) {
        const entries = await fs.readdir(current);
        if (entries.includes(".git")) return result("nested-project");
        for (const name of entries) {
          const child = path.join(current, name);
          if (isProtectedCleanupPath(child, policy.protectedPaths))
            return result("protected-path");
          stack.push(child);
        }
      }
    }
    return result(null);
  } catch (error) {
    ui.throwIfCancelled();
    const code = (error as NodeJS.ErrnoException).code;
    return result(
      code === "ENOENT"
        ? "not-found"
        : code === "EACCES" || code === "EPERM"
          ? "permission-denied"
          : "inspection-failed",
    );
  }
}
