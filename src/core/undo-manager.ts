import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";

/**
 * UndoManager: Central system for tracking and managing deletions
 * All destructive operations (clean, setup--undo, net reset) move files to backups
 * instead of permanently deleting them, enabling full recovery.
 */

export interface BackupMetadata {
  id: string;
  timestamp: number;
  timestampISO: string;
  command: string;
  args: string[];
  filesCount: number;
  byteSize: number;
  status: "completed" | "partial" | "failed";
  notes?: string;
}

export interface BackupRegistry {
  version: 1;
  lastUpdated: number;
  retentionDays: number;
  backups: BackupMetadata[];
}

export interface BackupItem {
  originalPath: string;
  relativePath: string;
  bytes: number;
}

const BACKUPS_DIR = path.join(os.homedir(), ".your-backups");
const REGISTRY_FILE = path.join(BACKUPS_DIR, ".registry.json");
const DEFAULT_RETENTION_DAYS = 30;

class UndoManager {
  private initialized: boolean = false;

  /**
   * Initialize undo system (creates directories if needed)
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(BACKUPS_DIR, { recursive: true });
      this.initialized = true;
    } catch (error) {
      console.error(chalk.red(`Failed to initialize backup directory: ${error}`));
      throw error;
    }
  }

  /**
   * Create a backup by moving files to a timestamped backup directory
   * Returns a BackupMetadata record that should be added to registry
   */
  async createBackup(
    filesToBackup: string[],
    command: string,
    args: string[] = [],
  ): Promise<BackupMetadata> {
    await this.init();

    if (filesToBackup.length === 0) {
      throw new Error("No files provided for backup");
    }

    const timestamp = Date.now();
    const id = `undo-${new Date(timestamp).toISOString().split("T")[0]}-${String(timestamp).slice(-5)}`;
    const backupDir = path.join(BACKUPS_DIR, id);

    try {
      await fs.mkdir(backupDir, { recursive: true });

      let totalBytes = 0;
      let successCount = 0;

      for (const filePath of filesToBackup) {
        try {
          // Get file stats before moving
          const stats = await fs.lstat(filePath);
          totalBytes += stats.size;

          // Create relative path structure in backup
          const homeDir = os.homedir();
          const relativePath = path.relative(homeDir, filePath);
          const backupPath = path.join(backupDir, relativePath);

          // Create parent directories
          await fs.mkdir(path.dirname(backupPath), { recursive: true });

          // Move file to backup
          await fs.rename(filePath, backupPath);
          successCount += 1;
        } catch (error) {
          console.warn(
            chalk.yellow(`  Warning: Failed to backup ${filePath}: ${error}`),
          );
        }
      }

      const metadata: BackupMetadata = {
        id,
        timestamp,
        timestampISO: new Date(timestamp).toISOString(),
        command,
        args,
        filesCount: successCount,
        byteSize: totalBytes,
        status: successCount === filesToBackup.length ? "completed" : "partial",
      };

      await this.addToRegistry(metadata);
      return metadata;
    } catch (error) {
      console.error(chalk.red(`Backup failed: ${error}`));
      throw error;
    }
  }

  /**
   * Restore a backup by moving files back from backup directory
   */
  async restoreBackup(backupId: string): Promise<number> {
    await this.init();

    const backupDir = path.join(BACKUPS_DIR, backupId);

    try {
      const stats = await fs.stat(backupDir);
      if (!stats.isDirectory()) {
        throw new Error(`Backup ${backupId} is not a directory`);
      }

      let restoredCount = 0;
      const homeDir = os.homedir();

      // Recursively restore all files
      const restoreRecursive = async (currentDir: string) => {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          const relativePath = path.relative(backupDir, fullPath);
          const targetPath = path.join(homeDir, relativePath);

          if (entry.isDirectory()) {
            await restoreRecursive(fullPath);
          } else {
            // Ensure parent directory exists
            await fs.mkdir(path.dirname(targetPath), { recursive: true });

            // Move back to original location (overwrite if exists)
            await fs.rename(fullPath, targetPath);
            restoredCount += 1;
          }
        }
      };

      await restoreRecursive(backupDir);

      // Remove now-empty backup directory
      await fs.rm(backupDir, { recursive: true, force: true });

      // Update registry - remove this backup
      await this.removeFromRegistry(backupId);

      return restoredCount;
    } catch (error) {
      console.error(chalk.red(`Restore failed: ${error}`));
      throw error;
    }
  }

  /**
   * Add a backup metadata record to the registry
   */
  private async addToRegistry(metadata: BackupMetadata): Promise<void> {
    const registry = await this.getRegistry();
    registry.backups.push(metadata);
    registry.lastUpdated = Date.now();
    await this.saveRegistry(registry);
  }

  /**
   * Remove a backup metadata record from the registry
   */
  private async removeFromRegistry(backupId: string): Promise<void> {
    const registry = await this.getRegistry();
    registry.backups = registry.backups.filter((b) => b.id !== backupId);
    registry.lastUpdated = Date.now();
    await this.saveRegistry(registry);
  }

  /**
   * List all available backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    await this.init();
    const registry = await this.getRegistry();
    return registry.backups;
  }

  /**
   * Get a specific backup by ID
   */
  async getBackup(backupId: string): Promise<BackupMetadata | null> {
    const backups = await this.listBackups();
    return backups.find((b) => b.id === backupId) || null;
  }

  /**
   * Cleanup old backups beyond retention period
   */
  async pruneOldBackups(retentionDays?: number): Promise<number> {
    await this.init();

    const registry = await this.getRegistry();
    const retention = retentionDays ?? registry.retentionDays;
    const cutoffTime = Date.now() - retention * 24 * 60 * 60 * 1000;
    const beforeCount = registry.backups.length;

    let prunedCount = 0;
    for (const backup of registry.backups) {
      if (backup.timestamp < cutoffTime) {
        const backupDir = path.join(BACKUPS_DIR, backup.id);
        try {
          await fs.rm(backupDir, { recursive: true, force: true });
          prunedCount += 1;
        } catch (error) {
          console.warn(
            chalk.yellow(`Failed to prune backup ${backup.id}: ${error}`),
          );
        }
      }
    }

    // Update registry
    registry.backups = registry.backups.filter(
      (b) => b.timestamp >= cutoffTime,
    );
    registry.lastUpdated = Date.now();
    await this.saveRegistry(registry);

    return prunedCount;
  }

  /**
   * Get the backup registry
   */
  private async getRegistry(): Promise<BackupRegistry> {
    try {
      const content = await fs.readFile(REGISTRY_FILE, "utf-8");
      return JSON.parse(content);
    } catch {
      // Registry doesn't exist yet, return new one
      return {
        version: 1,
        lastUpdated: Date.now(),
        retentionDays: DEFAULT_RETENTION_DAYS,
        backups: [],
      };
    }
  }

  /**
   * Save the backup registry
   */
  private async saveRegistry(registry: BackupRegistry): Promise<void> {
    const content = JSON.stringify(registry, null, 2);
    await fs.writeFile(REGISTRY_FILE, content, "utf-8");
  }

  /**
   * Get total size of all backups
   */
  async getTotalBackupSize(): Promise<number> {
    await this.init();

    try {
      const entries = await fs.readdir(BACKUPS_DIR);
      let totalBytes = 0;

      for (const entry of entries) {
        if (entry.startsWith("undo-")) {
          const dirPath = path.join(BACKUPS_DIR, entry);
          const stats = await fs.stat(dirPath);
          if (stats.isDirectory()) {
            totalBytes += await this.dirSize(dirPath);
          }
        }
      }

      return totalBytes;
    } catch (error) {
      console.warn(chalk.yellow(`Failed to calculate backup size: ${error}`));
      return 0;
    }
  }

  /**
   * Recursively calculate directory size
   */
  private async dirSize(dirPath: string): Promise<number> {
    let size = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          size += await this.dirSize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          size += stats.size;
        }
      }
    } catch (error) {
      // Silently ignore read errors
    }

    return size;
  }
}

// Export singleton instance
export const undoManager = new UndoManager();
