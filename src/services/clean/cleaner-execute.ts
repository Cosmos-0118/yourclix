import path from "node:path";
import { ui, type CliUI } from "../../core/ui.js";
import { filterToAncestorRoots } from "../../core/fs-utils.js";
import { bytesToHuman, pluralize } from "../../core/format.js";
import type { CleanerOptions, ScanResult } from "../../core/types.js";
import { undoManager } from "../../core/undo-manager.js";
import { buildCleanerHeuristicPolicy } from "../../managers/clean-heuristics-manager.js";
import type { CleanerScanContext } from "../../managers/clean-scan-manager.js";
import { getProjectArtifactSkipReason } from "./cleaner-project-guard.js";
import type { ValidatedDeletionCandidate } from "./clean-heuristics.js";
import { printSkippedSummary, type SkipRecord } from "./cleaner-skip-ui.js";
import {
  inspectCleanerTarget,
  readCleanerActivity,
  type CleanerActivity,
} from "./cleaner-safety.js";
import { handleManagedCleanerCaches } from "./cleaner-managed.js";
import { readCleanerExclusions } from "./cleaner-exclusions.js";
import { createCleanerRevalidator } from "./cleaner-revalidate.js";
import { runCleanerPermanentDeletion } from "./cleaner-permanent.js";

export interface PreflightOutcome {
  candidates: ValidatedDeletionCandidate[];
  skipped: SkipRecord[];
  eligibleBytes: number;
  discoveredBytes: number;
  managedCaches: ScanResult[];
  excludedPaths: string[];
  scanIssues: number;
  activityAvailable: boolean;
  policy: ReturnType<typeof buildCleanerHeuristicPolicy>;
}

/** Read-only inspection. Missing permissions/activity information fail closed. */
export async function preflightCleaner(
  results: ScanResult[],
  options: Pick<CleanerOptions, "mode" | "olderThanDays">,
  dependencies: {
    context?: CleanerScanContext;
    activity?: CleanerActivity;
    now?: number;
    maxEntries?: number;
  } = {},
): Promise<PreflightOutcome> {
  const policy = buildCleanerHeuristicPolicy(
    options.mode,
    options.olderThanDays ?? 14,
    dependencies.context,
  );
  const excludedPaths = await readCleanerExclusions(policy.home);
  policy.protectedPaths.push(...excludedPaths);
  const managedCaches = results.filter(
    (result) => result.managedBy && result.paths.length,
  );
  const ordinary = results.filter((result) => !result.managedBy);
  const categories = new Map(
    ordinary.flatMap((result) =>
      result.paths.map(
        (target) => [path.resolve(target), result.category] as const,
      ),
    ),
  );
  const unmeasured = new Set(
    results.flatMap((result) =>
      (result.issues ?? [])
        .filter((issue) => issue.reason === "size-unavailable")
        .map((issue) => path.resolve(issue.path)),
    ),
  );
  const activity = dependencies.activity ?? (await readCleanerActivity());
  const candidates: ValidatedDeletionCandidate[] = [];
  const skipped: SkipRecord[] = [];
  for (const target of filterToAncestorRoots([...categories.keys()])) {
    ui.throwIfCancelled();
    const category = categories.get(target)!;
    if (unmeasured.has(target)) {
      skipped.push({ path: target, category, reason: "size-unavailable" });
      continue;
    }
    const inspection = await inspectCleanerTarget(
      target,
      policy,
      activity,
      dependencies,
    );
    let reason = inspection.reason;
    if (!reason && category === "Developer Project Caches")
      reason = await getProjectArtifactSkipReason(target, policy.home);
    if (reason) {
      skipped.push({ path: target, category, reason });
      continue;
    }
    candidates.push({
      path: target,
      category,
      bytes: inspection.bytes,
      mtimeMs: inspection.newestMtimeMs,
      dev: inspection.dev,
      ino: inspection.ino,
    });
  }
  return {
    candidates,
    skipped,
    eligibleBytes: candidates.reduce((n, item) => n + item.bytes, 0),
    discoveredBytes: results.reduce((n, result) => n + result.bytes, 0),
    managedCaches,
    excludedPaths,
    scanIssues: results.reduce(
      (n, result) => n + (result.issues?.length ?? 0),
      0,
    ),
    activityAvailable: activity.available,
    policy,
  };
}

export interface BackupOutcome {
  deletedCount: number;
  reclaimedBytes: number;
  backupId: string | null;
  backupWarnings: string[];
  status: "success" | "partial" | "failed";
  details?: string[];
  availableBefore?: number;
  availableAfter?: number;
}

export async function runCleanerBackup(
  candidates: ValidatedDeletionCandidate[],
  options: Pick<CleanerOptions, "mode" | "dryRun" | "olderThanDays">,
): Promise<BackupOutcome> {
  if (options.dryRun)
    return {
      deletedCount: candidates.length,
      reclaimedBytes: candidates.reduce((n, item) => n + item.bytes, 0),
      backupId: null,
      backupWarnings: [],
      status: "success",
    };
  const validate = await createCleanerRevalidator(candidates, options);
  const { metadata, warnings } = await undoManager.createBackup(
    candidates.map((candidate) => candidate.path),
    "clean",
    [options.mode],
    validate,
  );
  return {
    deletedCount: metadata.filesCount,
    reclaimedBytes: metadata.byteSize,
    backupId: metadata.id,
    backupWarnings: warnings,
    status:
      metadata.filesCount === 0
        ? "failed"
        : warnings.length
          ? "partial"
          : "success",
    details: warnings,
  };
}

export function buildCleanupSummaryPanel(
  outcome: BackupOutcome,
  skippedCount: number,
  policy: { olderThanDays: number },
  dryRun: boolean,
  permanent = false,
): { title: string; body: string[] } {
  return {
    title: dryRun ? "Cleanup preview" : "Cleanup result",
    body: [
      `${permanent ? (dryRun ? "Would permanently delete" : "Permanently deleted") : dryRun ? "Would move to undo backup" : "Moved to undo backup"}: ${pluralize(outcome.deletedCount, "path")}`,
      `Selected size: ${bytesToHuman(outcome.reclaimedBytes)}`,
      `Kept by safety checks: ${pluralize(skippedCount, "path")}`,
      `Retention: all contents must be older than ${policy.olderThanDays} days`,
      permanent
        ? "Permanent mode: no undo backup is created."
        : "Disk space is not freed by moving files to the undo backup.",
      ...(permanent &&
      outcome.availableBefore !== undefined &&
      outcome.availableAfter !== undefined
        ? [
            `Available space on home volume: ${bytesToHuman(outcome.availableBefore)} → ${bytesToHuman(outcome.availableAfter)}`,
            `Measured free-space change: ${outcome.availableAfter >= outcome.availableBefore ? "+" : "−"}${bytesToHuman(Math.abs(outcome.availableAfter - outcome.availableBefore))}`,
          ]
        : []),
      ...(!dryRun && outcome.backupId
        ? [
            `Backup: ~/.your-backups/${outcome.backupId}`,
            `Restore: your undo restore ${outcome.backupId}`,
            "Free space later: your backup prune --dry-run",
          ]
        : []),
    ],
  };
}

export function printCleanerReview(
  outcome: PreflightOutcome,
  terminal: CliUI = ui,
): void {
  const managedBytes = outcome.managedCaches.reduce(
    (n, result) => n + result.bytes,
    0,
  );
  terminal.list("Cleanup plan", [
    `Discovered: ${bytesToHuman(outcome.discoveredBytes)}`,
    `Eligible for cleanup: ${bytesToHuman(outcome.eligibleBytes)} · ${pluralize(outcome.candidates.length, "path")}`,
    `Kept by safety checks: ${bytesToHuman(Math.max(0, outcome.discoveredBytes - managedBytes - outcome.eligibleBytes))} · ${pluralize(outcome.skipped.length, "path")}`,
    `Tool managed: ${bytesToHuman(managedBytes)} · excluded from ordinary cleanup`,
    `Scan coverage: ${outcome.scanIssues ? `partial · ${pluralize(outcome.scanIssues, "unreadable or limited location")}` : "no errors in the configured locations"}`,
  ]);
  terminal.note(
    `Retention: all contents must be older than ${outcome.policy.olderThanDays} days. Open files, symlinks and unreadable paths are kept.`,
  );
  if (!outcome.activityAvailable)
    terminal.notice(
      "Could not verify running processes; all ordinary cleanup paths were kept.",
      ["Allow process inspection and retry the preview."],
      "warn",
    );
}

export async function executeCleaner(
  results: ScanResult[],
  options: CleanerOptions,
  terminal: CliUI = ui,
): Promise<void> {
  terminal.heading("Safety checks");
  const outcome = await terminal.task(
    "Check retention, ownership and active files",
    () => preflightCleaner(results, options),
  );
  printCleanerReview(outcome, terminal);
  printSkippedSummary(outcome.skipped, Boolean(options.verbose), terminal);
  if (options.verbose) {
    const issues = results.flatMap((result) => result.issues ?? []);
    if (issues.length)
      terminal.list(
        "Scan limits",
        issues.map((issue) => `${issue.path} (${issue.reason})`),
      );
    if (outcome.candidates.length)
      terminal.list(
        "Eligible paths",
        outcome.candidates.map(
          (candidate) => `${candidate.path} · ${bytesToHuman(candidate.bytes)}`,
        ),
      );
  }
  let cleanup: BackupOutcome | undefined;
  let disposition: "backup" | "permanent" | "cancel" = options.permanent
    ? "permanent"
    : "backup";
  if (!outcome.candidates.length)
    terminal.notice("No paths eligible for ordinary cleanup.");
  else {
    if (!options.dryRun)
      disposition = await chooseCleanerDisposition(options, terminal);
    if (disposition === "cancel") {
      terminal.status("skipped", "Cleanup cancelled; files kept.");
      return;
    } else {
      const permanent = disposition === "permanent";
      const actionOptions = {
        ...options,
        olderThanDays: outcome.policy.olderThanDays,
      };
      const apply = () =>
        permanent
          ? runCleanerPermanentDeletion(outcome.candidates, actionOptions)
          : runCleanerBackup(outcome.candidates, actionOptions);
      if (!options.dryRun)
        terminal.notice(
          permanent ? "Permanent deletion selected" : "Undo backup selected",
          [
            permanent
              ? "Selected files will be deleted directly. This cannot be undone through your."
              : "Selected paths stay recoverable; space is freed only when the backup is pruned.",
          ],
          permanent ? "warn" : "info",
        );
      const approved =
        options.dryRun ||
        (await terminal.confirm(
          permanent
            ? `Permanently delete ${pluralize(outcome.candidates.length, "path")} (${bytesToHuman(outcome.eligibleBytes)}) without a backup?`
            : `Move ${pluralize(outcome.candidates.length, "path")} (${bytesToHuman(outcome.eligibleBytes)}) to the undo backup?`,
          Boolean(options.yes),
        ));
      if (approved) {
        cleanup = options.dryRun
          ? await apply()
          : await terminal.task(
              permanent
                ? "Recheck and permanently delete eligible paths"
                : "Recheck and move eligible paths to undo backup",
              apply,
            );
        const summary = buildCleanupSummaryPanel(
          cleanup,
          outcome.skipped.length,
          outcome.policy,
          Boolean(options.dryRun),
          permanent,
        );
        terminal.list(summary.title, summary.body);
        if (cleanup.backupWarnings.length)
          terminal.list("Cleanup diagnostics", cleanup.backupWarnings);
      } else {
        terminal.status("skipped", "Cleanup cancelled; files kept.");
        return;
      }
    }
  }
  if (cleanup && cleanup.status !== "success")
    throw new Error(
      "Some cleanup actions were incomplete. Review the diagnostics above; no forced retry was attempted.",
    );
  await handleManagedCleanerCaches(
    outcome.managedCaches,
    options,
    terminal,
    outcome.excludedPaths,
  );
}

/** Interactive choice is per-run; backup remains the default on every invocation. */
export async function chooseCleanerDisposition(
  options: CleanerOptions,
  terminal: CliUI = ui,
): Promise<"backup" | "permanent" | "cancel"> {
  if (options.permanent) return "permanent";
  if (options.dryRun || options.yes || !terminal.interactive) return "backup";
  return terminal.select(
    "How should eligible paths be removed?",
    [
      {
        value: "backup",
        label: "Move to undo backup",
        hint: "default · recoverable",
      },
      {
        value: "permanent",
        label: "Permanently delete",
        hint: "no backup · cannot undo",
      },
      { value: "cancel", label: "Cancel", hint: "keep all files" },
    ],
    "backup",
  );
}
