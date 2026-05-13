import { Command } from "commander";
import { runAutoFix } from "../../services/fix/index.js";
import { withGlobalOptions } from "../helpers.js";

export function registerFix(program: Command): void {
  withGlobalOptions(
    program
      .command("fix")
      .description(
        "Apply safe fixes from doctor (bounded symlink cleanup, Homebrew upgrade path)",
      )
      .option(
        "--verbose",
        "show full Homebrew output during upgrade (otherwise high-signal lines only)",
      )
      .addHelpText(
        "after",
        `
Examples:
  your fix                    # review plan, then confirm each action
  your fix -y                 # non-interactive confirmations
  your fix --dry-run -y       # preview only (no filesystem or brew changes)
  your fix --dry-run -y --verbose
`,
      ),
  ).action(async (options) => {
    await runAutoFix(
      Boolean(options.dryRun),
      Boolean(options.yes),
      Boolean(options.verbose),
    );
  });
}
