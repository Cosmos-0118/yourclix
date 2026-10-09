import { ui } from "../../core/ui.js";
import type { StepResult } from "./types.js";

export function renderSetupSummary(
  results: StepResult[],
  logPath: string,
): void {
  ui.heading("Setup summary");

  for (const result of results) {
    ui.status(
      result.status === "partial" ? "warn" : result.status,
      result.name,
      result.details.slice(0, 3),
    );
  }

  ui.note(`Log file: ${logPath}`);
}
