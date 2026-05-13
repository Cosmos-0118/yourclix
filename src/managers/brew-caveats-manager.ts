import boxen from "boxen";
import chalk from "chalk";

export interface BrewCaveatNotice {
  blocks: string[][];
  kegOnlyFormulae: string[];
  pathEntries: string[];
  exportLines: string[];
  runCommands: string[];
}

function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-9;]*m/g, "");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function collectCaveatBlocks(output: string): string[][] {
  const lines = stripAnsi(output).replace(/\r/g, "").split("\n");
  const blocks: string[][] = [];
  let active: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (/^==>\s+Caveats\b/i.test(trimmed)) {
      if (active && active.some((entry) => entry.trim().length > 0)) {
        blocks.push(active);
      }
      active = [];
      continue;
    }

    if (active && /^==>\s+/.test(trimmed)) {
      if (active.some((entry) => entry.trim().length > 0)) {
        blocks.push(active);
      }
      active = null;
      continue;
    }

    if (active) {
      active.push(line);
    }
  }

  if (active && active.some((entry) => entry.trim().length > 0)) {
    blocks.push(active);
  }

  return blocks;
}

function extractStandalonePathCandidates(block: string[]): string[] {
  const paths: string[] = [];
  for (let index = 0; index < block.length; index += 1) {
    const current = block[index]?.trim() ?? "";
    if (!current) {
      continue;
    }

    const previous = (block[index - 1] ?? "").toLowerCase();
    if (!previous.includes("path") && !previous.includes("placed into")) {
      continue;
    }

    if (/^\/[A-Za-z0-9._+\-\/]+$/.test(current)) {
      paths.push(current);
    }
  }

  return paths;
}

function extractPathFromExportLine(line: string): string | null {
  const match = line.match(/export\s+PATH=(?:"|')?([^"':]+(?:\/[^"':]+)*)/i);
  if (!match || !match[1]) {
    return null;
  }

  const candidate = match[1].trim();
  if (!candidate.startsWith("/")) {
    return null;
  }

  return candidate;
}

function buildNotice(blocks: string[][]): BrewCaveatNotice {
  const kegOnlyFormulae: string[] = [];
  const pathEntries: string[] = [];
  const exportLines: string[] = [];
  const runCommands: string[] = [];

  for (const block of blocks) {
    for (let index = 0; index < block.length; index += 1) {
      const line = block[index] ?? "";
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const kegOnlyMatch = trimmed.match(/^([A-Za-z0-9@._+\-]+)\s+is\s+keg-only\b/i);
      if (kegOnlyMatch?.[1]) {
        kegOnlyFormulae.push(kegOnlyMatch[1]);
      }

      if (/^export\s+[A-Z0-9_]+=/.test(trimmed)) {
        exportLines.push(trimmed);
        const exportedPath = extractPathFromExportLine(trimmed);
        if (exportedPath) {
          pathEntries.push(exportedPath);
        }
      }

      if (/\brun:\s*$/i.test(trimmed)) {
        for (let commandIndex = index + 1; commandIndex < block.length; commandIndex += 1) {
          const commandLine = block[commandIndex] ?? "";
          const commandTrimmed = commandLine.trim();
          if (!commandTrimmed) {
            break;
          }

          if (!/^\s{2,}|^\t/.test(commandLine)) {
            break;
          }

          runCommands.push(commandTrimmed);
        }
      }
    }

    pathEntries.push(...extractStandalonePathCandidates(block));
  }

  return {
    blocks,
    kegOnlyFormulae: dedupe(kegOnlyFormulae),
    pathEntries: dedupe(pathEntries),
    exportLines: dedupe(exportLines),
    runCommands: dedupe(runCommands),
  };
}

export function analyzeBrewCaveats(output: string): BrewCaveatNotice {
  const blocks = collectCaveatBlocks(output);
  if (blocks.length === 0) {
    return {
      blocks: [],
      kegOnlyFormulae: [],
      pathEntries: [],
      exportLines: [],
      runCommands: [],
    };
  }

  return buildNotice(blocks);
}

export function hasBrewCaveats(notice: BrewCaveatNotice): boolean {
  return notice.blocks.length > 0;
}

export function formatBrewCaveatFollowUps(notice: BrewCaveatNotice): string[] {
  const followUps: string[] = [];

  if (notice.kegOnlyFormulae.length > 0) {
    followUps.push(
      `Keg-only formula${notice.kegOnlyFormulae.length > 1 ? "e" : ""}: ${notice.kegOnlyFormulae.join(", ")}. Update PATH before relying on their binaries.`,
    );
  }

  for (const pathEntry of notice.pathEntries) {
    followUps.push(`export PATH=\"${pathEntry}:$PATH\"`);
  }

  for (const exportLine of notice.exportLines) {
    if (/^export\s+PATH=/.test(exportLine)) {
      continue;
    }
    followUps.push(exportLine);
  }

  for (const command of notice.runCommands) {
    followUps.push(command);
  }

  return dedupe(followUps);
}

export function printBrewCaveatGuidance(
  title: string,
  notice: BrewCaveatNotice,
): void {
  if (!hasBrewCaveats(notice)) {
    return;
  }

  const lines = [
    chalk.yellow.bold("Homebrew reported caveats for this install."),
    ...formatBrewCaveatFollowUps(notice)
      .slice(0, 8)
      .map((line) => chalk.dim(`- ${line}`)),
  ];

  console.log(
    boxen(lines.join("\n"), {
      title: chalk.bold.white(` ${title} `),
      titleAlignment: "left",
      borderStyle: "round",
      borderColor: "yellow",
      padding: { left: 1, right: 1, top: 0, bottom: 0 },
      margin: { top: 0, bottom: 0 },
    }),
  );
}