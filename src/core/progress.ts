import { ui } from "./ui.js";

/** Compatibility adapter: all commands share the same terminal owner. */
export class CommandProgress {
  private current = 0;
  constructor(
    private readonly title: string,
    private readonly totalSteps: number,
  ) {
    if (title.trim()) ui.heading(title);
  }
  private label(value: string): string {
    return `[${++this.current}/${this.totalSteps}] ${value}`;
  }
  async step<T>(label: string, task: () => Promise<T>): Promise<T> {
    return ui.task(this.label(label), task);
  }
  async interactiveStep<T>(label: string, task: () => Promise<T>): Promise<T> {
    return this.step(label, task);
  }
  async interactiveStepWithStatus<T extends { status: string }>(
    label: string,
    task: () => Promise<T>,
  ): Promise<T> {
    return this.step(label, task);
  }
  async streamStep<T extends { status: string }>(
    label: string,
    task: (line: (value: string) => void) => Promise<T>,
  ): Promise<T> {
    return ui.stream(this.label(label), task);
  }
  async stepNetwork<T extends { status: "success" | "failed" | "skipped" }>(
    label: string,
    task: () => Promise<T>,
  ): Promise<T> {
    return this.step(label, task);
  }
  tick(label: string): void {
    ui.status("skipped", this.label(label));
  }
  info(message: string): void {
    ui.note(message);
  }
  done(message: string): void {
    ui.note(message);
  }
}
