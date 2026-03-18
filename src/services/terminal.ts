import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { confirm } from "../core/prompt.js";

type ShellName = "zsh" | "bash" | "fish" | "unknown";

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

export async function runTerminalClean(
  dryRun = false,
  yes = false,
  clearHistory = false,
): Promise<void> {
  console.log(chalk.bold("Running terminal clean..."));

  if (dryRun) {
    console.log(
      chalk.dim("Dry-run: would clear terminal screen and scrollback."),
    );
  } else {
    // Reset terminal state and clear viewport + scrollback in most terminals.
    process.stdout.write("\u001bc");
  }

  console.log(chalk.green("Terminal viewport cleaned."));

  if (!clearHistory) {
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
    `Also clear shell history file (${historyPath})?`,
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
      "Note: current interactive session history may persist until you restart the shell.",
    ),
  );
}
