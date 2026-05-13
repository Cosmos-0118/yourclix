import { Command } from "commander";
import { analyzeSpace } from "../services/space.js";

export function registerSpace(program: Command): void {
  program
    .command("space")
    .description(
      "Disk usage tree for heavy folders (default) or a path you choose",
    )
    .option(
      "--path <path>",
      "analyze this path only (default: Downloads, Desktop, Documents, Library/Containers)",
    )
    .option("--depth <depth>", "tree depth", "2")
    .action(async (options) => {
      await analyzeSpace(options.path, Number.parseInt(options.depth, 10));
    });
}
