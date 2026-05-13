import { Command } from "commander";
import { executeUndo } from "../../services/undo/undo.js";

export function registerUndo(program: Command): void {
  program
    .command("undo")
    .description("Manage backups and restore deleted files")
    .usage("[command] [options]")
    .addCommand(
      new Command()
        .name("list")
        .description("List all available backups")
        .action(async () => {
          try {
            await executeUndo({ action: "list", dryRun: false });
          } catch (error) {
            console.error("Error listing backups:", error);
            process.exit(1);
          }
        }),
    )
    .addCommand(
      new Command()
        .name("restore")
        .description("Restore a backup by ID")
        .argument("<id>", "Backup ID (from `your undo list`)")
        .action(async (backupId: string) => {
          try {
            await executeUndo({
              id: backupId,
              action: "restore",
              dryRun: false,
            });
          } catch (error) {
            console.error("Error restoring backup:", error);
            process.exit(1);
          }
        }),
    )
    .addCommand(
      new Command()
        .name("prune")
        .description("Delete backups older than retention period")
        .option("--days <number>", "Retention days (default: 30)", "30")
        .option("-y, --yes", "Skip confirmation prompt")
        .action(async (options: any) => {
          try {
            const retentionDays = parseInt(options.days, 10);
            if (Number.isNaN(retentionDays) || retentionDays < 1) {
              console.error("Invalid days value. Must be >= 1");
              process.exit(1);
            }

            await executeUndo({
              retentionDays,
              action: "prune",
              dryRun: false,
              yes: Boolean(options.yes),
            });
          } catch (error) {
            console.error("Error pruning backups:", error);
            process.exit(1);
          }
        }),
    );
}
