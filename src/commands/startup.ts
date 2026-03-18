import { Command } from "commander";
import { disableStartupItem, listStartupItems } from "../services/startup.js";
import { withGlobalOptions } from "./helpers.js";

export function registerStartup(program: Command): void {
  const startup = program
    .command("startup")
    .description("Startup/login item manager");

  startup
    .command("list")
    .description("List startup items")
    .action(async () => {
      await listStartupItems();
    });

  withGlobalOptions(
    startup
      .command("disable")
      .description("Disable a startup item")
      .argument("<name>", "item name"),
  ).action(async (name: string, options) => {
    await disableStartupItem(name, Boolean(options.dryRun));
  });
}
