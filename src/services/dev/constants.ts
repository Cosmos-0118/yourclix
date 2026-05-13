import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEV_CLEAN_PROJECT_ROOTS = [
  "Developer",
  "Projects",
  "Code",
  "Work",
  "Desktop",
  "Downloads",
];

export const DEV_CLEAN_SKIP_DIRS = new Set([
  ".git",
  ".Trash",
  "Library",
  "Applications",
  "Movies",
  "Music",
  "Pictures",
  "Public",
  "Volumes",
  "node_modules",
]);

export const DEV_CLEAN_MAX_TARGETS = 2500;
export const DEV_CLEAN_MAX_DEPTH = 8;
export const DEV_INSTALL_SOURCE_ROOT = path.join(os.homedir(), ".your", "source");
export const DEV_CURRENT_PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
