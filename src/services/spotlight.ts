import chalk from "chalk";
import { ActionableError } from "../core/actionable-error.js";
import { runCommand } from "../core/exec.js";
import { CommandProgress } from "../core/progress.js";
import { buildManualRecoveryDetails } from "../core/reconfigure.js";

type SpotlightStepStatus = "success" | "failed" | "skipped";

interface SpotlightStepResult {
  name: string;
  command: string;
  status: SpotlightStepStatus;
  critical: boolean;
  details: string[];
}

class SpotlightPrecheckError extends Error {
  constructor(public readonly step: SpotlightStepResult) {
    super(step.details[0] ?? "Spotlight sudo precheck failed.");
  }
}

function hasCriticalFailure(steps: SpotlightStepResult[]): boolean {
  return steps.some((step) => step.critical && step.status === "failed");
}

function printSpotlightSummary(
  target: string,
  steps: SpotlightStepResult[],
): void {
  console.log(chalk.bold(`\n=== your spotlight reset summary (${target}) ===`));

  for (const step of steps) {
    const marker =
      step.status === "success" ? chalk.green("[ok]")
      : step.status === "failed" ? chalk.red("[fail]")
      : chalk.dim("[skip]");

    console.log(`${marker} ${step.name} (${step.command})`);
    for (const detail of step.details.slice(0, 3)) {
      console.log(chalk.dim(`  - ${detail}`));
    }
  }
}

function skippedStep(
  name: string,
  command: string,
  critical: boolean,
  reason: string,
): SpotlightStepResult {
  return {
    name,
    command,
    status: "skipped",
    critical,
    details: [reason],
  };
}

function parseSpotlightStatusState(output: string):
  | "enabled"
  | "disabled"
  | "unknown" {
  const normalized = output.toLowerCase();
  if (normalized.includes("indexing enabled")) {
    return "enabled";
  }

  if (
    normalized.includes("indexing and searching disabled") ||
    normalized.includes("indexing disabled")
  ) {
    return "disabled";
  }

  return "unknown";
}

function spotlightManualRecovery(target: string): string[] {
  return buildManualRecoveryDetails("Manual recovery checklist:", [
    `Run: sudo mdutil -i on ${target}`,
    `Run: sudo mdutil -E ${target}`,
    `Run: mdutil -s ${target}`,
    "If status still shows disabled, reboot macOS and run the commands again.",
  ]);
}

async function runSpotlightStep(
  name: string,
  command: string,
  args: string[],
  critical: boolean,
  dryRun = false,
): Promise<SpotlightStepResult> {
  const result = await runCommand(command, args, {
    dryRun,
    allowFailure: true,
  });

  const detail =
    result.stdout ||
    result.stderr ||
    (result.code === 0 ?
      "Completed successfully (exit code 0, no output)."
    : "Command failed with no output.");

  return {
    name,
    command: `${command} ${args.join(" ")}`.trim(),
    critical,
    status: result.code === 0 ? "success" : "failed",
    details: [detail],
  };
}

export async function spotlightStatus(): Promise<void> {
  const progress = new CommandProgress("Spotlight Status", 1);
  const result = await progress.step(
    "Querying Spotlight indexing state",
    async () => runCommand("mdutil", ["-sa"], { allowFailure: true }),
  );
  console.log(
    result.stdout || result.stderr || "No Spotlight status output available.",
  );
}

export async function spotlightReset(
  targetPath?: string,
  dryRun = false,
): Promise<void> {
  const progress = new CommandProgress("Spotlight Reset", 6);
  const target = targetPath ?? "/";
  const steps: SpotlightStepResult[] = [];

  console.log(
    chalk.yellow(
      "Rebuilding Spotlight index can temporarily impact system performance.",
    ),
  );

  let sudoStep: SpotlightStepResult;
  try {
    sudoStep = await progress.interactiveStep(
      "Checking administrator privileges",
      async () => {
        if (dryRun) {
          return {
            name: "Sudo precheck",
            command: "sudo -n true",
            critical: true,
            status: "skipped",
            details: ["Dry-run: sudo precheck skipped."],
          } satisfies SpotlightStepResult;
        }

        const sudoCheck = await runCommand("sudo", ["-n", "true"], {
          allowFailure: true,
        });

        if (sudoCheck.code === 0) {
          return {
            name: "Sudo precheck",
            command: "sudo -n true",
            critical: true,
            status: "success",
            details: ["Sudo credentials already valid."],
          } satisfies SpotlightStepResult;
        }

        if (!process.stdin.isTTY) {
          throw new SpotlightPrecheckError({
            name: "Sudo precheck",
            command: "sudo -v",
            critical: true,
            status: "failed",
            details: [
              "Administrator authentication required in non-interactive session. Run 'sudo -v' first, then retry your spotlight reset.",
            ],
          });
        }

        console.log(
          chalk.yellow(
            "Administrator authentication is required for Spotlight reset.",
          ),
        );
        console.log(
          chalk.dim("Please enter your macOS password when prompted."),
        );

        const auth = await runCommand("sudo", ["-v"], {
          allowFailure: true,
          stdio: "inherit",
        });

        if (auth.code !== 0) {
          throw new SpotlightPrecheckError({
            name: "Sudo precheck",
            command: "sudo -v",
            critical: true,
            status: "failed",
            details: [
              auth.stderr ||
                auth.stdout ||
                "Failed to validate sudo credentials.",
            ],
          });
        }

        return {
          name: "Sudo precheck",
          command: "sudo -v",
          critical: true,
          status: "success",
          details: ["Sudo credentials refreshed."],
        } satisfies SpotlightStepResult;
      },
    );
  } catch (error) {
    if (error instanceof SpotlightPrecheckError) {
      sudoStep = error.step;
    } else {
      throw error;
    }
  }
  steps.push(sudoStep);

  if (sudoStep.status === "failed") {
    progress.tick("Skipping index reset steps due to sudo precheck failure");
    steps.push(
      skippedStep(
        "Disable indexing",
        `sudo -n mdutil -i off ${target}`,
        true,
        "Skipped because sudo precheck failed.",
      ),
    );
    steps.push(
      skippedStep(
        "Erase index",
        `sudo -n mdutil -E ${target}`,
        true,
        "Skipped because sudo precheck failed.",
      ),
    );
    steps.push(
      skippedStep(
        "Re-enable indexing",
        `sudo -n mdutil -i on ${target}`,
        true,
        "Skipped because sudo precheck failed.",
      ),
    );
    steps.push(
      skippedStep(
        "Final status",
        `mdutil -s ${target}`,
        false,
        "Skipped because sudo precheck failed.",
      ),
    );
    steps.push(
      skippedStep(
        "Verify indexing state",
        `mdutil -s ${target}`,
        true,
        "Skipped because sudo precheck failed.",
      ),
    );
  } else {
    const disableStep = await progress.step(
      `Disabling index on ${target}`,
      () =>
        runSpotlightStep(
          "Disable indexing",
          "sudo",
          ["-n", "mdutil", "-i", "off", target],
          true,
          dryRun,
        ),
    );
    steps.push(disableStep);

    if (disableStep.status === "failed") {
      progress.tick("Skipping remaining reset steps due to disable failure");
      steps.push(
        skippedStep(
          "Erase index",
          `sudo -n mdutil -E ${target}`,
          true,
          "Skipped because disable step failed.",
        ),
      );
      steps.push(
        skippedStep(
          "Re-enable indexing",
          `sudo -n mdutil -i on ${target}`,
          true,
          "Skipped because disable step failed.",
        ),
      );
      steps.push(
        skippedStep(
          "Final status",
          `mdutil -s ${target}`,
          false,
          "Skipped because disable step failed.",
        ),
      );
      steps.push(
        skippedStep(
          "Verify indexing state",
          `mdutil -s ${target}`,
          true,
          "Skipped because disable step failed.",
        ),
      );
    } else {
      const eraseStep = await progress.step(`Erasing index on ${target}`, () =>
        runSpotlightStep(
          "Erase index",
          "sudo",
          ["-n", "mdutil", "-E", target],
          true,
          dryRun,
        ),
      );
      steps.push(eraseStep);

      if (eraseStep.status === "failed") {
        progress.tick("Skipping remaining reset steps due to erase failure");
        steps.push(
          skippedStep(
            "Re-enable indexing",
            `sudo -n mdutil -i on ${target}`,
            true,
            "Skipped because erase step failed.",
          ),
        );
        steps.push(
          skippedStep(
            "Final status",
            `mdutil -s ${target}`,
            false,
            "Skipped because erase step failed.",
          ),
        );
        steps.push(
          skippedStep(
            "Verify indexing state",
            `mdutil -s ${target}`,
            true,
            "Skipped because erase step failed.",
          ),
        );
      } else {
        const enableStep = await progress.step(
          `Re-enabling index on ${target}`,
          () =>
            runSpotlightStep(
              "Re-enable indexing",
              "sudo",
              ["-n", "mdutil", "-i", "on", target],
              true,
              dryRun,
            ),
        );
        steps.push(enableStep);

        if (enableStep.status === "failed") {
          progress.tick("Skipping final status check due to re-enable failure");
          steps.push(
            skippedStep(
              "Final status",
              `mdutil -s ${target}`,
              false,
              "Skipped because re-enable step failed.",
            ),
          );
          steps.push(
            skippedStep(
              "Verify indexing state",
              `mdutil -s ${target}`,
              true,
              "Skipped because re-enable step failed.",
            ),
          );
        } else {
          const statusStep = await progress.step(
            "Fetching indexing status",
            () =>
              runSpotlightStep(
                "Final status",
                "mdutil",
                ["-s", target],
                false,
                dryRun,
              ),
          );
          steps.push(statusStep);

          const verifyStep = await progress.step(
            "Verifying indexing state",
            async () => {
              if (dryRun) {
                return {
                  name: "Verify indexing state",
                  command: `mdutil -s ${target}`,
                  status: "skipped",
                  critical: true,
                  details: ["Dry-run: indexing verification skipped."],
                } satisfies SpotlightStepResult;
              }

              const state = parseSpotlightStatusState(statusStep.details[0] ?? "");

              if (state === "enabled") {
                return {
                  name: "Verify indexing state",
                  command: `mdutil -s ${target}`,
                  status: "success",
                  critical: true,
                  details: ["Spotlight indexing is enabled after reset."],
                } satisfies SpotlightStepResult;
              }

              if (state === "disabled") {
                return {
                  name: "Verify indexing state",
                  command: `mdutil -s ${target}`,
                  status: "failed",
                  critical: true,
                  details: [
                    "Spotlight indexing is still disabled after reset.",
                    ...spotlightManualRecovery(target),
                  ],
                } satisfies SpotlightStepResult;
              }

              return {
                name: "Verify indexing state",
                command: `mdutil -s ${target}`,
                status: "skipped",
                critical: false,
                details: [
                  "Could not confidently parse Spotlight status output.",
                  ...spotlightManualRecovery(target),
                ],
              } satisfies SpotlightStepResult;
            },
          );
          steps.push(verifyStep);
        }
      }
    }
  }

  printSpotlightSummary(target, steps);

  if (hasCriticalFailure(steps)) {
    throw new ActionableError({
      code: "SPOTLIGHT_RESET_CRITICAL_FAILURE",
      summary: "One or more critical Spotlight reset steps failed.",
      nextSteps: spotlightManualRecovery(target),
      details: ["Run 'your spotlight status' after applying manual recovery."],
    });
  }

  console.log(chalk.green(`Spotlight reset triggered for ${target}.`));
  console.log(
    chalk.dim("Tip: Use 'your spotlight status' to watch indexing progress."),
  );
}
