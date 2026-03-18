import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { CommandProgress } from "../core/progress.js";
import { confirm } from "../core/prompt.js";
import { removePath } from "../core/fs-utils.js";

const PRIVACY_TARGETS = [
  "~/Library/Caches/Google/Chrome/Default/Cache",
  "~/Library/Safari/History.db",
  "~/Library/Application Support/com.apple.sharedfilelist",
];

export async function privacyClean(dryRun = false, yes = false): Promise<void> {
  const progress = new CommandProgress("Privacy Cleanup", 2);
  console.log(chalk.bold("Privacy cleanup targets:"));

  const expanded = PRIVACY_TARGETS.map((target) =>
    target.replace("~", os.homedir()).replace("~/", `${os.homedir()}/`),
  );

  for (const target of expanded) {
    console.log(`- ${target}`);
  }

  const approved = await confirm("Proceed with privacy cleanup?", yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  await progress.step(
    `Removing ${expanded.length} privacy targets`,
    async () => {
      for (const target of expanded) {
        await removePath(path.resolve(target), dryRun);
      }
    },
  );

  progress.tick("Finalizing cleanup");

  console.log(
    chalk.green(`Privacy cleanup complete${dryRun ? " (dry-run)" : ""}.`),
  );
}
