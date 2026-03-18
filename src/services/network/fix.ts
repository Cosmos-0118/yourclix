import chalk from "chalk";
import { CommandProgress } from "../../core/progress.js";
import { createNetworkLogger } from "./logger.js";
import { ensureSudoReady } from "./preflight.js";
import { runStepCommand } from "./runner.js";
import { hasCriticalFailure, printNetworkSummary } from "./summary.js";
import type { NetworkStepResult } from "./types.js";

export async function netFix(dryRun = false): Promise<void> {
  console.log(chalk.bold("Running network fix..."));
  const logger = await createNetworkLogger("fix");
  const steps: NetworkStepResult[] = [];
  const progress = new CommandProgress("Network Fix", 4);

  const precheck = await progress.interactiveStep(
    "Checking sudo readiness",
    async () => ensureSudoReady(dryRun, logger),
  );
  steps.push(precheck);

  if (precheck.status === "success" || precheck.status === "skipped") {
    steps.push(
      await progress.step("Flushing DNS cache", async () =>
        runStepCommand(
          "Flush DNS cache",
          "sudo",
          ["-n", "dscacheutil", "-flushcache"],
          true,
          dryRun,
          logger,
        ),
      ),
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
      await progress.step("Detecting network hardware", async () =>
        runStepCommand(
          "Detect network hardware",
          "networksetup",
          ["-detectnewhardware"],
          false,
          dryRun,
          logger,
        ),
      ),
    );
  } else {
    progress.tick("Skipping repair steps due to sudo precheck failure");
    steps.push({
      name: "Flush DNS cache",
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
      name: "Detect network hardware",
      critical: false,
      status: "skipped",
      details: ["Skipped because sudo precheck failed."],
    });
  }

  printNetworkSummary("your net fix", steps, logger.path);

  if (hasCriticalFailure(steps)) {
    throw new Error("One or more critical network fix steps failed.");
  }

  console.log(chalk.green("Network fix completed."));
}
