import boxen from "boxen";
import chalk from "chalk";
import type { Issue } from "../../core/types.js";

const RULE = chalk.dim("─".repeat(56));

export function printFixBanner(dryRun: boolean): void {
  const mode = dryRun ? chalk.yellow(" dry-run ") : chalk.green(" apply ");
  console.log(
    "\n" +
      boxen(
        [
          chalk.bold.white("your fix"),
          "",
          chalk.dim("Safe, doctor-driven remediation — same scope as diagnosis."),
          chalk.dim("Homebrew steps stream live like ") + chalk.cyan("brew") + chalk.dim("."),
        ].join("\n"),
        {
          title: mode,
          titleAlignment: "center",
          padding: { left: 2, right: 2, top: 0, bottom: 0 },
          margin: { top: 0, bottom: 0 },
          borderStyle: "round",
          borderColor: dryRun ? "yellow" : "green",
          dimBorder: false,
        },
      ),
  );
}

export function printFixPlan(
  safeIssues: Issue[],
  actions: { symlinks: number; brewUpgrade: boolean },
): void {
  console.log(chalk.bold.cyan("\n==> ") + chalk.bold.white("Remediation plan"));
  console.log(RULE);

  const rows: string[] = [];
  if (actions.symlinks > 0) {
    rows.push(
      `${chalk.green("●")}  ${chalk.bold("Broken symlinks")}  ${chalk.dim("→")}  remove ${actions.symlinks} path(s) (diagnosis scope only)`,
    );
  }
  if (actions.brewUpgrade) {
    rows.push(
      `${chalk.green("●")}  ${chalk.bold("Outdated Homebrew")}  ${chalk.dim("→")}  brew upgrade, cleanup, doctor`,
    );
  }

  if (rows.length === 0) {
    rows.push(chalk.dim("No automated actions mapped for current safe issues."));
  }

  console.log(rows.join("\n"));
  console.log(RULE);
  console.log(
    chalk.dim(
      "Issues considered: ",
    ) + safeIssues.map((i) => chalk.white(i.id)).join(chalk.dim(", ")),
  );
}

export function printFixActionMatrix(issues: Issue[]): void {
  const rows = issues.map((issue) => {
    const fix =
      issue.safeToFix ?
        issue.id === "broken-symlinks" ?
          chalk.green("auto (symlinks)")
        : issue.id === "brew-outdated" ?
          chalk.green("auto (brew)")
        : chalk.yellow("not mapped")
      : chalk.dim("manual");

    const sev = issue.severity ?? "warn";
    const sevColor =
      sev === "critical" ? chalk.red
      : sev === "warn" ? chalk.yellow
      : chalk.cyan;

    return `  ${sevColor(`[${sev}]`)}  ${chalk.bold(issue.title.slice(0, 42))}${issue.title.length > 42 ? "…" : ""}  ${chalk.dim("→")}  ${fix}`;
  });

  console.log(chalk.bold.cyan("\n==> ") + chalk.bold.white("Issue → action matrix"));
  console.log(RULE);
  console.log(rows.join("\n"));
  console.log(RULE);
  console.log(
    chalk.dim(
      "Tip: network, disk, caches, and git identity stay manual — see suggested commands above.",
    ),
  );
}

export function printFixSuccessFooter(dryRun: boolean): void {
  const msg = dryRun ?
    "Dry run finished — no changes were made. Re-run without --dry-run to apply."
  : "All remediation steps completed successfully.";
  console.log(
    "\n" +
      boxen(chalk.green(msg), {
        title: chalk.bold.white(" done "),
        titleAlignment: "left",
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        margin: { top: 0, bottom: 0 },
        borderStyle: "round",
        borderColor: "green",
      }),
  );
}
