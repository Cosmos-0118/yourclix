import boxen from "boxen";
import chalk from "chalk";

const RULE = chalk.dim("─".repeat(52));

export function printNetFixBanner(dryRun: boolean): void {
  const mode = dryRun ? chalk.yellow(" dry-run ") : chalk.cyan(" live ");
  console.log(
    "\n" +
      boxen(
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
  console.log(chalk.bold.cyan("\n==> ") + chalk.bold.white("Repair pipeline"));
  console.log(RULE);
  console.log(
    `  ${chalk.green("1")} ${chalk.bold("Sudo")}  ${chalk.dim("→")}  ` +
      `${chalk.green("2")} ${chalk.bold("Route / iface")}  ${chalk.dim("→")}  ` +
      `${chalk.green("3")} ${chalk.bold("ARP")}  ${chalk.dim("→")}  ` +
      `${chalk.green("4")} ${chalk.bold("DNS")}  ${chalk.dim("→")}  ` +
      `${chalk.green("5")} ${chalk.bold("mDNS")}  ${chalk.dim("→")}  ` +
      `${chalk.green("6")} ${chalk.bold("DHCP")}  ${chalk.dim("→")}  ` +
      `${chalk.green("7")} ${chalk.bold("Wi‑Fi")}`,
  );
  console.log(RULE);
}

export interface NetPlistTarget {
  path: string;
  optional?: boolean;
}

export function printNetResetBanner(dryRun: boolean): void {
  const mode = dryRun ? chalk.yellow(" dry-run ") : chalk.hex("#e74c3c")(" live ");
  console.log(
    "\n" +
      boxen(
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
  console.log(chalk.bold.cyan("\n==> ") + chalk.bold.white("Plist scope"));
  console.log(RULE);
  for (const target of targets) {
    const tag = target.optional ? chalk.dim("  (optional on newer macOS)") : "";
    console.log(
      `${chalk.dim("  ▸")} ${chalk.white(target.path)}${tag}`,
    );
  }
  console.log(RULE);
}

export function printNetBackupFooter(args: {
  backupDirMaterialized: boolean;
  backupPlanned: boolean;
  dryRun: boolean;
  backupDir: string;
}): void {
  const { backupDirMaterialized, backupPlanned, dryRun, backupDir } = args;

  if (backupDirMaterialized) {
    console.log(
      "\n" +
        boxen(
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
    console.log(
      "\n" +
        boxen(
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
  console.log(
    "\n" +
      boxen(
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
  console.log(
    "\n" +
      boxen(chalk.green("Network reset completed."), {
        title: chalk.bold.white(" done "),
        titleAlignment: "left",
        borderStyle: "round",
        borderColor: "green",
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        margin: { top: 0, bottom: 0 },
      }),
  );
}
