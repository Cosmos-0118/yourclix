import { runCommand } from "../../core/exec.js";
import type { NetworkLogger, NetworkStepResult } from "./types.js";

export async function runStepCommand(
  name: string,
  command: string,
  args: string[],
  critical: boolean,
  dryRun: boolean,
  logger: NetworkLogger,
): Promise<NetworkStepResult> {
  const commandLine = `${command} ${args.join(" ")}`.trim();
  await logger.log(`[step:start] ${name} :: ${command} ${args.join(" ")}`);

  const result = await runCommand(command, args, {
    dryRun,
    allowFailure: true,
  });

  const detail =
    result.stdout ||
    result.stderr ||
    (result.code === 0 ?
      "Completed successfully (exit code 0, no output)."
    : "Command failed with no output.");
  await logger.log(
    `[step:end] ${name} :: code=${result.code} :: ${detail.replace(/\n/g, " | ")}`,
  );

  return {
    name,
    critical,
    status: result.code === 0 ? "success" : "failed",
    details: [`Command: ${commandLine}`, detail],
  };
}
