import { format } from "node:util";
import type { Readable, Writable } from "node:stream";
import { confirm, isCancel, select, text } from "@clack/prompts";
import { Chalk, type ChalkInstance } from "chalk";
import { fitText, stripAnsi, wrapAnsiText } from "./format.js";

type Input = Readable & { isTTY?: boolean };
type Output = Writable & { isTTY?: boolean; columns?: number };
export type TaskStatus = "success" | "warn" | "failed" | "skipped";
interface Task {
  label: string;
  startedAt: number;
}
interface Result {
  status?: string;
  details?: string[];
  code?: number;
  ok?: boolean;
  error?: string;
  stderr?: string;
  stdout?: string;
}
export class CliCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CliCancelled";
  }
}

/** The only owner of human-readable terminal output and cursor movement. */
export class CliUI {
  private readonly input: Input;
  private readonly output: Output;
  private readonly errorOutput: Output;
  private readonly env: NodeJS.ProcessEnv;
  private tasks: Task[] = [];
  private paused = 0;
  private timer?: ReturnType<typeof setInterval>;
  private painted = false;
  private frame = 0;
  private title?: string;
  private failures = 0;
  private warnings = 0;
  private controller = new AbortController();
  // Style against our output stream, independently of Chalk's global detection.
  private readonly colors = new Chalk({ level: 1 });
  private hasOutput = false;
  private lastLineBlank = true;
  private gapBeforeNextBlock = false;

  constructor(
    options: {
      input?: Input;
      output?: Output;
      errorOutput?: Output;
      env?: NodeJS.ProcessEnv;
    } = {},
  ) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.errorOutput = options.errorOutput ?? process.stderr;
    this.env = options.env ?? process.env;
  }

  get interactive(): boolean {
    return (
      Boolean(
        this.input.isTTY && this.output.isTTY && (this.output.columns ?? 0) > 0,
      ) &&
      !/^(1|true|yes)$/i.test(this.env.CI ?? "") &&
      this.env.TERM !== "dumb"
    );
  }
  get activeTasks(): number {
    return this.tasks.length;
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  get width(): number {
    return Math.max(1, this.output.columns || 80);
  }
  private get colorEnabled(): boolean {
    return (
      this.interactive && !this.env.NO_COLOR && this.env.FORCE_COLOR !== "0"
    );
  }
  cancel(): void {
    this.controller.abort();
    this.stopAnimation();
  }
  throwIfCancelled(): void {
    if (this.signal.aborted) throw new CliCancelled();
  }

  private clear(): void {
    if (this.painted) {
      this.output.write("\r\x1b[2K");
      this.painted = false;
    }
  }
  private redraw(): void {
    if (
      !this.interactive ||
      this.paused ||
      this.signal.aborted ||
      this.tasks.length === 0
    )
      return;
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const task = this.tasks[this.tasks.length - 1];
    const elapsed = Math.floor((Date.now() - task.startedAt) / 1000);
    // Fit before styling so truncation does not discard the active-step colour.
    const suffix = elapsed > 0 && this.width >= 20 ? ` (${elapsed}s)` : "";
    const label = fitText(
      `  ${frames[this.frame++ % frames.length]} ${task.label}`,
      this.width - 1 - suffix.length,
    );
    const progress = this.colors.cyan(label) + this.colors.gray(suffix);
    this.output.write(
      `\r\x1b[2K${this.colorEnabled ? progress : stripAnsi(progress)}`,
    );
    this.painted = true;
  }
  private animate(): void {
    if (
      this.interactive &&
      !this.signal.aborted &&
      !this.timer &&
      !this.paused &&
      this.tasks.length > 0
    ) {
      this.redraw();
      this.timer = setInterval(() => this.redraw(), 80);
      this.timer.unref();
    }
  }
  private stopAnimation(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.clear();
  }

  private print(target: Output, values: unknown[]): void {
    this.clear();
    // Keep SGR colors but discard child-process cursor movement and controls.
    const value = format(...values)
      .replace(
        /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g,
        (sequence) => (/^\u001b\[[\d;]*m$/.test(sequence) ? sequence : ""),
      )
      .replace(/\u001b(?!\[[\d;]*m).?/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, "");
    const printable = this.colorEnabled ? value : stripAnsi(value);
    const wrapped = wrapAnsiText(printable, this.width).join("\n");
    target.write(`${wrapped}\n`);
    this.hasOutput = true;
    this.lastLineBlank = !stripAnsi(wrapped).split("\n").at(-1)?.trim();
    this.redraw();
  }
  private gap(): void {
    if (this.hasOutput && !this.lastLineBlank) this.write("");
    this.gapBeforeNextBlock = false;
  }
  private separateBlock(): void {
    if (this.gapBeforeNextBlock) this.gap();
  }
  write(...values: unknown[]): void {
    this.print(this.output, values);
  }
  error(...values: unknown[]): void {
    this.print(this.errorOutput, [this.colors.red(format(...values))]);
  }
  warn(...values: unknown[]): void {
    this.print(this.errorOutput, [this.colors.yellow(format(...values))]);
  }
  heading(value: string): void {
    this.gap();
    this.write(`  ${this.colors.bold.cyan(`▸ ${value}`)}`);
  }
  note(value: string): void {
    this.detail(value, this.colors.gray);
    if (this.tasks.length === 0) this.gapBeforeNextBlock = true;
  }
  private detail(value: string, color: ChalkInstance): void {
    this.write(
      value
        .split(/\r?\n/)
        .map((line) => {
          const style = /^\s*(Error:|fatal:)/i.test(stripAnsi(line))
            ? this.colors.red
            : /^\s*Warning:/i.test(stripAnsi(line))
              ? this.colors.yellow
              : color;
          return line.trim() ? `    ${style(line)}` : "";
        })
        .join("\n"),
    );
  }
  message(value: string | string[]): void {
    this.write(Array.isArray(value) ? value.join("\n") : value);
  }
  success(value: string): void {
    this.status("success", value);
  }
  list(title: string, lines: string[]): void {
    this.heading(title);
    for (const line of lines) this.detail(line, this.colors.cyan);
    if (lines.length) this.gapBeforeNextBlock = true;
  }
  status(status: TaskStatus, label: string, details: string[] = []): void {
    this.separateBlock();
    const marker = { success: "✓", warn: "!", failed: "✗", skipped: "–" }[
      status
    ];
    if (status === "failed") this.failures++;
    if (status === "warn") this.warnings++;
    const color = {
      success: this.colors.green,
      warn: this.colors.yellow,
      failed: this.colors.red,
      skipped: this.colors.gray,
    }[status];
    this.write(`  ${color(`${marker} ${label}`)}`);
    for (const detail of details)
      this.detail(
        detail,
        status === "failed" || status === "warn" ? color : this.colors.gray,
      );
    if (details.length) this.gapBeforeNextBlock = true;
  }

  async task<T>(label: string, run: () => Promise<T>): Promise<T> {
    this.throwIfCancelled();
    this.separateBlock();
    const task: Task = { label, startedAt: Date.now() };
    this.tasks.push(task);
    if (!this.interactive) this.write(`  … ${label}`);
    this.animate();
    try {
      const result = await run();
      this.throwIfCancelled();
      const value = result as Result | undefined;
      const status: TaskStatus =
        (typeof value?.code === "number" && value.code !== 0) ||
        value?.ok === false
          ? "failed"
          : value?.status === "partial"
            ? "warn"
            : value?.status === "failed" ||
                value?.status === "warn" ||
                value?.status === "skipped"
              ? value.status
              : "success";
      // Finish this task before printing its result; do not redraw a completed task.
      this.removeTask(task);
      this.status(
        status,
        label,
        status === "success"
          ? []
          : (value?.details ??
              [value?.error || value?.stderr || value?.stdout || ""].filter(
                Boolean,
              )),
      );
      return result;
    } catch (error) {
      this.removeTask(task);
      this.status(error instanceof CliCancelled ? "skipped" : "failed", label);
      throw error;
    } finally {
      this.removeTask(task);
      this.animate();
    }
  }
  private removeTask(task: Task): void {
    this.stopAnimation();
    this.tasks = this.tasks.filter((entry) => entry !== task);
  }
  async stream<T>(
    label: string,
    run: (line: (value: string) => void) => Promise<T>,
  ): Promise<T> {
    return this.task(label, () => run((line) => this.note(line)));
  }
  async suspend<T>(run: () => Promise<T>): Promise<T> {
    this.paused++;
    this.stopAnimation();
    try {
      return await run();
    } finally {
      this.paused--;
      this.animate();
    }
  }

  start(title: string): void {
    if (this.title) return;
    this.title = title;
    this.failures = 0;
    this.warnings = 0;
    this.gap();
    this.write(`  ${this.colors.bold.magenta(title)}`);
    this.gapBeforeNextBlock = true;
  }
  finish(failed = false): void {
    this.stopAnimation();
    if (!this.title) return;
    if (this.signal.aborted) {
      this.title = undefined;
      return;
    }
    const message =
      failed || this.failures > 0
        ? "Finished with unresolved issues."
        : this.warnings > 0
          ? "Finished with warnings."
          : "Done.";
    this.gap();
    const color =
      failed || this.failures > 0
        ? this.colors.red
        : this.warnings > 0
          ? this.colors.yellow
          : this.colors.green;
    const marker =
      failed || this.failures > 0 ? "✗" : this.warnings > 0 ? "!" : "✓";
    this.write(`  ${color(`${marker} ${message}`)}`);
    this.title = undefined;
  }
  async command<T>(title: string, run: () => Promise<T>): Promise<T> {
    const ownsSession = !this.title;
    this.start(title);
    try {
      const result = await run();
      if (ownsSession) this.finish();
      return result;
    } catch (error) {
      if (ownsSession) this.finish(!(error instanceof CliCancelled));
      throw error;
    }
  }

  private answer<T>(value: T): Exclude<T, symbol> {
    if (isCancel(value)) {
      this.cancel();
      throw new CliCancelled();
    }
    return value as Exclude<T, symbol>;
  }
  private async prompt<T>(run: () => Promise<T>): Promise<T> {
    this.gap();
    return this.suspend(async () => {
      try {
        return await run();
      } finally {
        // Clack writes directly during the handoff; the following block needs space.
        this.hasOutput = true;
        this.lastLineBlank = false;
        this.gapBeforeNextBlock = true;
      }
    });
  }
  async confirm(message: string, assumeYes = false): Promise<boolean> {
    this.throwIfCancelled();
    if (assumeYes) return true;
    if (!this.interactive) {
      this.note(`${message} Kept / skipped (no interactive input).`);
      return false;
    }
    return this.prompt(async () =>
      this.answer(
        await confirm({
          message,
          initialValue: false,
          input: this.input,
          output: this.output,
          signal: this.signal,
        }),
      ),
    );
  }
  async select<T extends string>(
    message: string,
    options: { value: T; label: string; hint?: string }[],
    defaultValue: T,
  ): Promise<T> {
    this.throwIfCancelled();
    if (!this.interactive) {
      this.note(`${message} Skipped (no interactive input).`);
      return defaultValue;
    }
    return this.prompt(async () =>
      this.answer(
        await select({
          message,
          options: options as Parameters<typeof select<T>>[0]["options"],
          initialValue: defaultValue,
          input: this.input,
          output: this.output,
          signal: this.signal,
        }),
      ),
    );
  }
  async number(
    message: string,
    options: {
      defaultValue: number;
      min?: number;
      max?: number;
      assumeDefault?: boolean;
    },
  ): Promise<number> {
    this.throwIfCancelled();
    const min = options.min ?? Number.MIN_SAFE_INTEGER;
    const max = options.max ?? Number.MAX_SAFE_INTEGER;
    const fallback = Math.min(
      max,
      Math.max(min, Math.round(options.defaultValue)),
    );
    if (options.assumeDefault || !this.interactive) return fallback;
    const answer = await this.prompt(async () =>
      this.answer(
        await text({
          message,
          defaultValue: String(fallback),
          placeholder: String(fallback),
          input: this.input,
          output: this.output,
          signal: this.signal,
          validate(value) {
            if (!value?.trim()) return;
            if (
              !/^\d+$/.test(value.trim()) ||
              Number(value) < min ||
              Number(value) > max
            )
              return `Enter a whole number between ${min} and ${max}.`;
          },
        }),
      ),
    );
    return answer.trim() ? Number(answer) : fallback;
  }
}

export const ui = new CliUI();
