import chalk from "chalk";
import type { NetworkStepResult } from "./types.js";

export function printNetworkSummary(
  title: string,
  steps: NetworkStepResult[],
  logPath: string,
): void {
  console.log(chalk.bold(`\n=== ${title} summary ===`));

  for (const step of steps) {
    const marker =
      step.status === "success" ? chalk.green("[ok]")
      : step.status === "failed" ? chalk.red("[fail]")
      : chalk.dim("[skip]");

    console.log(`${marker} ${step.name}`);
    for (const detail of step.details.slice(0, 3)) {
      console.log(chalk.dim(`  - ${detail}`));
    }
  }

  console.log(chalk.dim(`Log file: ${logPath}`));
}

export function hasCriticalFailure(steps: NetworkStepResult[]): boolean {
  return steps.some((step) => step.critical && step.status === "failed");
}
