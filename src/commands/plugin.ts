import { Command } from "commander";
import { installPlugin, removePlugin } from "../services/plugin.js";
import { withGlobalOptions } from "./helpers.js";

export function registerPlugin(program: Command): void {
  const plugin = program.command("plugin").description("Plugin management");

  withGlobalOptions(
    plugin
      .command("install")
      .description("Install plugin")
      .argument("<name>", "plugin name"),
  ).action(async (name: string, options) => {
    await installPlugin(name, Boolean(options.dryRun));
  });

  withGlobalOptions(
    plugin
      .command("remove")
      .description("Remove plugin")
      .argument("<name>", "plugin name"),
  ).action(async (name: string, options) => {
    await removePlugin(name, Boolean(options.dryRun));
  });
}
