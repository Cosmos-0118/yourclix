import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import {
  APP_BUNDLES,
  CORE_FORMULAE,
  EXTRA_CLI_FORMULAE,
  SHELL_FORMULAE,
} from "./constants.js";
import type {
  AppsMode,
  EffectiveSetupConfig,
  SetupConfig,
  SetupLogger,
  SetupOptions,
  SetupProfile,
} from "./types.js";

export function resolveSetupConfig(
  options: SetupOptions,
  config?: SetupConfig,
): EffectiveSetupConfig {
  const profile = (options.profile ??
    config?.profile ??
    "minimal") as SetupProfile;
  const defaultAppModeByProfile: Record<SetupProfile, AppsMode> = {
    minimal: "minimal",
    webdev: "webdev",
    full: "full",
  };

  const appMode = (options.appMode ??
    config?.appMode ??
    defaultAppModeByProfile[profile]) as AppsMode;
  const dryRun = Boolean(options.dryRun);
  const fast = Boolean(options.fast);
  const debug = Boolean(options.debug);

  return {
    profile,
    appMode,
    coreFormulae: dedupe(config?.coreFormulae ?? CORE_FORMULAE),
    shellFormulae: dedupe(config?.shellFormulae ?? SHELL_FORMULAE),
    extraCliFormulae: dedupe(config?.extraCliFormulae ?? EXTRA_CLI_FORMULAE),
    casks: dedupe(config?.casks ?? APP_BUNDLES[appMode]),
    fast,
    dryRun,
    debug,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export async function readSetupConfig(
  configPath: string | undefined,
  logger: SetupLogger,
): Promise<SetupConfig | undefined> {
  if (!configPath) {
    return undefined;
  }

  try {
    const absolute = path.resolve(configPath);
    const content = await fs.readFile(absolute, "utf8");
    const parsed = JSON.parse(content) as SetupConfig;
    await logger.log("info", `Loaded setup config: ${absolute}`);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.log("warn", `Failed to load setup config: ${message}`);
    console.log(
      chalk.yellow(
        `Warning: could not load config '${configPath}', using defaults.`,
      ),
    );
    return undefined;
  }
}
