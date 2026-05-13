import chalk from "chalk";
import os from "node:os";
import { ActionableError } from "../../core/actionable-error.js";
import { CommandProgress } from "../../core/progress.js";
import { confirm } from "../../core/prompt.js";
import { collectBrokenSymlinkPaths } from "../../managers/broken-symlink-scan.js";
import { getDoctorSymlinkScanContext } from "../../managers/doctor-manager.js";
import { printDoctorReport, runDoctor } from "../doctor/doctor.js";
import { removeBrokenSymlinks } from "./broken-symlinks.js";
import { runBrewOutdatedRemediation } from "./brew.js";
import {
  printFixActionMatrix,
  printFixBanner,
  printFixPlan,
  printFixSuccessFooter,
} from "./fix-ui.js";
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
      return "Connectivity issues depend on local network/router state; try: your net fix (review output first).";
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

  console.log(chalk.bold.cyan("\n==> ") + chalk.bold.white("Not auto-fixed (by design)"));
  for (const issue of nonFixable) {
    console.log(
      chalk.yellow(`- ${issue.title}: ${getNonFixableReason(issue)}`),
    );
    if (issue.recommendedCommand) {
      console.log(chalk.dim(`  Suggested: ${issue.recommendedCommand}`));
    }
  }
}

async function resolveBrokenSymlinkPaths(safeIssues: Issue[]): Promise<string[]> {
  const issue = safeIssues.find((i) => i.id === "broken-symlinks");
  const fromReport = issue?.fixContext?.brokenSymlinkPaths;
  if (fromReport && fromReport.length > 0) {
    return fromReport;
  }

  const home = os.homedir();
  const ctx = await getDoctorSymlinkScanContext();
  return collectBrokenSymlinkPaths({
    home,
    symlinkScanDepth: ctx.symlinkScanDepth,
    ignorePatterns: ctx.ignorePatterns,
  });
}

export async function runAutoFix(
  dryRun = false,
  yes = false,
  verbose = false,
): Promise<void> {
  printFixBanner(dryRun);

  const report = await runDoctor();

  console.log(chalk.bold.cyan("\n==> ") + chalk.bold.white("Diagnosis summary"));
  printDoctorReport(report);
  printFixActionMatrix(report.issues);

  if (report.issues.length === 0) {
    printFixSuccessFooter(dryRun);
    console.log(chalk.green("Nothing to fix. System already healthy."));
    return;
  }

  const safeIssues = report.issues.filter((issue) => issue.safeToFix);
  if (safeIssues.length === 0) {
    printNonFixableIssues(report.issues);
    console.log(
      chalk.yellow("\nIssues were found, but none are safe for automatic fixes."),
    );
    return;
  }

  const safeIssueIds = safeIssues.map((issue) => issue.id);
  const shouldFixBrokenSymlinks = hasIssue(safeIssueIds, "broken-symlinks");
  const shouldRunBrewMaintenance = hasIssue(safeIssueIds, "brew-outdated");

  if (!shouldFixBrokenSymlinks && !shouldRunBrewMaintenance) {
    printNonFixableIssues(report.issues);
    console.log(
      chalk.yellow(
        "\nSafe issues were found, but none have automated remediation mapped yet.",
      ),
    );
    return;
  }

  const brokenPaths =
    shouldFixBrokenSymlinks ? await resolveBrokenSymlinkPaths(safeIssues) : [];

  const remedySteps =
    1 +
    (shouldFixBrokenSymlinks ? 1 : 0) +
    (shouldRunBrewMaintenance ? 1 : 0) +
    1;

  const progress = new CommandProgress("Remediation", remedySteps);

  await progress.step("Plan & scope", async () => {
    printFixPlan(safeIssues, {
      symlinks: shouldFixBrokenSymlinks ? brokenPaths.length : 0,
      brewUpgrade: shouldRunBrewMaintenance,
    });
    return undefined;
  });

  if (shouldFixBrokenSymlinks) {
    await progress.step("Broken symlinks", async () => {
      if (brokenPaths.length === 0) {
        console.log(
          chalk.dim("No broken symlink paths in the doctor scan scope."),
        );
        return;
      }

      const approveSymlinkCleanup = await confirm(
        `Remove ${brokenPaths.length} broken symlink(s) within the doctor scan scope?`,
        yes,
      );

      if (!approveSymlinkCleanup) {
        console.log(chalk.yellow("Broken symlink cleanup skipped by user."));
        return;
      }

      const { removed, failures } = await removeBrokenSymlinks(
        brokenPaths,
        dryRun,
      );

      const verb = dryRun ? "Would remove" : "Removed";
      console.log(chalk.green(`\n==> ${verb} ${removed} broken symlink(s).`));

      if (failures.length > 0) {
        throw new ActionableError({
          code: "FIX_SYMLINK_PARTIAL_FAILURE",
          summary: `${failures.length} symlink(s) could not be removed.`,
          details: failures.slice(0, 10).map((f) => `${f.path}: ${f.error}`),
          nextSteps: [
            "Check permissions (some paths may require elevated access).",
            "Re-run: your doctor",
          ],
        });
      }

      return removed;
    });
  }

  if (shouldRunBrewMaintenance) {
    await progress.step("Homebrew upgrade & maintenance", async () => {
      console.log(
        chalk.bold.cyan("\n==> ") +
          chalk.bold.white(
            dryRun ? "Homebrew (preview only)" : "Homebrew (live)",
          ),
      );
      await runBrewOutdatedRemediation(dryRun, verbose);
      return undefined;
    });
  }

  await progress.step("Summary", async () => {
    printFixSuccessFooter(dryRun);
    return undefined;
  });
}
