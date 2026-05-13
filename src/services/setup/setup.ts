import chalk from "chalk";
import ora from "ora";
import { runCommand } from "../../core/exec.js";
import { ensureManagedPath } from "../../managers/path-manager.js";
import { readSetupConfig, resolveSetupConfig } from "./config.js";
import { createSetupLogger } from "./logger.js";
import { hasBrew, installBatch } from "./install.js";
import { ensurePrerequisites } from "./prerequisites.js";
import { resolveAppsModeFromPrompt } from "./apps-prompt.js";
import { runStep } from "./run-step.js";
import { ensureManagedShellBlocks } from "./shell-blocks.js";
import { renderSetupSummary } from "./summary.js";
import { collectVersionSummary } from "./version-summary.js";
import type { SetupOptions, StepResult } from "./types.js";

export type { SetupOptions } from "./types.js";

export async function runSetup(options: SetupOptions): Promise<void> {
  const logger = await createSetupLogger(Boolean(options.debug));
  await logger.log("info", "Starting setup run");

  const configFromFile = await readSetupConfig(options.config, logger);
  const effective = resolveSetupConfig(options, configFromFile);

  console.log(chalk.cyan("Starting developer setup"));
  if (effective.dryRun) {
    console.log(chalk.yellow("Dry-run mode enabled. No changes will be made."));
  }

  const results: StepResult[] = [];

  results.push(
    await runStep("Prerequisites", logger, async () =>
      ensurePrerequisites(effective, logger),
    ),
  );

  results.push(
    await runStep("PATH management", logger, async () => {
      const pathResult = await ensureManagedPath("your");
      const details: string[] = [];

      if (pathResult.addedToCurrentSession.length > 0) {
        details.push(
          `Added to current session PATH: ${pathResult.addedToCurrentSession.join(", ")}`,
        );
      } else {
        details.push("Current session PATH already healthy.");
      }

      if (pathResult.addedToShellFiles.length > 0) {
        details.push(
          `Persisted PATH entries: ${pathResult.addedToShellFiles.join(", ")}`,
        );
      } else {
        details.push("Shell profile PATH entries already present.");
      }

      if (pathResult.fallbackApplied.length > 0) {
        details.push(
          `Fallback method used: ${pathResult.fallbackApplied.join(", ")}`,
        );
      }

      return { status: "success", details };
    }),
  );

  const brewReady = await runStep("Homebrew", logger, async () => {
    if (await hasBrew()) {
      return { status: "success", details: ["Homebrew already installed."] };
    }

    const spinner = ora("Homebrew not found. Installing Homebrew").start();
    const result = await runCommand(
      "/bin/bash",
      [
        "-c",
        "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)",
      ],
      { dryRun: effective.dryRun, allowFailure: true },
    );

    if (result.code === 0) {
      spinner.succeed(chalk.green("Homebrew installation step completed"));
      return {
        status: "success",
        details: [
          effective.dryRun ? "Would install Homebrew." : "Installed Homebrew.",
        ],
      };
    }

    spinner.fail(chalk.red("Homebrew installation failed"));
    return {
      status: "failed",
      details: [
        result.stderr ||
          result.stdout ||
          "Unknown Homebrew installation error.",
      ],
    };
  });

  results.push(brewReady);

  if (brewReady.status !== "failed") {
    results.push(
      await runStep("Core dev packages", logger, async () => {
        const summary = await installBatch(
          "Base Developer Packages",
          effective.coreFormulae.map((name) => ({ name, type: "formula" })),
          effective,
          logger,
        );
        return summary;
      }),
    );

    results.push(
      await runStep("Shell enhancements", logger, async () => {
        const installSummary = await installBatch(
          "Shell Enhancements",
          effective.shellFormulae.map((name) => ({ name, type: "formula" })),
          effective,
          logger,
        );

        const shellSummary = await ensureManagedShellBlocks(effective, logger);
        const status =
          installSummary.status === "failed" || shellSummary.status === "failed" ?
            "failed"
          : (
            installSummary.status === "partial" ||
            shellSummary.status === "partial"
          ) ?
            "partial"
          : "success";

        return {
          status,
          details: [...installSummary.details, ...shellSummary.details],
        };
      }),
    );

    if (effective.profile !== "minimal") {
      results.push(
        await runStep("Extra CLI tools", logger, async () =>
          installBatch(
            "Extra CLI Tools",
            effective.extraCliFormulae.map((name) => ({
              name,
              type: "formula",
            })),
            effective,
            logger,
          ),
        ),
      );
    } else {
      results.push({
        name: "Extra CLI tools",
        status: "skipped",
        details: ["Skipped for minimal profile."],
      });
    }

    const appMode = await resolveAppsModeFromPrompt(effective, options);
    if (appMode !== "none") {
      results.push(
        await runStep("Desktop apps", logger, async () =>
          installBatch(
            "Desktop Apps",
            effective.casks.map((name) => ({ name, type: "cask" })),
            effective,
            logger,
          ),
        ),
      );
    } else {
      results.push({
        name: "Desktop apps",
        status: "skipped",
        details: ["Skipped by configuration."],
      });
    }

    results.push(
      await runStep("Version checks", logger, async () =>
        collectVersionSummary(effective, logger),
      ),
    );
  } else {
    results.push({
      name: "Core dev packages",
      status: "skipped",
      details: ["Skipped because Homebrew failed."],
    });
    results.push({
      name: "Shell enhancements",
      status: "skipped",
      details: ["Skipped because Homebrew failed."],
    });
    results.push({
      name: "Extra CLI tools",
      status: "skipped",
      details: ["Skipped because Homebrew failed."],
    });
    results.push({
      name: "Desktop apps",
      status: "skipped",
      details: ["Skipped because Homebrew failed."],
    });
    results.push({
      name: "Version checks",
      status: "skipped",
      details: ["Skipped because Homebrew failed."],
    });
  }

  renderSetupSummary(results, logger.path);
}
