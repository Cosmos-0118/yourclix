import boxen from "boxen";
import chalk from "chalk";
import type { NetworkStepResult } from "./types.js";

export function printNetworkSummary(
  title: string,
  steps: NetworkStepResult[],
  logPath: string,
): void {
  const blocks = steps.map((step) => {
    const marker =
      step.status === "success" ? chalk.green.bold("OK ")
      : step.status === "failed" ? chalk.red.bold("NO ")
      : chalk.dim("— ");

    const lines = [
      `${marker}${chalk.white(step.name)}`,
      ...step.details.slice(0, 3).map((d) => {
        const one = d.length > 130 ? `${d.slice(0, 127)}…` : d;
        return chalk.dim(`    · ${one}`);
      }),
    ];

    return lines.join("\n");
  });

  console.log(
    "\n" +
      boxen(blocks.join("\n\n"), {
        title: chalk.bold.white(` ${title} · summary `),
        titleAlignment: "left",
        borderStyle: "round",
        borderColor: "gray",
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        margin: { top: 0, bottom: 0 },
      }),
  );
  console.log(chalk.dim(`Full log: ${logPath}`));
}

export function hasCriticalFailure(steps: NetworkStepResult[]): boolean {
  return steps.some((step) => step.critical && step.status === "failed");
}
