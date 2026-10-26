import fs from "node:fs/promises";
import path from "node:path";

/** User exclusions only add protection; an unreadable list must never be ignored. */
export async function readCleanerExclusions(home: string): Promise<string[]> {
  const config = path.join(home, ".your-config/cleaner-excludes.json");
  let raw: string;
  let exists = false;
  try {
    const stat = await fs.lstat(config);
    exists = true;
    if (stat.size > 65536) throw new Error("exclusion file exceeds 64 KiB");
    raw = await fs.readFile(config, "utf8");
  } catch (error) {
    if (!exists && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      `Cannot read cleaner exclusions at ${config}; cleanup stopped to preserve protected paths.`,
    );
  }
  try {
    const entries: unknown = JSON.parse(raw);
    if (
      !Array.isArray(entries) ||
      !entries.every(
        (value) =>
          typeof value === "string" &&
          (value === "~" || value.startsWith("~/") || path.isAbsolute(value)),
      )
    )
      throw new Error("expected absolute or home-relative paths");
    return [
      ...new Set(
        entries.map((value) =>
          path.resolve(
            value === "~"
              ? home
              : value.startsWith("~/")
                ? path.join(home, value.slice(2))
                : value,
          ),
        ),
      ),
    ];
  } catch {
    throw new Error(
      `Invalid cleaner exclusions at ${config}; expected a JSON array of absolute or ~/ paths. Cleanup stopped.`,
    );
  }
}
