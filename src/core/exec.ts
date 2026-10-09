import { spawn } from "node:child_process";
import { ui, CliCancelled } from "./ui.js";
import { watchCancellation } from "./child-lifecycle.js";

export interface ExecOptions {
  signal?: AbortSignal;
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

export interface FilteredStreamOptions {
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
  /**
   * Print a dim status line to stderr every N ms while the process runs (TTY only).
   */
  heartbeatMs?: number;
  /** Return true to hide the line (still captured for exit handling). */
  suppressLine?: (line: string, stream: "stdout" | "stderr") => boolean;
  /** Optional ANSI styling before writing to the display stream. */
  formatLine?: (line: string, stream: "stdout" | "stderr") => string;
  /** Where filtered lines go (default stdout). Ignored when `onLine` is set. */
  displayStream?: NodeJS.WriteStream;
  /**
   * Receive each formatted line instead of writing it to `displayStream`.
   * Used to feed a live task log (e.g. clack's `taskLog`) instead of the
   * raw terminal, so a managed redraw region isn't corrupted by unrelated
   * writes landing in the middle of it.
   */
  onLine?: (text: string) => void;
}

/**
 * Run a command with stdout/stderr piped; emit line-by-line through suppress/format.
 * Collects full stdout+stderr for exit handling.
 */
export async function runCommandFilteredStream(
  command: string,
  args: string[] = [],
  options: FilteredStreamOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const signal = options.signal ?? ui.signal;
    if (signal.aborted) {
      reject(new CliCancelled());
      return;
    }
    const display = options.displayStream;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const releaseCancellation = watchCancellation(child, signal, () => {
      finishHeartbeat();
      reject(new CliCancelled());
    });

    let stdout = "";
    let stderr = "";
    let pendingOut = "";
    let pendingErr = "";

    const emitOneLine = (rawLine: string, which: "stdout" | "stderr") => {
      const line = rawLine.replace(/\r$/, "");
      if (options.suppressLine?.(line, which)) {
        return;
      }
      const text = options.formatLine?.(line, which) ?? line;
      if (options.onLine) {
        options.onLine(text);
      } else {
        if (display) display.write(`${text}\n`);
        else ui.note(text);
      }
    };

    const pushChunk = (chunk: string, which: "stdout" | "stderr") => {
      if (which === "stdout") {
        pendingOut += chunk;
        stdout += chunk;
      } else {
        pendingErr += chunk;
        stderr += chunk;
      }

      let pending = which === "stdout" ? pendingOut : pendingErr;
      let newlineAt: number;
      while ((newlineAt = pending.search(/[\r\n]/)) !== -1) {
        const line = pending.slice(0, newlineAt);
        pending = pending.slice(newlineAt + 1);
        emitOneLine(line, which);
      }
      if (which === "stdout") {
        pendingOut = pending;
      } else {
        pendingErr = pending;
      }
    };

    child.stdout?.on("data", (ch) => {
      pushChunk(ch.toString(), "stdout");
    });
    child.stderr?.on("data", (ch) => {
      pushChunk(ch.toString(), "stderr");
    });

    const hbMs = options.heartbeatMs ?? 0;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    if (hbMs > 0 && process.stderr.isTTY) {
      const hint = `${command} ${args.slice(0, 3).join(" ")}…`;
      heartbeat = setInterval(() => {
        const time = new Date().toLocaleTimeString();
        const pulse = `\x1b[2m…still running ${hint} (${time})\x1b[0m`;
        if (options.onLine) {
          options.onLine(pulse);
        } else {
          ui.note(pulse);
        }
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
      releaseCancellation();
      if (signal.aborted) {
        reject(new CliCancelled());
        return;
      }
      if (options.allowFailure) {
        resolve({
          code: 1,
          stdout: stdout.trim(),
          stderr: stderr.trim() || error.message,
        });
        return;
      }
      reject(error);
    });

    child.on("close", (code, exitSignal) => {
      finishHeartbeat();
      releaseCancellation();
      if (signal.aborted || exitSignal === "SIGINT" || code === 130) {
        reject(new CliCancelled());
        return;
      }
      if (pendingOut.length > 0) {
        emitOneLine(pendingOut, "stdout");
        pendingOut = "";
      }
      if (pendingErr.length > 0) {
        emitOneLine(pendingErr, "stderr");
        pendingErr = "";
      }

      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function executeCommand(
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
    const signal = options.signal ?? ui.signal;
    if (signal.aborted) {
      reject(new CliCancelled());
      return;
    }
    const useInheritedStdio = options.stdio === "inherit";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: useInheritedStdio
        ? ["inherit", "inherit", "inherit"]
        : ["ignore", "pipe", "pipe"],
    });
    const releaseCancellation = watchCancellation(child, signal, () =>
      reject(new CliCancelled()),
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      releaseCancellation();
      if (signal.aborted) {
        reject(new CliCancelled());
        return;
      }
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

    child.on("close", (code, exitSignal) => {
      releaseCancellation();
      if (signal.aborted || exitSignal === "SIGINT" || code === 130) {
        reject(new CliCancelled());
        return;
      }
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

/** Suspend UI rendering while a subprocess owns stdin/stdout (sudo, installers). */
export async function runCommand(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return options.stdio === "inherit" && !options.dryRun
    ? ui.suspend(() => executeCommand(command, args, options))
    : executeCommand(command, args, options);
}
