import chalk from "chalk";
import { runCommand } from "../core/exec.js";
import { CommandProgress } from "../core/progress.js";

export async function listStartupItems(): Promise<void> {
  const progress = new CommandProgress("Startup Manager", 1);
  const output = await progress.step("Reading login items", async () =>
    runCommand(
      "osascript",
      [
        "-e",
        'tell application "System Events" to get the name of every login item',
      ],
      { allowFailure: true },
    ),
  );

  const raw = output.stdout || output.stderr;
  if (!raw.trim()) {
    console.log("No startup items found.");
    return;
  }

  console.log(chalk.bold("Startup items:"));
  raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => console.log(`- ${item}`));
}

export async function disableStartupItem(
  name: string,
  dryRun = false,
): Promise<void> {
  const progress = new CommandProgress("Startup Manager", 1);
  await progress.step(`Disabling login item '${name}'`, async () =>
    runCommand(
      "osascript",
      ["-e", `tell application "System Events" to delete login item "${name}"`],
      { dryRun, allowFailure: true },
    ),
  );

  console.log(chalk.green(`Startup item disabled: ${name}`));
}
