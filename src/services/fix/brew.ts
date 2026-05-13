import chalk from "chalk";
import { ActionableError } from "../../core/actionable-error.js";
import {
  getOutdatedPackages,
  hasCriticalBrewFailure,
  printBrewSummary,
  runBrewStep,
  type BrewStepResult,
} from "../../managers/brew-manager.js";

function countOutdated(p: { formulae: string[]; casks: string[] }): number {
  return p.formulae.length + p.casks.length;
}

/**
 * Resolves outdated Homebrew packages: upgrade, cleanup, then doctor (diagnostic only).
 * Uses the same streaming/styling pipeline as `your brew` for upgrades.
 */
export async function runBrewOutdatedRemediation(
  fixDryRun: boolean,
  verbose = false,
): Promise<void> {
  const before = await getOutdatedPackages();
  const beforeCount = countOutdated(before);

  if (beforeCount === 0) {
    console.log(
      chalk.dim(
        "No outdated Homebrew packages at apply time — skipping brew upgrade.",
      ),
    );
    return;
  }

  const steps: BrewStepResult[] = [];

  if (fixDryRun) {
    const plan = await runBrewStep(
      "Preview upgrades (brew upgrade --dry-run)",
      "brew",
      ["upgrade", "--dry-run"],
      false,
      false,
      true,
      { verbose, heartbeatMs: 12_000 },
    );
    steps.push(plan);
    if (plan.status === "failed") {
      const fallback = await runBrewStep(
        "List outdated packages",
        "brew",
        ["outdated", "--verbose"],
        false,
        false,
        false,
      );
      steps.push(fallback);
    }
  } else {
    steps.push(
      await runBrewStep(
        "Upgrade outdated formulae and casks",
        "brew",
        ["upgrade"],
        true,
        false,
        true,
        { verbose, heartbeatMs: 12_000 },
      ),
    );
  }

  steps.push(
    await runBrewStep(
      fixDryRun ? "Preview cleanup (brew cleanup -n)" : "Remove stale downloads (brew cleanup)",
      "brew",
      fixDryRun ? ["cleanup", "-n"] : ["cleanup"],
      true,
      false,
      true,
      { verbose },
    ),
  );

  steps.push(
    await runBrewStep(
      "Homebrew doctor (diagnostics)",
      "brew",
      ["doctor"],
      false,
      false,
      false,
      { verbose },
    ),
  );

  printBrewSummary(
    fixDryRun ? "Homebrew plan (dry run)" : "Homebrew remediation",
    steps,
  );

  if (hasCriticalBrewFailure(steps)) {
    const failed = steps.filter((s) => s.critical && s.status === "failed");
    throw new ActionableError({
      code: "FIX_BREW_REMEDIATION_FAILED",
      summary: "One or more Homebrew remediation steps failed.",
      details: failed.flatMap((s) => [
        `${s.name} (${s.command}):`,
        ...s.details.slice(0, 2),
      ]),
      nextSteps: [
        "Run: brew doctor",
        "Run: brew outdated --verbose",
        fixDryRun ? "Re-run without --dry-run to apply upgrades." : "Fix brew errors above, then run: your fix",
      ],
    });
  }

  if (
    fixDryRun &&
    steps.length > 0 &&
    steps.every((s) => s.status === "failed")
  ) {
    throw new ActionableError({
      code: "FIX_BREW_DRY_RUN_FAILED",
      summary: "Could not preview Homebrew changes (dry-run commands failed).",
      details: steps.flatMap((s) => s.details.slice(0, 1)),
      nextSteps: ["Run: brew config", "Run: brew doctor", "Update Homebrew: brew update"],
    });
  }

  if (!fixDryRun && beforeCount > 0) {
    const after = await getOutdatedPackages();
    const afterCount = countOutdated(after);
    if (afterCount >= beforeCount) {
      const remaining = [...after.formulae, ...after.casks].slice(0, 12);
      throw new ActionableError({
        code: "FIX_BREW_OUTDATED_UNCHANGED",
        summary:
          "Homebrew upgrade completed, but the same number of outdated packages is still reported.",
        details: [
          `Before: ${beforeCount} outdated. After: ${afterCount} outdated.`,
          remaining.length > 0 ?
            `Examples still outdated: ${remaining.join(", ")}`
          : "",
        ].filter(Boolean),
        nextSteps: [
          "Run: brew outdated --verbose",
          "Some formulae are pinned or need manual intervention — see brew output above.",
          "Run: your doctor",
        ],
      });
    }
  }

  if (!fixDryRun) {
    console.log(chalk.dim("==> Outdated package count decreased after upgrade."));
  }
}
