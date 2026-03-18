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
