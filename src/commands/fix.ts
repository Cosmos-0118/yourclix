import { Command } from "commander";
import { runAutoFix } from "../services/fixer.js";
import { withGlobalOptions } from "./helpers.js";

export function registerFix(program: Command): void {
  withGlobalOptions(
    program
      .command("fix")
      .description("Automatically apply safe fixes based on doctor findings"),
  ).action(async (options) => {
    await runAutoFix(Boolean(options.dryRun), Boolean(options.yes));
  });
}
