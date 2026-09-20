import os from "node:os";

// ANSI escape sequences are zero-width in a terminal. Keep this local instead
// of relying on a transitive formatting dependency so plain output and tests
// use the same measurements as the interactive UI.
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const ANSI_TOKEN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/y;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE, "");
}

export function visibleWidth(value: string): number {
  return Math.max(
    0,
    ...stripAnsi(value)
      .split("\n")
      .map((line) => Array.from(line).length),
  );
}

export function fitText(value: string, maxWidth: number, ellipsis = "…"): string {
  const safeWidth = Math.max(1, Math.floor(maxWidth));
  if (visibleWidth(value) <= safeWidth) {
    return value;
  }

  if (safeWidth <= Array.from(ellipsis).length) {
    return Array.from(ellipsis).slice(0, safeWidth).join("");
  }

  return `${Array.from(stripAnsi(value)).slice(0, safeWidth - Array.from(ellipsis).length).join("")}${ellipsis}`;
}

export function terminalWidth(columns = process.stdout.columns): number {
  return Number.isFinite(columns) && (columns ?? 0) > 0 ? Math.floor(columns!) : 80;
}

export function terminalRule(maxWidth = 72, columns = process.stdout.columns): string {
  return "─".repeat(Math.max(1, Math.min(maxWidth, terminalWidth(columns) - 2)));
}

export function compactPath(value: string, home = os.homedir()): string {
  const resolvedHome = home.replace(/[\\/]$/, "");
  if (value === resolvedHome) {
    return "~";
  }

  if (value.startsWith(`${resolvedHome}/`) || value.startsWith(`${resolvedHome}\\`)) {
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
  const result: string[] = [];

  for (const sourceLine of value.split(/\r?\n/)) {
    let current = "";
    let currentWidth = 0;
    let index = 0;

    while (index < sourceLine.length) {
      ANSI_TOKEN.lastIndex = index;
      const ansi = ANSI_TOKEN.exec(sourceLine);
      if (ansi && ansi.index === index) {
        current += ansi[0];
        index += ansi[0].length;
        continue;
      }

      const character = Array.from(sourceLine.slice(index))[0] ?? "";
      const characterLength = character.length;
      if (currentWidth >= safeWidth && character !== " ") {
        result.push(current.trimEnd());
        current = "";
        currentWidth = 0;
      }

      if (character === " " && currentWidth === 0) {
        index += characterLength;
        continue;
      }

      current += character;
      currentWidth += 1;
      index += characterLength;
    }

    result.push(current.trimEnd());
  }

  return result;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
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
