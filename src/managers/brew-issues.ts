import { runCommand } from "../core/exec.js";
import { ActionableError } from "../core/actionable-error.js";
import { ui, type CliUI } from "../core/ui.js";
import { runBrewStep, type BrewStepResult } from "./brew-manager.js";

export interface UnsupportedBrewPackage {
  name: string;
  kind: "formula" | "cask";
  disabled: boolean;
  reason: string;
  replacement?: string;
}

export function parseInstalledBrewPackages(
  output: string,
): UnsupportedBrewPackage[] {
  const parsed: unknown = JSON.parse(output);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid installed Homebrew metadata.");
  const data = parsed as Record<string, unknown>;
  const result: UnsupportedBrewPackage[] = [];
  for (const [field, kind] of [
    ["formulae", "formula"],
    ["casks", "cask"],
  ] as const) {
    if (!Array.isArray(data[field]))
      throw new Error(`Invalid installed Homebrew ${field} list.`);
    for (const entry of data[field]) {
      if (!entry || typeof entry !== "object")
        throw new Error(`Invalid installed Homebrew ${kind} entry.`);
      const pkg = entry as Record<string, unknown>;
      const name = kind === "formula" ? (pkg.full_name ?? pkg.name) : pkg.token;
      if (
        typeof name !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9@+_.\/-]*$/.test(name)
      )
        throw new Error(`Invalid installed Homebrew ${kind} name.`);
      if (
        typeof pkg.deprecated !== "boolean" ||
        typeof pkg.disabled !== "boolean"
      )
        throw new Error(`Invalid lifecycle metadata for ${name}.`);
      if (!pkg.deprecated && !pkg.disabled) continue;
      const reason = pkg.disabled ? pkg.disable_reason : pkg.deprecation_reason;
      const replacement = pkg.disabled
        ? (pkg.disable_replacement_formula ?? pkg.disable_replacement_cask)
        : (pkg.deprecation_replacement_formula ??
          pkg.deprecation_replacement_cask);
      result.push({
        name,
        kind,
        disabled: pkg.disabled,
        reason:
          typeof reason === "string"
            ? reason.replace(/_/g, " ")
            : "No reason supplied by Homebrew.",
        ...(typeof replacement === "string" && replacement
          ? { replacement }
          : {}),
      });
    }
  }
  return result;
}

export async function getUnsupportedBrewPackages(): Promise<
  UnsupportedBrewPackage[]
> {
  const result = await runCommand(
    "brew",
    ["info", "--json=v2", "--installed"],
    {
      allowFailure: true,
      env: { HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_ANALYTICS: "1" },
    },
  );
  try {
    if (result.code !== 0)
      throw new Error(
        result.stderr || result.stdout || `Exit code ${result.code}`,
      );
    return parseInstalledBrewPackages(result.stdout);
  } catch (error) {
    throw new ActionableError({
      code: "BREW_METADATA_FAILED",
      summary: "Could not inspect installed Homebrew package metadata.",
      details: [error instanceof Error ? error.message : String(error)],
      nextSteps: ["Run: brew info --json=v2 --installed", "Run: brew doctor"],
    });
  }
}

export async function reviewUnsupportedBrewPackages(
  packages: UnsupportedBrewPackage[],
  dryRun: boolean,
  terminal: CliUI = ui,
  reviewed = new Set<string>(),
): Promise<BrewStepResult[]> {
  const steps: BrewStepResult[] = [];
  for (const pkg of packages) {
    const key = `${pkg.kind}:${pkg.name}`;
    if (reviewed.has(key)) continue;
    reviewed.add(key);
    terminal.status(
      "warn",
      `${pkg.name} is ${pkg.disabled ? "disabled" : "deprecated"}`,
      [
        pkg.reason,
        ...(pkg.replacement
          ? [`Suggested replacement: ${pkg.replacement}`]
          : []),
      ],
    );
    if (dryRun) {
      terminal.note(
        `Would offer to remove ${pkg.name}; keeping it during dry run.`,
      );
      continue;
    }
    if (!terminal.interactive) {
      // A general --yes flag does not approve a newly discovered package deletion.
      terminal.note(
        `Keeping ${pkg.name}. Review interactively with: your brew doctor`,
      );
      continue;
    }
    if (pkg.kind === "formula") {
      const dependents = await terminal.task(
        `Check dependents of ${pkg.name}`,
        () =>
          runCommand("brew", ["uses", "--installed", "--recursive", pkg.name], {
            allowFailure: true,
            env: { HOMEBREW_NO_AUTO_UPDATE: "1" },
          }),
      );
      if (dependents.code !== 0) {
        terminal.status(
          "warn",
          `Keeping ${pkg.name}: dependency check failed`,
          [dependents.stderr || dependents.stdout],
        );
        continue;
      }
      if (dependents.stdout.trim()) {
        terminal.note(
          `Keeping ${pkg.name}; required by: ${dependents.stdout.trim().split(/\s+/).join(", ")}`,
        );
        continue;
      }
    }
    if (!(await terminal.confirm(`Remove ${pkg.name} (${pkg.kind})?`))) {
      terminal.note(`Keeping ${pkg.name}.`);
      continue;
    }
    steps.push(
      await terminal.stream(`Remove ${pkg.name}`, (onLine) =>
        runBrewStep(
          `Remove ${pkg.name}`,
          "brew",
          ["uninstall", `--${pkg.kind}`, pkg.name],
          true,
          false,
          true,
          { onLine },
        ),
      ),
    );
  }
  return steps;
}

export function brewRecoverySuggestions(
  pkg: string,
  kind: "formula" | "cask",
  details: string[],
): string[] {
  const output = details.join("\n");
  const result: string[] = [];
  if (/permission denied|not writable/i.test(output))
    result.push("Check Homebrew ownership and permissions with: brew doctor");
  if (/checksum|sha.?256/i.test(output))
    result.push(
      `Refresh the download with: brew fetch --retry --${kind} ${pkg}`,
    );
  if (/locked|another.*process/i.test(output))
    result.push("Wait for the other Homebrew process to finish, then retry.");
  if (
    /could not resolve|timed? out|connection|download failed|curl:/i.test(
      output,
    )
  )
    result.push("Check your network connection, then retry.");
  result.push(`Retry: brew upgrade --${kind} ${pkg}`);
  return result;
}
