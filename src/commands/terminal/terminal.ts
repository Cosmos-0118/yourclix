import { Command } from "commander";
import { runTerminalClean } from "../../services/terminal/terminal.js";
import { withGlobalOptions } from "../helpers.js";

const EXAMPLES = `
Examples:
  your terminal
  your terminal --soft
  your terminal --history
  your terminal --history -y
  your terminal clean
  your terminal clean --soft
`;

function attachTerminalCleanOptions(cmd: Command): Command {
  return withGlobalOptions(cmd)
    .option(
      "--soft",
      "only clear scrollback + screen; skip full reset (RIS) — use in tmux/SSH if needed",
    )
    .option("--history", "also clear on-disk shell history (backed up under ~/.your-backups)");
}

export function registerTerminal(program: Command): void {
  const terminal = program
    .command("terminal")
    .description(
      "Clear scrollback, reset the viewport, and optionally clear shell history (not just clear).",
    );

  attachTerminalCleanOptions(terminal)
    .addHelpText("after", EXAMPLES)
    .action(async (options) => {
      await runTerminalClean(
        options.dryRun,
        options.yes,
        options.history,
        options.soft,
      );
    });

  attachTerminalCleanOptions(
    terminal.command("clean").description("Legacy alias — same as your terminal"),
  ).action(async (options) => {
    await runTerminalClean(
      options.dryRun,
      options.yes,
      options.history,
      options.soft,
    );
  });
}
