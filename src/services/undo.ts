import chalk from "chalk";
import { undoManager } from "../core/undo-manager.js";
import { bytesToHuman, pad } from "../core/format.js";
import type { UndoOptions } from "../core/types.js";

/**
 * Undo service: Handles restoration of backed-up files
 */

export async function listUndoHistory(): Promise<void> {
  const backups = await undoManager.listBackups();

  if (backups.length === 0) {
    console.log(chalk.yellow("No undo history available."));
    return;
  }

  console.log(chalk.bold("Undo History"));
  console.log(
    pad("ID", 35) +
      pad("Command", 15) +
      pad("Files", 8) +
      pad("Size", 10) +
      "Date",
  );
  console.log("-".repeat(85));

  for (const backup of backups) {
    const dateStr = new Date(backup.timestamp).toLocaleDateString("en-US", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    console.log(
      pad(backup.id, 35) +
        pad(backup.command, 15) +
        pad(String(backup.filesCount), 8) +
        pad(bytesToHuman(backup.byteSize), 10) +
        dateStr,
    );
  }

  const totalSize = await undoManager.getTotalBackupSize();
  console.log(chalk.dim(`Total backup size: ${bytesToHuman(totalSize)}`));
}

export async function restoreUndoById(backupId: string): Promise<void> {
  const backup = await undoManager.getBackup(backupId);

  if (!backup) {
    console.log(
      chalk.red(`Backup ${backupId} not found. Run 'your undo list' to see available backups.`),
    );
    return;
  }

  console.log(chalk.cyan(`Restoring backup: ${backupId}`));
  console.log(chalk.dim(`  Command: ${backup.command}`));
  console.log(chalk.dim(`  Files: ${backup.filesCount}`));
  console.log(chalk.dim(`  Size: ${bytesToHuman(backup.byteSize)}`));

  const restoredCount = await undoManager.restoreBackup(backupId);
  console.log(
    chalk.green(
      `✓ Restored ${restoredCount} files from backup ${backupId}`,
    ),
  );
}

export async function pruneOldBackups(retentionDays: number): Promise<void> {
  const prunedCount = await undoManager.pruneOldBackups(retentionDays);

  if (prunedCount === 0) {
    console.log(chalk.dim(`No backups older than ${retentionDays} days found.`));
    return;
  }

  console.log(
    chalk.green(
      `✓ Pruned ${prunedCount} backup(s) older than ${retentionDays} days`,
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
        console.log(chalk.red("Backup ID required. Use: your undo restore <id>"));
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
