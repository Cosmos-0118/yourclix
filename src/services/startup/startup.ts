import chalk from "chalk";
import { ActionableError } from "../../core/actionable-error.js";
import { runCommand } from "../../core/exec.js";
import { buildManualRecoveryDetails } from "../../core/reconfigure.js";
import { printNextCommands } from "../../core/next-steps.js";
import { CommandProgress } from "../../core/progress.js";
import { hasNamedEntry } from "../../core/verification.js";

interface StartupItem {
  name: string;
  hidden: boolean;
  running: boolean;
}

function parseStartupItems(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanItems(raw: string): boolean[] {
  return parseStartupItems(raw).map((item) => item.toLowerCase() === "true");
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function getStartupItems(): Promise<StartupItem[]> {
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

  const names = parseStartupItems(raw);

  const hiddenOutput = await runCommand(
    "osascript",
    [
      "-e",
      'tell application "System Events" to get the hidden of every login item',
    ],
    { allowFailure: true },
  );

  const hiddenValues = parseBooleanItems(
    (hiddenOutput.stdout || hiddenOutput.stderr || "").trim(),
  );

  const runningOutput = await runCommand(
    "osascript",
    [
      "-e",
      'tell application "System Events" to get the name of every application process',
    ],
    { allowFailure: true },
  );

  const runningNames = new Set(
    parseStartupItems((runningOutput.stdout || runningOutput.stderr || "").trim()).map((name) =>
      name.toLowerCase(),
    ),
  );

  return names.map((name, index) => ({
    name,
    hidden: hiddenValues[index] ?? false,
    running: runningNames.has(name.toLowerCase()),
  }));
}

function startupManualRecovery(name: string): string[] {
  const escaped = escapeAppleScriptString(name);
  return buildManualRecoveryDetails("Manual recovery checklist:", [
    `Open System Settings > General > Login Items and remove '${name}' manually.`,
    `Or run: osascript -e 'tell application "System Events" to delete login item "${escaped}"'`,
    "Run: your startup list",
  ]);
}

function startupEnableManualRecovery(name: string, appPath: string): string[] {
  const escapedName = escapeAppleScriptString(name);
  const escapedPath = escapeAppleScriptString(appPath);
  return buildManualRecoveryDetails("Manual recovery checklist:", [
    `Open System Settings > General > Login Items and add '${appPath}' manually.`,
    `Or run: osascript -e 'tell application "System Events" to make login item at end with properties {name:"${escapedName}", path:"${escapedPath}", hidden:false}'`,
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
    const launchMode = item.hidden ? "launch hidden" : "launch visible";
    const runtimeState = item.running ? "running" : "not running";
    console.log(`- ${item.name} (${launchMode}, ${runtimeState})`);
  }

  printNextCommands("Next commands:", [
    "your startup disable <name>",
  ]);
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

  const matchedBefore = hasNamedEntry(
    beforeItems.map((item) => item.name),
    name,
  );

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

  const stillPresent = hasNamedEntry(
    afterItems.map((item) => item.name),
    name,
  );

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

    throw new ActionableError({
      code: "STARTUP_DISABLE_FAILED",
      summary: `Failed to disable startup item '${name}'.`,
      details: [
        disableResult.code !== 0 ?
          `Disable command failed: ${disableResult.stderr || disableResult.stdout || "unknown error"}`
        : "Disable command returned success.",
        stillPresent ? `Verification failed: '${name}' is still present.` : "Verification passed.",
      ],
      nextSteps: startupManualRecovery(name),
    });
  }

  if (!matchedBefore) {
    console.log(
      chalk.yellow(
        `Startup item '${name}' was not present before disable; no change was required.`,
      ),
    );
    printNextCommands("Next commands:", ["your startup list"]);
    return;
  }

  console.log(chalk.green(`Startup item disabled: ${name}`));
  printNextCommands("Next commands:", ["your startup list"]);
}

export async function enableStartupItem(
  name: string,
  appPath: string,
  dryRun = false,
): Promise<void> {
  const escapedName = escapeAppleScriptString(name);
  const escapedPath = escapeAppleScriptString(appPath);
  const progress = new CommandProgress("Startup Manager", 3);

  const beforeItems = await progress.step("Reading current login items", async () =>
    getStartupItems(),
  );

  const alreadyPresent = hasNamedEntry(
    beforeItems.map((item) => item.name),
    name,
  );
  if (alreadyPresent) {
    console.log(
      chalk.yellow(
        `Startup item '${name}' is already enabled; no change was required.`,
      ),
    );
    printNextCommands("Next commands:", ["your startup list"]);
    return;
  }

  const enableResult = await progress.step(
    `Enabling login item '${name}'`,
    async () =>
      runCommand(
        "osascript",
        [
          "-e",
          `tell application "System Events" to make login item at end with properties {name:"${escapedName}", path:"${escapedPath}", hidden:false}`,
        ],
        { dryRun, allowFailure: true },
      ),
  );

  if (dryRun) {
    console.log(chalk.green(`Startup item enable preview complete: ${name}`));
    return;
  }

  const afterItems = await progress.step("Verifying login item state", async () =>
    getStartupItems(),
  );

  const nowPresent = hasNamedEntry(
    afterItems.map((item) => item.name),
    name,
  );
  if (enableResult.code !== 0 || !nowPresent) {
    const details: string[] = [];
    if (enableResult.code !== 0) {
      details.push(
        `Enable command failed: ${enableResult.stderr || enableResult.stdout || "unknown error"}`,
      );
    }
    if (!nowPresent) {
      details.push(`Verification failed: '${name}' is still missing.`);
    }

    throw new ActionableError({
      code: "STARTUP_ENABLE_FAILED",
      summary: `Failed to enable startup item '${name}'.`,
      details,
      nextSteps: startupEnableManualRecovery(name, appPath),
    });
  }

  console.log(chalk.green(`Startup item enabled: ${name}`));
  printNextCommands("Next commands:", ["your startup list"]);
}
