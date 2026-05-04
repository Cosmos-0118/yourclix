import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import boxen from "boxen";
import chalk from "chalk";
import { confirm } from "../core/prompt.js";

type ShellName = "zsh" | "bash" | "fish" | "unknown";

const ESC = "\x1b";

function detectShell(): ShellName {
  const shellPath = process.env.SHELL ?? "";
  const shell = path.basename(shellPath).toLowerCase();

  if (shell === "zsh" || shell === "bash" || shell === "fish") {
    return shell;
  }

  return "unknown";
}

function getHistoryPath(shell: ShellName): string | null {
  const home = os.homedir();

  if (shell === "zsh") {
    return path.join(home, ".zsh_history");
  }

  if (shell === "bash") {
    return path.join(home, ".bash_history");
  }

  if (shell === "fish") {
    return path.join(home, ".local", "share", "fish", "fish_history");
  }

  return null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface DeepCleanResult {
  applied: boolean;
  steps: string[];
}

/**
 * Perform a deep terminal reset: scrollback, visible screen, then optional full RIS.
 * Intended to feel closer to opening a new terminal tab than a simple `clear`.
 */
function performDeepTerminalClean(options: {
  dryRun: boolean;
  soft: boolean;
}): DeepCleanResult {
  const steps: string[] = [];

  if (options.dryRun) {
    steps.push("iTerm: clear scrollback (if iTerm.app)");
    steps.push("Erase scrollback buffer (CSI 3 J)");
    steps.push("Erase display + cursor home (CSI 2 J + CSI H)");
    if (!options.soft) {
      steps.push("Full terminal reset — RIS (ESC c), restore modes/fonts/colors");
    } else {
      steps.push("(Soft mode: skip RIS — keeps some terminal modes intact)");
    }
    return { applied: false, steps };
  }

  if (!process.stdout.isTTY) {
    return {
      applied: false,
      steps: ["Skipped escape sequences (stdout is not a TTY — open a real terminal window)"],
    };
  }

  if (process.env.TERM_PROGRAM === "iTerm.app") {
    process.stdout.write(`${ESC}]1337;ClearScrollback\x07`);
    steps.push("iTerm scrollback buffer cleared");
  }

  process.stdout.write(`${ESC}[3J`);
  steps.push("Scrollback buffer cleared (CSI 3 J)");

  process.stdout.write(`${ESC}[2J${ESC}[H`);
  steps.push("Screen erased; cursor at home (CSI 2 J + CSI H)");

  if (!options.soft) {
    process.stdout.write("\x1bc");
    steps.push("Full terminal reset (RIS) — like a fresh session");
  } else {
    steps.push("Soft mode: RIS skipped (use without --soft for full reset)");
  }

  return { applied: true, steps };
}

export async function runTerminalClean(
  dryRun = false,
  yes = false,
  clearHistory = false,
  soft = false,
): Promise<void> {
  console.log(chalk.bold("Terminal deep clean"));

  const result = performDeepTerminalClean({ dryRun, soft });

  if (dryRun) {
    console.log(
      boxen(
        [
          chalk.yellow.bold("Dry run"),
          "",
          ...result.steps.map((s) => chalk.dim(`• ${s}`)),
        ].join("\n"),
        {
          borderStyle: "round",
          borderColor: "yellow",
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          margin: { top: 0, bottom: 0 },
        },
      ),
    );
  } else if (result.applied) {
    console.log(
      boxen(
        [
          chalk.green.bold("Terminal reset"),
          "",
          ...result.steps.map((s) => chalk.white(`• ${s}`)),
          "",
          chalk.dim(
            soft ?
              "Tip: omit --soft for a full hardware-style reset (RIS)."
            : "Tip: use --soft in tmux/SSH if the display glitches after reset.",
          ),
        ].join("\n"),
        {
          title: chalk.cyan(" like a new terminal "),
          titleAlignment: "center",
          borderStyle: "round",
          borderColor: "green",
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          margin: { top: 0, bottom: 0 },
        },
      ),
    );
  } else {
    for (const line of result.steps) {
      console.log(chalk.yellow(line));
    }
  }

  if (!clearHistory) {
    if (!dryRun && result.applied) {
      console.log(
        chalk.dim(
          "Shell command history on disk is unchanged. Pass --history to archive and clear it.",
        ),
      );
    }
    return;
  }

  const shell = detectShell();
  const historyPath = getHistoryPath(shell);

  if (!historyPath) {
    console.log(
      chalk.yellow(
        "Could not detect shell history file automatically. Skipping history cleanup.",
      ),
    );
    return;
  }

  const approved = await confirm(
    `Also clear on-disk shell history?\n  ${chalk.dim(historyPath)}`,
    yes,
  );
  if (!approved) {
    console.log(chalk.yellow("History cleanup cancelled by user."));
    return;
  }

  const hasHistoryFile = await exists(historyPath);
  if (!hasHistoryFile) {
    console.log(chalk.yellow(`History file not found: ${historyPath}`));
    return;
  }

  const backupDir = path.join(
    os.homedir(),
    ".your-backups",
    `terminal-history-${Date.now()}`,
  );
  const backupPath = path.join(backupDir, path.basename(historyPath));

  if (dryRun) {
    console.log(chalk.dim(`Dry-run: would back up history to ${backupPath}`));
    console.log(chalk.dim(`Dry-run: would truncate ${historyPath}`));
  } else {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(historyPath, backupPath);
    await fs.writeFile(historyPath, "", "utf8");
  }

  console.log(chalk.green(`History cleaned. Backup: ${backupPath}`));
  console.log(
    chalk.dim(
      "Current session may still remember commands until you open a new terminal tab.",
    ),
  );
}
