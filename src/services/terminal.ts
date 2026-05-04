import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import { writeSync } from "node:fs";
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort synchronous write so escape sequences apply before Node exits. */
function ttyWrite(data: string): void {
  if (!process.stdout.isTTY) {
    return;
  }
  try {
    writeSync(1, data);
  } catch {
    process.stdout.write(data);
  }
}

/**
 * Clear scrollback + screen + optional RIS. No console output — must stay silent
 * so the display stays empty after this runs.
 */
/** Terminfo-driven clear so the emulator applies the right erase ops for this TERM. */
function tryTerminfoClear(): void {
  for (const bin of ["/usr/bin/clear", "/bin/clear"]) {
    try {
      execSync(bin, { stdio: "inherit", env: process.env });
      return;
    } catch {
      /* try next */
    }
  }
  try {
    execSync("tput clear", { stdio: "inherit", env: process.env, shell: "/bin/sh" });
  } catch {
    /* escapes already sent */
  }
}

function performSilentTerminalClean(soft: boolean): void {
  if (!process.stdout.isTTY) {
    return;
  }

  if (process.env.TERM_PROGRAM === "iTerm.app") {
    ttyWrite(`${ESC}]1337;ClearScrollback\x07`);
  }

  ttyWrite(`${ESC}[3J`);
  ttyWrite(`${ESC}[2J${ESC}[H`);

  if (!soft) {
    ttyWrite("\x1bc");
  }

  tryTerminfoClear();
}

export async function runTerminalClean(
  dryRun = false,
  yes = false,
  clearHistory = false,
  soft = false,
): Promise<void> {
  if (dryRun) {
    const steps = [
      process.env.TERM_PROGRAM === "iTerm.app" ?
        "iTerm: CSI ? Clear scrollback"
      : null,
      "CSI 3 J — erase scrollback",
      "CSI 2 J + CSI H — erase screen, cursor home",
      soft ? "(soft: skip RIS)" : "ESC c — full terminal reset (RIS)",
      "clear(1) or tput clear — terminfo sync for this TERM",
    ].filter(Boolean) as string[];

    console.log(
      boxen(
        [
          chalk.yellow.bold("Dry run — no escape codes sent"),
          "",
          ...steps.map((s) => chalk.dim(`• ${s}`)),
        ].join("\n"),
        {
          borderStyle: "round",
          borderColor: "yellow",
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          margin: { top: 0, bottom: 0 },
        },
      ),
    );

    if (clearHistory) {
      console.log(
        chalk.dim(
          "With --history: would prompt, back up ~/.zsh_history (etc.), then clear the screen.",
        ),
      );
    }
    return;
  }

  if (!process.stdout.isTTY) {
    console.error(
      chalk.yellow(
        "your terminal: stdout is not a TTY — open an interactive terminal window.",
      ),
    );
    return;
  }

  // Optional history handling before we wipe the viewport (nothing printed after clear).
  if (clearHistory) {
    const shell = detectShell();
    const historyPath = getHistoryPath(shell);

    if (!historyPath) {
      console.error(
        chalk.yellow(
          "Could not detect shell history path; skipping --history. Clearing terminal only.",
        ),
      );
    } else {
      const approved = await confirm(
        `Clear shell history file?\n  ${chalk.dim(historyPath)}`,
        yes,
      );

      if (!approved) {
        console.error(chalk.yellow("History cleanup cancelled."));
        performSilentTerminalClean(soft);
        return;
      }

      const hasHistoryFile = await pathExists(historyPath);
      if (!hasHistoryFile) {
        console.error(
          chalk.yellow(`History file not found: ${historyPath}`),
        );
        performSilentTerminalClean(soft);
        return;
      }

      const backupDir = path.join(
        os.homedir(),
        ".your-backups",
        `terminal-history-${Date.now()}`,
      );
      const backupPath = path.join(backupDir, path.basename(historyPath));

      await fs.mkdir(backupDir, { recursive: true });
      await fs.copyFile(historyPath, backupPath);
      await fs.writeFile(historyPath, "", "utf8");
      // Intentionally no success line — next step clears the screen.
    }
  }

  performSilentTerminalClean(soft);
}
