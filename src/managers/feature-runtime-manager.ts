import chalk from "chalk";
import { runCommand } from "../core/exec.js";
import { ensureManagedPath } from "./path-manager.js";

type RequirementLevel = "required" | "recommended";

interface Requirement {
  command: string;
  level: RequirementLevel;
  installHint?: string;
}

const FEATURE_REQUIREMENTS: Record<string, Requirement[]> = {
  setup: [
    {
      command: "brew",
      level: "recommended",
      installHint: "Install Homebrew first or run setup to bootstrap.",
    },
  ],
  clean: [{ command: "find", level: "required" }],
  "net fix": [
    { command: "networksetup", level: "required" },
    { command: "dscacheutil", level: "required" },
  ],
  "net reset": [
    { command: "sudo", level: "required" },
    { command: "networksetup", level: "required" },
  ],
  "spotlight status": [{ command: "mdutil", level: "required" }],
  "spotlight reset": [
    { command: "mdutil", level: "required" },
    { command: "sudo", level: "required" },
  ],
  "brew doctor": [{ command: "brew", level: "required" }],
  "brew clean": [{ command: "brew", level: "required" }],
  "brew upgrade": [{ command: "brew", level: "required" }],
  "brew optimize": [{ command: "brew", level: "required" }],
  doctor: [{ command: "brew", level: "recommended" }],
  fix: [{ command: "brew", level: "recommended" }],
  "dev clean": [
    { command: "npm", level: "required" },
    { command: "python3", level: "recommended" },
  ],
  "dev reset": [{ command: "brew", level: "required" }],
  "startup list": [{ command: "osascript", level: "required" }],
  "startup disable": [{ command: "osascript", level: "required" }],
  "plugin install": [{ command: "npm", level: "required" }],
  "plugin remove": [{ command: "npm", level: "required" }],
};

export interface RuntimeCheckResult {
  commandId: string;
  missingRequired: Requirement[];
  missingRecommended: Requirement[];
}

async function commandExists(command: string): Promise<boolean> {
  const result = await runCommand("which", [command], { allowFailure: true });
  return result.code === 0;
}

export async function ensureFeatureRuntime(
  commandId: string,
): Promise<RuntimeCheckResult> {
  await ensureManagedPath("your");

  const requirements = FEATURE_REQUIREMENTS[commandId] ?? [];
  const missingRequired: Requirement[] = [];
  const missingRecommended: Requirement[] = [];

  for (const requirement of requirements) {
    const ok = await commandExists(requirement.command);
    if (ok) {
      continue;
    }

    if (requirement.level === "required") {
      missingRequired.push(requirement);
    } else {
      missingRecommended.push(requirement);
    }
  }

  return {
    commandId,
    missingRequired,
    missingRecommended,
  };
}

export function printRuntimeWarnings(result: RuntimeCheckResult): void {
  for (const requirement of result.missingRecommended) {
    const hint = requirement.installHint ? ` ${requirement.installHint}` : "";
    console.log(
      chalk.yellow(
        `Warning: recommended dependency '${requirement.command}' is missing.${hint}`,
      ),
    );
  }
}

export function assertRuntimeRequirements(result: RuntimeCheckResult): void {
  if (result.missingRequired.length === 0) {
    return;
  }

  const lines = result.missingRequired.map((item) => {
    const hint = item.installHint ? ` ${item.installHint}` : "";
    return `- ${item.command}${hint}`;
  });

  throw new Error(
    `Missing required tools for '${result.commandId}':\n${lines.join("\n")}`,
  );
}
