import { Command } from "commander";
import { runSetup } from "../services/setup.js";

export function registerSetup(program: Command): void {
  program
    .command("setup")
    .description("Install and configure developer essentials")
    .option("--fast", "non-interactive setup with default choices")
    .option("--apps", "install common desktop apps")
    .option("--profile <profile>", "setup profile: minimal | webdev | full")
    .option(
      "--app-mode <mode>",
      "desktop app bundle: none | minimal | webdev | full",
    )
    .option("--config <path>", "path to setup JSON config file")
    .option("--debug", "enable verbose setup debug logging")
    .option("--dry-run", "preview actions without changing anything")
    .action(async (options) => {
      await runSetup(options);
    });
}
