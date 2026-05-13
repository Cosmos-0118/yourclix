import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BASH_SETUP_BLOCK_END,
  BASH_SETUP_BLOCK_START,
  FISH_SETUP_BLOCK_END,
  FISH_SETUP_BLOCK_START,
  ZSH_SETUP_BLOCK_END,
  ZSH_SETUP_BLOCK_START,
} from "./constants.js";
import type {
  EffectiveSetupConfig,
  SetupLogger,
  ShellBlockConfig,
  StepStatus,
} from "./types.js";

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
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

export async function ensureManagedShellBlocks(
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
