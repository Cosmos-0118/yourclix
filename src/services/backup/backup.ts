import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { bytesToHuman, pad } from "../../core/format.js";
import { pathSizeFast, removePath } from "../../core/fs-utils.js";
import { confirm } from "../../core/prompt.js";

const BACKUP_ROOT = path.join(os.homedir(), ".your-backups");

interface BackupEntry {
  name: string;
  fullPath: string;
  kind: "dir" | "file";
  sizeBytes: number;
  modifiedAt: Date;
}

async function readBackupEntries(): Promise<BackupEntry[]> {
  try {
    await fs.mkdir(BACKUP_ROOT, { recursive: true });
  } catch {
    return [];
  }

  const items = await fs.readdir(BACKUP_ROOT, { withFileTypes: true });
  const entries: BackupEntry[] = [];

  for (const item of items) {
    const fullPath = path.join(BACKUP_ROOT, item.name);
    const stats = await fs.stat(fullPath);
    const sizeBytes = await pathSizeFast(fullPath);

    entries.push({
      name: item.name,
      fullPath,
      kind: item.isDirectory() ? "dir" : "file",
      sizeBytes,
      modifiedAt: stats.mtime,
    });
  }

  entries.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  return entries;
}

function formatAgeDays(modifiedAt: Date): string {
  const ageMs = Date.now() - modifiedAt.getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  return `${ageDays}d`;
}

function isSafeBackupName(name: string): boolean {
  if (!name || name === "." || name === "..") {
    return false;
  }

  if (name.includes("/") || name.includes("\\")) {
    return false;
  }

  return true;
}

export async function listBackups(limit = 100): Promise<void> {
  const entries = await readBackupEntries();
  if (entries.length === 0) {
    console.log(chalk.yellow("No backups found."));
    console.log(chalk.dim(`Backup root: ${BACKUP_ROOT}`));
    return;
  }

  const shown = entries.slice(0, Math.max(1, limit));
  const totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);

  console.log(chalk.bold("Your backups"));
  for (const entry of shown) {
    const row = [
      pad(entry.kind.toUpperCase(), 4),
      pad(formatAgeDays(entry.modifiedAt), 5),
      pad(bytesToHuman(entry.sizeBytes), 9),
      entry.name,
    ].join(" ");
    console.log(`- ${row}`);
  }

  if (shown.length < entries.length) {
    console.log(
      chalk.dim(`Showing ${shown.length}/${entries.length} backups.`),
    );
  }

  console.log(chalk.cyan(`Total backup size: ${bytesToHuman(totalBytes)}`));
  console.log(chalk.dim(`Backup root: ${BACKUP_ROOT}`));
}

export async function removeBackup(
  name: string,
  dryRun = false,
  yes = false,
): Promise<void> {
  if (!isSafeBackupName(name)) {
    throw new Error(`Invalid backup name '${name}'.`);
  }

  const targetPath = path.join(BACKUP_ROOT, name);
  try {
    await fs.lstat(targetPath);
  } catch {
    throw new Error(`Backup not found: ${name}`);
  }

  const approved = await confirm(`Delete backup '${name}'?`, yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  if (dryRun) {
    console.log(chalk.dim(`Dry-run: would delete ${targetPath}`));
    return;
  }

  await removePath(targetPath, false);
  console.log(chalk.green(`Deleted backup: ${name}`));
}

export async function pruneBackups(
  olderThanDays: number,
  dryRun = false,
  yes = false,
): Promise<void> {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw new Error("--days must be a non-negative number.");
  }

  const entries = await readBackupEntries();
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const candidates = entries.filter(
    (entry) => entry.modifiedAt.getTime() < cutoff,
  );

  if (candidates.length === 0) {
    console.log(chalk.green(`No backups older than ${olderThanDays} day(s).`));
    return;
  }

  const reclaimable = candidates.reduce(
    (sum, entry) => sum + entry.sizeBytes,
    0,
  );

  console.log(chalk.bold("Backup prune candidates"));
  for (const entry of candidates.slice(0, 10)) {
    console.log(
      `- ${entry.name} (${bytesToHuman(entry.sizeBytes)}, ${formatAgeDays(entry.modifiedAt)} old)`,
    );
  }
  if (candidates.length > 10) {
    console.log(chalk.dim(`...and ${candidates.length - 10} more`));
  }
  console.log(chalk.cyan(`Reclaimable: ${bytesToHuman(reclaimable)}`));

  const approved = await confirm(
    `Delete ${candidates.length} backup item(s) older than ${olderThanDays} day(s)?`,
    yes,
  );
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  if (dryRun) {
    console.log(chalk.dim("Dry-run: no backups deleted."));
    return;
  }

  for (const entry of candidates) {
    await removePath(entry.fullPath, false);
  }

  console.log(chalk.green(`Deleted ${candidates.length} backup item(s).`));
}
