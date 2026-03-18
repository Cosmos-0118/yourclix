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

interface NetworkTarget {
  path: string;
  optional?: boolean;
}

const NETWORK_TARGETS: NetworkTarget[] = [
  {
    path: "/Library/Preferences/SystemConfiguration/com.apple.airport.preferences.plist",
    optional: true,
  },
  {
    path: "/Library/Preferences/SystemConfiguration/NetworkInterfaces.plist",
  },
  {
    path: "/Library/Preferences/SystemConfiguration/preferences.plist",
  },
];
const SYSTEM_CONFIG_DIR = "/Library/Preferences/SystemConfiguration";
const POLICY_HINT =
  "Permission denied by macOS security policy. Grant Full Disk Access to your terminal app and VS Code, then retry.";

function isNoSuchFile(detail: string): boolean {
  return detail.toLowerCase().includes("no such file or directory");
}

function isOperationNotPermitted(detail: string): boolean {
  return detail.toLowerCase().includes("operation not permitted");
}

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
  for (const target of NETWORK_TARGETS) {
    const suffix = target.optional ? " (optional on newer macOS)" : "";
    console.log(`- ${target.path}${suffix}`);
  }

  const approved = await confirm("Proceed with network reset?", yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  const logger = await createNetworkLogger("reset");
  const steps: NetworkStepResult[] = [];
  const progress = new CommandProgress("Network Reset", 7);
  let copiedFiles = 0;
  let deletedFiles = 0;

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
      await progress.step(
        "Checking SystemConfiguration write access",
        async () => {
          const probe = await runCommand(
            "sudo",
            ["-n", "test", "-w", SYSTEM_CONFIG_DIR],
            {
              dryRun,
              allowFailure: true,
            },
          );

          if (probe.code === 0) {
            return {
              name: "SystemConfiguration write access",
              critical: true,
              status: "success",
              details: [
                dryRun ?
                  `Would verify write access for ${SYSTEM_CONFIG_DIR}.`
                : `Basic write check passed for ${SYSTEM_CONFIG_DIR}; individual files may still be protected by macOS policy.`,
              ],
            } satisfies NetworkStepResult;
          }

          return {
            name: "SystemConfiguration write access",
            critical: true,
            status: "failed",
            details: [
              probe.stderr ||
                probe.stdout ||
                `No write access to ${SYSTEM_CONFIG_DIR}.`,
              "Grant Full Disk Access to your terminal app (Terminal/iTerm) and VS Code, then retry.",
            ],
          } satisfies NetworkStepResult;
        },
      ),
    );

    if (hasCriticalFailure(steps)) {
      progress.tick(
        "Skipping reset steps due to write-access precheck failure",
      );
      steps.push({
        name: "Prepare backup directory",
        critical: true,
        status: "skipped",
        details: ["Skipped because write-access precheck failed."],
      });
      steps.push({
        name: "Backup plist files",
        critical: true,
        status: "skipped",
        details: ["Skipped because write-access precheck failed."],
      });
      steps.push({
        name: "Delete plist files",
        critical: true,
        status: "skipped",
        details: ["Skipped because write-access precheck failed."],
      });
      steps.push({
        name: "Restart mDNSResponder",
        critical: true,
        status: "skipped",
        details: ["Skipped because write-access precheck failed."],
      });
      steps.push({
        name: "Verify network services",
        critical: false,
        status: "skipped",
        details: ["Skipped because write-access precheck failed."],
      });
    } else {
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
          const notices: string[] = [];
          let copiedCount = 0;

          for (const target of NETWORK_TARGETS) {
            if (!dryRun) {
              const existsCheck = await runCommand(
                "sudo",
                ["-n", "test", "-e", target.path],
                {
                  allowFailure: true,
                },
              );

              if (existsCheck.code !== 0) {
                notices.push(`${target.path}: not present (skipped).`);
                continue;
              }
            }

            const result = await runCommand(
              "sudo",
              ["-n", "cp", target.path, backupDir],
              {
                dryRun,
                allowFailure: true,
              },
            );

            if (result.code === 0) {
              copiedCount += 1;
              continue;
            }

            const detail = result.stderr || result.stdout || "copy failed";
            if (isNoSuchFile(detail)) {
              notices.push(`${target.path}: not present (skipped).`);
              continue;
            }

            if (target.optional && isOperationNotPermitted(detail)) {
              notices.push(
                `${target.path}: protected by macOS policy (optional, skipped).`,
              );
              continue;
            }

            failures.push(`${target.path}: ${detail}`);
          }

          if (failures.some((entry) => isOperationNotPermitted(entry))) {
            failures.push(POLICY_HINT);
          }

          if (!dryRun && failures.length === 0) {
            copiedFiles = copiedCount;
          }

          return {
            name: "Backup plist files",
            critical: true,
            status: failures.length > 0 ? "failed" : "success",
            details:
              failures.length > 0 ?
                [...failures, ...notices.slice(0, 3)]
              : [
                  dryRun ?
                    `Would back up up to ${NETWORK_TARGETS.length} files.`
                  : `Backed up ${copiedCount} files.`,
                  ...notices.slice(0, 2),
                ],
          } satisfies NetworkStepResult;
        }),
      );

      steps.push(
        await progress.step("Deleting network plist files", async () => {
          const failures: string[] = [];
          const notices: string[] = [];
          let deletedCount = 0;

          for (const target of NETWORK_TARGETS) {
            if (!dryRun) {
              const existsCheck = await runCommand(
                "sudo",
                ["-n", "test", "-e", target.path],
                {
                  allowFailure: true,
                },
              );

              if (existsCheck.code !== 0) {
                notices.push(`${target.path}: not present (skipped).`);
                continue;
              }
            }

            const result = await runCommand(
              "sudo",
              ["-n", "rm", "-f", target.path],
              {
                dryRun,
                allowFailure: true,
              },
            );

            if (result.code === 0) {
              deletedCount += 1;
              continue;
            }

            const detail = result.stderr || result.stdout || "delete failed";
            if (isNoSuchFile(detail)) {
              notices.push(`${target.path}: not present (skipped).`);
              continue;
            }

            if (target.optional && isOperationNotPermitted(detail)) {
              notices.push(
                `${target.path}: protected by macOS policy (optional, skipped).`,
              );
              continue;
            }

            failures.push(`${target.path}: ${detail}`);
          }

          if (failures.some((entry) => isOperationNotPermitted(entry))) {
            failures.push(POLICY_HINT);
          }

          if (!dryRun && failures.length === 0) {
            deletedFiles = deletedCount;
          }

          return {
            name: "Delete plist files",
            critical: true,
            status: failures.length > 0 ? "failed" : "success",
            details:
              failures.length > 0 ?
                [...failures, ...notices.slice(0, 3)]
              : [
                  dryRun ?
                    `Would delete up to ${NETWORK_TARGETS.length} files.`
                  : `Deleted ${deletedCount} files.`,
                  ...notices.slice(0, 2),
                ],
          } satisfies NetworkStepResult;
        }),
      );

      if (hasCriticalFailure(steps)) {
        progress.tick("Skipping mDNS restart due to earlier critical failure");
        steps.push({
          name: "Restart mDNSResponder",
          critical: true,
          status: "skipped",
          details: ["Skipped because backup/delete step failed."],
        });

        progress.tick(
          "Skipping network service verification due to earlier critical failure",
        );
        steps.push({
          name: "Verify network services",
          critical: false,
          status: "skipped",
          details: ["Skipped because backup/delete step failed."],
        });
      } else {
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
              const noChange =
                !dryRun && copiedFiles === 0 && deletedFiles === 0;
              return {
                name: "Verify network services",
                critical: false,
                status: "skipped",
                details: [
                  noChange ?
                    "No network services reported; reset changed 0 files, so verification is informational only."
                  : "No active network services found. Reconfigure in System Settings > Network.",
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
      }
    }
  } else {
    progress.tick("Skipping reset steps due to sudo precheck failure");
    steps.push({
      name: "SystemConfiguration write access",
      critical: true,
      status: "skipped",
      details: ["Skipped because sudo precheck failed."],
    });
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
