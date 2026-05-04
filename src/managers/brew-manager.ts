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

/** Env helps brew/git print color + avoid pager stalls when streaming. */
const BREW_STREAM_ENV: NodeJS.ProcessEnv = {
  HOMEBREW_COLOR: "1",
  GIT_TERMINAL_PROMPT: "0",
  PAGER: "cat",
};

export interface BrewStreamOptions {
  /** Dim stderr pulse while brew runs (TTY only); brew update can sit silent for minutes. */
  heartbeatMs?: number;
}

export async function runBrewStep(
  name: string,
  command: string,
  args: string[],
  critical: boolean,
  dryRun: boolean,
  /** Pipe brew stdout/stderr through to the terminal (download/git progress). */
  streamOutput = false,
  streamOpts?: BrewStreamOptions,
): Promise<BrewStepResult> {
  const result = await runCommand(command, args, {
    dryRun,
    allowFailure: true,
    stdio: streamOutput && !dryRun ? "inherit" : undefined,
    env: streamOutput && !dryRun ? BREW_STREAM_ENV : undefined,
    heartbeatMs:
      streamOutput && !dryRun ? streamOpts?.heartbeatMs : undefined,
  });

  let detail: string;
  if (streamOutput && !dryRun) {
    detail =
      result.code === 0 ?
        "Finished successfully (see live output above)."
      : `Failed with exit code ${result.code} (see output above).`;
  } else {
    detail =
      result.stdout ||
      result.stderr ||
      (result.code === 0 ?
        "Completed successfully (exit code 0, no output)."
      : "Command failed with no output.");
  }

  return {
    name,
    command: commandLine(command, args),
    critical,
    status: result.code === 0 ? "success" : "failed",
    details: [detail],
  };
}

/** brew outdated JSON v2 — single fast pass, no tap auto-update. */
interface BrewOutdatedJsonV2 {
  formulae?: Array<{ name: string }>;
  casks?: Array<{ name: string }>;
}

export async function getOutdatedPackages(): Promise<OutdatedPackages> {
  const result = await runCommand("brew", ["outdated", "--json=v2"], {
    allowFailure: true,
    env: { HOMEBREW_NO_AUTO_UPDATE: "1" },
  });

  if (result.code !== 0 || !result.stdout.trim()) {
    return { formulae: [], casks: [] };
  }

  try {
    const data = JSON.parse(result.stdout) as BrewOutdatedJsonV2;
    const formulae = (data.formulae ?? [])
      .map((f) => f.name)
      .filter(Boolean);
    const casks = (data.casks ?? []).map((c) => c.name).filter(Boolean);
    return { formulae, casks };
  } catch {
    return { formulae: [], casks: [] };
  }
}
