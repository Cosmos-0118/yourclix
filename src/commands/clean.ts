import { Command } from "commander";
import {
  executeCleaner,
  printCleanerResults,
  runCleanerSelfCheck,
  scanCleanerTargets,
} from "../services/cleaner.js";
import { withGlobalOptions } from "./helpers.js";
import type { RunLevel } from "../core/types.js";

export function registerClean(program: Command): void {
  withGlobalOptions(
    program
      .command("clean")
      .description("Scan and clean system clutter")
      .option("--safe", "legacy alias for basic mode")
      .option("--deep", "legacy alias for deep mode")
      .option("--system", "system-wide cleanup mode (advanced)")
      .option("--verify", "run cleaner self-check and exit")
      .option("--mode <mode>", "run level: basic | deep | system", "basic"),
  ).action(async (options) => {
    const mode = resolveRunLevel(options);

    if (options.verify) {
      await runCleanerSelfCheck(mode);
      return;
    }

    const results = await scanCleanerTargets(mode);
    printCleanerResults(results);
    await executeCleaner(results, {
      mode,
      dryRun: options.dryRun,
      yes: options.yes,
    });
  });
}

function resolveRunLevel(options: {
  safe?: boolean;
  deep?: boolean;
  system?: boolean;
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
