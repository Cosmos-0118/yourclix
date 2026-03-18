import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import fg from "fast-glob";
import { runCommand } from "../core/exec.js";
import { CommandProgress } from "../core/progress.js";
import { removePath } from "../core/fs-utils.js";
import { confirm } from "../core/prompt.js";

export async function devClean(dryRun = false, yes = false): Promise<void> {
  const progress = new CommandProgress("Developer Cleanup", 3);
  const home = os.homedir();
  const targets = [
    path.join(home, "**/node_modules"),
    path.join(home, "Library/Developer/Xcode/DerivedData/*"),
  ];

  const found = await progress.step("Scanning cleanup targets", async () =>
    fg(targets, {
      dot: true,
      unique: true,
      onlyDirectories: true,
      suppressErrors: true,
    }),
  );

  console.log(`Found ${found.length} cleanup targets.`);
  const approved = await confirm("Proceed with developer cleanup?", yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  await progress.step(
    `Removing ${found.length} filesystem targets`,
    async () => {
      for (const target of found) {
        await removePath(target, dryRun);
      }
    },
  );

  await progress.step("Cleaning package manager caches", async () => {
    await runCommand("npm", ["cache", "clean", "--force"], {
      dryRun,
      allowFailure: true,
    });
    await runCommand("pnpm", ["store", "prune"], {
      dryRun,
      allowFailure: true,
    });
    await runCommand("python3", ["-m", "pip", "cache", "purge"], {
      dryRun,
      allowFailure: true,
    });
    await runCommand("gradle", ["--stop"], { dryRun, allowFailure: true });
  });

  console.log(chalk.green("Developer cleanup complete."));
}

export async function devReset(tool: string, dryRun = false): Promise<void> {
  const progress = new CommandProgress(`Developer Reset (${tool})`, 2);
  switch (tool) {
    case "node": {
      await progress.step("Uninstalling existing Node", async () =>
        runCommand("brew", ["uninstall", "node"], {
          dryRun,
          allowFailure: true,
        }),
      );
      await progress.step("Installing fresh Node", async () =>
        runCommand("brew", ["install", "node"], {
          dryRun,
          allowFailure: true,
        }),
      );
      break;
    }
    case "python": {
      await progress.step("Uninstalling existing Python", async () =>
        runCommand("brew", ["uninstall", "python"], {
          dryRun,
          allowFailure: true,
        }),
      );
      await progress.step("Installing fresh Python", async () =>
        runCommand("brew", ["install", "python"], {
          dryRun,
          allowFailure: true,
        }),
      );
      break;
    }
    default:
      throw new Error(`Unsupported tool reset target: ${tool}`);
  }

  console.log(chalk.green(`Developer environment reset complete for ${tool}.`));
}
