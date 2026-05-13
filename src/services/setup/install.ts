import chalk from "chalk";
import ora from "ora";
import { runCommand } from "../../core/exec.js";
import {
  analyzeBrewCaveats,
  formatBrewCaveatFollowUps,
  hasBrewCaveats,
  printBrewCaveatGuidance,
} from "../../managers/brew-caveats-manager.js";
import type {
  EffectiveSetupConfig,
  InstallTarget,
  SetupLogger,
  StepStatus,
} from "./types.js";

export async function hasBrew(): Promise<boolean> {
  const result = await runCommand("brew", ["--version"], {
    allowFailure: true,
  });
  return result.code === 0;
}

export async function installBatch(
  title: string,
  targets: InstallTarget[],
  effective: EffectiveSetupConfig,
  logger: SetupLogger,
): Promise<{ status: StepStatus; details: string[] }> {
  console.log(chalk.bold(`\n${title}`));
  const details: string[] = [];
  let ok = 0;
  let failed = 0;
  let skipped = 0;

  for (const [index, target] of targets.entries()) {
    const status = await installTarget(
      target,
      index + 1,
      targets.length,
      effective,
      logger,
    );
    if (status === "success") {
      ok += 1;
    } else if (status === "failed") {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  details.push(`Success: ${ok}`);
  details.push(`Failed: ${failed}`);
  details.push(`Skipped: ${skipped}`);

  const status: StepStatus =
    failed > 0 && ok === 0 ? "failed"
    : failed > 0 ? "partial"
    : "success";

  return { status, details };
}

async function installTarget(
  target: InstallTarget,
  index: number,
  total: number,
  effective: EffectiveSetupConfig,
  logger: SetupLogger,
): Promise<"success" | "failed" | "skipped"> {
  const prefix = `[${index}/${total}]`;
  const spinner = ora(`${prefix} Checking ${target.name}`).start();

  const installed = await isInstalled(target);
  if (!effective.dryRun && installed) {
    spinner.succeed(chalk.green(`${prefix} ${target.name} already installed`));
    await logger.log(
      "debug",
      `${target.type}:${target.name}: already installed`,
    );
    return "skipped";
  }

  spinner.text = `${prefix} Installing ${target.name}`;
  const args =
    target.type === "cask" ?
      ["install", "--cask", target.name]
    : ["install", target.name];
  const result = await runCommand("brew", args, {
    dryRun: effective.dryRun,
    allowFailure: true,
  });

  if (result.code === 0) {
    spinner.succeed(chalk.green(`${prefix} Installed ${target.name}`));
    if (result.stdout.trim()) {
      console.log(chalk.dim(result.stdout));
    }

    const caveatNotice = analyzeBrewCaveats(
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
    if (hasBrewCaveats(caveatNotice)) {
      printBrewCaveatGuidance(`${target.name} caveats`, caveatNotice);
      const followUps = formatBrewCaveatFollowUps(caveatNotice);
      await logger.log(
        "warn",
        `${target.type}:${target.name}: caveats => ${followUps.join(" | ")}`,
      );
    }

    await logger.log("info", `${target.type}:${target.name}: installed`);
    return "success";
  }

  spinner.fail(chalk.red(`${prefix} Failed to install ${target.name}`));
  const detail =
    result.stderr.trim() ||
    result.stdout.trim() ||
    "No details returned by brew.";
  console.log(chalk.yellow(detail));
  await logger.log("error", `${target.type}:${target.name}: ${detail}`);
  return "failed";
}

async function isInstalled(target: InstallTarget): Promise<boolean> {
  const args =
    target.type === "cask" ?
      ["list", "--cask", "--versions", target.name]
    : ["list", "--versions", target.name];
  const result = await runCommand("brew", args, { allowFailure: true });
  return result.code === 0 && result.stdout.trim().length > 0;
}
