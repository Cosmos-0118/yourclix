import fs from "node:fs/promises";
import os from "node:os";
import { ui } from "../../core/ui.js";
import { compactPath } from "../../core/format.js";
import type { CleanerOptions } from "../../core/types.js";
import type { ValidatedDeletionCandidate } from "./clean-heuristics.js";
import type { BackupOutcome } from "./cleaner-execute.js";
import { createCleanerRevalidator } from "./cleaner-revalidate.js";

async function availableBytes(): Promise<number | undefined> {
  try {
    const stats = await fs.statfs(os.homedir());
    return stats.bavail * stats.bsize;
  } catch {
    return undefined;
  }
}

/** Explicit permanent mode only. Never creates an undo registry or backup. */
export async function runCleanerPermanentDeletion(
  candidates: ValidatedDeletionCandidate[],
  options: Pick<CleanerOptions, "mode" | "dryRun" | "olderThanDays">,
): Promise<BackupOutcome> {
  if (options.dryRun)
    return {
      deletedCount: candidates.length,
      reclaimedBytes: candidates.reduce(
        (n, candidate) => n + candidate.bytes,
        0,
      ),
      backupId: null,
      backupWarnings: [],
      status: "success",
    };
  const validate = await createCleanerRevalidator(candidates, options);
  const before = await availableBytes();
  const warnings: string[] = [];
  let deletedCount = 0;
  let bytes = 0;
  for (const candidate of candidates) {
    ui.throwIfCancelled();
    const reason = await validate(candidate.path);
    if (reason) {
      warnings.push(`Kept ${compactPath(candidate.path)}: ${reason}`);
      continue;
    }
    try {
      await fs.rm(candidate.path, {
        recursive: true,
        force: false,
        maxRetries: 0,
      });
      // A running application may recreate the root during removal. Do not
      // claim it is gone when the final filesystem check says otherwise.
      let remains = true;
      try {
        await fs.lstat(candidate.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        remains = false;
      }
      if (remains) throw new Error("path was recreated during removal");
      deletedCount++;
      bytes += candidate.bytes;
    } catch (error) {
      ui.throwIfCancelled();
      const reason =
        (error as NodeJS.ErrnoException).code ??
        (error instanceof Error ? error.message : String(error));
      warnings.push(
        `Permanent removal incomplete for ${compactPath(candidate.path)}: ${reason}. Some contents may already have been removed.`,
      );
    }
  }
  return {
    deletedCount,
    reclaimedBytes: bytes,
    backupId: null,
    backupWarnings: warnings,
    status: warnings.length ? (deletedCount ? "partial" : "failed") : "success",
    details: warnings,
    availableBefore: before,
    availableAfter: await availableBytes(),
  };
}
