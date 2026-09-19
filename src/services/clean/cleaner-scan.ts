import path from "node:path";
import chalk from "chalk";
import boxen from "boxen";
import fg from "fast-glob";
import { bytesToHuman, pad } from "../../core/format.js";
import { CommandProgress } from "../../core/progress.js";
import { filterToAncestorRoots, sumPathSizesFast } from "../../core/fs-utils.js";
import { getCleanerScanCategories } from "../../managers/clean-scan-manager.js";
import type { CleanerOptions, ScanResult } from "../../core/types.js";

export async function scanCleanerTargets(
  mode: CleanerOptions["mode"],
): Promise<ScanResult[]> {
  const eligible = getCleanerScanCategories(mode);

  const progress = new CommandProgress(
    `Cleaner Scan (${mode.toUpperCase()})`,
    eligible.length,
  );

  const results: ScanResult[] = [];
  for (const target of eligible) {
    const result = await progress.step(
      `Scanning ${target.category}`,
      async () => {
        const matches = await fg(target.globs, {
          dot: true,
          onlyFiles: false,
          onlyDirectories: false,
          unique: true,
          suppressErrors: true,
        });

        const distinct = [...new Set(matches)];
        const bytes = await sumPathSizesFast(distinct, 12);

        return {
          category: target.category,
          paths: distinct,
          bytes,
        } satisfies ScanResult;
      },
    );

    if (result.paths.length > 0) {
      progress.info(
        `${result.category}: ${bytesToHuman(result.bytes)} across ${result.paths.length} paths`,
      );
      if (result.paths.length > 2000) {
        progress.info(
          `${result.category}: large result set detected (${result.paths.length} paths).`,
        );
      }
      results.push(result);
    } else {
      progress.info(`${result.category}: no cleanup candidates`);
    }
  }

  return dedupeCleanerScanResults(results);
}

/**
 * Scan categories intentionally contain some overlapping patterns (for
 * example, a browser cache is also a child of ~/Library/Caches). Keep the
 * broadest matched path once so the estimate and execution plan cannot count
 * or move the same bytes multiple times.
 */
export async function dedupeCleanerScanResults(
  results: ScanResult[],
): Promise<ScanResult[]> {
  const categoryByPath = new Map<string, string>();

  for (const result of results) {
    for (const targetPath of result.paths) {
      const normalized = path.normalize(targetPath);
      if (!categoryByPath.has(normalized)) {
        categoryByPath.set(normalized, result.category);
      }
    }
  }

  const roots = filterToAncestorRoots([...categoryByPath.keys()]);
  const pathsByCategory = new Map<string, string[]>();

  for (const targetPath of roots) {
    const category = categoryByPath.get(path.normalize(targetPath));
    if (!category) {
      continue;
    }

    const categoryPaths = pathsByCategory.get(category) ?? [];
    categoryPaths.push(targetPath);
    pathsByCategory.set(category, categoryPaths);
  }

  const deduped: ScanResult[] = [];
  for (const result of results) {
    const paths = pathsByCategory.get(result.category);
    if (!paths || paths.length === 0) {
      continue;
    }

    pathsByCategory.delete(result.category);
    deduped.push({
      category: result.category,
      paths,
      bytes: await sumPathSizesFast(paths),
    });
  }

  return deduped;
}

export function printCleanerResults(results: ScanResult[]): void {
  if (!results.length) {
    console.log(chalk.green("No cleanup candidates found."));
    return;
  }

  const rule = chalk.dim("─".repeat(52));
  console.log(chalk.bold("\nScan summary"));
  console.log(rule);
  for (const result of results) {
    console.log(
      `  ${pad(result.category, 24)} ${chalk.cyan(bytesToHuman(result.bytes))}  ${chalk.dim(`${result.paths.length} paths`)}`,
    );
  }

  console.log(rule);
  const total = results.reduce((sum, item) => sum + item.bytes, 0);
  console.log(
    `  ${pad("Discovered size", 24)} ${chalk.bold.cyan(bytesToHuman(total))}`,
  );
  console.log(chalk.dim("  Eligibility is calculated during cleanup preflight."));
}
