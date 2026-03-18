import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { runCommand } from "../core/exec.js";
import { CommandProgress } from "../core/progress.js";
import { confirm } from "../core/prompt.js";

const NETWORK_FILES = [
  "/Library/Preferences/SystemConfiguration/com.apple.airport.preferences.plist",
  "/Library/Preferences/SystemConfiguration/NetworkInterfaces.plist",
  "/Library/Preferences/SystemConfiguration/preferences.plist",
];

export async function netFix(dryRun = false): Promise<void> {
  const progress = new CommandProgress("Network Fix", 3);
  console.log(chalk.bold("Running safe network fixes..."));
  await progress.step("Flushing DNS cache", async () =>
    runCommand("sudo", ["dscacheutil", "-flushcache"], {
      dryRun,
      allowFailure: true,
    }),
  );
  await progress.step("Restarting mDNSResponder", async () =>
    runCommand("sudo", ["killall", "-HUP", "mDNSResponder"], {
      dryRun,
      allowFailure: true,
    }),
  );
  await progress.step("Detecting network hardware", async () =>
    runCommand("networksetup", ["-detectnewhardware"], {
      dryRun,
      allowFailure: true,
    }),
  );
  console.log(chalk.green("Network fix completed."));
}

export async function netReset(dryRun = false, yes = false): Promise<void> {
  const progress = new CommandProgress("Network Reset", 3);
  console.log(
    chalk.bold(
      "Preview: network reset will remove and recreate macOS network preference files.",
    ),
  );
  for (const file of NETWORK_FILES) {
    console.log(`- ${file}`);
  }

  const approved = await confirm("Proceed with network reset?", yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  const backupDir = path.join(
    os.homedir(),
    `.your-backups/network-${Date.now()}`,
  );
  await progress.step("Preparing backup directory", async () => {
    if (!dryRun) {
      await fs.mkdir(backupDir, { recursive: true });
    }
  });

  await progress.step(
    "Backing up and removing network plist files",
    async () => {
      for (const file of NETWORK_FILES) {
        await runCommand("sudo", ["cp", file, backupDir], {
          dryRun,
          allowFailure: true,
        });
        await runCommand("sudo", ["rm", "-f", file], {
          dryRun,
          allowFailure: true,
        });
      }
    },
  );

  await progress.step("Restarting DNS services", async () =>
    runCommand("sudo", ["killall", "-HUP", "mDNSResponder"], {
      dryRun,
      allowFailure: true,
    }),
  );
  console.log(chalk.green(`Network reset complete. Backup: ${backupDir}`));
}
