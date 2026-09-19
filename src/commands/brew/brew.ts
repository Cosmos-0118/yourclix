import { Command } from "commander";
import {
  brewClean,
  brewDoctor,
  brewOptimize,
  brewAutoremove,
  brewStatus,
  brewUpgrade,
} from "../../services/brew/brew.js";
import { withGlobalOptions } from "../helpers.js";

export function registerBrew(program: Command): void {
  const brew = program.command("brew").description("Homebrew manager");

  withGlobalOptions(
    brew.command("doctor").description("Run brew doctor"),
  ).action(async (options) => {
    await brewDoctor(Boolean(options.dryRun));
  });

  withGlobalOptions(
    brew.command("status").description("Show Homebrew configuration and freshness"),
  ).action(async () => {
    await brewStatus();
  });

  withGlobalOptions(
    brew.command("clean").description("Clean Homebrew cache and old versions"),
  ).action(async (options) => {
    await brewClean(Boolean(options.dryRun));
  });

  withGlobalOptions(
    brew
      .command("autoremove")
      .description("Preview and remove unused Homebrew dependencies"),
  ).action(async (options) => {
    await brewAutoremove(Boolean(options.dryRun));
  });

  withGlobalOptions(
    brew
      .command("upgrade")
      .description("Update and upgrade Homebrew packages")
      .option(
        "--verbose",
        "show full Homebrew output (every ln/rm/pour line from brew)",
      )
      .option(
        "--greedy",
        "include casks with latest or automatic upstream updates",
      ),
  ).action(async (options) => {
    await brewUpgrade(
      Boolean(options.dryRun),
      Boolean(options.verbose),
      Boolean(options.greedy),
    );
  });

  withGlobalOptions(
    brew.command("optimize").description("Run doctor, upgrade, and cleanup"),
  ).action(async (options) => {
    await brewOptimize(Boolean(options.dryRun));
  });
}
