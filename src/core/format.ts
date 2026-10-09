import os from "node:os";
import stringWidth from "fast-string-width";
import { wrapAnsi } from "fast-wrap-ansi";

// ANSI escape sequences are zero-width in a terminal. Keep this local instead
// of relying on a transitive formatting dependency so plain output and tests
// use the same measurements as the interactive UI.
const ANSI_ESCAPE =
  /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE, "");
}

export function visibleWidth(value: string): number {
  return Math.max(
    0,
    ...stripAnsi(value)
      .split("\n")
      .map((line) => stringWidth(line)),
  );
}

export function fitText(
  value: string,
  maxWidth: number,
  ellipsis = "…",
): string {
  const safeWidth = Math.max(1, Math.floor(maxWidth));
  if (visibleWidth(value) <= safeWidth) {
    return value;
  }

  let fitted = "";
  const available = safeWidth - visibleWidth(ellipsis);
  if (available < 0) return "";
  for (const { segment } of graphemes.segment(stripAnsi(value))) {
    if (visibleWidth(fitted + segment) > available) break;
    fitted += segment;
  }
  return fitted + ellipsis;
}

export function terminalWidth(columns = process.stdout.columns): number {
  return Number.isFinite(columns) && (columns ?? 0) > 0
    ? Math.floor(columns!)
    : 80;
}

export function terminalRule(
  maxWidth = 72,
  columns = process.stdout.columns,
): string {
  return "─".repeat(
    Math.max(1, Math.min(maxWidth, terminalWidth(columns) - 2)),
  );
}

export function compactPath(value: string, home = os.homedir()): string {
  const resolvedHome = home.replace(/[\\/]$/, "");
  if (value === resolvedHome) {
    return "~";
  }

  if (
    value.startsWith(`${resolvedHome}/`) ||
    value.startsWith(`${resolvedHome}\\`)
  ) {
    return `~${value.slice(resolvedHome.length)}`;
  }

  return value;
}

/**
 * Wrap unstyled text without losing a long value. This is for raw/list output;
 * panels containing chalk styling are wrapped by clack/boxen themselves.
 */
export function wrapText(value: string, width: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const result: string[] = [];

  for (const sourceLine of value.split(/\r?\n/)) {
    if (sourceLine.length === 0) {
      result.push("");
      continue;
    }

    let remaining = sourceLine;
    while (remaining.length > safeWidth) {
      let splitAt = remaining.lastIndexOf(" ", safeWidth + 1);
      if (splitAt <= 0) {
        splitAt = safeWidth;
      }

      result.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt).trimStart();
    }
    result.push(remaining);
  }

  return result;
}

/** Hard-wrap styled text while retaining its ANSI sequences. */
export function wrapAnsiText(value: string, width: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  return value.split(/\r?\n/).flatMap((line) => {
    const leading = line.match(/^ */)?.[0] ?? "";
    const indent = leading.slice(0, Math.max(0, safeWidth - 1));
    return wrapAnsi(line.slice(leading.length), safeWidth - indent.length, {
      hard: true,
      wordWrap: false,
      trim: true,
    })
      .split("\n")
      .map((wrapped) => indent + wrapped);
  });
}

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

export function bytesToHuman(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function pad(value: string, width: number): string {
  const currentWidth = visibleWidth(value);
  if (currentWidth >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - currentWidth)}`;
}
