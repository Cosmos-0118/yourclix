import { Command } from "commander";
import { listBackups, pruneBackups, removeBackup } from "../services/backup.js";
import { withGlobalOptions } from "./helpers.js";

export function registerBackup(program: Command): void {
  const backup = program.command("backup").description("Backup manager");

  backup
    .command("list")
    .description("List backups created by your")
    .option("--limit <count>", "max rows to show", "100")
    .action(async (options) => {
      const limit = Number.parseInt(options.limit, 10);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error("--limit must be a positive number.");
      }
      await listBackups(limit);
    });

  withGlobalOptions(
    backup
      .command("remove")
      .description("Delete a single backup item")
      .argument("<name>", "backup folder/file name from backup list"),
  ).action(async (name: string, options) => {
    await removeBackup(name, Boolean(options.dryRun), Boolean(options.yes));
  });

  withGlobalOptions(
    backup
      .command("prune")
      .description("Delete backup items older than N days")
      .option("--days <days>", "age threshold in days", "30"),
  ).action(async (options) => {
    const days = Number.parseInt(options.days, 10);
    await pruneBackups(days, Boolean(options.dryRun), Boolean(options.yes));
  });
}
