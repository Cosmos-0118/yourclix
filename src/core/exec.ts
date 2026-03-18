import { spawn } from "node:child_process";

export interface ExecOptions {
  dryRun?: boolean;
  allowFailure?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "pipe" | "inherit";
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
      env: options.env,
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

    child.on("error", (error) => {
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
