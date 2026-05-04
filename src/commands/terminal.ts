import { Command } from "commander";
import { runTerminalClean } from "../services/terminal.js";
import { withGlobalOptions } from "./helpers.js";

export function registerTerminal(program: Command): void {
  withGlobalOptions(
    program
      .command("terminal")
      .description("Terminal utilities")
      .command("clean")
      .description(
        "Deep reset: scrollback, screen, and full terminal RIS (not just clear); optional history",
      )
      .option(
        "--soft",
        "only clear scrollback + screen; skip full reset (RIS) — use in tmux/SSH if needed",
      )
      .option("--history", "also clear on-disk shell history (backed up under ~/.your-backups)"),
  )
    .addHelpText(
      "after",
      `
Examples:
  your terminal clean
  your terminal clean --soft
  your terminal clean --history
  your terminal clean --history -y
`,
    )
    .action(async (options) => {
      await runTerminalClean(
        options.dryRun,
        options.yes,
        options.history,
        options.soft,
      );
    });
}
