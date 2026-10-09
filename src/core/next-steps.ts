import { ui } from "./ui.js";
import chalk from "chalk";
import { terminalWidth, wrapText } from "./format.js";

export function printNextCommands(title: string, commands: string[]): void {
  if (commands.length === 0) {
    return;
  }

  ui.write(chalk.bold(title));
  for (const command of commands) {
    ui.write(chalk.dim(wrapText(`- ${command}`, Math.max(20, terminalWidth() - 2)).join("\n")));
  }
}
