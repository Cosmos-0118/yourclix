import chalk from "chalk";
import { runCommand } from "../core/exec.js";
import { buildManualRecoveryDetails } from "../core/reconfigure.js";
import { CommandProgress } from "../core/progress.js";

function parseStartupItems(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function getStartupItems(): Promise<string[]> {
  const output = await runCommand(
    "osascript",
    [
      "-e",
      'tell application "System Events" to get the name of every login item',
    ],
    { allowFailure: true },
  );

  const raw = (output.stdout || output.stderr || "").trim();
  if (!raw) {
    return [];
  }

  return parseStartupItems(raw);
}

function startupManualRecovery(name: string): string[] {
  const escaped = escapeAppleScriptString(name);
  return buildManualRecoveryDetails("Manual recovery checklist:", [
    `Open System Settings > General > Login Items and remove '${name}' manually.`,
    `Or run: osascript -e 'tell application "System Events" to delete login item "${escaped}"'`,
    "Run: your startup list",
  ]);
}

export async function listStartupItems(): Promise<void> {
  const progress = new CommandProgress("Startup Manager", 1);
  const items = await progress.step("Reading login items", async () =>
    getStartupItems(),
  );

  if (items.length === 0) {
    console.log("No startup items found.");
    return;
  }

  console.log(chalk.bold("Startup items:"));
  for (const item of items) {
    console.log(`- ${item}`);
  }
}

export async function disableStartupItem(
  name: string,
  dryRun = false,
): Promise<void> {
  const escapedName = escapeAppleScriptString(name);
  const progress = new CommandProgress("Startup Manager", 3);
  const beforeItems = await progress.step("Reading current login items", async () =>
    getStartupItems(),
  );

  const matchedBefore = beforeItems.some((item) => item === name);

  const disableResult = await progress.step(
    `Disabling login item '${name}'`,
    async () =>
      runCommand(
        "osascript",
        [
          "-e",
          `tell application "System Events" to delete login item "${escapedName}"`,
        ],
        { dryRun, allowFailure: true },
      ),
  );

  if (dryRun) {
    console.log(chalk.green(`Startup item disable preview complete: ${name}`));
    return;
  }

  const afterItems = await progress.step("Verifying login item state", async () =>
    getStartupItems(),
  );

  const stillPresent = afterItems.some((item) => item === name);

  if (disableResult.code !== 0 || stillPresent) {
    console.log(chalk.bold(`Startup item disable failed for '${name}'.`));
    if (disableResult.code !== 0) {
      console.log(
        chalk.yellow(
          `- Disable command failed: ${disableResult.stderr || disableResult.stdout || "unknown error"}`,
        ),
      );
    }
    if (stillPresent) {
      console.log(chalk.yellow(`- Verification failed: '${name}' is still present.`));
    }

    for (const line of startupManualRecovery(name)) {
      console.log(chalk.dim(line));
    }

    throw new Error(`Failed to disable startup item '${name}'.`);
  }

  if (!matchedBefore) {
    console.log(
      chalk.yellow(
        `Startup item '${name}' was not present before disable; no change was required.`,
      ),
    );
    return;
  }

  console.log(chalk.green(`Startup item disabled: ${name}`));
}
