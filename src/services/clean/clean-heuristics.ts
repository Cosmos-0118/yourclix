import type { RunLevel } from "../../core/types.js";
import { askNumber } from "../../core/prompt.js";
import {
  buildCleanerHeuristicPolicy,
  getDefaultRetentionDays,
  isProtectedCleanupPath,
  normalizeRetentionDays,
  type CleanerHeuristicPolicy,
} from "../../managers/clean-heuristics-manager.js";

export interface HeuristicSkipRecord {
  path: string;
  reason: string;
  category?: string;
  bytes?: number;
  mtimeMs?: number;
}

export interface ValidatedDeletionCandidate {
  path: string;
  category: string;
  bytes: number;
  mtimeMs: number;
}

interface RetentionInput {
  mode: RunLevel;
  rawDays?: number | string;
  assumeYes?: boolean;
}

interface HeuristicFilterResult {
  candidates: ValidatedDeletionCandidate[];
  skipped: HeuristicSkipRecord[];
}

export async function resolveRetentionDays(
  input: RetentionInput,
): Promise<number> {
  const defaultDays = getDefaultRetentionDays(input.mode);

  if (input.rawDays !== undefined) {
    const parsed = Number.parseInt(String(input.rawDays), 10);
    if (!Number.isFinite(parsed)) {
      throw new Error(
        "Invalid value for --days. Please provide a whole number.",
      );
    }

    return normalizeRetentionDays(parsed, input.mode);
  }

  const selected = await askNumber(
    `Delete items older than how many days for ${input.mode.toUpperCase()} cleanup?`,
    {
      defaultValue: defaultDays,
      min: 1,
      max: 3650,
      assumeDefault: Boolean(input.assumeYes),
    },
  );

  return normalizeRetentionDays(selected, input.mode);
}

export function getCleanerHeuristicPolicy(
  mode: RunLevel,
  olderThanDays: number,
): CleanerHeuristicPolicy {
  return buildCleanerHeuristicPolicy(mode, olderThanDays);
}

export function applyCleanerHeuristics(
  candidates: ValidatedDeletionCandidate[],
  policy: CleanerHeuristicPolicy,
): HeuristicFilterResult {
  const kept: ValidatedDeletionCandidate[] = [];
  const skipped: HeuristicSkipRecord[] = [];
  const now = Date.now();

  for (const candidate of candidates) {
    const reason = getCleanerHeuristicSkipReason(candidate, policy, now);
    if (reason) {
      skipped.push({
        path: candidate.path,
        reason,
        category: candidate.category,
        bytes: candidate.bytes,
        mtimeMs: candidate.mtimeMs,
      });
      continue;
    }

    kept.push(candidate);
  }

  return { candidates: kept, skipped };
}

export function getCleanerHeuristicSkipReason(
  candidate: Pick<ValidatedDeletionCandidate, "path" | "category" | "mtimeMs">,
  policy: CleanerHeuristicPolicy,
  now = Date.now(),
): string | null {
  if (isProtectedCleanupPath(candidate.path, policy.protectedPaths)) {
    return "protected-path";
  }

  const minAgeMs = policy.olderThanDays * 24 * 60 * 60 * 1000;
  if (
    policy.ageGatedCategories.has(candidate.category) &&
    now - candidate.mtimeMs < minAgeMs
  ) {
    return `newer-than-${policy.olderThanDays}d`;
  }

  return null;
}
