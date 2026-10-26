import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ui } from "../../core/ui.js";
import { bytesToHuman } from "../../core/format.js";
import type { CleanerOptions } from "../../core/types.js";
import { preflightCleaner } from "./cleaner-execute.js";
import { scanCleanerTargets } from "./cleaner-scan.js";

/** Verify discovery and retention in an isolated fixture, never real user caches. */
export async function runCleanerSelfCheck(
  mode: CleanerOptions["mode"] = "basic",
): Promise<void> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "yourclix-selfcheck-"));
  const cache = path.join(home, "Library/Caches/test-app");
  try {
    await ui.task("Create isolated cache fixture", async () => {
      await fs.mkdir(cache, { recursive: true });
      const payload = path.join(cache, "payload.bin");
      await fs.writeFile(payload, Buffer.alloc(1024 * 1024, 1));
      const old = new Date(Date.now() - 90 * 86400000);
      await fs.utimes(payload, old, old);
      await fs.utimes(cache, old, old);
    });
    const context = { home, tmpDir: home };
    const results = await ui.task("Verify cache discovery", () =>
      scanCleanerTargets(mode, {}, context),
    );
    if (!results.some((result) => result.paths.includes(cache)))
      throw new Error("Self-check: fixture was not discovered.");
    const fixture = { context, activity: { paths: [], available: true } };
    const check = await ui.task("Verify content retention", () =>
      preflightCleaner(results, { mode, olderThanDays: 14 }, fixture),
    );
    if (!check.candidates.some((candidate) => candidate.path === cache))
      throw new Error(
        `Self-check: old fixture was not eligible (${check.skipped.map((item) => item.reason).join(", ")}).`,
      );
    await fs.writeFile(path.join(cache, "recent.bin"), "keep");
    const recent = await preflightCleaner(
      results,
      { mode, olderThanDays: 14 },
      fixture,
    );
    if (recent.candidates.some((candidate) => candidate.path === cache))
      throw new Error("Self-check: recent contents were not protected.");
    ui.notice("Cleaner scan and safety self-check passed", [
      `Verified ${bytesToHuman(check.eligibleBytes)} of fixture data; recent contents were kept.`,
      "No real cache data or undo backups were changed.",
    ]);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}
