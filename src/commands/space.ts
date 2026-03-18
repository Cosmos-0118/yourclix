import { Command } from "commander";
import { analyzeSpace } from "../services/space.js";

export function registerSpace(program: Command): void {
  program
    .command("space")
    .description("Visual disk space analyzer")
    .option("--path <path>", "path to analyze")
    .option("--depth <depth>", "tree depth", "2")
    .action(async (options) => {
      await analyzeSpace(options.path, Number.parseInt(options.depth, 10));
    });
}
