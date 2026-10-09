import { ActionableError } from "../../core/actionable-error.js";
import { ui, type CliUI } from "../../core/ui.js";
import {
  getCleanupCandidateLines,
  getCleanupResultLines,
  getOutdatedPackages,
  runBrewStep,
  type BrewStepResult,
} from "../../managers/brew-manager.js";
import {
  brewRecoverySuggestions,
  getUnsupportedBrewPackages,
  reviewUnsupportedBrewPackages,
} from "../../managers/brew-issues.js";

interface ReviewContext {
  reviewed: Set<string>;
  removed: Set<string>;
}
const context = (): ReviewContext => ({
  reviewed: new Set(),
  removed: new Set(),
});
const shortName = (name: string): string => name.split("/").at(-1) ?? name;

export function normalizeDoctorStep(step: BrewStepResult): BrewStepResult {
  const output = step.details.join("\n");
  if (
    step.status !== "failed" ||
    (step.exitCode !== undefined && step.exitCode !== 1) ||
    !/^\s*Warning:/im.test(output) ||
    /^\s*(Error:|fatal:|Traceback|Exception)/im.test(output)
  )
    return step;
  const warningAt = output.search(/^\s*Warning:/im);
  return { ...step, status: "warn", details: [output.slice(warningAt).trim()] };
}

function requireSuccess(steps: BrewStepResult[]): void {
  const failed = steps.filter(
    (step) => step.critical && step.status === "failed",
  );
  if (!failed.length) return;
  throw new ActionableError({
    code: "BREW_UNRESOLVED",
    summary: `Homebrew finished with ${failed.length} unresolved issue${failed.length === 1 ? "" : "s"}: ${failed.map((step) => step.name).join(", ")}.`,
    details: failed.flatMap((step) => [step.command, ...step.details]),
    nextSteps: failed.map((step) => `Retry: ${step.command}`),
  });
}

async function review(dryRun: boolean, terminal: CliUI, ctx: ReviewContext) {
  const packages = await terminal.task(
    "Inspect installed Homebrew packages",
    getUnsupportedBrewPackages,
  );
  const steps = await reviewUnsupportedBrewPackages(
    packages,
    dryRun,
    terminal,
    ctx.reviewed,
  );
  for (const step of steps)
    if (step.status === "success")
      ctx.removed.add(
        `${step.command.includes("--cask") ? "cask" : "formula"}:${shortName(step.name.slice("Remove ".length))}`,
      );
  return { packages, steps };
}

async function doctor(
  _dryRun: boolean,
  terminal: CliUI,
): Promise<BrewStepResult> {
  // Doctor is read-only: dry runs should still discover actionable diagnostics.
  return terminal.task("Check Homebrew health", async () =>
    normalizeDoctorStep(
      await runBrewStep("Homebrew doctor", "brew", ["doctor"], false, false),
    ),
  );
}

export async function brewDoctor(
  dryRun = false,
  terminal: CliUI = ui,
): Promise<void> {
  const step = await doctor(dryRun, terminal);
  if (step.status === "failed")
    throw new ActionableError({
      code: "BREW_DOCTOR_FAILED",
      summary: "Homebrew doctor failed.",
      details: step.details,
      nextSteps: ["Run: brew doctor"],
    });
  const reviewed = await review(dryRun, terminal, context());
  requireSuccess(reviewed.steps);
}

export async function brewStatus(terminal: CliUI = ui): Promise<void> {
  const steps: BrewStepResult[] = [];
  for (const [name, args] of [
    ["Homebrew version", ["--version"]],
    ["Homebrew prefix", ["--prefix"]],
    ["Homebrew configuration", ["config"]],
  ] as const) {
    const result = await terminal.task(name, () =>
      runBrewStep(name, "brew", [...args], true, false),
    );
    steps.push(result);
    if (result.status === "success")
      for (const detail of result.details) terminal.note(detail);
  }
  const outdated = await terminal.task(
    "Check outdated packages",
    getOutdatedPackages,
  );
  if (!outdated.ok) throw new Error(outdated.error);
  terminal.list("Outdated packages", [
    ...outdated.formulae.map((name) => `formula  ${name}`),
    ...outdated.casks.map((name) => `cask     ${name}`),
  ]);
  const packages = await getUnsupportedBrewPackages();
  for (const pkg of packages)
    terminal.status(
      "warn",
      `${pkg.name}: ${pkg.disabled ? "disabled" : "deprecated"}`,
      [pkg.reason],
    );
  requireSuccess(steps);
}

async function cleanup(
  dryRun: boolean,
  terminal: CliUI,
  autoremove = false,
): Promise<BrewStepResult[]> {
  const verb = autoremove ? "autoremove" : "cleanup";
  const args = autoremove ? [verb] : [verb, "--prune=all"];
  const preview = await terminal.task(`Preview ${verb}`, () =>
    runBrewStep(`Preview ${verb}`, "brew", [...args, "--dry-run"], true, false),
  );
  if (preview.status === "failed") {
    terminal.status("skipped", verb, ["Preview failed; no cleanup applied."]);
    return [preview];
  }
  const candidates = getCleanupCandidateLines(preview.details.join("\n"));
  if (candidates.length) terminal.list("Cleanup candidates", candidates);
  if (dryRun) {
    terminal.status("skipped", verb, ["Dry run: no files removed."]);
    return [preview];
  }
  const applied = await terminal.task(
    autoremove
      ? "Remove unused dependencies"
      : "Remove stale Homebrew artifacts",
    () => runBrewStep(verb, "brew", args, true, false),
  );
  if (applied.status === "success") {
    const removed = getCleanupResultLines(applied.details.join("\n"));
    terminal.list(
      "Cleanup result",
      removed.length ? removed : ["No stale artifacts removed."],
    );
  }
  return [preview, applied];
}

export async function brewClean(
  dryRun = false,
  terminal: CliUI = ui,
): Promise<void> {
  requireSuccess(await cleanup(dryRun, terminal));
}
export async function brewAutoremove(
  dryRun = false,
  terminal: CliUI = ui,
): Promise<void> {
  requireSuccess(await cleanup(dryRun, terminal, true));
}

async function upgradePackage(
  name: string,
  kind: "formula" | "cask",
  verbose: boolean,
  greedy: boolean,
  terminal: CliUI,
): Promise<BrewStepResult> {
  const args = [
    "upgrade",
    ...(verbose ? ["--verbose"] : []),
    ...(kind === "cask" && greedy ? ["--greedy"] : []),
    `--${kind}`,
    name,
  ];
  const options = {
    verbose,
    env: { HOMEBREW_NO_AUTO_UPDATE: "1" },
    onLine: (line: string) => terminal.note(line),
  };
  const original = await runBrewStep(
    `Upgrade ${name}`,
    "brew",
    args,
    true,
    false,
    true,
    options,
  );
  if (original.status !== "failed") return original;
  terminal.list(`${name}: upgrade failed`, original.details);
  const missingApp =
    kind === "cask" &&
    /App source\s+['"].+?['"]\s+is not there|\.app.+(?:does not exist|not found)/i.test(
      original.details.join("\n"),
    );
  if (missingApp) {
    terminal.note(`Homebrew tracks ${name}, but its app is missing.`);
    terminal.note(`Repair: brew reinstall --cask ${name}`);
    const choice = await terminal.select(
      `How should we handle ${name}?`,
      [
        { value: "reinstall", label: "Reinstall the app" },
        {
          value: "remove",
          label: "Remove the cask from Homebrew",
          hint: "Runs brew uninstall --cask to remove managed artifacts",
        },
        { value: "skip", label: "Skip for now" },
      ],
      "skip",
    );
    if (choice !== "skip") {
      const repairArgs = [
        choice === "reinstall" ? "reinstall" : "uninstall",
        "--cask",
        name,
      ];
      const repaired = await runBrewStep(
        `${choice === "reinstall" ? "Reinstall" : "Remove"} ${name}`,
        "brew",
        repairArgs,
        true,
        false,
        true,
        options,
      );
      return repaired.status === "success"
        ? {
            ...repaired,
            details: [
              `${name} ${choice === "reinstall" ? "reinstalled" : "removed from Homebrew"}.`,
            ],
          }
        : repaired;
    }
  } else {
    terminal.list(
      "Next steps",
      brewRecoverySuggestions(name, kind, original.details),
    );
    const choice = await terminal.select(
      `Retry the upgrade for ${name}?`,
      [
        { value: "retry", label: "Retry once" },
        { value: "skip", label: "Skip for now" },
      ],
      "skip",
    );
    if (choice === "retry")
      return runBrewStep(
        `Upgrade ${name}`,
        "brew",
        args,
        true,
        false,
        true,
        options,
      );
  }
  return original;
}

async function upgrades(
  dryRun: boolean,
  verbose: boolean,
  greedy: boolean,
  terminal: CliUI,
  ctx: ReviewContext,
): Promise<BrewStepResult[]> {
  const steps: BrewStepResult[] = [];
  if (dryRun)
    terminal.status("skipped", "Refresh Homebrew metadata", [
      "Dry run: using current metadata.",
    ]);
  else {
    const update = await terminal.stream(
      "Refresh Homebrew metadata",
      (onLine) =>
        runBrewStep(
          "Refresh Homebrew metadata",
          "brew",
          verbose
            ? ["update", "--auto-update", "--verbose"]
            : ["update-if-needed"],
          true,
          false,
          true,
          { verbose, onLine },
        ),
    );
    steps.push(update);
    requireSuccess([update]);
  }
  const reviewed = await review(dryRun, terminal, ctx);
  steps.push(...reviewed.steps);
  const disabled = new Set(
    reviewed.packages
      .filter((pkg) => pkg.disabled)
      .map((pkg) => `${pkg.kind}:${shortName(pkg.name)}`),
  );
  const outdated = await terminal.task(
    "Discover upgrade targets",
    getOutdatedPackages.bind(null, { greedy }),
  );
  if (!outdated.ok)
    throw new ActionableError({
      code: "BREW_DISCOVERY_FAILED",
      summary: "Could not discover outdated Homebrew packages.",
      details: [outdated.error ?? "No details returned."],
      nextSteps: ["Run: brew outdated --json=v2"],
    });
  const targets = [
    ...outdated.formulae.map((name) => ({ name, kind: "formula" as const })),
    ...outdated.casks.map((name) => ({ name, kind: "cask" as const })),
  ];
  terminal.list(
    dryRun ? "Planned upgrades" : "Upgrade plan",
    targets.length
      ? targets.map((pkg) => `${pkg.kind}  ${pkg.name}`)
      : ["All packages are current."],
  );
  for (const pkg of targets) {
    if (
      ctx.removed.has(`${pkg.kind}:${shortName(pkg.name)}`) ||
      disabled.has(`${pkg.kind}:${shortName(pkg.name)}`)
    ) {
      terminal.status("skipped", `Upgrade ${pkg.name}`, [
        "Package was removed or is disabled in Homebrew.",
      ]);
      continue;
    }
    if (dryRun) {
      terminal.status("skipped", `Would upgrade ${pkg.name}`);
      continue;
    }
    steps.push(
      await terminal.task(`Upgrade ${pkg.name}`, () =>
        upgradePackage(pkg.name, pkg.kind, verbose, greedy, terminal),
      ),
    );
  }
  if (
    !dryRun &&
    steps.some(
      (step) =>
        step.status === "success" && /^(Upgrade|Reinstall) /.test(step.name),
    )
  ) {
    const after = await terminal.task("Verify upgraded packages", () =>
      getOutdatedPackages({ greedy }),
    );
    if (!after.ok) {
      steps.push({
        name: "Verify upgrades",
        command: "brew outdated --json=v2",
        critical: true,
        status: "failed",
        details: [after.error ?? "Could not verify the upgrade result."],
      });
    } else {
      const remaining = new Set([
        ...after.formulae.map((name) => `formula:${shortName(name)}`),
        ...after.casks.map((name) => `cask:${shortName(name)}`),
      ]);
      for (const step of steps) {
        if (
          step.status !== "success" ||
          !/^(Upgrade|Reinstall) /.test(step.name)
        )
          continue;
        const name = step.name.replace(/^(Upgrade|Reinstall) /, "");
        const kind = step.command.includes("--cask") ? "cask" : "formula";
        if (remaining.has(`${kind}:${shortName(name)}`)) {
          step.status = "failed";
          step.details = [
            `${name} is still outdated after Homebrew returned success; it may be pinned or require manual intervention.`,
          ];
          terminal.status("failed", `Verify ${name}`, step.details);
        }
      }
    }
  }
  terminal.list("Upgrade result", [
    `${steps.filter((step) => step.name.startsWith("Upgrade ") && step.status === "success").length} packages upgraded`,
    `${steps.filter((step) => /^(Reinstall|Remove) /.test(step.name) && step.status === "success").length} packages repaired or removed`,
    `${steps.filter((step) => step.status === "failed").length} unresolved failures`,
  ]);
  return steps;
}

export async function brewUpgrade(
  dryRun = false,
  verbose = false,
  greedy = false,
  terminal: CliUI = ui,
): Promise<void> {
  requireSuccess(await upgrades(dryRun, verbose, greedy, terminal, context()));
}

export async function brewOptimize(
  dryRun = false,
  terminal: CliUI = ui,
  verbose = false,
  greedy = false,
): Promise<void> {
  const ctx = context();
  terminal.heading("Homebrew health");
  const before = await doctor(dryRun, terminal);
  if (before.status === "failed")
    throw new ActionableError({
      code: "BREW_DOCTOR_FAILED",
      summary: "Homebrew preflight failed.",
      details: before.details,
      nextSteps: ["Run: brew doctor"],
    });
  const steps = await upgrades(dryRun, verbose, greedy, terminal, ctx);
  terminal.heading("Cleanup");
  steps.push(...(await cleanup(dryRun, terminal)));
  terminal.heading("Final health check");
  const after = await doctor(dryRun, terminal);
  steps.push({ ...after, critical: true });
  requireSuccess(steps);
}
