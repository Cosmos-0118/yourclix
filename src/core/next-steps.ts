import chalk from "chalk";
import { terminalWidth, wrapText } from "./format.js";

export function printNextCommands(title: string, commands: string[]): void {
  if (commands.length === 0) {
    return;
  }

  console.log(chalk.bold(title));
  for (const command of commands) {
    console.log(chalk.dim(wrapText(`- ${command}`, Math.max(20, terminalWidth() - 2)).join("\n")));
  }
}
