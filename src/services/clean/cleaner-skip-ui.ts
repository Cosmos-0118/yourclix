import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import type { HeuristicSkipRecord } from "./clean-heuristics.js";

export type SkipRecord = HeuristicSkipRecord;

const SAFETY_SKIP_REASONS = ["protected-path", "newer-than-"];

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

export function printSkippedBreakdown(skipped: SkipRecord[]): void {
  if (skipped.length === 0) {
    return;
  }

  const reasonCounts = new Map<string, number>();
  for (const entry of skipped) {
    reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
  }

  console.log(chalk.bold("\nSkipped breakdown"));
  for (const [reason, count] of [...reasonCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  • ${formatSkipReasonShort(reason)}: ${count}`);
  }
}

export function printSkippedSummary(skipped: SkipRecord[], verbose: boolean): void {
  if (skipped.length === 0) {
    return;
  }

  const reasonCounts = new Map<string, number>();
  for (const entry of skipped) {
    reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
  }

  console.log(chalk.bold("\nSkipped paths"));
  for (const [reason, count] of [...reasonCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${chalk.dim("•")} ${formatSkipReasonShort(reason)}: ${count}`);
  }

  if (!verbose) {
    const home = os.homedir();
    const buckets = bucketSkippedPaths(skipped, home);
    if (buckets.length > 0) {
      console.log(chalk.dim("\n  By location (use --verbose for full paths):"));
      for (const { label, count } of buckets.slice(0, 8)) {
        console.log(chalk.dim(`    ${count} under ${label}`));
      }
      if (buckets.length > 8) {
        console.log(
          chalk.dim(`    … and ${buckets.length - 8} more location group(s)`),
        );
      }
    }
    return;
  }

  const sample = skipped.slice(0, 12);
  console.log(chalk.dim("\n  Paths:"));
  for (const entry of sample) {
    console.log(
      chalk.dim(`    ${entry.path} (${formatSkipReasonShort(entry.reason)})`),
    );
  }
  if (skipped.length > sample.length) {
    console.log(
      chalk.dim(
        `    … ${skipped.length - sample.length} more (truncated; narrow scan with filters if needed)`,
      ),
    );
  }
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

  let line = `Safety filters skipped ${skipped.length} path(s) (${parts.join(", ")}).`;
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
    return `retention (${age})`;
  }

  if (reason === "permission-denied") {
    return "permission denied";
  }

  if (reason === "not-found") {
    return "not found";
  }

  return reason;
}

export function isSafetySkipReason(reason: string): boolean {
  return SAFETY_SKIP_REASONS.some((prefix) => reason.startsWith(prefix));
}
