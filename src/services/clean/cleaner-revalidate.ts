import { buildCleanerHeuristicPolicy } from "../../managers/clean-heuristics-manager.js";
import type { CleanerOptions } from "../../core/types.js";
import type { ValidatedDeletionCandidate } from "./clean-heuristics.js";
import { inspectCleanerTarget, readCleanerActivity } from "./cleaner-safety.js";
import { readCleanerExclusions } from "./cleaner-exclusions.js";
import { getProjectArtifactSkipReason } from "./cleaner-project-guard.js";

/** Shared by backup and permanent removal; action choice cannot weaken checks. */
export async function createCleanerRevalidator(
  candidates: ValidatedDeletionCandidate[],
  options: Pick<CleanerOptions, "mode" | "olderThanDays">,
): Promise<(target: string) => Promise<string | null>> {
  const policy = buildCleanerHeuristicPolicy(
    options.mode,
    options.olderThanDays ?? 14,
  );
  policy.protectedPaths.push(...(await readCleanerExclusions(policy.home)));
  let activity = await readCleanerActivity();
  let activityCheckedAt = Date.now();
  const byPath = new Map(
    candidates.map((candidate) => [candidate.path, candidate]),
  );
  return async (target) => {
    if (Date.now() - activityCheckedAt > 2000) {
      activity = await readCleanerActivity();
      activityCheckedAt = Date.now();
    }
    const inspection = await inspectCleanerTarget(target, policy, activity);
    if (inspection.reason) return inspection.reason;
    const candidate = byPath.get(target);
    if (
      !candidate ||
      candidate.dev !== inspection.dev ||
      candidate.ino !== inspection.ino
    )
      return "path-changed-since-preview";
    if (candidate.category === "Developer Project Caches")
      return getProjectArtifactSkipReason(target);
    return null;
  };
}
