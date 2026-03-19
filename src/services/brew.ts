import chalk from "chalk";
import { CommandProgress } from "../core/progress.js";
import {
  getOutdatedPackages,
  hasCriticalBrewFailure,
  printBrewSummary,
  printCleanupCandidates,
  printCleanupResult,
  runBrewStep,
  type BrewStepResult,
} from "../managers/brew-manager.js";

function isWarningOnlyDoctorOutput(step: BrewStepResult): boolean {
  if (step.status !== "failed") {
    return false;
  }

  const details = (step.details[0] ?? "").toLowerCase();
  const hasWarning = details.includes("warning:");
  const hasError = details.includes("error:");
  return hasWarning && !hasError;
}

function normalizeDoctorStep(step: BrewStepResult): BrewStepResult {
  if (!isWarningOnlyDoctorOutput(step)) {
    return step;
  }

  return {
    ...step,
    status: "warn",
    details: [
      "Brew doctor reported warnings (non-fatal).",
      ...(step.details.length > 0 ? [step.details[0]] : []),
    ],
  };
}

export async function brewDoctor(dryRun = false): Promise<void> {
  const progress = new CommandProgress("Brew Doctor", 1);
  const steps: BrewStepResult[] = [];

  const doctorStepRaw = await progress.step("Running brew doctor", () =>
    runBrewStep("Brew doctor", "brew", ["doctor"], false, dryRun),
  );
  const doctorStep = normalizeDoctorStep(doctorStepRaw);
  steps.push(doctorStep);

  printBrewSummary("your brew doctor", steps);
}

export async function brewClean(dryRun = false): Promise<void> {
  const progress = new CommandProgress("Brew Cleanup", 2);
  const steps: BrewStepResult[] = [];

  const previewStep = await progress.step("Collecting cleanup candidates", () =>
    runBrewStep(
      "Cleanup preview",
      "brew",
      ["cleanup", "--prune=all", "-n"],
      false,
      false,
    ),
  );
  steps.push(previewStep);

  printCleanupCandidates(previewStep.details[0] ?? "");

  if (dryRun) {
    progress.tick("Skipping cleanup apply step due to dry-run");
    steps.push({
      name: "Cleanup apply",
      command: "brew cleanup --prune=all",
      critical: true,
      status: "skipped",
      details: ["Skipped because dry-run is enabled."],
    });
  } else {
    const cleanupStep = await progress.step(
      "Removing stale brew artifacts",
      () =>
        runBrewStep(
          "Cleanup apply",
          "brew",
          ["cleanup", "--prune=all"],
          true,
          false,
        ),
    );
    steps.push(cleanupStep);
    printCleanupResult(cleanupStep.details[0] ?? "", false);
  }

  printBrewSummary("your brew clean", steps);

  if (hasCriticalBrewFailure(steps)) {
    throw new Error("One or more critical brew clean steps failed.");
  }

  console.log(chalk.green("Brew cleanup complete."));
}

export async function brewUpgrade(dryRun = false): Promise<void> {
  const outdated = await getOutdatedPackages();
  const totalTargets = outdated.formulae.length + outdated.casks.length;
  const progress = new CommandProgress(
    "Brew Upgrade",
    1 + Math.max(totalTargets, 1),
  );

  const steps: BrewStepResult[] = [];

  const updateStep = await progress.step("Updating brew formula metadata", () =>
    runBrewStep("Brew update", "brew", ["update"], true, false),
  );
  steps.push(updateStep);

  if (updateStep.status === "failed") {
    progress.tick("Skipping upgrade targets due to brew update failure");
    for (const pkg of outdated.formulae) {
      steps.push({
        name: `Upgrade formula ${pkg}`,
        command: `brew upgrade ${pkg}`,
        critical: true,
        status: "skipped",
        details: ["Skipped because brew update failed."],
      });
    }
    for (const cask of outdated.casks) {
      steps.push({
        name: `Upgrade cask ${cask}`,
        command: `brew upgrade --cask ${cask}`,
        critical: true,
        status: "skipped",
        details: ["Skipped because brew update failed."],
      });
    }

    printBrewSummary("your brew upgrade", steps);
    throw new Error("One or more critical brew upgrade steps failed.");
  }

  if (totalTargets === 0) {
    progress.tick("No outdated formulae or casks found");
  }

  if (dryRun && totalTargets > 0) {
    progress.tick("Dry-run: upgrade commands will not be executed");
  }

  for (const pkg of outdated.formulae) {
    if (dryRun) {
      progress.tick(`Would upgrade formula ${pkg}`);
      steps.push({
        name: `Upgrade formula ${pkg}`,
        command: `brew upgrade ${pkg}`,
        critical: true,
        status: "skipped",
        details: ["Skipped because dry-run is enabled."],
      });
      continue;
    }

    const step = await progress.step(`Upgrading formula ${pkg}`, () =>
      runBrewStep(
        `Upgrade formula ${pkg}`,
        "brew",
        ["upgrade", pkg],
        true,
        false,
      ),
    );
    steps.push(step);
  }

  for (const cask of outdated.casks) {
    if (dryRun) {
      progress.tick(`Would upgrade cask ${cask}`);
      steps.push({
        name: `Upgrade cask ${cask}`,
        command: `brew upgrade --cask ${cask}`,
        critical: true,
        status: "skipped",
        details: ["Skipped because dry-run is enabled."],
      });
      continue;
    }

    const step = await progress.step(`Upgrading cask ${cask}`, () =>
      runBrewStep(
        `Upgrade cask ${cask}`,
        "brew",
        ["upgrade", "--cask", cask],
        true,
        false,
      ),
    );
    steps.push(step);
  }

  if (totalTargets > 0) {
    console.log(
      chalk.bold(dryRun ? "Planned upgrade targets" : "Upgraded targets"),
    );
    outdated.formulae.forEach((pkg) => console.log(`- formula: ${pkg}`));
    outdated.casks.forEach((cask) => console.log(`- cask: ${cask}`));
  }

  printBrewSummary("your brew upgrade", steps);

  if (hasCriticalBrewFailure(steps)) {
    throw new Error("One or more critical brew upgrade steps failed.");
  }

  console.log(chalk.green("Brew upgrade complete."));
}

export async function brewOptimize(dryRun = false): Promise<void> {
  console.log(chalk.bold("Pre-cleanup doctor pass"));
  await brewDoctor(dryRun);
  await brewUpgrade(dryRun);
  await brewClean(dryRun);

  console.log(chalk.bold("Post-cleanup doctor pass"));
  await brewDoctor(dryRun);

  console.log(chalk.green("Brew optimize completed."));
}
