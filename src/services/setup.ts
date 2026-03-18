import chalk from "chalk";
import ora from "ora";
import { runCommand } from "../core/exec.js";
import { confirm } from "../core/prompt.js";
import { ensureManagedPath } from "../managers/path-manager.js";

const BREW_PACKAGES = ["git", "node", "python", "pnpm", "oven-sh/bun/bun"];
const BREW_CASK_APPS = ["visual-studio-code", "google-chrome"];

export interface SetupOptions {
  fast?: boolean;
  dryRun?: boolean;
  apps?: boolean;
}

interface InstallTarget {
  name: string;
  type: "formula" | "cask";
}

async function hasBrew(): Promise<boolean> {
  try {
    await runCommand("brew", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function isInstalled(target: InstallTarget): Promise<boolean> {
  const args =
    target.type === "cask" ?
      ["list", "--cask", "--versions", target.name]
    : ["list", "--versions", target.name];
  const result = await runCommand("brew", args, { allowFailure: true });
  return result.code === 0 && result.stdout.trim().length > 0;
}

async function installTarget(
  target: InstallTarget,
  index: number,
  total: number,
  dryRun?: boolean,
): Promise<void> {
  const prefix = `[${index}/${total}]`;
  const spinner = ora(`${prefix} Checking ${target.name}`).start();

  if (!dryRun && (await isInstalled(target))) {
    spinner.succeed(chalk.green(`${prefix} ${target.name} already installed`));
    return;
  }

  spinner.text = `${prefix} Installing ${target.name}`;
  const args =
    target.type === "cask" ?
      ["install", "--cask", target.name]
    : ["install", target.name];
  const result = await runCommand("brew", args, {
    dryRun,
    allowFailure: true,
  });

  if (result.code === 0) {
    spinner.succeed(chalk.green(`${prefix} Installed ${target.name}`));
    if (result.stdout.trim()) {
      console.log(chalk.dim(result.stdout));
    }
    return;
  }

  spinner.fail(chalk.red(`${prefix} Failed to install ${target.name}`));
  const detail =
    result.stderr.trim() ||
    result.stdout.trim() ||
    "No details returned by brew.";
  console.log(chalk.yellow(detail));
}

async function installBatch(
  title: string,
  targets: InstallTarget[],
  dryRun?: boolean,
): Promise<void> {
  console.log(chalk.bold(`\n${title}`));
  for (const [idx, target] of targets.entries()) {
    await installTarget(target, idx + 1, targets.length, dryRun);
  }
}

export async function runSetup(options: SetupOptions): Promise<void> {
  console.log(chalk.cyan("Starting developer setup"));
  if (options.dryRun) {
    console.log(chalk.yellow("Dry-run mode enabled. No changes will be made."));
  }

  const pathResult = await ensureManagedPath("your");
  console.log(chalk.bold("\nPATH Manager"));
  if (pathResult.addedToCurrentSession.length > 0) {
    console.log(
      chalk.green(
        `Added to current session PATH: ${pathResult.addedToCurrentSession.join(", ")}`,
      ),
    );
  } else {
    console.log(chalk.dim("Current session PATH already healthy."));
  }

  if (pathResult.addedToShellFiles.length > 0) {
    console.log(chalk.green("Persisted PATH entries:"));
    for (const entry of pathResult.addedToShellFiles) {
      console.log(`- ${entry}`);
    }
  } else {
    console.log(chalk.dim("Shell profile PATH entries already present."));
  }

  if (pathResult.fallbackApplied.length > 0) {
    console.log(
      chalk.yellow(
        `Fallback method used: ${pathResult.fallbackApplied.join(", ")}`,
      ),
    );
  }

  if (!(await hasBrew())) {
    const spinner = ora("Homebrew not found. Installing Homebrew").start();
    await runCommand(
      "/bin/bash",
      [
        "-c",
        "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)",
      ],
      { dryRun: options.dryRun },
    );
    spinner.succeed(chalk.green("Homebrew installation step completed"));
  } else {
    console.log(chalk.green("Homebrew already installed"));
  }

  await installBatch(
    "Base Developer Packages",
    BREW_PACKAGES.map((name) => ({ name, type: "formula" })),
    options.dryRun,
  );

  await installBatch(
    "Shell Enhancements",
    ["zsh-autosuggestions", "zsh-syntax-highlighting", "starship"].map(
      (name) => ({
        name,
        type: "formula",
      }),
    ),
    options.dryRun,
  );

  const wantsApps =
    options.fast ||
    options.apps ||
    (await confirm("Install common apps (VS Code + Chrome)?", false));

  if (wantsApps) {
    await installBatch(
      "Common Desktop Apps",
      BREW_CASK_APPS.map((name) => ({ name, type: "cask" })),
      options.dryRun,
    );
  } else {
    console.log(chalk.dim("Skipped optional desktop apps."));
  }

  console.log(chalk.green("\nSetup complete."));
}
