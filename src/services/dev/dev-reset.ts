import chalk from "chalk";
import { ActionableError } from "../../core/actionable-error.js";
import { runCommand } from "../../core/exec.js";
import { buildManualRecoveryDetails } from "../../core/reconfigure.js";
import { printNextCommands } from "../../core/next-steps.js";
import { CommandProgress } from "../../core/progress.js";
import { firstCommandOutput } from "../../core/verification.js";
import {
  analyzeBrewCaveats,
  formatBrewCaveatFollowUps,
  hasBrewCaveats,
  printBrewCaveatGuidance,
} from "../../managers/brew-caveats-manager.js";
import type { DevResetPlan } from "./types.js";

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
    case "ruby":
      return {
        brewPackage: "ruby",
        verifyCommand: "ruby",
        verifyArgs: ["--version"],
      };
    case "rust":
      return {
        brewPackage: "rust",
        verifyCommand: "rustc",
        verifyArgs: ["--version"],
      };
    case "go":
      return {
        brewPackage: "go",
        verifyCommand: "go",
        verifyArgs: ["version"],
      };
    default:
      throw new ActionableError({
        code: "DEV_RESET_UNSUPPORTED_TOOL",
        summary: `Unsupported tool reset target: ${tool}`,
        nextSteps: [
          "Use one of the supported targets: node, python, ruby, rust, go",
          "Run: your dev reset node",
        ],
      });
  }
}

function buildDevManualRecovery(
  tool: string,
  plan: DevResetPlan,
  caveatFollowUps: string[] = [],
): string[] {
  const verifyCommand = `${plan.verifyCommand} ${plan.verifyArgs.join(" ")}`;
  const extraSteps = [...new Set(caveatFollowUps)]
    .map((step) =>
      /^Keg-only formula/i.test(step) || /^Run:\s+/i.test(step) ?
        step
      : `Run: ${step}`,
    );

  return buildManualRecoveryDetails("Manual recovery checklist:", [
    `Run: brew uninstall ${plan.brewPackage}`,
    `Run: brew install ${plan.brewPackage}`,
    `Run: ${verifyCommand}`,
    ...extraSteps,
    `Run: your dev reset ${tool}`,
  ]);
}

async function verifyKegOnlyCommandResolution(
  plan: DevResetPlan,
): Promise<string | null> {
  const [prefixResult, whichResult] = await Promise.all([
    runCommand("brew", ["--prefix", plan.brewPackage], { allowFailure: true }),
    runCommand("which", [plan.verifyCommand], { allowFailure: true }),
  ]);

  const prefix = prefixResult.stdout.trim();
  if (!prefix) {
    return `Installed ${plan.brewPackage} appears keg-only, but brew --prefix ${plan.brewPackage} returned no path.`;
  }

  const resolvedCommand = whichResult.stdout.trim();
  if (!resolvedCommand) {
    return `Installed ${plan.brewPackage} appears keg-only, but '${plan.verifyCommand}' is not resolvable in PATH.`;
  }

  if (!resolvedCommand.startsWith(`${prefix}/`)) {
    return `${plan.verifyCommand} resolves to '${resolvedCommand}', not '${prefix}/bin/${plan.verifyCommand}'. PATH likely still points to a system binary.`;
  }

  return null;
}

export async function devReset(tool: string, dryRun = false): Promise<void> {
  const plan = getDevResetPlan(tool);
  const title =
    tool === "node" ? "Node"
    : tool === "python" ? "Python"
    : tool === "ruby" ? "Ruby"
    : tool === "rust" ? "Rust"
    : tool === "go" ? "Go"
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

  const caveatNotice = analyzeBrewCaveats(
    [installResult.stdout, installResult.stderr].filter(Boolean).join("\n"),
  );
  const caveatFollowUps = formatBrewCaveatFollowUps(caveatNotice);
  if (!dryRun && installResult.code === 0 && hasBrewCaveats(caveatNotice)) {
    printBrewCaveatGuidance(`${title} caveats`, caveatNotice);
  }

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

  const needsKegOnlyPathValidation =
    !dryRun &&
    installResult.code === 0 &&
    caveatNotice.kegOnlyFormulae.length > 0;
  if (needsKegOnlyPathValidation) {
    const kegOnlyPathIssue = await verifyKegOnlyCommandResolution(plan);
    if (kegOnlyPathIssue) {
      failedDetails.push(kegOnlyPathIssue);
    }
  }

  if (!dryRun && failedDetails.length > 0) {
    console.log(chalk.bold(`Developer reset failed for ${tool}.`));
    for (const detail of failedDetails) {
      console.log(chalk.yellow(`- ${detail}`));
    }

    const recoverySteps = buildDevManualRecovery(tool, plan, caveatFollowUps);
    for (const line of recoverySteps) {
      console.log(chalk.dim(line));
    }

    throw new ActionableError({
      code: "DEV_RESET_VERIFICATION_FAILED",
      summary: `Developer reset verification failed for ${tool}.`,
      details: failedDetails,
      nextSteps: recoverySteps,
    });
  }

  if (!dryRun && caveatFollowUps.length > 0) {
    console.log(chalk.bold("Homebrew caveat follow-up"));
    for (const followUp of caveatFollowUps) {
      console.log(chalk.dim(`- ${followUp}`));
    }
  }

  if (!dryRun) {
    console.log(
      chalk.green(
        `Verification output: ${firstCommandOutput(verifyResult)}`,
      ),
    );
  }

  console.log(chalk.green(`Developer environment reset complete for ${tool}.`));
  printNextCommands("Next commands:", [
    `your doctor`,
    `${plan.verifyCommand} ${plan.verifyArgs.join(" ")}`,
  ]);
}
