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

  const nodeModules = found.filter((entry) =>
    entry.endsWith(`${path.sep}node_modules`),
  );
  const xcodeDerivedData = found.filter((entry) =>
    entry.includes(
      `${path.sep}Library${path.sep}Developer${path.sep}Xcode${path.sep}DerivedData${path.sep}`,
    ),
  );
  const otherTargets =
    found.length - nodeModules.length - xcodeDerivedData.length;

  console.log(chalk.bold("Developer cleanup targets"));
  console.log(`- Total: ${found.length}`);
  console.log(`- node_modules: ${nodeModules.length}`);
  console.log(`- Xcode DerivedData: ${xcodeDerivedData.length}`);
  if (otherTargets > 0) {
    console.log(`- Other: ${otherTargets}`);
  }

  const preview = found.slice(0, 20);
  if (preview.length > 0) {
    console.log(chalk.dim("Sample targets (first 20)"));
    for (const target of preview) {
      console.log(chalk.dim(`- ${target}`));
    }
  }

  if (found.length > preview.length) {
    console.log(
      chalk.dim(`...and ${found.length - preview.length} more target(s).`),
    );
  }

  const approved = await confirm("Proceed with developer cleanup?", yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  let removedCount = 0;
  const failedTargets: Array<{ path: string; reason: string }> = [];
  await progress.step(
    `Removing ${found.length} filesystem targets`,
    async () => {
      for (const target of found) {
        try {
          await removePath(target, dryRun);
          removedCount += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          failedTargets.push({ path: target, reason: message || "unknown" });
        }
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

  const actionWord = dryRun ? "Would remove" : "Removed";
  console.log(chalk.bold("Developer cleanup summary"));
  console.log(chalk.green(`- ${actionWord}: ${removedCount} targets`));
  console.log(chalk.yellow(`- Failed: ${failedTargets.length} targets`));

  if (failedTargets.length > 0) {
    const sampleFailed = failedTargets.slice(0, 10);
    console.log(chalk.dim("Sample failures"));
    for (const failed of sampleFailed) {
      console.log(chalk.dim(`- ${failed.path} (${failed.reason})`));
    }
  }

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
