import { Command } from "commander";
import {
  brewClean,
  brewDoctor,
  brewOptimize,
  brewUpgrade,
} from "../services/brew.js";
import { withGlobalOptions } from "./helpers.js";

export function registerBrew(program: Command): void {
  const brew = program.command("brew").description("Homebrew manager");

  withGlobalOptions(
    brew.command("doctor").description("Run brew doctor"),
  ).action(async (options) => {
    await brewDoctor(Boolean(options.dryRun));
  });

  withGlobalOptions(
    brew.command("clean").description("Clean Homebrew cache and old versions"),
  ).action(async (options) => {
    await brewClean(Boolean(options.dryRun));
  });

  withGlobalOptions(
    brew.command("upgrade").description("Update and upgrade Homebrew packages"),
  ).action(async (options) => {
    await brewUpgrade(Boolean(options.dryRun));
  });

  withGlobalOptions(
    brew.command("optimize").description("Run doctor, upgrade, and cleanup"),
  ).action(async (options) => {
    await brewOptimize(Boolean(options.dryRun));
  });
}
