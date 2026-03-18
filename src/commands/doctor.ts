import { Command } from "commander";
import { printDoctorReport, runDoctor } from "../services/doctor.js";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Analyze macOS health and provide actionable report")
    .action(async () => {
      const report = await runDoctor();
      printDoctorReport(report);
    });
}
