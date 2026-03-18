import { Command } from "commander";
import {
  executeCleaner,
  printCleanerResults,
  runCleanerSelfCheck,
  scanCleanerTargets,
} from "../services/cleaner.js";
import { withGlobalOptions } from "./helpers.js";
import type { RunLevel } from "../core/types.js";
import { resolveRetentionDays } from "../services/clean-heuristics.js";

export function registerClean(program: Command): void {
  withGlobalOptions(
    program
      .command("clean")
      .description("Scan and clean system clutter")
      .option("--safe", "legacy alias for basic mode")
      .option("--deep", "legacy alias for deep mode")
      .option("--system", "system-wide cleanup mode (advanced)")
      .option("--days <days>", "delete only files older than this many days")
      .option("--verify", "run cleaner self-check and exit")
      .option("--mode <mode>", "run level: basic | deep | system", "basic")
      .addHelpText(
        "after",
        `
Examples:
  your clean --mode basic
  your clean --mode deep --days 14 --dry-run
  your clean --system -y
`,
      ),
  ).action(async (options) => {
    const mode = resolveRunLevel(options);

    if (options.verify) {
      await runCleanerSelfCheck(mode);
      return;
    }

    const olderThanDays = await resolveRetentionDays({
      mode,
      rawDays: options.days,
      assumeYes: options.yes,
    });

    const results = await scanCleanerTargets(mode);
    printCleanerResults(results);
    await executeCleaner(results, {
      mode,
      olderThanDays,
      dryRun: options.dryRun,
      yes: options.yes,
    });
  });
}

function resolveRunLevel(options: {
  safe?: boolean;
  deep?: boolean;
  system?: boolean;
  days?: string;
  mode?: string;
}): RunLevel {
  if (options.system) {
    return "system";
  }

  if (options.deep) {
    return "deep";
  }

  if (options.safe) {
    return "basic";
  }

  const mode = (options.mode ?? "basic").toLowerCase();
  if (mode === "basic" || mode === "deep" || mode === "system") {
    return mode;
  }

  throw new Error(
    `Invalid clean mode '${options.mode}'. Use one of: basic, deep, system.`,
  );
}
