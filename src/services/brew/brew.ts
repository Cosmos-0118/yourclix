import chalk from "chalk";
import { log } from "@clack/prompts";
import { terminalWidth, wrapText } from "../../core/format.js";
import { panel } from "../../core/task-ui.js";
import { CommandProgress } from "../../core/progress.js";
import {
  getOutdatedPackages,
  hasCriticalBrewFailure,
  printBrewSummary,
  printCleanupCandidates,
  printCleanupResult,
  runBrewStep,
  type BrewStepResult,
  type OutdatedPackages,
} from "../../managers/brew-manager.js";

function isWarningOnlyDoctorOutput(step: BrewStepResult): boolean {
  if (step.status !== "failed") {
    return false;
  }

  const details = step.details.join("\n").toLowerCase();
  const hasWarning = /\bwarning\b/.test(details);
  const hasError = /\berror\b|\bfatal\b|\bfailed\b/.test(details);
  return hasWarning && !hasError;
}

export function normalizeDoctorStep(step: BrewStepResult): BrewStepResult {
  if (!isWarningOnlyDoctorOutput(step)) {
    return step;
  }

  return {
    ...step,
    status: "warn",
    details: [
      "Brew doctor reported warnings (non-fatal).",
      ...step.details.slice(0, 2),
    ],
  };
}

function skippedStep(
  name: string,
  command: string,
  critical: boolean,
  reason: string,
): BrewStepResult {
  return {
    name,
    command,
    critical,
    status: "skipped",
    details: [reason],
  };
}

export async function brewDoctor(dryRun = false): Promise<void> {
  const progress = new CommandProgress("Brew Doctor", 1);
  const doctorStepRaw = await progress.step("Running brew doctor", () =>
    runBrewStep("Brew doctor", "brew", ["doctor"], false, dryRun),
  );
  const doctorStep = normalizeDoctorStep(doctorStepRaw);

  printBrewSummary("your brew doctor", [doctorStep]);
  if (doctorStep.status === "failed") {
    throw new Error("Homebrew doctor failed; see the diagnostic output above.");
  }
}

export async function brewStatus(): Promise<void> {
  const progress = new CommandProgress("Brew Status", 4);
  const steps: BrewStepResult[] = [];

  steps.push(
    await progress.step("Reading Homebrew version", () =>
      runBrewStep("Brew version", "brew", ["--version"], true, false),
    ),
  );
  steps.push(
    await progress.step("Reading Homebrew prefix", () =>
      runBrewStep("Brew prefix", "brew", ["--prefix"], true, false),
    ),
  );
  steps.push(
    await progress.step("Reading Homebrew configuration", () =>
      runBrewStep("Brew config", "brew", ["config"], false, false),
    ),
  );

  let outdated: OutdatedPackages | undefined;
  steps.push(
    await progress.interactiveStepWithStatus(
      "Checking outdated formulae and casks",
      async () => {
        outdated = await getOutdatedPackages();
        return {
          name: "Outdated package check",
          command: "brew outdated --json=v2",
          critical: true,
          status: outdated.ok ? "success" as const : "failed" as const,
          details: [
            outdated.ok ?
              `${outdated.formulae.length} formulae and ${outdated.casks.length} casks are outdated.`
            : outdated.error ?? "Could not determine outdated Homebrew packages.",
          ],
        } satisfies BrewStepResult;
      },
    ),
  );

  printBrewSummary("your brew status", steps);
  if (outdated?.ok && (outdated.formulae.length > 0 || outdated.casks.length > 0)) {
    log.warn(wrapText(`Outdated: ${[...outdated.formulae, ...outdated.casks].join(", ")}`, Math.max(20, terminalWidth() - 4)).join("\n"));
  } else if (outdated?.ok) {
    log.success("All installed formulae and casks are current.");
  }

  if (hasCriticalBrewFailure(steps)) {
    throw new Error("One or more critical brew status checks failed.");
  }
}

export async function brewClean(dryRun = false): Promise<void> {
  const progress = new CommandProgress("Brew Cleanup", 2);
  const steps: BrewStepResult[] = [];

  const previewStep = await progress.step("Collecting cleanup candidates", () =>
    runBrewStep(
      "Cleanup preview",
      "brew",
      ["cleanup", "--prune=all", "--dry-run"],
      true,
      false,
    ),
  );
  steps.push(previewStep);

  if (previewStep.status === "failed") {
    progress.tick("Skipping cleanup apply step because preview failed");
    steps.push(
      skippedStep(
        "Cleanup apply",
        "brew cleanup --prune=all",
        true,
        "Skipped because cleanup preview failed.",
      ),
    );
  } else {
    printCleanupCandidates(previewStep.details[0] ?? "");

    if (dryRun) {
      progress.tick("Skipping cleanup apply step due to dry-run");
      steps.push(
        skippedStep(
          "Cleanup apply",
          "brew cleanup --prune=all",
          true,
          "Skipped because dry-run is enabled.",
        ),
      );
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
  }

  printBrewSummary("your brew clean", steps);
  if (hasCriticalBrewFailure(steps)) {
    throw new Error("One or more critical brew clean steps failed.");
  }

  log.success("Brew cleanup complete.");
}

export async function brewUpgrade(
  dryRun = false,
  verbose = false,
  greedy = false,
): Promise<void> {
  const streamOpts = { verbose, heartbeatMs: 45_000 } as const;
  const upgradeStreamOpts = {
    ...streamOpts,
    env: { HOMEBREW_NO_AUTO_UPDATE: "1" },
  } as const;

  panel(
    [
      chalk.green("Formulae to upgrade     determined after metadata refresh"),
      chalk.magenta(
        greedy ?
          "Casks to upgrade        includes latest/auto-updating casks"
        : "Casks to upgrade        standard outdated casks only",
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
    "Plan",
    (line) => chalk.cyan(line),
  );

  const steps: BrewStepResult[] = [];
  const preflight = new CommandProgress("", 2);

  const updateStep = dryRun ?
    (() => {
      preflight.tick("Dry-run: skipping Homebrew metadata update");
      return skippedStep(
        "Brew update",
        "brew update-if-needed",
        true,
        "Skipped because dry-run is enabled.",
      );
    })()
  : await preflight.streamStep(
      "brew update — refresh taps & metadata",
      (logLine) =>
        runBrewStep(
          "Brew update",
          "brew",
          verbose ?
            ["update", "--auto-update", "--verbose"]
          : ["update-if-needed"],
          true,
          false,
          true,
          { ...streamOpts, onLine: logLine },
        ),
    );
  steps.push(updateStep);

  if (updateStep.status === "failed") {
    printBrewSummary("your brew upgrade", steps);
    throw new Error("Homebrew metadata update failed; no packages were upgraded.");
  }

  let discovered: OutdatedPackages | undefined;
  const discoveryStep = await preflight.interactiveStepWithStatus(
    "brew outdated — discover upgrade targets",
    async () => {
      discovered = await getOutdatedPackages({ greedy });
      return {
        name: "Outdated package discovery",
        command: `brew outdated --json=v2${greedy ? " --greedy" : ""}`,
        critical: true,
        status: discovered.ok ? "success" as const : "failed" as const,
        details: [
          discovered.ok ?
            `${discovered.formulae.length} formulae and ${discovered.casks.length} casks are outdated.`
          : discovered.error ?? "Could not determine outdated Homebrew packages.",
        ],
      } satisfies BrewStepResult;
    },
  );
  steps.push(discoveryStep);

  if (!discovered || !discovered.ok || discoveryStep.status === "failed") {
    printBrewSummary("your brew upgrade", steps);
    throw new Error(
      discovered?.error ?? "Could not determine outdated Homebrew packages.",
    );
  }

  const formulae = discovered.formulae;
  const casks = discovered.casks;
  const totalTargets = formulae.length + casks.length;
  const actionCount = (formulae.length > 0 ? 1 : 0) + (casks.length > 0 ? 1 : 0);
  const actions = new CommandProgress("", Math.max(actionCount, 1));

  if (totalTargets === 0) {
    actions.tick("No outdated formulae or casks found");
  }

  if (formulae.length > 0) {
    const upgradeArgs = [
      "upgrade",
      ...(verbose ? ["--verbose"] : []),
      "--formula",
      ...formulae,
    ];
    if (dryRun) {
      actions.tick(`Would upgrade ${formulae.length} formulae`);
      steps.push({
        name: "Upgrade formulae",
        command: ["brew", ...upgradeArgs].join(" "),
        critical: true,
        status: "skipped",
        details: [`Would upgrade: ${formulae.join(", ")}`],
      });
    } else {
      steps.push(
        await actions.streamStep(
          `brew upgrade ${formulae.length} formulae`,
          (logLine) =>
            runBrewStep(
              "Upgrade formulae",
              "brew",
              upgradeArgs,
              true,
              false,
              true,
              { ...upgradeStreamOpts, onLine: logLine },
            ),
        ),
      );
    }
  }

  if (casks.length > 0) {
    const upgradeArgs = [
      "upgrade",
      ...(verbose ? ["--verbose"] : []),
      ...(greedy ? ["--greedy"] : []),
      "--cask",
      ...casks,
    ];
    if (dryRun) {
      actions.tick(`Would upgrade ${casks.length} casks`);
      steps.push({
        name: "Upgrade casks",
        command: ["brew", ...upgradeArgs].join(" "),
        critical: true,
        status: "skipped",
        details: [`Would upgrade: ${casks.join(", ")}`],
      });
    } else {
      steps.push(
        await actions.streamStep(
          `brew upgrade ${casks.length} casks`,
          (logLine) =>
            runBrewStep(
              "Upgrade casks",
              "brew",
              upgradeArgs,
              true,
              false,
              true,
              { ...upgradeStreamOpts, onLine: logLine },
            ),
        ),
      );
    }
  }

  if (totalTargets > 0) {
    const rows = [
      ...formulae.map(
        (pkg) => `${chalk.green("●")}  ${chalk.bold("formula")}  ${pkg}`,
      ),
      ...casks.map(
        (cask) => `${chalk.magenta("●")}  ${chalk.bold("cask")}    ${cask}`,
      ),
    ];

    panel(rows.join("\n"), dryRun ? "Planned targets" : "Upgrade targets", (line) =>
      chalk.green(line),
    );
  }

  printBrewSummary("your brew upgrade", steps);
  if (hasCriticalBrewFailure(steps)) {
    throw new Error("One or more critical brew upgrade steps failed.");
  }

  log.success("Brew upgrade complete.");
}

export async function brewAutoremove(dryRun = false): Promise<void> {
  const progress = new CommandProgress("Brew Autoremove", 2);
  const steps: BrewStepResult[] = [];
  const preview = await progress.step("Previewing unused dependencies", () =>
    runBrewStep(
      "Autoremove preview",
      "brew",
      ["autoremove", "--dry-run"],
      true,
      false,
    ),
  );
  steps.push(preview);

  if (preview.status === "failed") {
    progress.tick("Skipping autoremove because preview failed");
    steps.push(
      skippedStep(
        "Autoremove apply",
        "brew autoremove",
        true,
        "Skipped because autoremove preview failed.",
      ),
    );
  } else if (dryRun) {
    progress.tick("Skipping autoremove apply step due to dry-run");
    steps.push(
      skippedStep(
        "Autoremove apply",
        "brew autoremove",
        true,
        "Skipped because dry-run is enabled.",
      ),
    );
  } else {
    steps.push(
      await progress.step("Removing unused dependencies", () =>
        runBrewStep(
          "Autoremove apply",
          "brew",
          ["autoremove"],
          true,
          false,
        ),
      ),
    );
  }

  printBrewSummary("your brew autoremove", steps);
  if (hasCriticalBrewFailure(steps)) {
    throw new Error("One or more critical brew autoremove steps failed.");
  }
  log.success("Brew autoremove complete.");
}

export async function brewOptimize(dryRun = false): Promise<void> {
  log.step("Pre-cleanup doctor pass");
  await brewDoctor(dryRun);
  await brewUpgrade(dryRun, false, false);
  await brewClean(dryRun);

  log.step("Post-cleanup doctor pass");
  await brewDoctor(dryRun);

  log.success("Brew optimize completed.");
}
