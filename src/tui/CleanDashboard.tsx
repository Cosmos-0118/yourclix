import React, { useEffect, useState } from "react";
import { Box, render, Text, useInput } from "ink";
import chalk from "chalk";
import type { RunLevel } from "../core/types.js";
import type { ScanResult } from "../core/types.js";
import { bytesToHuman, pluralize } from "../core/format.js";
import {
  getDefaultRetentionDays,
} from "../managers/clean-heuristics-manager.js";
import { parseFixedRetentionDays } from "../services/clean/clean-heuristics.js";
import { scanCleanerTargets } from "../services/clean/cleaner-scan.js";
import {
  preflightCleaner,
  runCleanerBackup,
  type BackupOutcome,
  type PreflightOutcome,
} from "../services/clean/cleaner-execute.js";
import { printSkippedBreakdown, printSkippedSummary } from "../services/clean/cleaner-skip-ui.js";
import { CategoryList } from "./components/CategoryList.js";
import { Panel } from "./components/Panel.js";
import { KeyHints } from "./components/KeyHints.js";
import { CYAN, DIM, FG, GREEN, YELLOW } from "./theme.js";
import type { DashboardCategory } from "./components/CategoryRow.js";
import { useSpinnerFrame } from "./useSpinnerFrame.js";

type Phase =
  | "scanning"
  | "review"
  | "preflight"
  | "confirm"
  | "executing"
  | "empty"
  | "done"
  | "cancelled";

export interface CleanDashboardOptions {
  mode: RunLevel;
  rawDays?: number | string;
  dryRun?: boolean;
  verbose?: boolean;
  /** `--yes`: skip the review/confirm gates but keep the dashboard visuals. */
  autoApprove?: boolean;
}

interface ExitState {
  phase: "done" | "empty" | "cancelled";
  outcome: PreflightOutcome | null;
  backup: BackupOutcome | null;
}

function toCategories(results: ScanResult[]): DashboardCategory[] {
  return results.map((result) => ({
    category: result.category,
    bytes: result.bytes,
    pathCount: result.paths.length,
  }));
}

function CleanApp({
  options,
  initialDays,
  retentionFixed,
  onExit,
}: {
  options: CleanDashboardOptions;
  initialDays: number;
  retentionFixed: boolean;
  onExit(state: ExitState): void;
}) {
  const [phase, setPhase] = useState<Phase>("scanning");
  const [categories, setCategories] = useState<DashboardCategory[]>([]);
  const [scanResults, setScanResults] = useState<ScanResult[] | null>(null);
  const [retentionDays, setRetentionDays] = useState(initialDays);
  const [outcome, setOutcome] = useState<PreflightOutcome | null>(null);
  const [backup, setBackup] = useState<BackupOutcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    const seen: DashboardCategory[] = [];

    scanCleanerTargets(options.mode, {
      onCategoryScanned(result) {
        if (cancelled) return;
        seen.push({
          category: result.category,
          bytes: result.bytes,
          pathCount: result.paths.length,
        });
        setCategories([...seen]);
      },
    }).then((results) => {
      if (cancelled) return;
      setScanResults(results);
      setCategories(toCategories(results));
      setPhase(options.autoApprove ? "preflight" : "review");
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autoApprove is fixed for the run
  }, [options.mode]);

  useEffect(() => {
    if (phase !== "preflight" || !scanResults) return;
    let cancelled = false;

    preflightCleaner(scanResults, { mode: options.mode, olderThanDays: retentionDays }).then(
      (result) => {
        if (cancelled) return;
        if (!result || result.candidates.length === 0) {
          setOutcome(result);
          setPhase("empty");
          return;
        }
        setOutcome(result);
        setPhase(options.autoApprove ? "executing" : "confirm");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [phase, scanResults, options.mode, options.autoApprove, retentionDays]);

  useEffect(() => {
    if (phase !== "executing" || !outcome) return;
    let cancelled = false;

    runCleanerBackup(outcome.candidates, { mode: options.mode, dryRun: options.dryRun }).then(
      (result) => {
        if (cancelled) return;
        setBackup(result);
        setPhase("done");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [phase, outcome, options.mode, options.dryRun]);

  useInput((input, key) => {
    // Any key dismisses a finished screen — this must run before the
    // q/escape "abort" check below, or exiting a completed run would
    // misreport as a cancellation instead of showing its real outcome.
    if (phase === "empty" || phase === "done") {
      onExit({ phase, outcome, backup });
      return;
    }

    if ((key.escape || input === "q") && phase !== "executing" && phase !== "preflight") {
      onExit({ phase: "cancelled", outcome, backup });
      return;
    }

    if (phase === "review") {
      if (key.leftArrow && !retentionFixed) {
        setRetentionDays((days) => Math.max(1, days - 1));
      } else if (key.rightArrow && !retentionFixed) {
        setRetentionDays((days) => Math.min(3650, days + 1));
      } else if (key.return) {
        setPhase("preflight");
      }
      return;
    }

    if (phase === "confirm") {
      if (input === "y" || key.return) {
        setPhase("executing");
      } else if (input === "n") {
        onExit({ phase: "cancelled", outcome, backup });
      }
    }
  });

  const totalBytes = categories.reduce((sum, entry) => sum + entry.bytes, 0);
  const spinnerFrame = useSpinnerFrame(
    phase === "scanning" || phase === "preflight" || phase === "executing",
  );

  return (
    <Box flexDirection="column">
      {categories.length > 0 && (
        <Box flexDirection="column">
          <CategoryList entries={categories} cursor={-1} />
          <Box marginTop={1}>
            <Text color={FG} bold>
              Discovered{" "}
            </Text>
            <Text color={CYAN} bold>
              {bytesToHuman(totalBytes)}
            </Text>
            <Text color={DIM}> across {pluralize(categories.length, "category", "categories")}</Text>
          </Box>
        </Box>
      )}

      {phase === "scanning" && (
        <Box marginTop={1}>
          <Text color={CYAN}>
            {spinnerFrame} Scanning ({options.mode.toUpperCase()})…
          </Text>
        </Box>
      )}

      {phase === "review" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color={DIM}>Delete items older than </Text>
            <Text color={FG} bold>
              {retentionDays}
            </Text>
            <Text color={DIM}> days{retentionFixed ? " (fixed by --days)" : ""}</Text>
          </Box>
          <Box marginTop={1}>
            <KeyHints
              hints={
                retentionFixed
                  ? [
                      { key: "enter", label: "continue" },
                      { key: "q", label: "quit" },
                    ]
                  : [
                      { key: "←→", label: "adjust retention" },
                      { key: "enter", label: "continue" },
                      { key: "q", label: "quit" },
                    ]
              }
            />
          </Box>
        </Box>
      )}

      {phase === "preflight" && (
        <Box>
          <Text color={CYAN}>{spinnerFrame} Validating target paths…</Text>
        </Box>
      )}

      {phase === "confirm" && outcome && (
        <Box flexDirection="column">
          <Text color={CYAN}>
            Eligible after safety checks: {pluralize(outcome.candidates.length, "path")},{" "}
            {bytesToHuman(outcome.eligibleBytes)}
          </Text>
          <Text color={DIM}>
            Retention policy: targets must be older than {outcome.policy.olderThanDays} days.
          </Text>
          <Box marginTop={1}>
            <Text bold color={FG}>
              Move {pluralize(outcome.candidates.length, "path")} to the undo backup in{" "}
              {options.mode.toUpperCase()} mode?
            </Text>
          </Box>
          <Box marginTop={1}>
            <KeyHints
              hints={[
                { key: "y", label: "confirm" },
                { key: "n", label: "cancel" },
              ]}
            />
          </Box>
        </Box>
      )}

      {phase === "executing" && outcome && (
        <Box>
          <Text color={CYAN}>
            {spinnerFrame} Moving {pluralize(outcome.candidates.length, "path")} to undo backup…
          </Text>
        </Box>
      )}

      {phase === "empty" && (
        <Box flexDirection="column">
          <Text color={YELLOW}>No eligible cleanup candidates after safety checks.</Text>
          <Box marginTop={1}>
            <KeyHints hints={[{ key: "any", label: "exit" }]} />
          </Box>
        </Box>
      )}

      {phase === "done" && backup && outcome && (
        <Box flexDirection="column">
          <Panel
            title={options.dryRun ? "Dry run" : "Cleanup complete"}
            borderColor={options.dryRun ? CYAN : GREEN}
          >
            <Text color={FG} bold>
              {options.dryRun ? "Would remove: " : "Moved to undo backup: "}
              {pluralize(backup.deletedCount, "path")}
            </Text>
            <Text color={DIM}>
              Skipped by safety checks: {pluralize(outcome.skipped.length, "path")}
            </Text>
            <Text color={CYAN} bold>
              {options.dryRun ? "Potential reclaim: " : "Backup size: "}
              {bytesToHuman(backup.reclaimedBytes)}
            </Text>
            {!options.dryRun && backup.backupId ? (
              <>
                <Text color={YELLOW}>
                  Disk space is not freed until this undo backup is pruned.
                </Text>
                <Text> </Text>
                <Text color={GREEN}>Backup: ~/.your-backups/{backup.backupId}</Text>
                <Text color={DIM}>Undo: your undo restore {backup.backupId}</Text>
              </>
            ) : null}
          </Panel>
          <Box marginTop={1}>
            <KeyHints hints={[{ key: "any", label: "exit" }]} />
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * Runs the interactive clean dashboard end to end (scan → review → preflight
 * → confirm → execute → done), then unmounts Ink and prints the final
 * summary panel through the same plain-path helpers `executeCleaner` uses,
 * so the durable `Backup:`/`Undo:` lines land in normal scrollback text.
 */
export async function runCleanDashboard(options: CleanDashboardOptions): Promise<void> {
  const fixedDays = parseFixedRetentionDays(options.mode, options.rawDays);
  const initialDays = fixedDays ?? getDefaultRetentionDays(options.mode);
  const retentionFixed = fixedDays !== undefined;

  const state = await new Promise<ExitState>((resolve) => {
    const { unmount } = render(
      <CleanApp
        options={options}
        initialDays={initialDays}
        retentionFixed={retentionFixed}
        onExit={(final) => {
          unmount();
          resolve(final);
        }}
      />,
    );
  });

  if (state.phase === "cancelled") {
    console.log(chalk.yellow("Cancelled."));
    return;
  }

  if (state.phase === "empty" && state.outcome) {
    console.log(chalk.yellow("No eligible cleanup candidates after safety checks."));
    if (options.verbose) {
      printSkippedBreakdown(state.outcome.skipped);
    }
    return;
  }

  if (state.phase === "done" && state.outcome && state.backup) {
    printSkippedSummary(state.outcome.skipped, Boolean(options.verbose));

    if (state.backup.backupWarnings.length > 0) {
      console.log(chalk.yellow.bold("Warnings"));
      console.log(state.backup.backupWarnings.map((w) => chalk.yellow(`• ${w}`)).join("\n"));
    }
  }
}
