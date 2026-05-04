import boxen from "boxen";
import chalk from "chalk";
import {
  runCommand,
  runCommandFilteredStream,
} from "../core/exec.js";

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
  const blocks = steps.map((step) => {
    const marker =
      step.status === "success" ? chalk.green.bold("OK ")
      : step.status === "warn" ? chalk.yellow.bold("!! ")
      : step.status === "failed" ? chalk.red.bold("NO ")
      : chalk.dim("— ");

    const lines = [
      `${marker}${chalk.white(step.name)}`,
      chalk.dim(`    ${step.command}`),
      ...step.details.slice(0, 3).map((d) => {
        const one =
          d.length > 140 ? `${d.slice(0, 137)}…` : d;
        return chalk.dim(`    · ${one}`);
      }),
    ];

    return lines.join("\n");
  });

  console.log(
    "\n" +
      boxen(blocks.join("\n\n"), {
        title: chalk.bold.white(` ${title} `),
        titleAlignment: "left",
        borderStyle: "round",
        borderColor: "gray",
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        margin: { top: 0, bottom: 0 },
      }),
  );
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
  /** Fewer “Hide this hint with HOMEBREW_…” footer lines at the end of installs. */
  HOMEBREW_NO_ENV_HINTS: "1",
};

export interface BrewStreamOptions {
  /** Dim stderr pulse while brew runs (TTY only); brew update can sit silent for minutes. */
  heartbeatMs?: number;
  /** Full brew stdout/stderr (every ln/rm/pour line). Default: filtered, calm output. */
  verbose?: boolean;
}

/** Low-value pour/link noise Homebrew prints during bottles/cleanup. */
export function suppressBrewPourNoise(
  line: string,
  _stream: "stdout" | "stderr",
): boolean {
  const t = line.trim();
  if (t === "") {
    return true;
  }

  if (/^\s*ln -s\s/.test(line)) {
    return true;
  }
  if (/^\s*rm\s/.test(line)) {
    return true;
  }
  if (/^\s*chmod\s/.test(line)) {
    return true;
  }
  if (/^\s*chown\s/.test(line)) {
    return true;
  }
  if (/^\s*install\s/.test(line)) {
    return true;
  }
  if (/^\s*cp\s/.test(line)) {
    return true;
  }
  if (/^\s*mv\s/.test(line)) {
    return true;
  }
  if (/^\s*mkdir\s/.test(line)) {
    return true;
  }
  if (/^\s*rmdir\s/.test(line)) {
    return true;
  }
  if (/^\s*touch\s/.test(line)) {
    return true;
  }
  if (/^Hide these hints with/.test(t)) {
    return true;
  }
  if (/^Disable this behaviour by setting/.test(t)) {
    return true;
  }
  return false;
}

function formatBrewStreamLine(
  line: string,
  _stream: "stdout" | "stderr",
): string {
  if (/^==>/.test(line)) {
    return chalk.cyan.bold(line);
  }
  if (/🍺/.test(line)) {
    return chalk.green(line);
  }
  if (/\bError:\b/i.test(line)) {
    return chalk.red(line);
  }
  if (/\bWarning:\b/i.test(line)) {
    return chalk.yellow(line);
  }
  if (/^(Fetching|Downloading|Verifying|Already|Built|Pouring|Upgrading|Reinstalling)\b/i.test(
    line.trim(),
  )) {
    return chalk.blue(line);
  }
  return line;
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
  const useStream = streamOutput && !dryRun;
  const fullVerbose = Boolean(streamOpts?.verbose);

  const result =
    useStream && !fullVerbose ?
      await runCommandFilteredStream(command, args, {
        allowFailure: true,
        env: BREW_STREAM_ENV,
        heartbeatMs: streamOpts?.heartbeatMs,
        suppressLine: suppressBrewPourNoise,
        formatLine: formatBrewStreamLine,
      })
    : await runCommand(command, args, {
        dryRun,
        allowFailure: true,
        stdio: useStream && fullVerbose ? "inherit" : undefined,
        env: useStream && fullVerbose ? BREW_STREAM_ENV : undefined,
        heartbeatMs:
          useStream && fullVerbose ? streamOpts?.heartbeatMs : undefined,
      });

  let detail: string;
  if (useStream) {
    detail =
      result.code === 0 ?
        fullVerbose ?
          "Finished successfully (see live output above)."
        : "Finished successfully (high-signal output above; use --verbose for full brew log)."
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
