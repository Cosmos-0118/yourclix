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
import { withIntroOutro } from "../../core/task-ui.js";

function titleFor(name: string, dryRun: boolean): string {
  return dryRun ? `your brew ${name} · dry run` : `your brew ${name}`;
}

export function registerBrew(program: Command): void {
  const brew = program.command("brew").description("Homebrew manager");

  withGlobalOptions(
    brew.command("doctor").description("Run brew doctor"),
  ).action(async (options) => {
    const dryRun = Boolean(options.dryRun);
    await withIntroOutro(titleFor("doctor", dryRun), () => brewDoctor(dryRun));
  });

  withGlobalOptions(
    brew.command("status").description("Show Homebrew configuration and freshness"),
  ).action(async () => {
    await withIntroOutro("your brew status", () => brewStatus());
  });

  withGlobalOptions(
    brew.command("clean").description("Clean Homebrew cache and old versions"),
  ).action(async (options) => {
    const dryRun = Boolean(options.dryRun);
    await withIntroOutro(titleFor("clean", dryRun), () => brewClean(dryRun));
  });

  withGlobalOptions(
    brew
      .command("autoremove")
      .description("Preview and remove unused Homebrew dependencies"),
  ).action(async (options) => {
    const dryRun = Boolean(options.dryRun);
    await withIntroOutro(titleFor("autoremove", dryRun), () =>
      brewAutoremove(dryRun),
    );
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
    const dryRun = Boolean(options.dryRun);
    await withIntroOutro(titleFor("upgrade", dryRun), () =>
      brewUpgrade(dryRun, Boolean(options.verbose), Boolean(options.greedy)),
    );
  });

  withGlobalOptions(
    brew.command("optimize").description("Run doctor, upgrade, and cleanup"),
  ).action(async (options) => {
    const dryRun = Boolean(options.dryRun);
    await withIntroOutro(titleFor("optimize", dryRun), () => brewOptimize(dryRun));
  });
}
