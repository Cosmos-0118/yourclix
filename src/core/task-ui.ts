import {
  confirm as clackConfirm,
  intro,
  isCancel,
  isCI,
  outro,
  progress as clackProgress,
  text as clackText,
} from "@clack/prompts";
import chalk from "chalk";
import { askNumber as legacyAskNumber, confirm as legacyConfirm } from "./prompt.js";

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
 * Frames a command with a clack intro/outro so every step, spinner, and
 * summary box printed inside `fn` reads as one continuous flow. On failure
 * `fn` is left to throw; the outro is skipped and the existing top-level
 * error handler takes over, matching every other command's failure path.
 */
export async function withIntroOutro(
  title: string,
  fn: () => Promise<void>,
): Promise<void> {
  intro(chalk.bold(title));
  await fn();
  outro();
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
