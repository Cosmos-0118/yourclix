import { Command } from "commander";
import { devClean, devReset } from "../services/dev.js";
import { withGlobalOptions } from "./helpers.js";

export function registerDev(program: Command): void {
  const dev = program.command("dev").description("Developer environment tools");

  withGlobalOptions(
    dev
      .command("clean")
      .description("Clean developer caches and build artifacts"),
  ).action(async (options) => {
    await devClean(Boolean(options.dryRun), Boolean(options.yes));
  });

  withGlobalOptions(
    dev
      .command("reset")
      .description("Reset a specific dev tool environment")
      .argument("<tool>", "tool to reset"),
  ).action(async (tool: string, options) => {
    await devReset(tool, Boolean(options.dryRun));
  });
}
