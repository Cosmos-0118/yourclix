import chalk from "chalk";
import { runCommand } from "../core/exec.js";

export type BrewStepStatus = "success" | "warn" | "failed" | "skipped";

export interface BrewStepResult {
  name: string;
  command: string;
  status: BrewStepStatus;
  critical: boolean;
  details: string[];
}

interface OutdatedPackages {
  formulae: string[];
  casks: string[];
}

function parseOutdatedOutput(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(" ")[0]);
}

function commandLine(command: string, args: string[]): string {
  return `${command} ${args.join(" ")}`.trim();
}

export function printBrewSummary(title: string, steps: BrewStepResult[]): void {
  console.log(chalk.bold(`\n=== ${title} summary ===`));

  for (const step of steps) {
    const marker =
      step.status === "success" ? chalk.green("[ok]")
      : step.status === "warn" ? chalk.yellow("[warn]")
      : step.status === "failed" ? chalk.red("[fail]")
      : chalk.dim("[skip]");

    console.log(`${marker} ${step.name} (${step.command})`);
    for (const detail of step.details.slice(0, 3)) {
      console.log(chalk.dim(`  - ${detail}`));
    }
  }
}

export function hasCriticalBrewFailure(steps: BrewStepResult[]): boolean {
  return steps.some((step) => step.critical && step.status === "failed");
}

export function printCleanupCandidates(output: string): void {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        line.startsWith("Would remove") ||
        line.startsWith("Would prune") ||
        line.startsWith("Would delete") ||
        line.startsWith("Would uninstall") ||
        line.startsWith("Removing") ||
        line.startsWith("Pruned") ||
        line.startsWith("Deleted"),
    );

  if (lines.length === 0) {
    console.log(chalk.dim("No cleanup candidates detected."));
    return;
  }

  console.log(chalk.bold("Cleanup candidates"));
  lines.slice(0, 30).forEach((line) => console.log(`- ${line}`));
  if (lines.length > 30) {
    console.log(chalk.dim(`... and ${lines.length - 30} more lines`));
  }
}

export function printCleanupResult(output: string, dryRun: boolean): void {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        line.startsWith("Removing") ||
        line.startsWith("Pruned") ||
        line.startsWith("Deleted") ||
        line.startsWith("Would remove") ||
        line.startsWith("Would prune"),
    );

  if (lines.length === 0) {
    console.log(
      chalk.dim(
        dryRun ? "No files would be removed." : "No files were removed.",
      ),
    );
    return;
  }

  console.log(chalk.bold(dryRun ? "Would delete" : "Deleted items"));
  lines.slice(0, 30).forEach((line) => console.log(`- ${line}`));
  if (lines.length > 30) {
    console.log(chalk.dim(`... and ${lines.length - 30} more lines`));
  }
}

export async function runBrewStep(
  name: string,
  command: string,
  args: string[],
  critical: boolean,
  dryRun: boolean,
): Promise<BrewStepResult> {
  const result = await runCommand(command, args, {
    dryRun,
    allowFailure: true,
  });

  const detail =
    result.stdout ||
    result.stderr ||
    (result.code === 0 ?
      "Completed successfully (exit code 0, no output)."
    : "Command failed with no output.");

  return {
    name,
    command: commandLine(command, args),
    critical,
    status: result.code === 0 ? "success" : "failed",
    details: [detail],
  };
}

export async function getOutdatedPackages(): Promise<OutdatedPackages> {
  const outdatedFormulae = await runCommand("brew", ["outdated", "--formula"], {
    allowFailure: true,
  });
  const outdatedCasks = await runCommand("brew", ["outdated", "--cask"], {
    allowFailure: true,
  });

  return {
    formulae: parseOutdatedOutput(outdatedFormulae.stdout),
    casks: parseOutdatedOutput(outdatedCasks.stdout),
  };
}
