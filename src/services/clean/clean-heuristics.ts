import type { RunLevel } from "../../core/types.js";
import { numberPrompt } from "../../core/task-ui.js";
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
  dev?: number;
  ino?: number;
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

/**
 * Parses an explicit `--days` value into a normalized retention count, or
 * `undefined` when the caller should fall back to a prompt/default. Shared by
 * the plain retention prompt and the TUI dashboard so both reject an invalid
 * `--days` value the same way.
 */
export function parseFixedRetentionDays(
  mode: RunLevel,
  rawDays?: number | string,
): number | undefined {
  if (rawDays === undefined) {
    return undefined;
  }

  const raw = String(rawDays).trim();
  const parsed = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > 3650
  ) {
    throw new Error(
      "Invalid value for --days. Please provide a whole number from 1 to 3650.",
    );
  }

  return normalizeRetentionDays(parsed, mode);
}

export async function resolveRetentionDays(
  input: RetentionInput,
): Promise<number> {
  const fixedDays = parseFixedRetentionDays(input.mode, input.rawDays);
  if (fixedDays !== undefined) {
    return fixedDays;
  }

  const defaultDays = getDefaultRetentionDays(input.mode);
  const selected = await numberPrompt(
    `Keep items modified within how many days? (${input.mode})`,
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
    (policy.ageGatedCategories.has("*") ||
      policy.ageGatedCategories.has(candidate.category)) &&
    now - candidate.mtimeMs < minAgeMs
  ) {
    return `newer-than-${policy.olderThanDays}d`;
  }

  return null;
}
