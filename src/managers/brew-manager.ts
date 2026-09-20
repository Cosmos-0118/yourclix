import chalk from "chalk";
import { log } from "@clack/prompts";
import { panel } from "../core/task-ui.js";
import { terminalWidth, wrapText } from "../core/format.js";
import {
  runCommand,
  runCommandFilteredStream,
} from "../core/exec.js";
import {
  analyzeBrewCaveats,
  formatBrewCaveatFollowUps,
  hasBrewCaveats,
} from "./brew-caveats-manager.js";

export type BrewStepStatus = "success" | "warn" | "failed" | "skipped";

export interface BrewStepResult {
  name: string;
  command: string;
  status: BrewStepStatus;
  critical: boolean;
  details: string[];
}

export interface OutdatedPackages {
  formulae: string[];
  casks: string[];
  /** False means Homebrew could not be queried reliably. */
  ok: boolean;
  error?: string;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@+=,-]+$/.test(value) ?
      value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

function commandLine(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ").trim();
}

function compactOutput(output: string, maxLength = 320): string {
  const compact = output.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

export function printBrewSummary(title: string, steps: BrewStepResult[]): void {
  const blocks = steps.map((step) => {
    const marker =
      step.status === "success" ? chalk.green.bold("OK ")
      : step.status === "warn" ? chalk.yellow.bold("!! ")
      : step.status === "failed" ? chalk.red.bold("NO ")
      : chalk.dim("— ");

    const detailLines = step.details
      .flatMap((detail) => detail.split(/\r?\n/))
      .map((detail) => detail.trim())
      .filter(Boolean)
      .slice(0, 3);
    const lines = [
      `${marker}${chalk.white(step.name)}`,
      chalk.dim(`    ${step.command}`),
      ...detailLines.map((d) => {
        const one =
          d.length > 140 ? `${d.slice(0, 137)}…` : d;
        return chalk.dim(`    · ${one}`);
      }),
    ];

    return lines.join("\n");
  });

  panel(blocks.join("\n\n"), title, (line) => chalk.gray(line));
}

export function hasCriticalBrewFailure(steps: BrewStepResult[]): boolean {
  return steps.some((step) => step.critical && step.status === "failed");
}

const CANDIDATE_PREFIXES = [
  "Would remove",
  "Would prune",
  "Would delete",
  "Would uninstall",
  "Removing",
  "Pruned",
  "Deleted",
];
const RESULT_PREFIXES = ["Removing", "Pruned", "Deleted", "Would remove", "Would prune"];

function filterPrefixedLines(output: string, prefixes: string[]): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => prefixes.some((prefix) => line.startsWith(prefix)));
}

/** Pure line extraction shared by the plain printers and the TUI dashboard. */
export function getCleanupCandidateLines(output: string): string[] {
  return filterPrefixedLines(output, CANDIDATE_PREFIXES);
}

export function getCleanupResultLines(output: string): string[] {
  return filterPrefixedLines(output, RESULT_PREFIXES);
}

export function printCleanupCandidates(output: string): void {
  const lines = getCleanupCandidateLines(output);

  if (lines.length === 0) {
    log.message(chalk.dim("No cleanup candidates detected."));
    return;
  }

  const shown = lines
    .slice(0, 30)
    .flatMap((line) => wrapText(`- ${line}`, Math.max(20, terminalWidth() - 2)))
    .map((line) => chalk.dim(line));
  if (lines.length > 30) {
    shown.push(chalk.dim(`... and ${lines.length - 30} more lines`));
  }
  log.message([chalk.bold("Cleanup candidates"), ...shown]);
}

export function printCleanupResult(output: string, dryRun: boolean): void {
  const lines = getCleanupResultLines(output);

  if (lines.length === 0) {
    log.message(
      chalk.dim(dryRun ? "No files would be removed." : "No files were removed."),
    );
    return;
  }

  const shown = lines
    .slice(0, 30)
    .flatMap((line) => wrapText(`- ${line}`, Math.max(20, terminalWidth() - 2)))
    .map((line) => chalk.dim(line));
  if (lines.length > 30) {
    shown.push(chalk.dim(`... and ${lines.length - 30} more lines`));
  }
  log.message([chalk.bold(dryRun ? "Would delete" : "Deleted items"), ...shown]);
}

/** Shared non-interactive defaults for every Homebrew subprocess. */
const BREW_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: "0",
  PAGER: "cat",
  HOMEBREW_NO_ENV_HINTS: "1",
};

/** Environment for read-only inventory calls. Never let them silently update taps. */
const BREW_QUERY_ENV: NodeJS.ProcessEnv = {
  ...BREW_ENV,
  HOMEBREW_NO_AUTO_UPDATE: "1",
};

/** Env helps brew/git print color + avoid pager stalls when streaming. */
const BREW_STREAM_ENV: NodeJS.ProcessEnv = {
  ...BREW_ENV,
  HOMEBREW_COLOR: "1",
};

export interface BrewStreamOptions {
  /** Dim stderr pulse while brew runs (TTY only); brew update can sit silent for minutes. */
  heartbeatMs?: number;
  /** Full brew stdout/stderr (every ln/rm/pour line). Default: filtered, calm output. */
  verbose?: boolean;
  /** Additional Homebrew environment overrides for a specific operation. */
  env?: NodeJS.ProcessEnv;
  /** Route formatted output lines into a live task log instead of stdout. */
  onLine?: (line: string) => void;
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
  if (/^Hide these hints with/i.test(t)) {
    return true;
  }
  if (/^Disable this behaviour by setting/i.test(t)) {
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
    useStream ?
      await runCommandFilteredStream(command, args, {
        allowFailure: true,
        env: { ...BREW_STREAM_ENV, ...(streamOpts?.env ?? {}) },
        heartbeatMs: streamOpts?.heartbeatMs,
        suppressLine: fullVerbose ? undefined : suppressBrewPourNoise,
        formatLine: fullVerbose ? undefined : formatBrewStreamLine,
        onLine: streamOpts?.onLine,
      })
    : await runCommand(command, args, {
      dryRun,
      allowFailure: true,
      env: {
        ...(dryRun ? BREW_QUERY_ENV : BREW_ENV),
        ...(streamOpts?.env ?? {}),
      },
    });

  let detail: string;
  if (useStream) {
    detail =
      result.code === 0 ?
        "Finished successfully."
      : `Failed with exit code ${result.code} (see output above).`;
  } else {
    detail =
      result.stdout ||
      result.stderr ||
      (result.code === 0 ?
        "Completed successfully (exit code 0, no output)."
      : "Command failed with no output.");
  }

  const caveatNotice = analyzeBrewCaveats(
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
  const details = [detail];
  if (hasBrewCaveats(caveatNotice)) {
    const followUps = formatBrewCaveatFollowUps(caveatNotice);
    details.push(
      caveatNotice.kegOnlyFormulae.length > 0 ?
        `Homebrew caveats detected (keg-only: ${caveatNotice.kegOnlyFormulae.join(", ")}).`
      : "Homebrew caveats detected.",
    );
    for (const followUp of followUps.slice(0, 2)) {
      details.push(`Follow-up: ${followUp}`);
    }
  }

  return {
    name,
    command: commandLine(command, args),
    critical,
    status: result.code === 0 ? "success" : "failed",
    details,
  };
}

interface BrewOutdatedJsonV2 {
  formulae?: unknown;
  casks?: unknown;
}

function packageNames(value: unknown, field: "formulae" | "casks"): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Homebrew returned an invalid ${field} list.`);
  }

  return [...new Set(
    value
      .map((entry) =>
        typeof entry === "object" && entry !== null && "name" in entry &&
          typeof entry.name === "string" ? entry.name : "",
      )
      .map((name) => name.trim())
      .filter(Boolean),
  )].sort();
}

export function parseBrewOutdatedJson(output: string): Pick<OutdatedPackages, "formulae" | "casks"> {
  const parsed = JSON.parse(output) as BrewOutdatedJsonV2;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Homebrew returned an unexpected outdated-package shape.");
  }

  return {
    formulae: packageNames(parsed.formulae, "formulae"),
    casks: packageNames(parsed.casks, "casks"),
  };
}

export interface OutdatedPackageOptions {
  /** Include casks with :latest or auto_updates true. */
  greedy?: boolean;
}

export async function getOutdatedPackages(
  options: OutdatedPackageOptions = {},
): Promise<OutdatedPackages> {
  const result = await runCommand(
    "brew",
    ["outdated", "--json=v2", ...(options.greedy ? ["--greedy"] : [])],
    {
    allowFailure: true,
      env: BREW_QUERY_ENV,
    },
  );

  if (result.code !== 0) {
    return {
      formulae: [],
      casks: [],
      ok: false,
      error: compactOutput(
        result.stderr || result.stdout || `brew outdated exited with code ${result.code}`,
      ),
    };
  }

  if (!result.stdout.trim()) {
    return {
      formulae: [],
      casks: [],
      ok: false,
      error: "brew outdated returned no JSON output.",
    };
  }

  try {
    return { ...parseBrewOutdatedJson(result.stdout), ok: true };
  } catch (error) {
    return {
      formulae: [],
      casks: [],
      ok: false,
      error: compactOutput(
        error instanceof Error ? error.message : "Could not parse brew outdated JSON.",
      ),
    };
  }
}
