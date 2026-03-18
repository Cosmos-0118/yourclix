import { Command } from "commander";
import { netFix, netReset } from "../services/network.js";
import { withGlobalOptions } from "./helpers.js";

export function registerNet(program: Command): void {
  const net = program.command("net").description("Network tools");

  withGlobalOptions(
    net.command("fix").description("Apply safe network fixes"),
  ).action(async (options) => {
    await netFix(Boolean(options.dryRun));
  });

  withGlobalOptions(
    net
      .command("reset")
      .description("Reset network configuration with backups"),
  ).action(async (options) => {
    await netReset(Boolean(options.dryRun), Boolean(options.yes));
  });
}
