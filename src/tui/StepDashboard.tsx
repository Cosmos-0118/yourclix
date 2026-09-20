import React, { useEffect, useRef, useState } from "react";
import { Box, render, Static, Text, useInput } from "ink";
import { CYAN, DIM, FG, GREEN, RED, YELLOW } from "./theme.js";
import { KeyHints } from "./components/KeyHints.js";
import { useSpinnerFrame } from "./useSpinnerFrame.js";

export type StepStatus = "running" | "success" | "warn" | "failed" | "skipped";

export interface TaskResult {
  status: "success" | "warn" | "failed" | "skipped";
  details: string[];
}

interface StepState {
  id: number;
  label: string;
  status: StepStatus;
  liveLines: string[];
  finalDetails: string[];
}

interface SectionState {
  id: number;
  title: string;
  steps: StepState[];
}

type NoteTone = "info" | "success" | "warn" | "heading";

interface NoteState {
  id: number;
  text: string;
  tone: NoteTone;
}

interface ListState {
  id: number;
  title: string;
  lines: string[];
}

type Entry =
  | { kind: "section"; value: SectionState }
  | { kind: "note"; value: NoteState }
  | { kind: "list"; value: ListState };

/**
 * Per-section step runner. Mirrors the subset of `CommandProgress`'s surface
 * that the brew dashboard needs, but reports into Ink state instead of the
 * console — no fixed step count, steps just append live as they start.
 */
export interface SectionHandle {
  run<T extends TaskResult>(
    label: string,
    task: () => Promise<T>,
    /** Post-process the raw result (e.g. downgrade a warning-only failure to "warn") before it's displayed or returned. */
    postProcess?: (result: T) => T,
  ): Promise<T>;
  runStream<T extends TaskResult>(
    label: string,
    task: (logLine: (line: string) => void) => Promise<T>,
    opts?: { persistLines?: boolean },
  ): Promise<T>;
  skip(label: string, reason: string): void;
}

export interface DashboardHooks {
  addSection(title: string): SectionHandle;
  note(text: string, tone?: NoteTone): void;
  list(title: string, lines: string[]): void;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

function statusIcon(status: StepStatus, spinnerFrame: string): { char: string; color: string } {
  switch (status) {
    case "success":
      return { char: "✓", color: GREEN };
    case "failed":
      return { char: "✗", color: RED };
    case "warn":
      return { char: "!", color: YELLOW };
    case "skipped":
      return { char: "-", color: DIM };
    default:
      return { char: spinnerFrame, color: CYAN };
  }
}

const LIVE_LINE_LIMIT = 4;

function StepRow({ step, spinnerFrame }: { step: StepState; spinnerFrame: string }) {
  const icon = statusIcon(step.status, spinnerFrame);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={icon.color}>{icon.char}</Text>
        <Text color={FG}> {step.label}</Text>
      </Box>
      {step.status === "running" && step.liveLines.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {step.liveLines.map((line, i) => (
            <Text key={i} color={DIM}>
              {line}
            </Text>
          ))}
        </Box>
      )}
      {step.status !== "running" && step.finalDetails.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {step.finalDetails.map((line, i) => (
            <Text key={i} color={step.status === "failed" ? RED : DIM}>
              · {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function SectionBlock({ section, spinnerFrame }: { section: SectionState; spinnerFrame: string }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {section.title.trim().length > 0 && (
        <Text color={FG} bold>
          {section.title}
        </Text>
      )}
      {section.steps.map((step) => (
        <StepRow key={step.id} step={step} spinnerFrame={spinnerFrame} />
      ))}
    </Box>
  );
}

function NoteLine({ note }: { note: NoteState }) {
  const color =
    note.tone === "success" ? GREEN
    : note.tone === "warn" ? YELLOW
    : note.tone === "heading" ? CYAN
    : DIM;
  return (
    <Text color={color} bold={note.tone === "heading"}>
      {note.text}
    </Text>
  );
}

const LIST_LINE_LIMIT = 20;

function ListBlock({ list }: { list: ListState }) {
  const shown = list.lines.slice(0, LIST_LINE_LIMIT);
  const overflow = list.lines.length - shown.length;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={FG} bold>
        {list.title}
      </Text>
      {shown.map((line, i) => (
        <Text key={i} color={DIM}>
          {line}
        </Text>
      ))}
      {overflow > 0 && <Text color={DIM}>... and {overflow} more</Text>}
    </Box>
  );
}

function DashboardApp<T>({
  run,
  onExit,
}: {
  run: (hooks: DashboardHooks) => Promise<T>;
  onExit: (outcome: Outcome<T>) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [staticLines, setStaticLines] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const nextId = () => (idRef.current += 1);

    function updateSection(sectionId: number, updater: (s: SectionState) => SectionState) {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.kind === "section" && entry.value.id === sectionId ?
            { kind: "section", value: updater(entry.value) }
          : entry,
        ),
      );
    }

    function updateStep(sectionId: number, stepId: number, updater: (s: StepState) => StepState) {
      updateSection(sectionId, (section) => ({
        ...section,
        steps: section.steps.map((step) => (step.id === stepId ? updater(step) : step)),
      }));
    }

    function addStep(sectionId: number, label: string, status: StepStatus): number {
      const stepId = nextId();
      updateSection(sectionId, (section) => ({
        ...section,
        steps: [...section.steps, { id: stepId, label, status, liveLines: [], finalDetails: [] }],
      }));
      return stepId;
    }

    function finishStep(sectionId: number, stepId: number, result: TaskResult) {
      updateStep(sectionId, stepId, (step) => ({
        ...step,
        status: result.status,
        liveLines: [],
        finalDetails: result.status === "success" ? [] : result.details,
      }));
    }

    function addSection(title: string): SectionHandle {
      const sectionId = nextId();
      setEntries((prev) => [...prev, { kind: "section", value: { id: sectionId, title, steps: [] } }]);

      return {
        async run(label, task, postProcess) {
          const stepId = addStep(sectionId, label, "running");
          const raw = await task();
          const result = postProcess ? postProcess(raw) : raw;
          if (!cancelled) finishStep(sectionId, stepId, result);
          return result;
        },
        async runStream(label, task, opts) {
          const stepId = addStep(sectionId, label, "running");
          const persist = Boolean(opts?.persistLines);
          const result = await task((line) => {
            if (cancelled) return;
            if (persist) {
              setStaticLines((prev) => [...prev, line]);
            } else {
              updateStep(sectionId, stepId, (step) => ({
                ...step,
                liveLines: [...step.liveLines.slice(-(LIVE_LINE_LIMIT - 1)), line],
              }));
            }
          });
          if (!cancelled) finishStep(sectionId, stepId, result);
          return result;
        },
        skip(label, reason) {
          const stepId = addStep(sectionId, label, "skipped");
          updateStep(sectionId, stepId, (step) => ({ ...step, finalDetails: [reason] }));
        },
      };
    }

    function note(text: string, tone: NoteTone = "info") {
      setEntries((prev) => [...prev, { kind: "note", value: { id: nextId(), text, tone } }]);
    }

    function list(title: string, lines: string[]) {
      setEntries((prev) => [...prev, { kind: "list", value: { id: nextId(), title, lines } }]);
    }

    run({ addSection, note, list }).then(
      (value) => {
        if (!cancelled) setOutcome({ ok: true, value });
      },
      (error: unknown) => {
        if (!cancelled) setOutcome({ ok: false, error });
      },
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `run` is fixed for the dashboard's lifetime
  }, []);

  const spinnerFrame = useSpinnerFrame(outcome === null);

  useInput((_input, _key) => {
    if (outcome) {
      onExit(outcome);
    }
  });

  return (
    <Box flexDirection="column">
      <Static items={staticLines}>{(line, i) => <Text key={i}>{line}</Text>}</Static>
      {entries.map((entry) => {
        if (entry.kind === "section") {
          return <SectionBlock key={`s${entry.value.id}`} section={entry.value} spinnerFrame={spinnerFrame} />;
        }
        if (entry.kind === "note") {
          return <NoteLine key={`n${entry.value.id}`} note={entry.value} />;
        }
        return <ListBlock key={`l${entry.value.id}`} list={entry.value} />;
      })}
      {outcome && (
        <Box marginTop={1}>
          <KeyHints hints={[{ key: "any", label: "exit" }]} />
        </Box>
      )}
    </Box>
  );
}

/**
 * Runs a step-and-section dashboard end to end, then unmounts Ink once the
 * user dismisses the finished screen. Rejects with `run`'s error (if any)
 * after unmounting, so the caller's existing error handling still applies.
 */
export async function runStepDashboard<T>(run: (hooks: DashboardHooks) => Promise<T>): Promise<T> {
  const outcome = await new Promise<Outcome<T>>((resolve) => {
    const { unmount } = render(
      <DashboardApp
        run={run}
        onExit={(result) => {
          unmount();
          resolve(result);
        }}
      />,
    );
  });

  if (!outcome.ok) {
    throw outcome.error;
  }

  return outcome.value;
}
