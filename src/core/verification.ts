import type { ExecResult } from "./exec.js";

export function hasNamedEntry(entries: string[], name: string): boolean {
  return entries.some((entry) => entry === name);
}

export function firstCommandOutput(result: ExecResult): string {
  const merged = (result.stdout || result.stderr || "(no output)").trim();
  const firstLine = merged.split("\n")[0];
  return firstLine || "(no output)";
}
