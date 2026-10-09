import { ui, CliCancelled } from "../../core/ui.js";
import type { SetupLogger, StepResult, StepStatus } from "./types.js";

export async function runStep(
  name: string,
  logger: SetupLogger,
  task: () => Promise<{ status: StepStatus; details: string[] }>,
): Promise<StepResult> {
  await logger.log("info", `Step start: ${name}`);
  try {
    const result = await ui.task(name, task);
    for (const detail of result.details) {
      await logger.log(
        result.status === "failed" ? "error" : "info",
        `${name}: ${detail}`,
      );
    }
    await logger.log("info", `Step end: ${name} (${result.status})`);
    return { name, ...result };
  } catch (error) {
    if (error instanceof CliCancelled) throw error;
    const message = error instanceof Error ? error.message : String(error);
    await logger.log("error", `Step end: ${name} (failed) ${message}`);
    return {
      name,
      status: "failed",
      details: [message],
    };
  }
}
