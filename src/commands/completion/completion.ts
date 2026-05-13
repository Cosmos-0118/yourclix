import { Command } from "commander";
import {
  installZshCompletion,
  printZshCompletionScript,
  uninstallZshCompletion,
} from "../../services/completion/completion.js";

export function registerCompletion(program: Command): void {
  const completion = program
    .command("completion")
    .description("Autocomplete assistant for shell completion");

  completion
    .command("zsh")
    .description("Print zsh completion script")
    .action(async () => {
      await printZshCompletionScript();
    });

  completion
    .command("install")
    .description("Install shell completion")
    .option("--shell <shell>", "target shell", "zsh")
    .option("--force", "force replacement of completion block", false)
    .action(async (options) => {
      if (options.shell !== "zsh") {
        throw new Error(
          `Unsupported shell '${options.shell}'. Supported shells: zsh`,
        );
      }

      await installZshCompletion(Boolean(options.force));
    });

  completion
    .command("uninstall")
    .description("Uninstall shell completion")
    .option("--shell <shell>", "target shell", "zsh")
    .action(async (options) => {
      if (options.shell !== "zsh") {
        throw new Error(
          `Unsupported shell '${options.shell}'. Supported shells: zsh`,
        );
      }

      await uninstallZshCompletion();
    });
}
