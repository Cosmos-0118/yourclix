import { Command } from "commander";
import {
  installPlugin,
  listPlugins,
  removePlugin,
  searchPlugins,
} from "../services/plugin.js";
import { withGlobalOptions } from "./helpers.js";

export function registerPlugin(program: Command): void {
  const plugin = program.command("plugin").description("Plugin management");

  plugin
    .command("list")
    .description("List installed plugins")
    .action(async () => {
      await listPlugins();
    });

  plugin
    .command("search")
    .description("Search plugins")
    .argument("<query>", "search query")
    .action(async (query: string) => {
      await searchPlugins(query);
    });

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
