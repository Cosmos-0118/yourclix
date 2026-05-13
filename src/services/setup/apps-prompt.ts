import { confirm } from "../../core/prompt.js";
import { printDesktopAppBundlePreview } from "./preview.js";
import type { AppsMode, EffectiveSetupConfig, SetupOptions } from "./types.js";

export async function resolveAppsModeFromPrompt(
  effective: EffectiveSetupConfig,
  options: SetupOptions,
): Promise<AppsMode> {
  if (options.apps) {
    return "minimal";
  }

  if (effective.fast) {
    return effective.appMode;
  }

  if (effective.appMode !== "none") {
    printDesktopAppBundlePreview(effective.appMode, effective.casks);
    const approved = await confirm(
      `Install these ${effective.casks.length} desktop app${effective.casks.length === 1 ? "" : "s"} now?`,
      false,
    );
    return approved ? effective.appMode : "none";
  }

  return "none";
}
