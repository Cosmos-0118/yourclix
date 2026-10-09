import { ui } from "../../core/ui.js";
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

  ui.list(
    `${bundleName} apps to install`,
    casks.map((id) => `${formatCaskLabel(id)} · ${id}`),
  );
}
