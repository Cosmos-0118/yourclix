import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function confirm(
  message: string,
  assumeYes = false,
): Promise<boolean> {
  if (assumeYes) {
    return true;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} [y/N]: `);
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

interface NumberPromptOptions {
  defaultValue: number;
  min?: number;
  max?: number;
  assumeDefault?: boolean;
}

export async function askNumber(
  message: string,
  options: NumberPromptOptions,
): Promise<number> {
  const min = options.min ?? Number.MIN_SAFE_INTEGER;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  const fallback = clampInteger(options.defaultValue, min, max);

  if (options.assumeDefault) {
    return fallback;
  }

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const answer = await rl.question(`${message} [${fallback}]: `);
      const trimmed = answer.trim();
      if (!trimmed) {
        return fallback;
      }

      const parsed = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(parsed)) {
        console.log(`Please enter a whole number between ${min} and ${max}.`);
        continue;
      }

      if (parsed < min || parsed > max) {
        console.log(`Please enter a value between ${min} and ${max}.`);
        continue;
      }

      return parsed;
    }
  } finally {
    rl.close();
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}
