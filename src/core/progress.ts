import chalk from "chalk";
import {
  log,
  S_STEP_CANCEL,
  S_STEP_ERROR,
  S_STEP_SUBMIT,
  S_WARN,
  spinner,
  taskLog,
} from "@clack/prompts";
import { interactive } from "./task-ui.js";

function statusLine(status: string, text: string): string {
  if (status === "failed") {
    return chalk.red(`${S_STEP_ERROR}  ${text}`);
  }
  if (status === "warn") {
    return chalk.yellow(`${S_WARN}  ${text}`);
  }
  if (status === "skipped") {
    return chalk.dim(`${S_STEP_CANCEL}  ${text} (skipped)`);
  }
  return chalk.green(`${S_STEP_SUBMIT}  ${text}`);
}

export class CommandProgress {
  private current = 0;

  constructor(
    private readonly title: string,
    private readonly totalSteps: number,
  ) {
    if (title.trim().length > 0) {
      log.message(chalk.bold(this.title));
    }
  }

  private nextPrefix(): string {
    this.current += 1;
    return `[${this.current}/${this.totalSteps}]`;
  }

  async step<T>(label: string, task: () => Promise<T>): Promise<T> {
    const text = `${this.nextPrefix()} ${label}`;

    if (!interactive()) {
      console.log(chalk.cyan(`${text}...`));
      try {
        const result = await task();
        console.log(statusLine("success", text));
        return result;
      } catch (error) {
        console.log(statusLine("failed", text));
        throw error;
      }
    }

    const s = spinner();
    s.start(text);
    try {
      const result = await task();
      s.stop(text);
      return result;
    } catch (error) {
      s.error(text);
      throw error;
    }
  }

  async interactiveStep<T>(label: string, task: () => Promise<T>): Promise<T> {
    const text = `${this.nextPrefix()} ${label}`;
    console.log(chalk.cyan(`${text}...`));

    try {
      const result = await task();
      console.log(statusLine("success", text));
      return result;
    } catch (error) {
      console.log(statusLine("failed", text));
      throw error;
    }
  }

  /**
   * Like interactiveStep but for tasks that return { status: 'success' | 'failed' | ... }
   * (e.g. brew) so we show the right marker from the result instead of always succeeding.
   */
  async interactiveStepWithStatus<T extends { status: string }>(
    label: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const text = `${this.nextPrefix()} ${label}`;

    if (!interactive()) {
      console.log(chalk.bold.cyan(text));
      const result = await task();
      console.log(statusLine(result.status, text));
      return result;
    }

    const s = spinner();
    s.start(text);
    const result = await task();

    if (result.status === "failed") {
      s.error(text);
    } else if (result.status === "success") {
      s.stop(text);
    } else {
      // warn / skipped: clack's spinner only has green-stop or red-error
      // terminal states, so clear it and print our own marker.
      s.clear();
      console.log(statusLine(result.status, text));
    }

    return result;
  }

  /**
   * For steps that pipe a subprocess's own stdout/stderr through live
   * (e.g. `brew update`/`brew upgrade`). Renders a rolling, bounded log that
   * clears on success and stays visible on failure, instead of dumping raw
   * output straight into the scrollback.
   */
  async streamStep<T extends { status: string }>(
    label: string,
    task: (logLine: (line: string) => void) => Promise<T>,
  ): Promise<T> {
    const text = `${this.nextPrefix()} ${label}`;

    if (!interactive()) {
      console.log(chalk.bold.cyan(text));
      const result = await task((line) => console.log(line));
      console.log(statusLine(result.status, text));
      return result;
    }

    const log = taskLog({ title: text, limit: 8 });
    const result = await task((line) => log.message(line));

    if (result.status === "failed") {
      log.error(text);
    } else {
      log.success(text);
    }

    return result;
  }

  /**
   * Ora-era name kept for network repair steps (success / failed / skipped).
   */
  async stepNetwork<T extends { status: "success" | "failed" | "skipped" }>(
    label: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const text = `${this.nextPrefix()} ${label}`;

    if (!interactive()) {
      console.log(chalk.cyan(`${text}...`));
      const result = await task();
      console.log(statusLine(result.status, text));
      return result;
    }

    const s = spinner();
    s.start(text);
    try {
      const result = await task();
      if (result.status === "failed") {
        s.error(text);
      } else if (result.status === "skipped") {
        s.clear();
        console.log(statusLine("warn", text));
      } else {
        s.stop(text);
      }
      return result;
    } catch (error) {
      s.error(text);
      throw error;
    }
  }

  tick(label: string): void {
    const text = `${this.nextPrefix()} ${label}`;
    console.log(statusLine("success", text));
  }

  info(message: string): void {
    console.log(chalk.dim(`  ${message}`));
  }

  done(message: string): void {
    console.log(chalk.green(message));
  }
}
