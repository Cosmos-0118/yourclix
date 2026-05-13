import { Command } from "commander";
import { privacyClean } from "../services/privacy.js";
import { withGlobalOptions } from "./helpers.js";

export function registerPrivacy(program: Command): void {
  const privacy = program
    .command("privacy")
    .description("Privacy cleanup tools");

  withGlobalOptions(
    privacy
      .command("clean")
      .description("Clear browser cache and recent metadata"),
  ).action(async (options) => {
    await privacyClean(Boolean(options.dryRun), Boolean(options.yes));
  });
}
