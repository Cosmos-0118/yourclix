import { runCommand, type ExecResult } from "../../core/exec.js";
import type { EffectiveSetupConfig, SetupLogger, StepStatus } from "./types.js";

export async function collectVersionSummary(
  effective: EffectiveSetupConfig,
  logger: SetupLogger,
): Promise<{ status: StepStatus; details: string[] }> {
  const probes: Array<{ label: string; cmd: string; args: string[] }> = [
    { label: "git", cmd: "git", args: ["--version"] },
    { label: "node", cmd: "node", args: ["-v"] },
    { label: "python3", cmd: "python3", args: ["--version"] },
    { label: "pnpm", cmd: "pnpm", args: ["-v"] },
    { label: "bun", cmd: "bun", args: ["-v"] },
  ];

  const details: string[] = [];
  let failures = 0;

  for (const probe of probes) {
    const result: ExecResult = await runCommand(probe.cmd, probe.args, {
      dryRun: effective.dryRun,
      allowFailure: true,
    });

    if (result.code === 0) {
      const version = result.stdout || result.stderr || "ok";
      details.push(`${probe.label}: ${version}`);
    } else {
      failures += 1;
      details.push(`${probe.label}: unavailable`);
    }
  }

  for (const detail of details) {
    await logger.log("info", `Version check: ${detail}`);
  }

  return {
    status: failures > 0 ? "partial" : "success",
    details,
  };
}
