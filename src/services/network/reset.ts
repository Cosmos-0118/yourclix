import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { runCommand } from "../../core/exec.js";
import { confirm } from "../../core/prompt.js";
import { CommandProgress } from "../../core/progress.js";
import { createNetworkLogger } from "./logger.js";
import { ensureSudoReady } from "./preflight.js";
import { runStepCommand } from "./runner.js";
import { hasCriticalFailure, printNetworkSummary } from "./summary.js";
import type { NetworkStepResult } from "./types.js";

const NETWORK_FILES = [
  "/Library/Preferences/SystemConfiguration/com.apple.airport.preferences.plist",
  "/Library/Preferences/SystemConfiguration/NetworkInterfaces.plist",
  "/Library/Preferences/SystemConfiguration/preferences.plist",
];

export async function netReset(dryRun = false, yes = false): Promise<void> {
  console.log(chalk.bold("Running network reset..."));
  console.log(
    chalk.yellow("This is destructive and may temporarily disrupt networking."),
  );

  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) {
    console.log(
      chalk.yellow(
        "Warning: running over SSH may disconnect your current session.",
      ),
    );
  }

  console.log(chalk.bold("Plist files targeted:"));
  for (const file of NETWORK_FILES) {
    console.log(`- ${file}`);
  }

  const approved = await confirm("Proceed with network reset?", yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  const logger = await createNetworkLogger("reset");
  const steps: NetworkStepResult[] = [];
  const progress = new CommandProgress("Network Reset", 6);

  const precheck = await progress.interactiveStep(
    "Checking sudo readiness",
    async () => ensureSudoReady(dryRun, logger),
  );
  steps.push(precheck);

  const backupDir = path.join(
    os.homedir(),
    `.your-backups/network-${Date.now()}`,
  );

  if (precheck.status === "success" || precheck.status === "skipped") {
    steps.push(
      await progress.step("Preparing backup directory", async () => {
        if (!dryRun) {
          await fs.mkdir(backupDir, { recursive: true });
        }

        return {
          name: "Prepare backup directory",
          critical: true,
          status: "success",
          details: [
            dryRun ? `Would create: ${backupDir}` : `Created: ${backupDir}`,
          ],
        } satisfies NetworkStepResult;
      }),
    );

    steps.push(
      await progress.step("Backing up network plist files", async () => {
        const failures: string[] = [];

        for (const file of NETWORK_FILES) {
          const result = await runCommand(
            "sudo",
            ["-n", "cp", file, backupDir],
            {
              dryRun,
              allowFailure: true,
            },
          );

          if (result.code !== 0) {
            failures.push(
              `${file}: ${result.stderr || result.stdout || "copy failed"}`,
            );
          }
        }

        return {
          name: "Backup plist files",
          critical: true,
          status: failures.length > 0 ? "failed" : "success",
          details:
            failures.length > 0 ?
              failures
            : [
                dryRun ?
                  `Would back up ${NETWORK_FILES.length} files.`
                : `Backed up ${NETWORK_FILES.length} files.`,
              ],
        } satisfies NetworkStepResult;
      }),
    );

    steps.push(
      await progress.step("Deleting network plist files", async () => {
        const failures: string[] = [];

        for (const file of NETWORK_FILES) {
          const result = await runCommand("sudo", ["-n", "rm", "-f", file], {
            dryRun,
            allowFailure: true,
          });

          if (result.code !== 0) {
            failures.push(
              `${file}: ${result.stderr || result.stdout || "delete failed"}`,
            );
          }
        }

        return {
          name: "Delete plist files",
          critical: true,
          status: failures.length > 0 ? "failed" : "success",
          details:
            failures.length > 0 ?
              failures
            : [
                dryRun ?
                  `Would delete ${NETWORK_FILES.length} files.`
                : `Deleted ${NETWORK_FILES.length} files.`,
              ],
        } satisfies NetworkStepResult;
      }),
    );

    steps.push(
      await progress.step("Restarting mDNSResponder", async () =>
        runStepCommand(
          "Restart mDNSResponder",
          "sudo",
          ["-n", "killall", "-HUP", "mDNSResponder"],
          true,
          dryRun,
          logger,
        ),
      ),
    );

    steps.push(
      await progress.step("Verifying network services", async () => {
        const services = await runCommand(
          "networksetup",
          ["-listallnetworkservices"],
          {
            dryRun,
            allowFailure: true,
          },
        );

        if (services.code !== 0) {
          return {
            name: "Verify network services",
            critical: false,
            status: "failed",
            details: [
              services.stderr || services.stdout || "verification failed",
            ],
          } satisfies NetworkStepResult;
        }

        const rows = (services.stdout || "")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("An asterisk"));

        if (rows.length === 0) {
          return {
            name: "Verify network services",
            critical: false,
            status: "failed",
            details: [
              "No active network services found. Reconfigure in System Settings > Network.",
            ],
          } satisfies NetworkStepResult;
        }

        return {
          name: "Verify network services",
          critical: false,
          status: "success",
          details: [
            dryRun ?
              `Would verify services: ${rows.join(", ")}`
            : `Services present: ${rows.join(", ")}`,
          ],
        } satisfies NetworkStepResult;
      }),
    );
  } else {
    progress.tick("Skipping reset steps due to sudo precheck failure");
    steps.push({
      name: "Prepare backup directory",
      critical: true,
      status: "skipped",
      details: ["Skipped because sudo precheck failed."],
    });
    steps.push({
      name: "Backup plist files",
      critical: true,
      status: "skipped",
      details: ["Skipped because sudo precheck failed."],
    });
    steps.push({
      name: "Delete plist files",
      critical: true,
      status: "skipped",
      details: ["Skipped because sudo precheck failed."],
    });
    steps.push({
      name: "Restart mDNSResponder",
      critical: true,
      status: "skipped",
      details: ["Skipped because sudo precheck failed."],
    });
    steps.push({
      name: "Verify network services",
      critical: false,
      status: "skipped",
      details: ["Skipped because sudo precheck failed."],
    });
  }

  printNetworkSummary("your net reset", steps, logger.path);
  console.log(chalk.dim(`Backup path: ${backupDir}`));
  console.log(
    chalk.dim(
      "Restore hint: copy files from backup back to /Library/Preferences/SystemConfiguration/ (sudo), then reboot.",
    ),
  );

  if (hasCriticalFailure(steps)) {
    throw new Error("One or more critical network reset steps failed.");
  }

  console.log(chalk.green("Network reset completed."));
}
