import { spawn } from "node:child_process";

export interface ExecOptions {
  dryRun?: boolean;
  allowFailure?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "pipe" | "inherit";
  /**
   * Print a dim status line to stderr every N ms while the process runs (TTY only).
   * Useful when brew/git emit little output for minutes with inherited stdio.
   */
  heartbeatMs?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ExecResult> {
  if (options.dryRun) {
    return {
      code: 0,
      stdout: `[dry-run] ${command} ${args.join(" ")}`,
      stderr: "",
    };
  }

  return new Promise((resolve, reject) => {
    const useInheritedStdio = options.stdio === "inherit";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio:
        useInheritedStdio ?
          ["inherit", "inherit", "inherit"]
        : ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const hbMs = options.heartbeatMs ?? 0;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    if (
      hbMs > 0 &&
      useInheritedStdio &&
      process.stderr.isTTY
    ) {
      const hint = `${command} ${args.slice(0, 3).join(" ")}…`;
      heartbeat = setInterval(() => {
        const time = new Date().toLocaleTimeString();
        console.error(
          `\x1b[2m…still running ${hint} (${time})\x1b[0m`,
        );
      }, hbMs);
    }

    const finishHeartbeat = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
    };

    child.on("error", (error) => {
      finishHeartbeat();
      if (options.allowFailure) {
        resolve({
          code: 1,
          stdout: "",
          stderr: error.message,
        });
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      finishHeartbeat();
      const result: ExecResult = {
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
      if (result.code !== 0 && !options.allowFailure) {
        const message =
          stderr.trim() || `Command failed: ${command} ${args.join(" ")}`;
        reject(new Error(message));
        return;
      }

      resolve(result);
    });
  });
}
