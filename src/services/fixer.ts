import chalk from "chalk";
import { runCommand } from "../core/exec.js";
import { CommandProgress } from "../core/progress.js";
import { confirm } from "../core/prompt.js";
import { executeCleaner, scanCleanerTargets } from "./cleaner.js";
import { runDoctor } from "./doctor.js";

export async function runAutoFix(dryRun = false, yes = false): Promise<void> {
  const progress = new CommandProgress("Auto Fix Engine", 4);
  const report = await progress.step("Running system diagnosis", () =>
    runDoctor(),
  );

  if (report.issues.length === 0) {
    console.log(chalk.green("Nothing to fix. System already healthy."));
    return;
  }

  const safeIssues = report.issues.filter((issue) => issue.safeToFix);
  if (safeIssues.length === 0) {
    console.log(
      chalk.yellow("Issues were found, but none are safe for automatic fixes."),
    );
    return;
  }

  console.log(chalk.bold(`Applying ${safeIssues.length} safe fixes...`));

  const cleanerResults = await progress.step(
    "Scanning safe cleanup targets",
    () => scanCleanerTargets("basic"),
  );

  const cleanupTargets = cleanerResults.flatMap((item) => item.paths).length;
  const cleanupApproved = await confirm(
    `Delete ${cleanupTargets} paths in BASIC mode?`,
    Boolean(yes),
  );

  if (!cleanupApproved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  await progress.step("Executing safe cleanup", () =>
    executeCleaner(cleanerResults, { mode: "basic", dryRun, yes: true }),
  );

  await progress.step("Running Homebrew cleanup and doctor", async () => {
    await runCommand("brew", ["cleanup"], { dryRun, allowFailure: true });
    await runCommand("brew", ["doctor"], { dryRun, allowFailure: true });
  });

  console.log(chalk.green("Auto-fix completed."));
}
