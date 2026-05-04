import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import boxen from "boxen";
import chalk from "chalk";
import ora from "ora";
import { runCommand, type ExecResult } from "../core/exec.js";
import { confirm } from "../core/prompt.js";
import { ensureManagedPath } from "../managers/path-manager.js";

type SetupProfile = "minimal" | "webdev" | "full";
type AppsMode = "none" | "minimal" | "webdev" | "full";
type StepStatus = "success" | "partial" | "failed" | "skipped";

type LogLevel = "info" | "warn" | "error" | "debug";

const CORE_FORMULAE = ["git", "node", "python", "pnpm", "oven-sh/bun/bun"];
const SHELL_FORMULAE = [
  "zsh-autosuggestions",
  "zsh-syntax-highlighting",
  "starship",
];
const EXTRA_CLI_FORMULAE = [
  "jq",
  "ripgrep",
  "fd",
  "fzf",
  "htop",
  "gh",
  "awscli",
  "kubectl",
];

const APP_BUNDLES: Record<AppsMode, string[]> = {
  none: [],
  minimal: ["visual-studio-code", "google-chrome"],
  webdev: [
    "visual-studio-code",
    "google-chrome",
    "firefox",
    "docker",
    "postman",
    "raycast",
  ],
  full: [
    "visual-studio-code",
    "google-chrome",
    "firefox",
    "iterm2",
    "docker",
    "postman",
    "slack",
    "notion",
    "rectangle",
    "raycast",
  ],
};

/** Friendly names for Homebrew casks (shown before install confirmation). */
const CASK_LABELS: Record<string, string> = {
  "visual-studio-code": "Visual Studio Code",
  "google-chrome": "Google Chrome",
  firefox: "Mozilla Firefox",
  docker: "Docker Desktop",
  postman: "Postman",
  raycast: "Raycast",
  iterm2: "iTerm2",
  slack: "Slack",
  notion: "Notion",
  rectangle: "Rectangle",
};

function formatCaskLabel(caskId: string): string {
  if (CASK_LABELS[caskId]) {
    return CASK_LABELS[caskId];
  }
  const leaf = caskId.includes("/") ? caskId.split("/").pop()! : caskId;
  return leaf
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function printDesktopAppBundlePreview(bundleName: AppsMode, casks: string[]): void {
  if (casks.length === 0) {
    return;
  }

  const lines = casks.map(
    (id) =>
      `${chalk.cyan("  ▸")} ${chalk.bold.white(formatCaskLabel(id))} ${chalk.dim(`· ${id}`)}`,
  );

  console.log(
    boxen(
      [chalk.gray("Homebrew will install:"), "", ...lines].join("\n"),
      {
        title: chalk.bold.white(` ${bundleName} bundle `),
        titleAlignment: "center",
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        margin: { top: 1, bottom: 0 },
        borderStyle: "round",
        borderColor: "cyan",
        dimBorder: false,
      },
    ),
  );
}

const ZSH_SETUP_BLOCK_START = "# >>> setup.ts managed block >>>";
const ZSH_SETUP_BLOCK_END = "# <<< setup.ts managed block <<<";
const BASH_SETUP_BLOCK_START = "# >>> setup.ts managed block >>>";
const BASH_SETUP_BLOCK_END = "# <<< setup.ts managed block <<<";
const FISH_SETUP_BLOCK_START = "# >>> setup.ts managed block >>>";
const FISH_SETUP_BLOCK_END = "# <<< setup.ts managed block <<<";

interface ShellBlockConfig {
  shell: "zsh" | "bash" | "fish";
  filePath: string;
  blockStart: string;
  blockEnd: string;
  lines: string[];
}

export interface SetupOptions {
  fast?: boolean;
  dryRun?: boolean;
  apps?: boolean;
  profile?: SetupProfile;
  appMode?: AppsMode;
  config?: string;
  debug?: boolean;
}

interface SetupConfig {
  profile?: SetupProfile;
  appMode?: AppsMode;
  coreFormulae?: string[];
  shellFormulae?: string[];
  extraCliFormulae?: string[];
  casks?: string[];
}

interface EffectiveSetupConfig {
  profile: SetupProfile;
  appMode: AppsMode;
  coreFormulae: string[];
  shellFormulae: string[];
  extraCliFormulae: string[];
  casks: string[];
  fast: boolean;
  dryRun: boolean;
  debug: boolean;
}

interface StepResult {
  name: string;
  status: StepStatus;
  details: string[];
}

interface SetupLogger {
  path: string;
  log: (level: LogLevel, message: string) => Promise<void>;
}

interface InstallTarget {
  name: string;
  type: "formula" | "cask";
}

export async function runSetup(options: SetupOptions): Promise<void> {
  const logger = await createSetupLogger(Boolean(options.debug));
  await logger.log("info", "Starting setup run");

  const configFromFile = await readSetupConfig(options.config, logger);
  const effective = resolveSetupConfig(options, configFromFile);

  console.log(chalk.cyan("Starting developer setup"));
  if (effective.dryRun) {
    console.log(chalk.yellow("Dry-run mode enabled. No changes will be made."));
  }

  const results: StepResult[] = [];

  results.push(
    await runStep("Prerequisites", logger, async () =>
      ensurePrerequisites(effective, logger),
    ),
  );

  results.push(
    await runStep("PATH management", logger, async () => {
      const pathResult = await ensureManagedPath("your");
      const details: string[] = [];

      if (pathResult.addedToCurrentSession.length > 0) {
        details.push(
          `Added to current session PATH: ${pathResult.addedToCurrentSession.join(", ")}`,
        );
      } else {
        details.push("Current session PATH already healthy.");
      }

      if (pathResult.addedToShellFiles.length > 0) {
        details.push(
          `Persisted PATH entries: ${pathResult.addedToShellFiles.join(", ")}`,
        );
      } else {
        details.push("Shell profile PATH entries already present.");
      }

      if (pathResult.fallbackApplied.length > 0) {
        details.push(
          `Fallback method used: ${pathResult.fallbackApplied.join(", ")}`,
        );
      }

      return { status: "success", details };
    }),
  );

  const brewReady = await runStep("Homebrew", logger, async () => {
    if (await hasBrew()) {
      return { status: "success", details: ["Homebrew already installed."] };
    }

    const spinner = ora("Homebrew not found. Installing Homebrew").start();
    const result = await runCommand(
      "/bin/bash",
      [
        "-c",
        "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)",
      ],
      { dryRun: effective.dryRun, allowFailure: true },
    );

    if (result.code === 0) {
      spinner.succeed(chalk.green("Homebrew installation step completed"));
      return {
        status: "success",
        details: [
          effective.dryRun ? "Would install Homebrew." : "Installed Homebrew.",
        ],
      };
    }

    spinner.fail(chalk.red("Homebrew installation failed"));
    return {
      status: "failed",
      details: [
        result.stderr ||
          result.stdout ||
          "Unknown Homebrew installation error.",
      ],
    };
  });

  results.push(brewReady);

  if (brewReady.status !== "failed") {
    results.push(
      await runStep("Core dev packages", logger, async () => {
        const summary = await installBatch(
          "Base Developer Packages",
          effective.coreFormulae.map((name) => ({ name, type: "formula" })),
          effective,
          logger,
        );
        return summary;
      }),
    );

    results.push(
      await runStep("Shell enhancements", logger, async () => {
        const installSummary = await installBatch(
          "Shell Enhancements",
          effective.shellFormulae.map((name) => ({ name, type: "formula" })),
          effective,
          logger,
        );

        const shellSummary = await ensureManagedShellBlocks(effective, logger);
        const status: StepStatus =
          installSummary.status === "failed" || shellSummary.status === "failed" ?
            "failed"
          : (
            installSummary.status === "partial" ||
            shellSummary.status === "partial"
          ) ?
            "partial"
          : "success";

        return {
          status,
          details: [...installSummary.details, ...shellSummary.details],
        };
      }),
    );

    if (effective.profile !== "minimal") {
      results.push(
        await runStep("Extra CLI tools", logger, async () =>
          installBatch(
            "Extra CLI Tools",
            effective.extraCliFormulae.map((name) => ({
              name,
              type: "formula",
            })),
            effective,
            logger,
          ),
        ),
      );
    } else {
      results.push({
        name: "Extra CLI tools",
        status: "skipped",
        details: ["Skipped for minimal profile."],
      });
    }

    const appMode = await resolveAppsModeFromPrompt(effective, options);
    if (appMode !== "none") {
      results.push(
        await runStep("Desktop apps", logger, async () =>
          installBatch(
            "Desktop Apps",
            effective.casks.map((name) => ({ name, type: "cask" })),
            effective,
            logger,
          ),
        ),
      );
    } else {
      results.push({
        name: "Desktop apps",
        status: "skipped",
        details: ["Skipped by configuration."],
      });
    }

    results.push(
      await runStep("Version checks", logger, async () =>
        collectVersionSummary(effective, logger),
      ),
    );
  } else {
    results.push({
      name: "Core dev packages",
      status: "skipped",
      details: ["Skipped because Homebrew failed."],
    });
    results.push({
      name: "Shell enhancements",
      status: "skipped",
      details: ["Skipped because Homebrew failed."],
    });
    results.push({
      name: "Extra CLI tools",
      status: "skipped",
      details: ["Skipped because Homebrew failed."],
    });
    results.push({
      name: "Desktop apps",
      status: "skipped",
      details: ["Skipped because Homebrew failed."],
    });
    results.push({
      name: "Version checks",
      status: "skipped",
      details: ["Skipped because Homebrew failed."],
    });
  }

  renderSetupSummary(results, logger.path);
}

async function runStep(
  name: string,
  logger: SetupLogger,
  task: () => Promise<{ status: StepStatus; details: string[] }>,
): Promise<StepResult> {
  await logger.log("info", `Step start: ${name}`);
  try {
    const result = await task();
    for (const detail of result.details) {
      await logger.log(
        result.status === "failed" ? "error" : "info",
        `${name}: ${detail}`,
      );
    }
    await logger.log("info", `Step end: ${name} (${result.status})`);
    return { name, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.log("error", `Step end: ${name} (failed) ${message}`);
    return {
      name,
      status: "failed",
      details: [message],
    };
  }
}

async function ensurePrerequisites(
  effective: EffectiveSetupConfig,
  logger: SetupLogger,
): Promise<{ status: StepStatus; details: string[] }> {
  const details: string[] = [];
  let status: StepStatus = "success";

  const xcodeResult = await runCommand("xcode-select", ["-p"], {
    allowFailure: true,
  });
  if (xcodeResult.code === 0) {
    details.push("Xcode Command Line Tools detected.");
  } else {
    const installResult = await runCommand("xcode-select", ["--install"], {
      dryRun: effective.dryRun,
      allowFailure: true,
    });
    if (installResult.code === 0 || installResult.stderr.includes("already")) {
      details.push(
        effective.dryRun ?
          "Would request Xcode Command Line Tools install."
        : "Requested Xcode Command Line Tools install.",
      );
      status = "partial";
    } else {
      details.push("Unable to request Xcode Command Line Tools installation.");
      status = "partial";
    }
  }

  const arch = os.arch();
  if (arch === "arm64") {
    const rosettaCheck = await runCommand("pgrep", ["oahd"], {
      allowFailure: true,
    });
    if (rosettaCheck.code !== 0) {
      const rosettaInstall = await runCommand(
        "softwareupdate",
        ["--install-rosetta", "--agree-to-license"],
        { dryRun: effective.dryRun, allowFailure: true },
      );

      if (rosettaInstall.code === 0) {
        details.push(
          effective.dryRun ? "Would install Rosetta." : "Installed Rosetta.",
        );
      } else {
        details.push("Rosetta not confirmed. Some Intel-only tools may fail.");
        status = "partial";
      }
    } else {
      details.push("Rosetta already installed.");
    }
  }

  const reachabilityChecks = ["https://github.com", "https://ghcr.io"];
  for (const url of reachabilityChecks) {
    const result = await runCommand("curl", ["-Is", "--max-time", "6", url], {
      allowFailure: true,
    });
    if (result.code === 0) {
      details.push(`Reachability ok: ${url}`);
    } else {
      details.push(`Reachability failed: ${url}`);
      status = "partial";
    }
  }

  return { status, details };
}

async function hasBrew(): Promise<boolean> {
  const result = await runCommand("brew", ["--version"], {
    allowFailure: true,
  });
  return result.code === 0;
}

async function installBatch(
  title: string,
  targets: InstallTarget[],
  effective: EffectiveSetupConfig,
  logger: SetupLogger,
): Promise<{ status: StepStatus; details: string[] }> {
  console.log(chalk.bold(`\n${title}`));
  const details: string[] = [];
  let ok = 0;
  let failed = 0;
  let skipped = 0;

  for (const [index, target] of targets.entries()) {
    const status = await installTarget(
      target,
      index + 1,
      targets.length,
      effective,
      logger,
    );
    if (status === "success") {
      ok += 1;
    } else if (status === "failed") {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  details.push(`Success: ${ok}`);
  details.push(`Failed: ${failed}`);
  details.push(`Skipped: ${skipped}`);

  const status: StepStatus =
    failed > 0 && ok === 0 ? "failed"
    : failed > 0 ? "partial"
    : "success";

  return { status, details };
}

async function installTarget(
  target: InstallTarget,
  index: number,
  total: number,
  effective: EffectiveSetupConfig,
  logger: SetupLogger,
): Promise<"success" | "failed" | "skipped"> {
  const prefix = `[${index}/${total}]`;
  const spinner = ora(`${prefix} Checking ${target.name}`).start();

  const installed = await isInstalled(target);
  if (!effective.dryRun && installed) {
    spinner.succeed(chalk.green(`${prefix} ${target.name} already installed`));
    await logger.log(
      "debug",
      `${target.type}:${target.name}: already installed`,
    );
    return "skipped";
  }

  spinner.text = `${prefix} Installing ${target.name}`;
  const args =
    target.type === "cask" ?
      ["install", "--cask", target.name]
    : ["install", target.name];
  const result = await runCommand("brew", args, {
    dryRun: effective.dryRun,
    allowFailure: true,
  });

  if (result.code === 0) {
    spinner.succeed(chalk.green(`${prefix} Installed ${target.name}`));
    if (result.stdout.trim()) {
      console.log(chalk.dim(result.stdout));
    }
    await logger.log("info", `${target.type}:${target.name}: installed`);
    return "success";
  }

  spinner.fail(chalk.red(`${prefix} Failed to install ${target.name}`));
  const detail =
    result.stderr.trim() ||
    result.stdout.trim() ||
    "No details returned by brew.";
  console.log(chalk.yellow(detail));
  await logger.log("error", `${target.type}:${target.name}: ${detail}`);
  return "failed";
}

async function isInstalled(target: InstallTarget): Promise<boolean> {
  const args =
    target.type === "cask" ?
      ["list", "--cask", "--versions", target.name]
    : ["list", "--versions", target.name];
  const result = await runCommand("brew", args, { allowFailure: true });
  return result.code === 0 && result.stdout.trim().length > 0;
}

async function upsertManagedShellBlock(
  config: ShellBlockConfig,
  effective: EffectiveSetupConfig,
  logger: SetupLogger,
): Promise<{ status: StepStatus; details: string[] }> {
  const shellConfigPath = config.filePath;
  let existing = "";
  try {
    existing = await fs.readFile(shellConfigPath, "utf8");
  } catch {
    existing = "";
  }

  const block = [config.blockStart, ...config.lines, config.blockEnd, ""].join(
    "\n",
  );

  const pattern = new RegExp(
    `${escapeRegExp(config.blockStart)}[\\s\\S]*?${escapeRegExp(config.blockEnd)}\\n?`,
    "m",
  );

  const next =
    pattern.test(existing) ?
      existing.replace(pattern, `${block}`)
    : `${existing.trimEnd()}\n\n${block}`;

  if (effective.dryRun) {
    return {
      status: "success",
      details: [`Would update managed ${config.shell} shell block.`],
    };
  }

  await fs.mkdir(path.dirname(shellConfigPath), { recursive: true });
  await fs.writeFile(shellConfigPath, next, "utf8");
  await logger.log("info", `Updated managed shell block in ${shellConfigPath}`);
  return {
    status: "success",
    details: [`Managed ${config.shell} shell block updated.`],
  };
}

async function ensureManagedShellBlocks(
  effective: EffectiveSetupConfig,
  logger: SetupLogger,
): Promise<{ status: StepStatus; details: string[] }> {
  const home = os.homedir();
  const shellBlocks: ShellBlockConfig[] = [
    {
      shell: "zsh",
      filePath: path.join(home, ".zshrc"),
      blockStart: ZSH_SETUP_BLOCK_START,
      blockEnd: ZSH_SETUP_BLOCK_END,
      lines: [
        "if command -v brew >/dev/null 2>&1; then",
        '  HOMEBREW_PREFIX="$(brew --prefix)"',
        '  [ -f "$HOMEBREW_PREFIX/share/zsh-autosuggestions/zsh-autosuggestions.zsh" ] && source "$HOMEBREW_PREFIX/share/zsh-autosuggestions/zsh-autosuggestions.zsh"',
        '  [ -f "$HOMEBREW_PREFIX/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" ] && source "$HOMEBREW_PREFIX/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"',
        "fi",
        "if command -v starship >/dev/null 2>&1; then",
        '  eval "$(starship init zsh)"',
        "fi",
      ],
    },
    {
      shell: "bash",
      filePath: path.join(home, ".bash_profile"),
      blockStart: BASH_SETUP_BLOCK_START,
      blockEnd: BASH_SETUP_BLOCK_END,
      lines: [
        "if command -v brew >/dev/null 2>&1; then",
        '  eval "$(brew shellenv)"',
        "fi",
        "if command -v starship >/dev/null 2>&1; then",
        '  eval "$(starship init bash)"',
        "fi",
      ],
    },
    {
      shell: "fish",
      filePath: path.join(home, ".config/fish/config.fish"),
      blockStart: FISH_SETUP_BLOCK_START,
      blockEnd: FISH_SETUP_BLOCK_END,
      lines: [
        "if type -q brew",
        "  brew shellenv | source",
        "end",
        "if type -q starship",
        "  starship init fish | source",
        "end",
      ],
    },
  ];

  const details: string[] = [];
  let hasPartial = false;

  for (const shellBlock of shellBlocks) {
    const result = await upsertManagedShellBlock(shellBlock, effective, logger);
    details.push(...result.details);
    if (result.status !== "success") {
      hasPartial = true;
    }
  }

  return {
    status: hasPartial ? "partial" : "success",
    details,
  };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

async function collectVersionSummary(
  effective: EffectiveSetupConfig,
  logger: SetupLogger,
): Promise<{ status: StepStatus; details: string[] }> {
  const probes: Array<{ label: string; cmd: string; args: string[] }> = [
    { label: "git", cmd: "git", args: ["--version"] },
    { label: "node", cmd: "node", args: ["-v"] },
    { label: "python3", cmd: "python3", args: ["--version"] },
    { label: "pnpm", cmd: "pnpm", args: ["-v"] },
    { label: "bun", cmd: "bun", args: ["-v"] },
  ];

  const details: string[] = [];
  let failures = 0;

  for (const probe of probes) {
    const result: ExecResult = await runCommand(probe.cmd, probe.args, {
      dryRun: effective.dryRun,
      allowFailure: true,
    });

    if (result.code === 0) {
      const version = result.stdout || result.stderr || "ok";
      details.push(`${probe.label}: ${version}`);
    } else {
      failures += 1;
      details.push(`${probe.label}: unavailable`);
    }
  }

  for (const detail of details) {
    await logger.log("info", `Version check: ${detail}`);
  }

  return {
    status: failures > 0 ? "partial" : "success",
    details,
  };
}

async function resolveAppsModeFromPrompt(
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

function resolveSetupConfig(
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

async function readSetupConfig(
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

async function createSetupLogger(debug: boolean): Promise<SetupLogger> {
  const logsDir = path.join(os.homedir(), ".your", "logs");
  await fs.mkdir(logsDir, { recursive: true });
  const filePath = path.join(logsDir, `setup-${Date.now()}.log`);

  const log = async (level: LogLevel, message: string) => {
    if (level === "debug" && !debug) {
      return;
    }

    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}\n`;
    await fs.appendFile(filePath, line, "utf8");
  };

  await log("info", "Logger initialized");
  return { path: filePath, log };
}

function renderSetupSummary(results: StepResult[], logPath: string): void {
  console.log(chalk.bold("\n=== Setup summary ==="));

  for (const result of results) {
    const marker =
      result.status === "success" ? chalk.green("[ok]")
      : result.status === "partial" ? chalk.yellow("[warn]")
      : result.status === "failed" ? chalk.red("[fail]")
      : chalk.dim("[skip]");

    console.log(`${marker} ${result.name}`);
    for (const detail of result.details.slice(0, 3)) {
      console.log(chalk.dim(`  - ${detail}`));
    }
  }

  console.log(chalk.dim(`Log file: ${logPath}`));
}
