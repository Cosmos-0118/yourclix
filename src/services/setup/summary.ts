import chalk from "chalk";
import type { StepResult } from "./types.js";

export function renderSetupSummary(results: StepResult[], logPath: string): void {
  console.log(chalk.bold("\n=== Setup summary ==="));

  for (const result of results) {
    const marker =
      result.status === "success" ? chalk.green("[ok]")
      : result.status === "partial" ? chalk.yellow("[warn]")
      : result.status === "failed" ? chalk.red("[fail]")
      : chalk.dim("[skip]");

    console.log(`${marker} ${result.name}`);
    for (const detail of result.details.slice(0, 3)) {
      console.log(chalk.dim(`  - ${detail}`));
    }
  }

  console.log(chalk.dim(`Log file: ${logPath}`));
}
