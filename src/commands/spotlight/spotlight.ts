import { Command } from "commander";
import { spotlightReset, spotlightStatus } from "../services/spotlight.js";
import { withGlobalOptions } from "./helpers.js";

export function registerSpotlight(program: Command): void {
  const spotlight = program
    .command("spotlight")
    .description("Spotlight index manager");

  spotlight
    .command("status")
    .description("Show Spotlight indexing status")
    .action(async () => {
      await spotlightStatus();
    });

  withGlobalOptions(
    spotlight
      .command("reset")
      .description("Reset Spotlight indexing")
      .option("--path <path>", "target path to rebuild"),
  ).action(async (options) => {
    await spotlightReset(options.path, Boolean(options.dryRun));
  });
}
