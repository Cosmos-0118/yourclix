import { Command } from "commander";
import { runTerminalClean } from "../services/terminal.js";
import { withGlobalOptions } from "./helpers.js";

export function registerTerminal(program: Command): void {
  withGlobalOptions(
    program
      .command("terminal")
      .description("Terminal utilities")
      .command("clean")
      .description("Clear terminal viewport and optionally shell history")
      .option("--history", "also clean shell history (with backup)"),
  ).action(async (options) => {
    await runTerminalClean(options.dryRun, options.yes, options.history);
  });
}
