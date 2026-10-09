import { ui } from "../../core/ui.js";
import type { NetworkStepResult } from "./types.js";

export function printNetworkSummary(
  title: string,
  steps: NetworkStepResult[],
  logPath: string,
): void {
  ui.summary(title.includes("reset") ? "Reset result" : "Repair result", steps);
  ui.note(`Full log: ${logPath}`);
}

export function hasCriticalFailure(steps: NetworkStepResult[]): boolean {
  return steps.some((step) => step.critical && step.status === "failed");
}
