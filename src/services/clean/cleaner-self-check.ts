import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { CommandProgress } from "../../core/progress.js";
import { pathSizeFast } from "../../core/fs-utils.js";
import { bytesToHuman } from "../../core/format.js";
import type { CleanerOptions } from "../../core/types.js";
import { executeCleaner } from "./cleaner-execute.js";
import { scanCleanerTargets } from "./cleaner-scan.js";

export async function runCleanerSelfCheck(
  mode: CleanerOptions["mode"] = "basic",
): Promise<void> {
  const testDir = path.join(os.homedir(), "Library/Caches/yourclix-selfcheck");
  const testFile = path.join(testDir, "payload.bin");
  const progress = new CommandProgress("Cleaner Self-Check", 5);

  try {
    await progress.step("Creating temporary cache payload", async () => {
      await fs.rm(testDir, { recursive: true, force: true });
      await fs.mkdir(testDir, { recursive: true });
      const payload = Buffer.alloc(4 * 1024 * 1024, 1);
      await fs.writeFile(testFile, payload);
    });

    const createdBytes = await progress.step(
      "Measuring test payload size",
      async () => pathSizeFast(testDir),
    );
    progress.info(`Test payload size: ${bytesToHuman(createdBytes)}`);

    const scanResults = await progress.step("Running cleaner scan", async () =>
      scanCleanerTargets(mode),
    );
    const foundInCategory = scanResults.find((entry) =>
      entry.paths.includes(testDir),
    );

    if (!foundInCategory) {
      throw new Error(
        "Self-check failed: test cache path was not detected by scanner.",
      );
    }

    progress.info(`Detected in category: ${foundInCategory.category}`);

    await progress.step("Executing targeted cleanup", async () =>
      executeCleaner(
        [
          {
            category: "Self-Check Test",
            paths: [testDir],
            bytes: createdBytes,
          },
        ],
        { mode, dryRun: false, yes: true },
      ),
    );

    await progress.step("Verifying deletion outcome", async () => {
      const stillExists = await fs
        .lstat(testDir)
        .then(() => true)
        .catch(() => false);

      if (stillExists) {
        throw new Error(
          "Self-check failed: test cache path still exists after cleanup.",
        );
      }
    });

    console.log(chalk.green("Cleaner self-check passed."));
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}
