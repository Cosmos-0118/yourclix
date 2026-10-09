import { ui } from "../../core/ui.js";
import type { StepResult } from "./types.js";

export function renderSetupSummary(
  results: StepResult[],
  logPath: string,
): void {
  ui.summary("Setup result", results);
  const versions = results.find((result) => result.name === "Version checks");
  if (versions && versions.status !== "skipped")
    ui.list("Tool versions", versions.details);

  ui.note(`Log file: ${logPath}`);
}
