import { brewOptimize } from "../brew/brew.js";
import { ui } from "../../core/ui.js";

/** Fix and standalone Brew commands share diagnostics, recovery, and rendering. */
export async function runBrewOutdatedRemediation(fixDryRun: boolean, verbose = false): Promise<void> {
  await brewOptimize(fixDryRun, ui, verbose);
}
