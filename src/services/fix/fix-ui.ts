import { ui } from "../../core/ui.js";
import chalk from "chalk";
import type { Issue } from "../../core/types.js";
import { pluralize } from "../../core/format.js";

export function printFixBanner(dryRun: boolean): void {
  ui.heading(dryRun ? "Fix preview" : "Fix system issues");
  ui.note("Doctor-driven remediation within the diagnosis scope.");
}

export function printFixPlan(
  safeIssues: Issue[],
  actions: { symlinks: number; brewUpgrade: boolean },
): void {
  ui.heading("Remediation plan");

  const rows: string[] = [];
  if (actions.symlinks > 0) {
    rows.push(
      `${chalk.green("●")}  ${chalk.bold("Broken symlinks")}  ${chalk.dim("→")}  remove ${pluralize(actions.symlinks, "path")} (diagnosis scope only)`,
    );
  }
  if (actions.brewUpgrade) {
    rows.push(
      `${chalk.green("●")}  ${chalk.bold("Outdated Homebrew")}  ${chalk.dim("→")}  brew update, upgrade, cleanup, doctor`,
    );
  }

  if (rows.length === 0) {
    rows.push(
      chalk.dim("No automated actions mapped for current safe issues."),
    );
  }

  for (const row of rows) {
    ui.note(row);
  }
  ui.note(
    chalk.dim("Issues considered: ") +
      safeIssues.map((i) => chalk.white(i.id)).join(chalk.dim(", ")),
  );
}

export function printFixActionMatrix(issues: Issue[]): void {
  const rows = issues.map((issue) => {
    const fix = issue.safeToFix
      ? issue.id === "broken-symlinks"
        ? chalk.green("auto (symlinks)")
        : issue.id === "brew-outdated"
          ? chalk.green("auto (brew)")
          : chalk.yellow("not mapped")
      : chalk.dim("manual");

    const sev = issue.severity ?? "warn";
    const sevColor =
      sev === "critical"
        ? chalk.red
        : sev === "warn"
          ? chalk.yellow
          : chalk.cyan;

    const title =
      issue.title.length > 42 ? `${issue.title.slice(0, 41)}…` : issue.title;
    return `${sevColor(`[${sev}]`)}  ${chalk.bold(title)}  ${chalk.dim("→")}  ${fix}`;
  });

  ui.heading("Issue → action matrix");
  for (const row of rows) ui.note(row);
  ui.note(
    chalk.dim(
      "Tip: network, disk, caches, and git identity stay manual — see suggested commands above.",
    ),
  );
}

export function printFixSuccessFooter(dryRun: boolean): void {
  const msg = dryRun
    ? "Dry run finished — no changes were made. Re-run without --dry-run to apply."
    : "All remediation steps completed successfully.";
  ui.success(msg);
}
