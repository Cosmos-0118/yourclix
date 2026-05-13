import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LogLevel, SetupLogger } from "./types.js";

export async function createSetupLogger(debug: boolean): Promise<SetupLogger> {
  const logsDir = path.join(os.homedir(), ".your", "logs");
  await fs.mkdir(logsDir, { recursive: true });
  const filePath = path.join(logsDir, `setup-${Date.now()}.log`);

  const log = async (level: LogLevel, message: string) => {
    if (level === "debug" && !debug) {
      return;
    }

    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}\n`;
    await fs.appendFile(filePath, line, "utf8");
  };

  await log("info", "Logger initialized");
  return { path: filePath, log };
}
