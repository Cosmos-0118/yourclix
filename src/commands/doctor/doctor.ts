import { Command } from "commander";
import { printDoctorReport, runDoctor } from "../services/doctor.js";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Analyze macOS health and provide actionable report")
    .addHelpText(
      "after",
      `
Examples:
  your doctor
  your doctor && your fix
`,
    )
    .action(async () => {
      const report = await runDoctor();
      printDoctorReport(report);
    });
}
