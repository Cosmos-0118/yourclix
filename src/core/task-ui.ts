import {
  box,
  confirm as clackConfirm,
  isCancel,
  isCI,
  progress as clackProgress,
  text as clackText,
} from "@clack/prompts";
import boxen, { type Options as BoxenOptions } from "boxen";
import chalk from "chalk";
import { askNumber as legacyAskNumber, confirm as legacyConfirm } from "./prompt.js";
import { fitText, terminalWidth, visibleWidth } from "./format.js";

/**
 * A bordered summary panel sized to its own content. `auto` lets clack wrap
 * long lines to the actual terminal width, while disabling its guide avoids a
 * second vertical frame inside the command's output.
 */
export function panel(
  content: string,
  title: string,
  formatBorder: (line: string) => string,
): void {
  box(content, title, {
    width: "auto",
    withGuide: false,
    contentPadding: 1,
    titlePadding: 1,
    formatBorder,
  });
}

/** Render a boxen panel that never exceeds the current terminal width. */
export function boundedBox(content: string, options: BoxenOptions = {}): string {
  const padding = typeof options.padding === "number" ?
    options.padding * 2
    : (options.padding?.left ?? 0) + (options.padding?.right ?? 0);
  const maxWidth = Math.max(3, terminalWidth() - 1);
  const maxInnerWidth = Math.max(1, maxWidth - padding - 2);
  const title = options.title && visibleWidth(options.title) > maxInnerWidth ?
    fitText(options.title, maxInnerWidth)
    : options.title;
  const longest = Math.max(
    1,
    ...content.split("\n").map(visibleWidth),
    ...(title ? [visibleWidth(title)] : []),
  );
  const width = Math.min(
    maxWidth,
    Math.max(3, longest + padding + 2),
  );

  return boxen(content, { ...options, title, width });
}

/**
 * True when it's safe to animate (spinners, progress bars, live task logs,
 * interactive prompts). Clack's own primitives only special-case CI; they
 * still emit raw cursor-movement bytes on a plain redirected/piped stdout,
 * so callers must check this before reaching for an animated primitive.
 */
export function interactive(): boolean {
  return (
    Boolean(process.stdout.isTTY) &&
    !isCI() &&
    (process.stdout.columns ?? 0) > 0
  );
}

/**
 * Frames a command with a plain heading and trailing spacing so every step,
 * spinner, and summary box printed inside `fn` reads as one continuous flow.
 * On failure `fn` is left to throw and the existing top-level error handler
 * takes over, matching every other command's failure path.
 */
export async function withIntroOutro(
  title: string,
  fn: () => Promise<void>,
): Promise<void> {
  // A persistent clack guide around a command makes nested panels look like
  // broken double borders. Keep the command heading, but let each component
  // own its own layout.
  console.log(chalk.bold(title));
  await fn();
  console.log();
}

/**
 * Clack-styled confirm prompt with the same contract as core/prompt.ts's
 * `confirm`. Falls back to the readline prompt when not interactive (piped
 * output, CI). Ctrl-C is treated as "no" rather than proceeding, since
 * clack's cancel symbol is truthy.
 */
export async function confirmAction(
  message: string,
  assumeYes = false,
): Promise<boolean> {
  if (assumeYes) {
    return true;
  }

  if (!interactive()) {
    return legacyConfirm(message, false);
  }

  const answer = await clackConfirm({ message });
  if (isCancel(answer)) {
    return false;
  }

  return answer;
}

interface RetentionPromptOptions {
  defaultValue: number;
  min: number;
  max: number;
  assumeDefault: boolean;
}

/**
 * Clack-styled numeric prompt used for the clean flow's retention-days
 * question. Falls back to the readline-based prompt when not interactive.
 */
export async function numberPrompt(
  message: string,
  options: RetentionPromptOptions,
): Promise<number> {
  if (options.assumeDefault) {
    return options.defaultValue;
  }

  if (!interactive()) {
    return legacyAskNumber(message, options);
  }

  const answer = await clackText({
    message,
    placeholder: String(options.defaultValue),
    defaultValue: String(options.defaultValue),
    validate: (value) => {
      if (!value || value.trim() === "") {
        return undefined;
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) {
        return "Enter a whole number.";
      }
      if (parsed < options.min || parsed > options.max) {
        return `Enter a value between ${options.min} and ${options.max}.`;
      }
      return undefined;
    },
  });

  if (isCancel(answer)) {
    return options.defaultValue;
  }

  const trimmed = answer.trim();
  return trimmed === "" ? options.defaultValue : Number.parseInt(trimmed, 10);
}

export interface ProgressBar {
  advance(step: number, label?: string): void;
  stop(label?: string): void;
}

/**
 * A single progress bar across a known number of items (e.g. scan
 * categories). Falls back to plain `[n/total]` lines when not interactive.
 */
export function startProgressBar(title: string, max: number): ProgressBar {
  if (!interactive()) {
    console.log(chalk.bold.cyan(title));
    let done = 0;
    return {
      advance(step = 1, label) {
        done += step;
        if (label) {
          console.log(chalk.dim(`  [${done}/${max}] ${label}`));
        }
      },
      stop(label) {
        if (label) {
          console.log(chalk.green(label));
        }
      },
    };
  }

  const bar = clackProgress({ style: "block", max, size: 30 });
  bar.start(title);
  return {
    advance(step = 1, label) {
      bar.advance(step, label);
    },
    stop(label) {
      bar.stop(label);
    },
  };
}
