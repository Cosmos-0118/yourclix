import { ui } from "../../core/ui.js";
import { compactPath } from "../../core/format.js";

export function printNetFixBanner(dryRun: boolean): void {
  ui.notice(dryRun ? "Preview network repair" : "Network repair", [
    "Clear ARP and DNS caches, refresh DHCP, and soft-cycle Wi-Fi when applicable.",
  ]);
}

export interface NetPlistTarget {
  path: string;
  optional?: boolean;
}

export function printNetResetBanner(dryRun: boolean): void {
  ui.notice(
    dryRun ? "Preview network reset" : "Network reset",
    [
      "Selected SystemConfiguration files will be backed up, then removed.",
      "You may lose Wi-Fi or Ethernet until macOS rebuilds preferences or you restore the backup.",
    ],
    "warn",
  );
}

export function printNetResetPlistTargets(targets: NetPlistTarget[]): void {
  ui.list(
    "Files in scope",
    targets.map(
      (target) =>
        `${compactPath(target.path)}${target.optional ? " (optional on newer macOS)" : ""}`,
    ),
  );
}

export function printNetBackupFooter(args: {
  backupDirMaterialized: boolean;
  backupPlanned: boolean;
  dryRun: boolean;
  backupDir: string;
}): void {
  const { backupDirMaterialized, backupPlanned, dryRun, backupDir } = args;
  if (backupDirMaterialized) {
    ui.list("Backup", [
      `Path: ${backupDir}`,
      "Restore: copy the backup files to /Library/Preferences/SystemConfiguration/ with sudo, then reboot.",
    ]);
  } else if (dryRun && backupPlanned) {
    ui.list("Planned backup", [
      backupDir,
      "Preview only: no backup directory was created.",
    ]);
  }
}

export function printNetFixSuccess(dryRun = false): void {
  ui.note(
    dryRun
      ? "Preview finished; no repair was applied."
      : "Wi-Fi or Ethernet may take a few seconds to settle.",
  );
}

export function printNetResetSuccess(dryRun = false): void {
  ui.note(
    dryRun
      ? "Preview finished; no network reset was applied."
      : "Network reset completed.",
  );
}
