import chalk from "chalk";

export function printNextCommands(title: string, commands: string[]): void {
  if (commands.length === 0) {
    return;
  }

  console.log(chalk.bold(title));
  for (const command of commands) {
    console.log(chalk.dim(`- ${command}`));
  }
}
