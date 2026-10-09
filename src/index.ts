#!/usr/bin/env node
import { ui, CliCancelled } from "./core/ui.js";
import type { Command } from "commander";
import { ActionableError, formatActionableError } from "./core/actionable-error.js";
import { YourCommand } from "./core/your-command.js";
import { registerCommands } from "./commands/index.js";
import {
  assertRuntimeRequirements,
  ensureFeatureRuntime,
  printRuntimeWarnings,
} from "./managers/feature-runtime-manager.js";

const program = new YourCommand();

program
  .name("your")
  .description("Developer-first macOS optimizer CLI")
  .version("0.1.0")
  .showHelpAfterError();

registerCommands(program);

process.on("SIGINT", () => { ui.cancel(); });

program.hook("preAction", async (_thisCommand, actionCommand) => {
  const commandId = getCommandId(actionCommand);
  if (commandId === "completion zsh") return;
  ui.start(`your ${commandId}${actionCommand.opts().dryRun ? " · dry run" : ""}`);
  const runtime = await ensureFeatureRuntime(commandId);
  printRuntimeWarnings(runtime);
  assertRuntimeRequirements(runtime);
});

program.hook("postAction", () => { ui.throwIfCancelled(); ui.finish(); });

program.parseAsync(process.argv).catch((error: unknown) => {
  ui.finish(true);
  if (error instanceof CliCancelled) {
    ui.error("Cancelled.");
    process.exitCode = 130;
    return;
  }
  if (error instanceof ActionableError) {
    for (const line of formatActionableError(error)) {
      ui.error(line);
    }
    process.exitCode = 1;
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  ui.error(`Error: ${message}`);
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
