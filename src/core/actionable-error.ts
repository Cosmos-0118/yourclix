import { terminalWidth, wrapText } from "./format.js";

export interface ActionableErrorOptions {
  code: string;
  summary: string;
  nextSteps?: string[];
  details?: string[];
}

export class ActionableError extends Error {
  readonly code: string;
  readonly summary: string;
  readonly nextSteps: string[];
  readonly details: string[];

  constructor(options: ActionableErrorOptions) {
    super(options.summary);
    this.name = "ActionableError";
    this.code = options.code;
    this.summary = options.summary;
    this.nextSteps = options.nextSteps ?? [];
    this.details = options.details ?? [];
  }
}

export function formatActionableError(error: ActionableError): string[] {
  const lines: string[] = [];
  lines.push(...wrapText(`Error [${error.code}]: ${error.summary}`, terminalWidth()));

  if (error.details.length > 0) {
    lines.push("Details:");
    for (const detail of error.details) {
      lines.push(...wrapText(`- ${detail}`, Math.max(20, terminalWidth() - 2)));
    }
  }

  if (error.nextSteps.length > 0) {
    lines.push("Next steps:");
    for (const step of error.nextSteps) {
      lines.push(...wrapText(`- ${step}`, Math.max(20, terminalWidth() - 2)));
    }
  }

  return lines;
}
