import chalk from "chalk";
import { runCommand } from "../core/exec.js";
import { CommandProgress } from "../core/progress.js";

export async function spotlightStatus(): Promise<void> {
  const progress = new CommandProgress("Spotlight Status", 1);
  const result = await progress.step(
    "Querying Spotlight indexing state",
    async () => runCommand("mdutil", ["-sa"], { allowFailure: true }),
  );
  console.log(
    result.stdout || result.stderr || "No Spotlight status output available.",
  );
}

export async function spotlightReset(
  targetPath?: string,
  dryRun = false,
): Promise<void> {
  const progress = new CommandProgress("Spotlight Reset", 5);
  const target = targetPath ?? "/";
  console.log(
    chalk.yellow(
      "Rebuilding Spotlight index can temporarily impact system performance.",
    ),
  );

  await progress.step("Checking administrator privileges", async () => {
    if (dryRun) {
      return;
    }

    const sudoCheck = await runCommand("sudo", ["-n", "true"], {
      allowFailure: true,
    });

    if (sudoCheck.code !== 0) {
      throw new Error(
        "Administrator authentication required. Run 'sudo -v' first, then retry your spotlight reset.",
      );
    }
  });

  await progress.step(`Disabling index on ${target}`, async () =>
    runCommand("sudo", ["-n", "mdutil", "-i", "off", target], {
      dryRun,
      allowFailure: true,
    }),
  );
  await progress.step(`Erasing index on ${target}`, async () =>
    runCommand("sudo", ["-n", "mdutil", "-E", target], {
      dryRun,
      allowFailure: true,
    }),
  );
  await progress.step(`Re-enabling index on ${target}`, async () =>
    runCommand("sudo", ["-n", "mdutil", "-i", "on", target], {
      dryRun,
      allowFailure: true,
    }),
  );

  await progress.step("Fetching indexing status", async () => {
    const status = await runCommand("mdutil", ["-s", target], {
      allowFailure: true,
    });
    const output = status.stdout || status.stderr;
    if (output.trim()) {
      console.log(chalk.dim(output.trim()));
    }
  });

  console.log(chalk.green(`Spotlight reset triggered for ${target}.`));
  console.log(
    chalk.dim("Tip: Use 'your spotlight status' to watch indexing progress."),
  );
}
