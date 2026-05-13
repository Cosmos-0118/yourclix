import { Command } from "commander";
import { netFix, netReset } from "../../services/network/index.js";
import { withGlobalOptions } from "../helpers.js";

export function registerNet(program: Command): void {
  const net = program
    .command("net")
    .description("Repair connectivity (net fix) or reset network plists (net reset)")
    .addHelpText(
      "after",
      `
Examples:
  your net fix
  your net fix --dry-run
  your net reset --dry-run
  your net reset -y
`,
    );

  withGlobalOptions(
    net
      .command("fix")
      .description(
        "ARP, DNS, mDNS, DHCP, Wi‑Fi soft-cycle — clear boxed summary",
      ),
  ).action(async (options) => {
    await netFix(Boolean(options.dryRun));
  });

  withGlobalOptions(
    net
      .command("reset")
      .description(
        "Backup and remove SystemConfiguration plists (destructive)",
      ),
  ).action(async (options) => {
    await netReset(Boolean(options.dryRun), Boolean(options.yes));
  });
}
