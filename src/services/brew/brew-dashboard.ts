import {
  getCleanupCandidateLines,
  getCleanupResultLines,
  getOutdatedPackages,
  hasCriticalBrewFailure,
  runBrewStep,
  type BrewStepResult,
  type OutdatedPackages,
} from "../../managers/brew-manager.js";
import type { DashboardHooks, TaskResult } from "../../tui/StepDashboard.js";
import { normalizeDoctorStep } from "./brew.js";

export async function brewDoctorDashboard(dryRun: boolean, hooks: DashboardHooks): Promise<void> {
  const section = hooks.addSection("Brew Doctor");
  const doctorStep = await section.run(
    "Running brew doctor",
    () => runBrewStep("Brew doctor", "brew", ["doctor"], false, dryRun),
    normalizeDoctorStep,
  );

  if (doctorStep.status === "failed") {
    throw new Error("Homebrew doctor failed; see the diagnostic output above.");
  }
}

export async function brewStatusDashboard(hooks: DashboardHooks): Promise<void> {
  const section = hooks.addSection("Brew Status");
  const steps: BrewStepResult[] = [];

  steps.push(
    await section.run("Reading Homebrew version", () =>
      runBrewStep("Brew version", "brew", ["--version"], true, false),
    ),
  );
  steps.push(
    await section.run("Reading Homebrew prefix", () =>
      runBrewStep("Brew prefix", "brew", ["--prefix"], true, false),
    ),
  );
  steps.push(
    await section.run("Reading Homebrew configuration", () =>
      runBrewStep("Brew config", "brew", ["config"], false, false),
    ),
  );

  let outdated: OutdatedPackages | undefined;
  steps.push(
    await section.run("Checking outdated formulae and casks", async () => {
      outdated = await getOutdatedPackages();
      return {
        name: "Outdated package check",
        command: "brew outdated --json=v2",
        critical: true,
        status: outdated.ok ? ("success" as const) : ("failed" as const),
        details: [
          outdated.ok ?
            `${outdated.formulae.length} formulae and ${outdated.casks.length} casks are outdated.`
          : (outdated.error ?? "Could not determine outdated Homebrew packages."),
        ],
      } satisfies BrewStepResult;
    }),
  );

  if (outdated?.ok && (outdated.formulae.length > 0 || outdated.casks.length > 0)) {
    hooks.note(`Outdated: ${[...outdated.formulae, ...outdated.casks].join(", ")}`, "warn");
  } else if (outdated?.ok) {
    hooks.note("All installed formulae and casks are current.", "success");
  }

  if (hasCriticalBrewFailure(steps)) {
    throw new Error("One or more critical brew status checks failed.");
  }
}

export async function brewCleanDashboard(dryRun: boolean, hooks: DashboardHooks): Promise<void> {
  const section = hooks.addSection("Brew Cleanup");
  const steps: BrewStepResult[] = [];

  const previewStep = await section.run("Collecting cleanup candidates", () =>
    runBrewStep("Cleanup preview", "brew", ["cleanup", "--prune=all", "--dry-run"], true, false),
  );
  steps.push(previewStep);

  if (previewStep.status === "failed") {
    section.skip("Cleanup apply", "Skipped because cleanup preview failed.");
  } else {
    const candidateLines = getCleanupCandidateLines(previewStep.details[0] ?? "");
    if (candidateLines.length === 0) {
      hooks.note("No cleanup candidates detected.", "info");
    } else {
      hooks.list("Cleanup candidates", candidateLines);
    }

    if (dryRun) {
      section.skip("Cleanup apply", "Skipped because dry-run is enabled.");
    } else {
      const cleanupStep = await section.run("Removing stale brew artifacts", () =>
        runBrewStep("Cleanup apply", "brew", ["cleanup", "--prune=all"], true, false),
      );
      steps.push(cleanupStep);

      const resultLines = getCleanupResultLines(cleanupStep.details[0] ?? "");
      if (resultLines.length === 0) {
        hooks.note("No files were removed.", "info");
      } else {
        hooks.list("Deleted items", resultLines);
      }
    }
  }

  if (hasCriticalBrewFailure(steps)) {
    throw new Error("One or more critical brew clean steps failed.");
  }

  hooks.note("Brew cleanup complete.", "success");
}

export async function brewAutoremoveDashboard(dryRun: boolean, hooks: DashboardHooks): Promise<void> {
  const section = hooks.addSection("Brew Autoremove");
  const steps: BrewStepResult[] = [];

  const preview = await section.run("Previewing unused dependencies", () =>
    runBrewStep("Autoremove preview", "brew", ["autoremove", "--dry-run"], true, false),
  );
  steps.push(preview);

  if (preview.status === "failed") {
    section.skip("Autoremove apply", "Skipped because autoremove preview failed.");
  } else if (dryRun) {
    section.skip("Autoremove apply", "Skipped because dry-run is enabled.");
  } else {
    steps.push(
      await section.run("Removing unused dependencies", () =>
        runBrewStep("Autoremove apply", "brew", ["autoremove"], true, false),
      ),
    );
  }

  if (hasCriticalBrewFailure(steps)) {
    throw new Error("One or more critical brew autoremove steps failed.");
  }
  hooks.note("Brew autoremove complete.", "success");
}

export async function brewUpgradeDashboard(
  dryRun: boolean,
  verbose: boolean,
  greedy: boolean,
  hooks: DashboardHooks,
): Promise<void> {
  const streamOpts = { verbose, heartbeatMs: 45_000 } as const;
  const upgradeStreamOpts = { ...streamOpts, env: { HOMEBREW_NO_AUTO_UPDATE: "1" } } as const;

  const preflight = hooks.addSection("");

  const updateStep =
    dryRun ?
      (() => {
        preflight.skip("Brew update", "Skipped because dry-run is enabled.");
        return { status: "skipped" as const, details: ["Skipped because dry-run is enabled."] };
      })()
    : await preflight.runStream(
        "brew update — refresh taps & metadata",
        (logLine) =>
          runBrewStep(
            "Brew update",
            "brew",
            verbose ? ["update", "--auto-update", "--verbose"] : ["update-if-needed"],
            true,
            false,
            true,
            { ...streamOpts, onLine: logLine },
          ),
        { persistLines: verbose },
      );

  if (updateStep.status === "failed") {
    throw new Error("Homebrew metadata update failed; no packages were upgraded.");
  }

  let discovered: OutdatedPackages | undefined;
  const discoveryStep = await preflight.run("brew outdated — discover upgrade targets", async () => {
    discovered = await getOutdatedPackages({ greedy });
    return {
      status: discovered.ok ? ("success" as const) : ("failed" as const),
      details: [
        discovered.ok ?
          `${discovered.formulae.length} formulae and ${discovered.casks.length} casks are outdated.`
        : (discovered.error ?? "Could not determine outdated Homebrew packages."),
      ],
    };
  });

  if (!discovered || !discovered.ok || discoveryStep.status === "failed") {
    throw new Error(discovered?.error ?? "Could not determine outdated Homebrew packages.");
  }

  const formulae = discovered.formulae;
  const casks = discovered.casks;
  const totalTargets = formulae.length + casks.length;
  const actions = hooks.addSection("");
  const actionResults: TaskResult[] = [];

  if (totalTargets === 0) {
    actions.skip("Upgrade", "No outdated formulae or casks found.");
  }

  if (formulae.length > 0) {
    const upgradeArgs = ["upgrade", ...(verbose ? ["--verbose"] : []), "--formula", ...formulae];
    if (dryRun) {
      actions.skip(`Upgrade ${formulae.length} formulae`, `Would upgrade: ${formulae.join(", ")}`);
    } else {
      actionResults.push(
        await actions.runStream(
          `brew upgrade ${formulae.length} formulae`,
          (logLine) =>
            runBrewStep("Upgrade formulae", "brew", upgradeArgs, true, false, true, {
              ...upgradeStreamOpts,
              onLine: logLine,
            }),
          { persistLines: verbose },
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
      actions.skip(`Upgrade ${casks.length} casks`, `Would upgrade: ${casks.join(", ")}`);
    } else {
      actionResults.push(
        await actions.runStream(
          `brew upgrade ${casks.length} casks`,
          (logLine) =>
            runBrewStep("Upgrade casks", "brew", upgradeArgs, true, false, true, {
              ...upgradeStreamOpts,
              onLine: logLine,
            }),
          { persistLines: verbose },
        ),
      );
    }
  }

  if (totalTargets > 0) {
    hooks.list(dryRun ? "Planned targets" : "Upgrade targets", [
      ...formulae.map((pkg) => `formula  ${pkg}`),
      ...casks.map((cask) => `cask     ${cask}`),
    ]);
  }

  if (actionResults.some((result) => result.status === "failed")) {
    throw new Error("One or more critical brew upgrade steps failed.");
  }

  hooks.note("Brew upgrade complete.", "success");
}

export async function brewOptimizeDashboard(dryRun: boolean, hooks: DashboardHooks): Promise<void> {
  hooks.note("Pre-cleanup doctor pass", "heading");
  await brewDoctorDashboard(dryRun, hooks);
  await brewUpgradeDashboard(dryRun, false, false, hooks);
  await brewCleanDashboard(dryRun, hooks);

  hooks.note("Post-cleanup doctor pass", "heading");
  await brewDoctorDashboard(dryRun, hooks);

  hooks.note("Brew optimize completed.", "success");
}
