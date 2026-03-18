import chalk from "chalk";
import { runCommand } from "../../core/exec.js";

export async function runBrewMaintenance(dryRun: boolean): Promise<void> {
  const cleanupArgs = dryRun ? ["cleanup", "-n"] : ["cleanup"];

  const cleanup = await runCommand("brew", cleanupArgs, {
    allowFailure: true,
  });

  const doctor = await runCommand("brew", ["doctor"], {
    allowFailure: true,
  });

  const cleanupText = cleanup.stdout || cleanup.stderr;
  if (cleanupText.trim()) {
    console.log(chalk.dim(cleanupText.trim()));
  }

  const doctorText = doctor.stdout || doctor.stderr;
  if (doctorText.trim()) {
    console.log(chalk.dim(doctorText.trim()));
  }
}
