import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import fg from "fast-glob";
import { ActionableError } from "../core/actionable-error.js";
import { runCommand } from "../core/exec.js";
import { buildManualRecoveryDetails } from "../core/reconfigure.js";
import { printNextCommands } from "../core/next-steps.js";
import { CommandProgress } from "../core/progress.js";
import { removePath } from "../core/fs-utils.js";
import { confirm } from "../core/prompt.js";

interface DevResetPlan {
  brewPackage: string;
  verifyCommand: string;
  verifyArgs: string[];
}

function getDevResetPlan(tool: string): DevResetPlan {
  switch (tool) {
    case "node":
      return {
        brewPackage: "node",
        verifyCommand: "node",
        verifyArgs: ["--version"],
      };
    case "python":
      return {
        brewPackage: "python",
        verifyCommand: "python3",
        verifyArgs: ["--version"],
      };
    default:
      throw new ActionableError({
        code: "DEV_RESET_UNSUPPORTED_TOOL",
        summary: `Unsupported tool reset target: ${tool}`,
        nextSteps: [
          "Use one of the supported targets: node, python",
          "Run: your dev reset node",
        ],
      });
  }
}

function buildDevManualRecovery(tool: string, plan: DevResetPlan): string[] {
  const verifyCommand = `${plan.verifyCommand} ${plan.verifyArgs.join(" ")}`;
  return buildManualRecoveryDetails("Manual recovery checklist:", [
    `Run: brew uninstall ${plan.brewPackage}`,
    `Run: brew install ${plan.brewPackage}`,
    `Run: ${verifyCommand}`,
    `Run: your dev reset ${tool}`,
  ]);
}

export async function devClean(dryRun = false, yes = false): Promise<void> {
  const progress = new CommandProgress("Developer Cleanup", 3);
  const home = os.homedir();
  const targets = [
    path.join(home, "**/node_modules"),
    path.join(home, "Library/Developer/Xcode/DerivedData/*"),
  ];

  const found = await progress.step("Scanning cleanup targets", async () =>
    fg(targets, {
      dot: true,
      unique: true,
      onlyDirectories: true,
      suppressErrors: true,
    }),
  );

  const nodeModules = found.filter((entry) =>
    entry.endsWith(`${path.sep}node_modules`),
  );
  const xcodeDerivedData = found.filter((entry) =>
    entry.includes(
      `${path.sep}Library${path.sep}Developer${path.sep}Xcode${path.sep}DerivedData${path.sep}`,
    ),
  );
  const otherTargets =
    found.length - nodeModules.length - xcodeDerivedData.length;

  console.log(chalk.bold("Developer cleanup targets"));
  console.log(`- Total: ${found.length}`);
  console.log(`- node_modules: ${nodeModules.length}`);
  console.log(`- Xcode DerivedData: ${xcodeDerivedData.length}`);
  if (otherTargets > 0) {
    console.log(`- Other: ${otherTargets}`);
  }

  const preview = found.slice(0, 20);
  if (preview.length > 0) {
    console.log(chalk.dim("Sample targets (first 20)"));
    for (const target of preview) {
      console.log(chalk.dim(`- ${target}`));
    }
  }

  if (found.length > preview.length) {
    console.log(
      chalk.dim(`...and ${found.length - preview.length} more target(s).`),
    );
  }

  const approved = await confirm("Proceed with developer cleanup?", yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  let removedCount = 0;
  const failedTargets: Array<{ path: string; reason: string }> = [];
  await progress.step(
    `Removing ${found.length} filesystem targets`,
    async () => {
      for (const target of found) {
        try {
          await removePath(target, dryRun);
          removedCount += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          failedTargets.push({ path: target, reason: message || "unknown" });
        }
      }
    },
  );

  await progress.step("Cleaning package manager caches", async () => {
    await runCommand("npm", ["cache", "clean", "--force"], {
      dryRun,
      allowFailure: true,
    });
    await runCommand("pnpm", ["store", "prune"], {
      dryRun,
      allowFailure: true,
    });
    await runCommand("python3", ["-m", "pip", "cache", "purge"], {
      dryRun,
      allowFailure: true,
    });
    await runCommand("gradle", ["--stop"], { dryRun, allowFailure: true });
  });

  const actionWord = dryRun ? "Would remove" : "Removed";
  console.log(chalk.bold("Developer cleanup summary"));
  console.log(chalk.green(`- ${actionWord}: ${removedCount} targets`));
  console.log(chalk.yellow(`- Failed: ${failedTargets.length} targets`));

  if (failedTargets.length > 0) {
    const sampleFailed = failedTargets.slice(0, 10);
    console.log(chalk.dim("Sample failures"));
    for (const failed of sampleFailed) {
      console.log(chalk.dim(`- ${failed.path} (${failed.reason})`));
    }
  }

  console.log(chalk.green("Developer cleanup complete."));
}

export async function devReset(tool: string, dryRun = false): Promise<void> {
  const plan = getDevResetPlan(tool);
  const title =
    tool === "node" ? "Node"
    : tool === "python" ? "Python"
    : tool;
  const progress = new CommandProgress(`Developer Reset (${tool})`, 3);

  const uninstallResult = await progress.step(
    `Uninstalling existing ${title}`,
    async () =>
      runCommand("brew", ["uninstall", plan.brewPackage], {
        dryRun,
        allowFailure: true,
      }),
  );

  const installResult = await progress.step(
    `Installing fresh ${title}`,
    async () =>
      runCommand("brew", ["install", plan.brewPackage], {
        dryRun,
        allowFailure: true,
      }),
  );

  const verifyResult = await progress.step(
    `Verifying ${title} is available`,
    async () =>
      runCommand(plan.verifyCommand, plan.verifyArgs, {
        dryRun,
        allowFailure: true,
      }),
  );

  const failedDetails: string[] = [];
  if (uninstallResult.code !== 0) {
    failedDetails.push(
      `Uninstall failed: ${uninstallResult.stderr || uninstallResult.stdout || "unknown error"}`,
    );
  }
  if (installResult.code !== 0) {
    failedDetails.push(
      `Install failed: ${installResult.stderr || installResult.stdout || "unknown error"}`,
    );
  }
  if (verifyResult.code !== 0) {
    failedDetails.push(
      `Verification failed: ${verifyResult.stderr || verifyResult.stdout || "unknown error"}`,
    );
  }

  if (!dryRun && failedDetails.length > 0) {
    console.log(chalk.bold(`Developer reset failed for ${tool}.`));
    for (const detail of failedDetails) {
      console.log(chalk.yellow(`- ${detail}`));
    }

    for (const line of buildDevManualRecovery(tool, plan)) {
      console.log(chalk.dim(line));
    }

    throw new ActionableError({
      code: "DEV_RESET_VERIFICATION_FAILED",
      summary: `Developer reset verification failed for ${tool}.`,
      details: failedDetails,
      nextSteps: buildDevManualRecovery(tool, plan),
    });
  }

  if (!dryRun) {
    console.log(
      chalk.green(
        `Verification output: ${(verifyResult.stdout || verifyResult.stderr || "(no output)").split("\n")[0]}`,
      ),
    );
  }

  console.log(chalk.green(`Developer environment reset complete for ${tool}.`));
  printNextCommands("Next commands:", [
    `your doctor`,
    `${plan.verifyCommand} ${plan.verifyArgs.join(" ")}`,
  ]);
}
