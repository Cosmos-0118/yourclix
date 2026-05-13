import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { ActionableError } from "../../core/actionable-error.js";
import { printNextCommands } from "../../core/next-steps.js";
import { runCommand } from "../../core/exec.js";
import { buildManualRecoveryDetails } from "../../core/reconfigure.js";
import { confirm } from "../../core/prompt.js";
import { CommandProgress } from "../../core/progress.js";
import { createNetworkLogger } from "./logger.js";
import { ensureSudoReady } from "./preflight.js";
import { runStepCommand } from "./runner.js";
import {
  printNetBackupFooter,
  printNetResetBanner,
  printNetResetPlistTargets,
  printNetResetSuccess,
} from "./net-ui.js";
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

function buildNetworkManualRecovery(backupDir: string | null): string[] {
  const backupHint =
    backupDir ?
      `If services are broken, restore backup files from ${backupDir} to /Library/Preferences/SystemConfiguration using sudo cp.`
    : "If you have a Time Machine backup or another Mac, restore SystemConfiguration plists from there (see log for paths touched).";
  return buildManualRecoveryDetails("Manual recovery checklist:", [
    "Open System Settings > Network and confirm your Wi-Fi/Ethernet services are present.",
    backupHint,
    "Run: sudo killall -HUP mDNSResponder",
    "Run: networksetup -listallnetworkservices",
    "If still broken, reboot macOS and re-run: your net reset --yes",
  ]);
}

function isNoSuchFile(detail: string): boolean {
  return detail.toLowerCase().includes("no such file or directory");
}

function isOperationNotPermitted(detail: string): boolean {
  return detail.toLowerCase().includes("operation not permitted");
}

/** Parse `networksetup -listallnetworkservices` — leading `*` marks disabled (see networksetup(8)). */
function parseNetworksetupServicesList(stdout: string): {
  enabled: string[];
  disabled: string[];
} {
  const enabled: string[] = [];
  const disabled: string[] = [];

  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (/^An asterisk/i.test(line)) {
      continue;
    }
    if (/^hardware port:/i.test(line)) {
      continue;
    }

    if (line.startsWith("*")) {
      const name = line.replace(/^\*+\s*/, "").trim();
      if (name) {
        disabled.push(name);
      }
      continue;
    }

    enabled.push(line);
  }

  return { enabled, disabled };
}

export async function netReset(dryRun = false, yes = false): Promise<void> {
  printNetResetBanner(dryRun);

  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) {
    console.log(
      chalk.yellow(
        "\nWarning: running over SSH may disconnect your current session.",
      ),
    );
  }

  printNetResetPlistTargets(NETWORK_TARGETS);

  const approved = await confirm("Proceed with network reset?", yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  const logger = await createNetworkLogger("reset");
  const steps: NetworkStepResult[] = [];
  const progress = new CommandProgress("Recovery steps", 8);
  let copiedFiles = 0;
  let deletedFiles = 0;
  let backupDirMaterialized = false;
  let backupPlanned = false;

  const precheck = await progress.interactiveStepWithStatus(
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
            backupDirMaterialized = true;
          }
          backupPlanned = true;

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

      steps.push(
        await progress.step("Verifying plist reset outcome", async () => {
          if (dryRun) {
            return {
              name: "Verify plist reset outcome",
              critical: true,
              status: "skipped",
              details: ["Dry-run: plist verification skipped."],
            } satisfies NetworkStepResult;
          }

          const failures: string[] = [];

          for (const target of NETWORK_TARGETS) {
            if (target.optional) {
              continue;
            }

            const existsCheck = await runCommand(
              "sudo",
              ["-n", "test", "-e", target.path],
              {
                allowFailure: true,
              },
            );

            if (existsCheck.code === 0) {
              failures.push(
                `${target.path}: still present after reset (expected deleted).`,
              );
            }
          }

          return {
            name: "Verify plist reset outcome",
            critical: true,
            status: failures.length > 0 ? "failed" : "success",
            details:
              failures.length > 0 ?
                [...failures, ...buildNetworkManualRecovery(backupDir)]
              : ["Required network plist targets are no longer present."],
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
            if (dryRun) {
              return {
                name: "Verify network services",
                critical: false,
                status: "skipped",
                details: [
                  "Dry-run: would run `networksetup -listallnetworkservices` after plist reset.",
                  "Service output is not parsed in dry-run (simulated command output would be misleading).",
                ],
              } satisfies NetworkStepResult;
            }

            const services = await runCommand(
              "networksetup",
              ["-listallnetworkservices"],
              {
                dryRun: false,
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

            const { enabled, disabled } = parseNetworksetupServicesList(
              services.stdout || "",
            );

            if (enabled.length === 0) {
              const noChange = copiedFiles === 0 && deletedFiles === 0;
              const disabledHint =
                disabled.length > 0 ?
                  `Only disabled service(s) reported (${disabled.slice(0, 8).join(", ")}${disabled.length > 8 ? ", …" : ""}). An asterisk (*) denotes disabled in networksetup output — enable at least one service in System Settings > Network.`
                : "No network services listed.";

              return {
                name: "Verify network services",
                critical: !noChange,
                status: noChange ? "skipped" : "failed",
                details: [
                  noChange ?
                    "No enabled services and reset changed 0 files — verification is informational only."
                  : disabledHint,
                  ...(noChange ? [] : buildNetworkManualRecovery(backupDir)),
                ],
              } satisfies NetworkStepResult;
            }

            const detailLines = [
              `Enabled services (${enabled.length}): ${enabled.join(", ")}`,
            ];
            if (disabled.length > 0) {
              detailLines.push(
                `Disabled (not sufficient alone): ${disabled.slice(0, 8).join(", ")}${disabled.length > 8 ? ", …" : ""}`,
              );
            }

            return {
              name: "Verify network services",
              critical: false,
              status: "success",
              details: detailLines,
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

  printNetBackupFooter({
    backupDirMaterialized,
    backupPlanned,
    dryRun,
    backupDir,
  });

  if (hasCriticalFailure(steps)) {
    throw new ActionableError({
      code: "NET_RESET_CRITICAL_FAILURE",
      summary: "One or more critical network reset steps failed.",
      nextSteps: buildNetworkManualRecovery(
        backupDirMaterialized ? backupDir : null,
      ),
      details: [
        `See detailed reset log: ${logger.path}`,
        ...(backupDirMaterialized ?
          [`Backup path: ${backupDir}`]
        : [
            "No backup directory was written to disk; do not assume a restore path exists.",
          ]),
      ],
    });
  }

  printNetResetSuccess();
  printNextCommands("Next commands:", [
    "your net fix",
    "your doctor",
  ]);
}
