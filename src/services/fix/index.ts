import chalk from "chalk";
import { CommandProgress } from "../../core/progress.js";
import { confirm } from "../../core/prompt.js";
import { printDoctorReport, runDoctor } from "../doctor.js";
import { findBrokenSymlinks, removeBrokenSymlinks } from "./broken-symlinks.js";
import { runBrewMaintenance } from "./brew.js";
import type { Issue } from "../../core/types.js";

function hasIssue(reportIssueIds: string[], issueId: string): boolean {
  return reportIssueIds.includes(issueId);
}

function getNonFixableReason(issue: Issue): string {
  switch (issue.id) {
    case "large-directories":
      return "Requires human review to avoid deleting important project or personal files.";
    case "dev-caches":
      return "Cache locations can include active workspace/runtime data and need explicit user choice.";
    case "low-disk-space":
      return "Low space can be caused by mixed data types; auto-delete could remove important files.";
    case "network-reachability":
      return "Connectivity issues depend on local network/router state and need user context before applying resets.";
    case "git-identity-missing":
      return "Git identity values are personal and should be configured explicitly by the user.";
    default:
      return "No safe automatic remediation is mapped for this issue yet.";
  }
}

function printNonFixableIssues(issues: Issue[]): void {
  const nonFixable = issues.filter((issue) => !issue.safeToFix);
  if (nonFixable.length === 0) {
    return;
  }

  console.log(chalk.bold("Why these issues were not auto-fixed"));
  for (const issue of nonFixable) {
    console.log(
      chalk.yellow(`- ${issue.title}: ${getNonFixableReason(issue)}`),
    );
    if (issue.recommendedCommand) {
      console.log(
        chalk.dim(`  Suggested next step: ${issue.recommendedCommand}`),
      );
    }
  }
}

export async function runAutoFix(dryRun = false, yes = false): Promise<void> {
  const progress = new CommandProgress("Auto Fix Engine", 4);
  const report = await progress.step("Running system diagnosis", () =>
    runDoctor(),
  );

  console.log(chalk.bold("Diagnosis summary"));
  printDoctorReport(report);

  if (report.issues.length === 0) {
    progress.tick("Skipping broken symlink discovery (no issues)");
    progress.tick("Skipping broken symlink removal (no issues)");
    progress.tick("Skipping Homebrew maintenance (no issues)");
    console.log(chalk.green("Nothing to fix. System already healthy."));
    return;
  }

  const safeIssues = report.issues.filter((issue) => issue.safeToFix);
  if (safeIssues.length === 0) {
    progress.tick("Skipping broken symlink discovery (no safe fixes)");
    progress.tick("Skipping broken symlink removal (no safe fixes)");
    progress.tick("Skipping Homebrew maintenance (no safe fixes)");
    printNonFixableIssues(report.issues);
    console.log(
      chalk.yellow("Issues were found, but none are safe for automatic fixes."),
    );
    return;
  }

  const safeIssueIds = safeIssues.map((issue) => issue.id);
  const shouldFixBrokenSymlinks = hasIssue(safeIssueIds, "broken-symlinks");
  const shouldRunBrewMaintenance = hasIssue(safeIssueIds, "brew-outdated");

  if (!shouldFixBrokenSymlinks && !shouldRunBrewMaintenance) {
    progress.tick("Skipping broken symlink discovery (no mapped action)");
    progress.tick("Skipping broken symlink removal (no mapped action)");
    progress.tick("Skipping Homebrew maintenance (no mapped action)");
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
