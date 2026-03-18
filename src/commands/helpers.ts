import { Command } from "commander";

export function withGlobalOptions(command: Command): Command {
  return command
    .option("--dry-run", "preview actions without changing anything")
    .option("-y, --yes", "skip confirmation prompts");
}
