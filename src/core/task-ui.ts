import boxen, { type Options as BoxenOptions } from "boxen";
import { ui } from "./ui.js";
import { fitText, terminalWidth, visibleWidth } from "./format.js";

/** Compatibility helper: summaries use the common heading/list style. */
export function panel(
  content: string,
  title: string,
  _formatBorder: (line: string) => string,
): void {
  ui.list(title, content.split("\n"));
}

/** Render a boxen panel that never exceeds the current terminal width. */
export function boundedBox(
  content: string,
  options: BoxenOptions = {},
): string {
  const padding =
    typeof options.padding === "number"
      ? options.padding * 2
      : (options.padding?.left ?? 0) + (options.padding?.right ?? 0);
  const maxWidth = Math.max(3, terminalWidth() - 1);
  const maxInnerWidth = Math.max(1, maxWidth - padding - 2);
  const title =
    options.title && visibleWidth(options.title) > maxInnerWidth
      ? fitText(options.title, maxInnerWidth)
      : options.title;
  const longest = Math.max(
    1,
    ...content.split("\n").map(visibleWidth),
    ...(title ? [visibleWidth(title)] : []),
  );
  const width = Math.min(maxWidth, Math.max(3, longest + padding + 2));

  return boxen(content, { ...options, title, width });
}

/** Both input and output must be interactive before prompting or animating. */
export function interactive(): boolean {
  return ui.interactive;
}

export async function withIntroOutro(
  title: string,
  fn: () => Promise<void>,
): Promise<void> {
  await ui.command(title, fn);
}

export async function confirmAction(
  message: string,
  assumeYes = false,
): Promise<boolean> {
  return ui.confirm(message, assumeYes);
}

export async function numberPrompt(
  message: string,
  options: {
    defaultValue: number;
    min: number;
    max: number;
    assumeDefault: boolean;
  },
): Promise<number> {
  return ui.number(message, options);
}

export interface ProgressBar {
  advance(step: number, label?: string): void;
  stop(label?: string): void;
}
export function startProgressBar(title: string, max: number): ProgressBar {
  ui.heading(title);
  let done = 0;
  return {
    advance(step = 1, label) {
      done += step;
      if (label) ui.note(`[${done}/${max}] ${label}`);
    },
    stop(label) {
      if (label) ui.note(label);
    },
  };
}
