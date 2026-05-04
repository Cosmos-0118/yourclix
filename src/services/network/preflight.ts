import chalk from "chalk";
import { runCommand } from "../../core/exec.js";
import type { NetworkLogger, NetworkStepResult } from "./types.js";

export async function ensureSudoReady(
  dryRun: boolean,
  logger: NetworkLogger,
): Promise<NetworkStepResult> {
  if (dryRun) {
    return {
      name: "Checking sudo readiness",
      critical: true,
      status: "skipped",
      details: ["Dry-run: sudo precheck skipped."],
    };
  }

  const noPrompt = await runCommand("sudo", ["-n", "true"], {
    allowFailure: true,
  });
  if (noPrompt.code === 0) {
    await logger.log("sudo precheck passed without prompt");
    return {
      name: "Checking sudo readiness",
      critical: true,
      status: "success",
      details: ["Sudo credentials already valid."],
    };
  }

  if (!process.stdin.isTTY) {
    await logger.log("sudo precheck failed in non-interactive session");
    return {
      name: "Checking sudo readiness",
      critical: true,
      status: "failed",
      details: [
        "Sudo credentials required in non-interactive session. Run 'sudo -v' first.",
      ],
    };
  }

  console.log(
    chalk.yellow(
      "Administrator authentication is required for network operations.",
    ),
  );
  console.log(chalk.dim("Please enter your macOS password when prompted."));
  const promptResult = await runCommand("sudo", ["-v"], {
    allowFailure: true,
    stdio: "inherit",
  });
  if (promptResult.code === 0) {
    await logger.log("sudo precheck passed after interactive auth");
    return {
      name: "Checking sudo readiness",
      critical: true,
      status: "success",
      details: ["Sudo credentials refreshed."],
    };
  }

  return {
    name: "Checking sudo readiness",
    critical: true,
    status: "failed",
    details: [promptResult.stderr || "Failed to validate sudo credentials."],
  };
}
