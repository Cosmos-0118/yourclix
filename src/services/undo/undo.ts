import { ui } from "../../core/ui.js";
import chalk from "chalk";
import { undoManager } from "../../core/undo-manager.js";
import {
  bytesToHuman,
  pad,
  pluralize,
  terminalRule,
  terminalWidth,
  wrapText,
} from "../../core/format.js";
import type { UndoOptions } from "../../core/types.js";

/**
 * Undo service: Handles restoration of backed-up files
 */

export async function listUndoHistory(): Promise<void> {
  const backups = await undoManager.listBackups();

  if (backups.length === 0) {
    ui.write(chalk.yellow("No undo history available."));
    return;
  }

  ui.write(chalk.bold("Undo History"));
  const wide = terminalWidth() >= 100;
  if (wide) {
    ui.write(
      pad("ID", 35) +
        pad("Command", 15) +
        pad("Files", 8) +
        pad("Size", 10) +
        "Date",
    );
    ui.write(terminalRule(85));
  }

  for (const backup of backups) {
    const dateStr = new Date(backup.timestamp).toLocaleDateString("en-US", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    if (wide) {
      ui.write(
        pad(backup.id, 35) +
          pad(backup.command, 15) +
          pad(String(backup.filesCount), 8) +
          pad(bytesToHuman(backup.byteSize), 10) +
          dateStr,
      );
    } else {
      ui.write(wrapText(
        `- ${backup.id} · ${backup.command} · ${backup.filesCount} files · ${bytesToHuman(backup.byteSize)} · ${dateStr}`,
        Math.max(20, terminalWidth() - 2),
      ).join("\n"));
    }
  }

  const totalSize = await undoManager.getTotalBackupSize();
  ui.write(chalk.dim(`Total backup size: ${bytesToHuman(totalSize)}`));
}

export async function restoreUndoById(backupId: string): Promise<void> {
  const backup = await undoManager.getBackup(backupId);

  if (!backup) {
    ui.write(
      chalk.red(`Backup ${backupId} not found. Run 'your undo list' to see available backups.`),
    );
    return;
  }

  ui.write(chalk.cyan(`Restoring backup: ${backupId}`));
  ui.write(chalk.dim(`  Command: ${backup.command}`));
  ui.write(chalk.dim(`  Files: ${backup.filesCount}`));
  ui.write(chalk.dim(`  Size: ${bytesToHuman(backup.byteSize)}`));

  const restoredCount = await undoManager.restoreBackup(backupId);
  ui.write(
    chalk.green(
      `✓ Restored ${restoredCount} files from backup ${backupId}`,
    ),
  );
}

export async function pruneOldBackups(retentionDays: number): Promise<void> {
  const prunedCount = await undoManager.pruneOldBackups(retentionDays);

  if (prunedCount === 0) {
    ui.write(chalk.dim(`No backups older than ${retentionDays} days found.`));
    return;
  }

  ui.write(
    chalk.green(
      `✓ Pruned ${pluralize(prunedCount, "backup")} older than ${retentionDays} days`,
    ),
  );
}

export async function executeUndo(options: UndoOptions & { action: "list" | "restore" | "prune" }): Promise<void> {
  switch (options.action) {
    case "list":
      await listUndoHistory();
      break;

    case "restore":
      if (!options.id) {
        ui.write(chalk.red("Backup ID required. Use: your undo restore <id>"));
        return;
      }
      await restoreUndoById(options.id);
      break;

    case "prune":
      const retention = options.retentionDays ?? 30;
      await pruneOldBackups(retention);
      break;
  }
}
