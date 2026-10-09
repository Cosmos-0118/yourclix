import { ui } from "../../core/ui.js";
import chalk from "chalk";
import { compactPath, terminalRule, terminalWidth, wrapText } from "../../core/format.js";
import { boundedBox } from "../../core/task-ui.js";

const RULE = () => chalk.dim(terminalRule(52));

export function printNetFixBanner(dryRun: boolean): void {
  const mode = dryRun ? chalk.yellow(" dry-run ") : chalk.cyan(" live ");
  ui.write(
    "\n" +
      boundedBox(
        [
          chalk.bold.white("your net fix"),
          "",
          chalk.dim("ARP flush · DNS & mDNS cache · DHCP refresh · Wi‑Fi soft-cycle when on Wi‑Fi."),
          chalk.dim("Uses ") +
            chalk.cyan.bold("==>") +
            chalk.dim(" section headers like ") +
            chalk.cyan("brew") +
            chalk.dim(" for scanability."),
        ].join("\n"),
        {
          title: mode,
          titleAlignment: "center",
          padding: { left: 2, right: 2, top: 0, bottom: 0 },
          margin: { top: 0, bottom: 0 },
          borderStyle: "round",
          borderColor: dryRun ? "yellow" : "cyan",
          dimBorder: false,
        },
      ),
  );
}

export function printNetFixPipelineHint(): void {
  ui.write(chalk.bold.cyan("\n==> ") + chalk.bold.white("Repair pipeline"));
  ui.write(RULE());
  const pipeline = "1 Sudo → 2 Route / iface → 3 ARP → 4 DNS → 5 mDNS → 6 DHCP → 7 Wi‑Fi";
  for (const line of wrapText(pipeline, Math.max(20, terminalWidth() - 4))) {
    ui.write(chalk.dim(`  ${line}`));
  }
  ui.write(RULE());
}

export interface NetPlistTarget {
  path: string;
  optional?: boolean;
}

export function printNetResetBanner(dryRun: boolean): void {
  const mode = dryRun ? chalk.yellow(" dry-run ") : chalk.hex("#e74c3c")(" live ");
  ui.write(
    "\n" +
      boundedBox(
        [
          chalk.bold.white("your net reset"),
          "",
          chalk.yellow("Destructive:") +
            chalk.dim(" backs up then removes selected SystemConfiguration plists."),
          chalk.dim("You may lose Wi‑Fi/Ethernet until macOS rebuilds preferences or you restore from backup."),
        ].join("\n"),
        {
          title: mode,
          titleAlignment: "center",
          padding: { left: 2, right: 2, top: 0, bottom: 0 },
          margin: { top: 0, bottom: 0 },
          borderStyle: "round",
          borderColor: dryRun ? "yellow" : "red",
          dimBorder: false,
        },
      ),
  );
}

export function printNetResetPlistTargets(targets: NetPlistTarget[]): void {
  ui.write(chalk.bold.cyan("\n==> ") + chalk.bold.white("Plist scope"));
  ui.write(RULE());
  for (const target of targets) {
    const raw = `${compactPath(target.path)}${target.optional ? "  (optional on newer macOS)" : ""}`;
    const lines = wrapText(raw, Math.max(20, terminalWidth() - 8));
    ui.write(`${chalk.dim("  ▸")} ${chalk.white(lines[0] ?? "")}`);
    for (const line of lines.slice(1)) {
      ui.write(`      ${chalk.white(line)}`);
    }
  }
  ui.write(RULE());
}

export function printNetBackupFooter(args: {
  backupDirMaterialized: boolean;
  backupPlanned: boolean;
  dryRun: boolean;
  backupDir: string;
}): void {
  const { backupDirMaterialized, backupPlanned, dryRun, backupDir } = args;

  if (backupDirMaterialized) {
    ui.write(
      "\n" +
        boundedBox(
          [
            chalk.bold.white("Backup"),
            "",
            chalk.dim("Path: ") + chalk.cyan(backupDir),
            "",
            chalk.dim(
              "Restore: copy files from backup → /Library/Preferences/SystemConfiguration/ (sudo), then reboot.",
            ),
          ].join("\n"),
          {
            title: chalk.bold.green(" ready "),
            titleAlignment: "left",
            borderStyle: "round",
            borderColor: "green",
            padding: { left: 1, right: 1, top: 0, bottom: 0 },
            margin: { top: 0, bottom: 0 },
          },
        ),
    );
    return;
  }

  if (dryRun && backupPlanned) {
    ui.write(
      "\n" +
        boundedBox(
          [
            chalk.bold.yellow("Dry-run"),
            "",
            chalk.dim("Backups would be written to:"),
            chalk.cyan(backupDir),
            chalk.dim("(no directory created on disk)"),
          ].join("\n"),
          {
            title: chalk.bold.yellow(" plan "),
            titleAlignment: "left",
            borderStyle: "round",
            borderColor: "yellow",
            padding: { left: 1, right: 1, top: 0, bottom: 0 },
            margin: { top: 0, bottom: 0 },
          },
        ),
    );
  }
}

export function printNetFixSuccess(): void {
  ui.write(
    "\n" +
      boundedBox(
        chalk.green(
          "Repair complete. Wi‑Fi or Ethernet may take a few seconds to settle.",
        ),
        {
          title: chalk.bold.white(" done "),
          titleAlignment: "left",
          borderStyle: "round",
          borderColor: "green",
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          margin: { top: 0, bottom: 0 },
        },
      ),
  );
}

export function printNetResetSuccess(): void {
  ui.write(
    "\n" +
      boundedBox(chalk.green("Network reset completed."), {
        title: chalk.bold.white(" done "),
        titleAlignment: "left",
        borderStyle: "round",
        borderColor: "green",
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        margin: { top: 0, bottom: 0 },
      }),
  );
}
