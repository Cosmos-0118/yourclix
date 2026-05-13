import boxen from "boxen";
import chalk from "chalk";
import { CommandProgress } from "../../core/progress.js";
import {
  getOutdatedPackages,
  hasCriticalBrewFailure,
  printBrewSummary,
  printCleanupCandidates,
  printCleanupResult,
  runBrewStep,
  type BrewStepResult,
} from "../../managers/brew-manager.js";

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

export async function brewUpgrade(
  dryRun = false,
  verbose = false,
): Promise<void> {
  const outdated = await getOutdatedPackages();
  const totalTargets = outdated.formulae.length + outdated.casks.length;
  const stepCount = 1 + Math.max(totalTargets, 1);

  const streamOpts = { verbose, heartbeatMs: 45_000 } as const;

  console.log(
    boxen(
      [
        chalk.white.bold("Plan"),
        "",
        chalk.green(
          `  Formulae to upgrade     ${chalk.bold(String(outdated.formulae.length))}`,
        ),
        chalk.magenta(
          `  Casks to upgrade        ${chalk.bold(String(outdated.casks.length))}`,
        ),
        "",
        verbose ?
          chalk.dim(
            "Full Homebrew output (every pour / symlink / rm line) — same as brew --verbose.",
          )
        : [
            chalk.gray(
              "You will see summaries, git fetch, downloads, pours, and errors — not thousands of ln -s lines.",
            ),
            chalk.dim(
              "Pass --verbose on this command for the complete brew transcript.",
            ),
          ].join("\n"),
        "",
        chalk.dim(
          "brew update can sit quiet on slow networks — a faint heartbeat prints every 45s.",
        ),
      ].join("\n"),
      {
        title: chalk.bold.white(" your brew upgrade "),
        titleAlignment: "center",
        borderStyle: "round",
        borderColor: "cyan",
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        margin: { top: 0, bottom: 0 },
      },
    ),
  );

  const progress = new CommandProgress("", stepCount);

  const steps: BrewStepResult[] = [];

  const updateStep = await progress.interactiveStepWithStatus(
    "brew update — refresh taps & metadata",
    () =>
      runBrewStep(
        "Brew update",
        "brew",
        ["update", "--verbose"],
        true,
        false,
        true,
        streamOpts,
      ),
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

    const step = await progress.interactiveStepWithStatus(
      `brew upgrade ${pkg} (formula)`,
      () =>
        runBrewStep(
          `Upgrade formula ${pkg}`,
          "brew",
          [...(verbose ? ["upgrade", "--verbose", pkg] : ["upgrade", pkg])],
          true,
          false,
          true,
          streamOpts,
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

    const step = await progress.interactiveStepWithStatus(
      `brew upgrade --cask ${cask}`,
      () =>
        runBrewStep(
          `Upgrade cask ${cask}`,
          "brew",
          [
            ...(verbose ?
              ["upgrade", "--verbose", "--cask", cask]
            : ["upgrade", "--cask", cask]),
          ],
          true,
          false,
          true,
          streamOpts,
        ),
    );
    steps.push(step);
  }

  if (totalTargets > 0) {
    const rows = [
      ...outdated.formulae.map(
        (pkg) => `${chalk.green("●")}  ${chalk.bold("formula")}  ${pkg}`,
      ),
      ...outdated.casks.map(
        (cask) => `${chalk.magenta("●")}  ${chalk.bold("cask")}    ${cask}`,
      ),
    ];

    console.log(
      boxen(rows.join("\n"), {
        title:
          chalk.bold.white(
            dryRun ? " Planned targets " : " Upgrade targets ",
          ),
        titleAlignment: "left",
        borderStyle: "round",
        borderColor: "green",
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        margin: { top: 1, bottom: 0 },
      }),
    );
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
  await brewUpgrade(dryRun, false);
  await brewClean(dryRun);

  console.log(chalk.bold("Post-cleanup doctor pass"));
  await brewDoctor(dryRun);

  console.log(chalk.green("Brew optimize completed."));
}
