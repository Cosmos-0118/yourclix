import chalk from "chalk";
import { CommandProgress } from "../../core/progress.js";
import { confirm } from "../../core/prompt.js";
import { runDoctor } from "../doctor.js";
import { findBrokenSymlinks, removeBrokenSymlinks } from "./broken-symlinks.js";
import { runBrewMaintenance } from "./brew.js";

function hasIssue(reportIssueIds: string[], issueId: string): boolean {
  return reportIssueIds.includes(issueId);
}

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

  const safeIssueIds = safeIssues.map((issue) => issue.id);
  const shouldFixBrokenSymlinks = hasIssue(safeIssueIds, "broken-symlinks");
  const shouldRunBrewMaintenance = hasIssue(safeIssueIds, "brew-outdated");

  if (!shouldFixBrokenSymlinks && !shouldRunBrewMaintenance) {
    console.log(
      chalk.yellow(
        "Safe issues found, but no automated fix actions are mapped yet.",
      ),
    );
    return;
  }

  console.log(chalk.bold(`Applying ${safeIssues.length} safe fixes...`));

  let brokenSymlinks: string[] = [];
  if (shouldFixBrokenSymlinks) {
    brokenSymlinks = await progress.step("Finding broken symlinks", () =>
      findBrokenSymlinks(),
    );

    console.log(
      chalk.dim(`Detected ${brokenSymlinks.length} broken symlink(s).`),
    );
  } else {
    progress.tick(
      "Skipping broken symlink discovery (not indicated by doctor)",
    );
  }

  if (shouldFixBrokenSymlinks) {
    const approveSymlinkCleanup = await confirm(
      `Delete ${brokenSymlinks.length} broken symlink(s)?`,
      yes,
    );

    if (!approveSymlinkCleanup) {
      console.log(chalk.yellow("Broken symlink cleanup skipped by user."));
      progress.tick("Skipping broken symlink removal (user declined)");
    } else {
      const removedCount = await progress.step(
        `Removing ${brokenSymlinks.length} broken symlink(s)`,
        () => removeBrokenSymlinks(brokenSymlinks, dryRun),
      );

      const verb = dryRun ? "Would remove" : "Removed";
      console.log(chalk.green(`${verb} ${removedCount} broken symlink(s).`));
    }
  } else {
    progress.tick("Skipping broken symlink removal (not indicated by doctor)");
  }

  if (shouldRunBrewMaintenance) {
    await progress.step("Running Homebrew cleanup and doctor", () =>
      runBrewMaintenance(dryRun),
    );
  } else {
    progress.tick("Skipping Homebrew maintenance (no outdated packages)");
  }

  console.log(chalk.green("Auto-fix completed."));
}
