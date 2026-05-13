import { runCommand } from "../../core/exec.js";
import { isSafeInterfaceName } from "./interface.js";
import type { NetworkLogger, NetworkStepResult } from "./types.js";

const MAX_DETAIL_LINES = 10;

function truncateCommandOutput(text: string, maxLines = MAX_DETAIL_LINES): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return text;
  }
  const rest = lines.length - maxLines;
  return `${lines.slice(0, maxLines).join("\n")}\n… (${rest} more line(s); see network log file for full output)`;
}

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

  const rawOut = result.stdout || result.stderr || "";
  const detail =
    rawOut.trim() ?
      truncateCommandOutput(rawOut.trim())
    : result.code === 0 ?
      "Completed successfully (exit code 0, no output)."
    : "Command failed with no output.";
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

/**
 * Apple-recommended DHCP refresh for an interface (non-destructive; no link drop).
 */
export async function runStepScutilDhcpRefresh(
  iface: string,
  critical: boolean,
  dryRun: boolean,
  logger: NetworkLogger,
): Promise<NetworkStepResult> {
  const name = "DHCP lease renewal";

  if (!isSafeInterfaceName(iface)) {
    await logger.log(
      `[step:skip] ${name} :: invalid interface name: ${iface}`,
    );
    return {
      name,
      critical,
      status: "skipped",
      details: [`Skipping scutil refresh — unexpected interface name (${iface}).`],
    };
  }

  const line = `add State:/Network/Interface/${iface}/RefreshConfiguration`;
  const commandLine = `printf '%s\\n' '${line}' | sudo -n scutil`;
  await logger.log(`[step:start] ${name} :: ${commandLine}`);

  const result = await runCommand(
    "/bin/sh",
    ["-c", `printf '%s\\n' '${line}' | sudo -n /usr/sbin/scutil`],
    {
      dryRun,
      allowFailure: true,
    },
  );

  const detail =
    result.stdout ||
    result.stderr ||
    (result.code === 0 ?
      "DHCP refresh requested via scutil."
    : "scutil returned non-zero.");

  await logger.log(`[step:end] ${name} :: code=${result.code} :: ${detail}`);

  return {
    name,
    critical,
    status: result.code === 0 ? "success" : "failed",
    details: [`Command: ${commandLine}`, detail],
  };
}
