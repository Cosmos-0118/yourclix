import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../../core/exec.js";
import { ui, type CliUI } from "../../core/ui.js";
import { compactPath } from "../../core/format.js";
import type { CleanerOptions, ScanResult } from "../../core/types.js";
import { isProtectedCleanupPath } from "../../managers/clean-heuristics-manager.js";
import { readCleanerExclusions } from "./cleaner-exclusions.js";
import os from "node:os";

/** uv owns cache locking and object reachability; never move its entries. */
export async function handleManagedCleanerCaches(
  caches: ScanResult[],
  options: CleanerOptions,
  terminal: CliUI = ui,
  excludedPaths: string[] = [],
): Promise<void> {
  const allUvPaths = [
    ...new Set(
      caches
        .filter((cache) => cache.managedBy === "uv")
        .flatMap((cache) => cache.paths),
    ),
  ];
  const uvPaths = allUvPaths.filter(
    (target) => !isProtectedCleanupPath(target, excludedPaths),
  );
  if (caches.some((cache) => cache.managedBy === "gradle"))
    terminal.notice("Gradle manages its shared dependency cache", [
      "Kept intact. Gradle performs age-based cache cleanup when builds run or the daemon stops.",
    ]);
  if (!uvPaths.length) {
    if (options.pruneUv)
      terminal.notice(
        allUvPaths.length
          ? "uv cache protected by your exclusion list."
          : "No uv cache found at the supported cache locations.",
      );
    return;
  }
  if (!options.pruneUv) {
    terminal.notice("uv cache requires native pruning", [
      "Kept intact to preserve cache locks and shared environments.",
      "Preview: your clean --prune-uv --dry-run",
      "Prune unused entries: your clean --prune-uv",
    ]);
    return;
  }
  terminal.list("uv cache pruning", [
    ...uvPaths.map((target) => compactPath(target)),
    "uv removes unreachable entries permanently using its own locks.",
    "The --days retention setting and undo backup do not apply to this operation.",
    "The full cache size is not a reclaim estimate.",
  ]);
  if (options.dryRun) {
    terminal.status(
      "skipped",
      "Would run uv cache prune; no command executed.",
    );
    return;
  }
  if (
    !(await terminal.confirm(
      "Permanently prune unused uv cache entries using uv?",
      Boolean(options.yes),
    ))
  ) {
    terminal.status("skipped", "uv cache kept.");
    return;
  }
  for (const target of uvPaths) {
    if (
      isProtectedCleanupPath(target, await readCleanerExclusions(os.homedir()))
    ) {
      terminal.status("skipped", "uv cache protected by your exclusion list.");
      continue;
    }
    // The scanner supports only these explicit cache roots. Reject a symlink
    // or a changed root before handing a directory to the native command.
    const stat = await fs.lstat(target);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await fs.realpath(target)) !== path.resolve(target) ||
      stat.uid !== process.getuid?.()
    ) {
      throw new Error(
        `uv cache path is not a user-owned directory: ${compactPath(target)}`,
      );
    }
    const result = await terminal.task("Prune unused uv cache entries", () =>
      runCommand(
        "uv",
        [
          "--no-config",
          "--offline",
          "--no-progress",
          "--color",
          "never",
          "cache",
          "prune",
          "--cache-dir",
          target,
        ],
        { allowFailure: true, env: { UV_LOCK_TIMEOUT: "1" } },
      ),
    );
    if (result.code !== 0)
      throw new Error(
        `uv cache prune failed; no forced removal attempted: ${result.stderr || result.stdout}`,
      );
    if (result.stderr || result.stdout)
      terminal.note([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
}
