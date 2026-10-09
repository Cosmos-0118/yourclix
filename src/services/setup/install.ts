import { ui } from "../../core/ui.js";
import type { TaskStatus } from "../../core/ui.js";
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
  ui.heading(title);
  const details: string[] = [];
  let ok = 0;
  let failed = 0;
  let skipped = 0;

  for (const [index, target] of targets.entries()) {
    const result = await ui.task(
      `[${index + 1}/${targets.length}] Install ${target.name}`,
      () => installTarget(target, effective, logger),
    );
    const status = result.status;
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
    failed > 0 && ok === 0 ? "failed" : failed > 0 ? "partial" : "success";

  return { status, details };
}

async function installTarget(
  target: InstallTarget,
  effective: EffectiveSetupConfig,
  logger: SetupLogger,
): Promise<{ status: TaskStatus; details: string[] }> {
  const installed = await isInstalled(target);
  if (!effective.dryRun && installed) {
    await logger.log(
      "debug",
      `${target.type}:${target.name}: already installed`,
    );
    return { status: "skipped", details: ["Already installed."] };
  }

  const args =
    target.type === "cask"
      ? ["install", "--cask", target.name]
      : ["install", target.name];

  if (effective.dryRun) {
    await logger.log("info", `${target.type}:${target.name}: would install`);
    return { status: "skipped", details: [`Would install ${target.name}.`] };
  }

  const result = await runCommand("brew", args, {
    allowFailure: true,
  });

  if (result.code === 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (output.trim()) await logger.log("info", output);

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
    return { status: "success", details: [] };
  }

  const detail =
    [result.stdout, result.stderr].filter(Boolean).join("\n") ||
    "No details returned by brew.";
  await logger.log("error", `${target.type}:${target.name}: ${detail}`);
  return { status: "failed", details: [detail] };
}

async function isInstalled(target: InstallTarget): Promise<boolean> {
  const args =
    target.type === "cask"
      ? ["list", "--cask", "--versions", target.name]
      : ["list", "--versions", target.name];
  const result = await runCommand("brew", args, { allowFailure: true });
  return result.code === 0 && result.stdout.trim().length > 0;
}
