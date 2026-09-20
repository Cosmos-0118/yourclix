import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { pluralize, terminalWidth, wrapText } from "../../core/format.js";
import type { HeuristicSkipRecord } from "./clean-heuristics.js";

export type SkipRecord = HeuristicSkipRecord;

export function getSkipReason(error: unknown): string {
  const err = error as NodeJS.ErrnoException;
  if (!err || typeof err !== "object") {
    return "unknown";
  }

  if (err.code === "ENOENT") {
    return "not-found";
  }

  if (err.code === "EACCES" || err.code === "EPERM") {
    return "permission-denied";
  }

  if (err.code) {
    return err.code.toLowerCase();
  }

  return err.message || "unknown";
}

function reasonBreakdownLines(skipped: SkipRecord[]): string[] {
  const reasonCounts = new Map<string, number>();
  for (const entry of skipped) {
    reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
  }

  return [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${chalk.dim("•")} ${formatSkipReasonShort(reason)}: ${count}`);
}

export function printSkippedBreakdown(skipped: SkipRecord[]): void {
  if (skipped.length === 0) {
    return;
  }

  console.log([chalk.bold("Skipped breakdown"), ...reasonBreakdownLines(skipped)].join("\n"));
}

export function printSkippedSummary(skipped: SkipRecord[], verbose: boolean): void {
  if (skipped.length === 0) {
    return;
  }

  const lines = [chalk.bold(`Skipped paths · ${pluralize(skipped.length, "item")}`), ...reasonBreakdownLines(skipped)];

  if (!verbose) {
    const home = os.homedir();
    const buckets = bucketSkippedPaths(skipped, home);
    if (buckets.length > 0) {
      lines.push("", chalk.dim("By location (use --verbose for full paths):"));
      for (const { label, count } of buckets.slice(0, 8)) {
        lines.push(chalk.dim(`  ${count} under ${label}`));
      }
      if (buckets.length > 8) {
        lines.push(chalk.dim(`  … and ${pluralize(buckets.length - 8, "more location group")}`));
      }
    }
    console.log(lines.join("\n"));
    return;
  }

  const sample = skipped.slice(0, 12);
  lines.push("", chalk.dim("Paths:"));
  for (const entry of sample) {
    for (const line of wrapText(
      `  ${entry.path} (${formatSkipReasonShort(entry.reason)})`,
      Math.max(20, terminalWidth() - 2),
    )) {
      lines.push(chalk.dim(line));
    }
  }
  if (skipped.length > sample.length) {
    lines.push(
      chalk.dim(
        `  … ${skipped.length - sample.length} more (truncated; narrow scan with filters if needed)`,
      ),
    );
  }
  console.log(lines.join("\n"));
}

export function summarizeSkippedInline(skipped: SkipRecord[]): string {
  const reasonCounts = new Map<string, number>();
  for (const entry of skipped) {
    const label = formatSkipReasonShort(entry.reason);
    reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1);
  }

  const parts = [...reasonCounts.entries()].map(([k, v]) => `${v} ${k}`);
  const home = os.homedir();
  const top = topLocationBucket(
    skipped.map((s) => s.path),
    home,
  );

  let line = `Safety filters skipped ${pluralize(skipped.length, "path")} (${parts.join(", ")}).`;
  if (top) {
    line += ` Largest group under ${top}.`;
  }
  return line;
}

function bucketSkippedPaths(
  skipped: SkipRecord[],
  home: string,
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of skipped) {
    const label = pathBucketForDisplay(entry.path, home);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function topLocationBucket(paths: string[], home: string): string | null {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const label = pathBucketForDisplay(p, home);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [label, count] of counts) {
    if (count > n) {
      n = count;
      best = label;
    }
  }
  return best;
}

function pathBucketForDisplay(fullPath: string, home: string): string {
  const rel = path.relative(home, fullPath);
  if (rel.startsWith("..")) {
    return "(outside home)";
  }

  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length >= 2 && parts[0] === "Library") {
    return `~/Library/${parts[1]}`;
  }

  if (parts.length >= 1) {
    return `~/${parts[0]}`;
  }

  return "~";
}

function formatSkipReasonShort(reason: string): string {
  if (reason === "protected-path") {
    return "protected";
  }

  if (reason.startsWith("newer-than-")) {
    const age = reason.replace("newer-than-", "");
    return `retention (<${age})`;
  }

  if (reason === "permission-denied") {
    return "permission denied";
  }

  if (reason === "not-found") {
    return "not found";
  }

  if (reason === "tracked-project-artifact") {
    return "tracked project files";
  }

  if (reason === "git-check-failed") {
    return "Git check failed";
  }

  if (reason === "project-boundary") {
    return "project boundary";
  }

  return reason;
}
