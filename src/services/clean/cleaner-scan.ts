import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import fg from "fast-glob";
import { ui, type CliUI } from "../../core/ui.js";
import { runCommand } from "../../core/exec.js";
import { bytesToHuman, pad, pluralize } from "../../core/format.js";
import { filterToAncestorRoots } from "../../core/fs-utils.js";
import {
  getCleanerScanCategories,
  getCleanerScanIgnores,
  type CleanerScanContext,
} from "../../managers/clean-scan-manager.js";
import type { CleanerOptions, ScanResult } from "../../core/types.js";

export interface ScanHooks {
  terminal?: CliUI;
  onCategoryScanned?(result: ScanResult): void;
  onLargeResultWarning?(warning: string): void;
}

export async function scanCleanerTargets(
  mode: CleanerOptions["mode"],
  hooks?: ScanHooks,
  context: CleanerScanContext = {},
): Promise<ScanResult[]> {
  const terminal = hooks ? hooks.terminal : ui;
  const categories = getCleanerScanCategories(mode, context);
  const results: ScanResult[] = [];
  terminal?.heading(`Scan · ${mode}`);
  for (const [index, category] of categories.entries()) {
    ui.throwIfCancelled();
    const scan = async (): Promise<void> => {
      const paths = new Set<string>();
      const issues: NonNullable<ScanResult["issues"]> = [];
      // Handle independent roots separately: one denied container must not
      // turn an entire category into a silently empty result.
      for (const glob of category.globs) {
        try {
          const matches = await fg(glob, {
            dot: true,
            onlyFiles: false,
            unique: true,
            followSymbolicLinks: false,
            suppressErrors: false,
            deep: 10,
            ignore: getCleanerScanIgnores(context.home ?? os.homedir()),
          });
          for (const match of matches) paths.add(path.resolve(match));
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          issues.push({
            path: glob,
            reason:
              code === "EACCES" || code === "EPERM"
                ? "permission-denied"
                : "scan-failed",
          });
        }
      }
      if (paths.size > 5000) {
        issues.push({ path: category.category, reason: "scan-limit" });
        hooks?.onLargeResultWarning?.(
          `${category.category}: scan limited to 5000 paths.`,
        );
      }
      results.push({
        category: category.category,
        paths: [...paths].sort().slice(0, 5000),
        bytes: 0,
        managedBy: category.managedBy,
        issues,
      });
    };
    if (terminal)
      await terminal.task(
        `[${index + 1}/${categories.length}] ${category.category}`,
        scan,
      );
    else await scan();
  }
  const measure = () => dedupeCleanerScanResults(results);
  const deduped = terminal
    ? await terminal.task("Measure unique cache paths", measure)
    : await measure();
  for (const result of deduped) hooks?.onCategoryScanned?.(result);
  return deduped;
}

/** Prefer managed-cache identity, then count each ancestor only once. */
export async function dedupeCleanerScanResults(
  results: ScanResult[],
): Promise<ScanResult[]> {
  const owners = new Map<string, ScanResult>();
  for (const result of [...results].sort(
    (a, b) => Number(Boolean(b.managedBy)) - Number(Boolean(a.managedBy)),
  )) {
    for (const target of result.paths)
      if (!owners.has(path.resolve(target)))
        owners.set(path.resolve(target), result);
  }
  const roots = filterToAncestorRoots([...owners.keys()]);
  const output = results.map((result) => ({
    ...result,
    paths: [] as string[],
    bytes: 0,
    issues: [...(result.issues ?? [])],
  }));
  const byOwner = new Map(
    results.map((result, index) => [result, output[index]!]),
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, roots.length) }, async () => {
      while (next < roots.length) {
        ui.throwIfCancelled();
        const target = roots[next++];
        const owner = byOwner.get(owners.get(target)!)!;
        owner.paths.push(target);
        try {
          const stat = await fs.lstat(target);
          if (!stat.isDirectory()) {
            owner.bytes += stat.blocks * 512;
            continue;
          }
        } catch {
          owner.issues.push({ path: target, reason: "size-unavailable" });
          continue;
        }
        const measured = await runCommand("du", ["-sk", target], {
          allowFailure: true,
        });
        const kb = Number.parseInt(measured.stdout, 10);
        if (
          measured.code === 0 &&
          !measured.stderr.trim() &&
          Number.isFinite(kb) &&
          kb >= 0
        )
          owner.bytes += kb * 1024;
        else owner.issues.push({ path: target, reason: "size-unavailable" });
      }
    }),
  );
  return output
    .filter((result) => result.paths.length || result.issues.length)
    .map((result) => ({ ...result, paths: result.paths.sort() }));
}

export function printCleanerResults(
  results: ScanResult[],
  terminal: CliUI = ui,
): void {
  const visible = results.filter((result) => result.paths.length);
  const width = Math.min(
    38,
    Math.max(16, ...visible.map((result) => result.category.length)),
  );
  const rows = visible.flatMap((result) => {
    const detail = `${bytesToHuman(result.bytes)} · ${pluralize(result.paths.length, "path")}${result.managedBy ? " · tool managed" : ""}`;
    return terminal.width >= 76
      ? [`${pad(result.category, width + 2)}${detail}`]
      : [result.category, `  ${detail}`];
  });
  terminal.list(
    "Discovered caches",
    rows.length ? rows : ["No cache candidates found."],
  );
  const issues = results.flatMap((result) => result.issues ?? []);
  terminal.note(
    "Sizes are measured disk usage, not guaranteed space recovery. Eligibility is checked next.",
  );
  if (issues.length)
    terminal.notice(
      "Some locations could not be fully scanned or measured",
      [
        `${pluralize(issues.length, "scan issue")}; inaccessible or unmeasured paths are kept. Use --verbose for locations.`,
      ],
      "warn",
    );
}
