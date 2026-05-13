import os from "node:os";
import { runCommand } from "../../core/exec.js";
import type { EffectiveSetupConfig, SetupLogger, StepStatus } from "./types.js";

export async function ensurePrerequisites(
  effective: EffectiveSetupConfig,
  logger: SetupLogger,
): Promise<{ status: StepStatus; details: string[] }> {
  const details: string[] = [];
  let status: StepStatus = "success";

  const xcodeResult = await runCommand("xcode-select", ["-p"], {
    allowFailure: true,
  });
  if (xcodeResult.code === 0) {
    details.push("Xcode Command Line Tools detected.");
  } else {
    const installResult = await runCommand("xcode-select", ["--install"], {
      dryRun: effective.dryRun,
      allowFailure: true,
    });
    if (installResult.code === 0 || installResult.stderr.includes("already")) {
      details.push(
        effective.dryRun ?
          "Would request Xcode Command Line Tools install."
        : "Requested Xcode Command Line Tools install.",
      );
      status = "partial";
    } else {
      details.push("Unable to request Xcode Command Line Tools installation.");
      status = "partial";
    }
  }

  const arch = os.arch();
  if (arch === "arm64") {
    const rosettaCheck = await runCommand("pgrep", ["oahd"], {
      allowFailure: true,
    });
    if (rosettaCheck.code !== 0) {
      const rosettaInstall = await runCommand(
        "softwareupdate",
        ["--install-rosetta", "--agree-to-license"],
        { dryRun: effective.dryRun, allowFailure: true },
      );

      if (rosettaInstall.code === 0) {
        details.push(
          effective.dryRun ? "Would install Rosetta." : "Installed Rosetta.",
        );
      } else {
        details.push("Rosetta not confirmed. Some Intel-only tools may fail.");
        status = "partial";
      }
    } else {
      details.push("Rosetta already installed.");
    }
  }

  const reachabilityChecks = ["https://github.com", "https://ghcr.io"];
  for (const url of reachabilityChecks) {
    const result = await runCommand("curl", ["-Is", "--max-time", "6", url], {
      allowFailure: true,
    });
    if (result.code === 0) {
      details.push(`Reachability ok: ${url}`);
    } else {
      details.push(`Reachability failed: ${url}`);
      status = "partial";
    }
  }

  return { status, details };
}
