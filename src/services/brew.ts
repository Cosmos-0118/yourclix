import chalk from "chalk";
import { runCommand } from "../core/exec.js";
import { CommandProgress } from "../core/progress.js";

interface OutdatedPackages {
  formulae: string[];
  casks: string[];
}

export async function brewDoctor(dryRun = false): Promise<void> {
  const progress = new CommandProgress("Brew Doctor", 1);
  const output = await progress.step("Running brew doctor", async () =>
    runCommand("brew", ["doctor"], {
      dryRun,
      allowFailure: true,
    }),
  );
  console.log(output.stdout || output.stderr);
}

export async function brewClean(dryRun = false): Promise<void> {
  const progress = new CommandProgress("Brew Cleanup", 2);
  const preview = await progress.step(
    "Collecting cleanup candidates",
    async () =>
      runCommand("brew", ["cleanup", "--prune=all", "-n"], {
        dryRun,
        allowFailure: true,
      }),
  );

  printCleanupCandidates(preview.stdout || preview.stderr);

  const cleanupResult = await progress.step(
    "Removing stale brew artifacts",
    async () =>
      runCommand("brew", ["cleanup", "--prune=all"], {
        dryRun,
        allowFailure: true,
      }),
  );

  printCleanupResult(cleanupResult.stdout || cleanupResult.stderr, dryRun);
  console.log(chalk.green("Brew cleanup complete."));
}

export async function brewUpgrade(dryRun = false): Promise<void> {
  const outdated = await getOutdatedPackages();
  const totalTargets = outdated.formulae.length + outdated.casks.length;
  const progress = new CommandProgress(
    "Brew Upgrade",
    1 + Math.max(totalTargets, 1),
  );

  await progress.step("Updating brew formula metadata", async () =>
    runCommand("brew", ["update"], { dryRun, allowFailure: true }),
  );

  if (totalTargets === 0) {
    progress.tick("No outdated formulae or casks found");
  }

  for (const pkg of outdated.formulae) {
    await progress.step(`Upgrading formula ${pkg}`, async () =>
      runCommand("brew", ["upgrade", pkg], { dryRun, allowFailure: true }),
    );
  }

  for (const cask of outdated.casks) {
    await progress.step(`Upgrading cask ${cask}`, async () =>
      runCommand("brew", ["upgrade", "--cask", cask], {
        dryRun,
        allowFailure: true,
      }),
    );
  }

  if (totalTargets > 0) {
    console.log(chalk.bold("Upgraded targets"));
    outdated.formulae.forEach((pkg) => console.log(`- formula: ${pkg}`));
    outdated.casks.forEach((cask) => console.log(`- cask: ${cask}`));
  }

  console.log(chalk.green("Brew upgrade complete."));
}

export async function brewOptimize(dryRun = false): Promise<void> {
  await brewDoctor(dryRun);
  await brewUpgrade(dryRun);
  await brewClean(dryRun);
  console.log(chalk.green("Brew optimize completed."));
}

async function getOutdatedPackages(): Promise<OutdatedPackages> {
  const outdatedFormulae = await runCommand("brew", ["outdated", "--formula"], {
    allowFailure: true,
  });
  const outdatedCasks = await runCommand("brew", ["outdated", "--cask"], {
    allowFailure: true,
  });

  return {
    formulae: parseOutdatedOutput(outdatedFormulae.stdout),
    casks: parseOutdatedOutput(outdatedCasks.stdout),
  };
}

function parseOutdatedOutput(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(" ")[0]);
}

function printCleanupCandidates(output: string): void {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        line.startsWith("Would remove") ||
        line.startsWith("Would prune") ||
        line.startsWith("Would delete") ||
        line.startsWith("Would uninstall") ||
        line.startsWith("Removing") ||
        line.startsWith("Pruned") ||
        line.startsWith("Deleted"),
    );

  if (lines.length === 0) {
    console.log(chalk.dim("No cleanup candidates detected."));
    return;
  }

  console.log(chalk.bold("Cleanup candidates"));
  lines.slice(0, 30).forEach((line) => console.log(`- ${line}`));
  if (lines.length > 30) {
    console.log(chalk.dim(`... and ${lines.length - 30} more lines`));
  }
}

function printCleanupResult(output: string, dryRun: boolean): void {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        line.startsWith("Removing") ||
        line.startsWith("Pruned") ||
        line.startsWith("Deleted") ||
        line.startsWith("Would remove") ||
        line.startsWith("Would prune"),
    );

  if (lines.length === 0) {
    console.log(
      chalk.dim(
        dryRun ? "No files would be removed." : "No files were removed.",
      ),
    );
    return;
  }

  console.log(chalk.bold(dryRun ? "Would delete" : "Deleted items"));
  lines.slice(0, 30).forEach((line) => console.log(`- ${line}`));
  if (lines.length > 30) {
    console.log(chalk.dim(`... and ${lines.length - 30} more lines`));
  }
}
