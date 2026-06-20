import { Command } from "commander";
import { runTerminalClean } from "../../services/terminal/terminal.js";

export function registerTerminal(program: Command): void {
  const terminal = program
    .command("terminal")
    .description("Clear the terminal and scrollback, making it look like a new terminal opened.");

  terminal.action(() => {
    runTerminalClean();
  });

  terminal
    .command("clean")
    .description("Legacy alias — same as your terminal")
    .action(() => {
      runTerminalClean();
    });
}
