import boxen from "boxen";
import chalk from "chalk";
import { CASK_LABELS } from "./constants.js";
import type { AppsMode } from "./types.js";

export function formatCaskLabel(caskId: string): string {
  if (CASK_LABELS[caskId]) {
    return CASK_LABELS[caskId];
  }
  const leaf = caskId.includes("/") ? caskId.split("/").pop()! : caskId;
  return leaf
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function printDesktopAppBundlePreview(
  bundleName: AppsMode,
  casks: string[],
): void {
  if (casks.length === 0) {
    return;
  }

  const lines = casks.map(
    (id) =>
      `${chalk.cyan("  ▸")} ${chalk.bold.white(formatCaskLabel(id))} ${chalk.dim(`· ${id}`)}`,
  );

  console.log(
    boxen([chalk.gray("Homebrew will install:"), "", ...lines].join("\n"), {
      title: chalk.bold.white(` ${bundleName} bundle `),
      titleAlignment: "center",
      padding: { left: 1, right: 1, top: 0, bottom: 0 },
      margin: { top: 1, bottom: 0 },
      borderStyle: "round",
      borderColor: "cyan",
      dimBorder: false,
    }),
  );
}
