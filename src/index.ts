#!/usr/bin/env node
import { Command } from "commander";
import { registerCommands } from "./commands/index.js";
import {
  assertRuntimeRequirements,
  ensureFeatureRuntime,
  printRuntimeWarnings,
} from "./managers/feature-runtime-manager.js";

const program = new Command();

program
  .name("your")
  .description("Developer-first macOS optimizer CLI")
  .version("0.1.0")
  .showHelpAfterError();

registerCommands(program);

program.hook("preAction", async (_thisCommand, actionCommand) => {
  const commandId = getCommandId(actionCommand);
  const runtime = await ensureFeatureRuntime(commandId);
  printRuntimeWarnings(runtime);
  assertRuntimeRequirements(runtime);
});

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});

function getCommandId(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;

  while (current) {
    const currentName = current.name();
    if (currentName && currentName !== "your") {
      names.push(currentName);
    }

    current = current.parent ?? null;
  }

  return names.reverse().join(" ");
}
