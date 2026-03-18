import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NetworkLogger } from "./types.js";

export async function createNetworkLogger(
  scope: "fix" | "reset",
): Promise<NetworkLogger> {
  const dir = path.join(os.homedir(), ".your-backups", "network-logs");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${scope}-${Date.now()}.log`);

  const log = async (message: string) => {
    const line = `${new Date().toISOString()} ${message}\n`;
    await fs.appendFile(filePath, line, "utf8");
  };

  await log("logger initialized");
  return { path: filePath, log };
}
