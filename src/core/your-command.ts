import { Command, Help } from "commander";
import { YourCliHelp } from "./your-help.js";

/**
 * Root CLI command: ensures custom {@link YourCliHelp} is used for every subcommand.
 */
export class YourCommand extends Command {
  createCommand(name?: string): Command {
    return new YourCommand(name ?? "");
  }

  createHelp(): Help {
    return Object.assign(new YourCliHelp(), this.configureHelp());
  }
}
