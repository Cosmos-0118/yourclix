import chalk from "chalk";
import boxen from "boxen";
import fg from "fast-glob";
import { bytesToHuman, pad } from "../../core/format.js";
import { CommandProgress } from "../../core/progress.js";
import { sumPathSizesFast } from "../../core/fs-utils.js";
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

  return results;
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
    `  ${pad("Estimated reclaimable", 24)} ${chalk.bold.cyan(bytesToHuman(total))}`,
  );
}
