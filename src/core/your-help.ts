import { Help } from "commander";
import type { Command } from "commander";
import chalk from "chalk";

/** Logical groupings for the top-level `your --help` view (command names must match exactly). */
const COMMAND_GROUPS: { title: string; members: string[] }[] = [
  { title: "Setup & cleanup", members: ["setup", "clean"] },
  { title: "Health & fixes", members: ["doctor", "fix"] },
  { title: "System & package managers", members: ["spotlight", "net", "brew"] },
  {
    title: "Developer workspace",
    members: ["dev", "space", "terminal", "plugin"],
  },
  { title: "Privacy & startup", members: ["privacy", "startup"] },
  { title: "Backups & undo", members: ["backup", "undo"] },
  { title: "Shell", members: ["completion"] },
  { title: "Help", members: ["help"] },
];

export class YourCliHelp extends Help {
  private useColors = false;

  prepareContext(contextOptions: {
    error?: boolean;
    helpWidth?: number;
    outputHasColors?: boolean;
  }): void {
    super.prepareContext(contextOptions);
    this.useColors = Boolean(contextOptions.outputHasColors);
  }

  styleTitle(str: string): string {
    if (!this.useColors) return str;
    return chalk.bold.cyan(str);
  }

  styleUsage(str: string): string {
    if (!this.useColors) return str;
    return str
      .split(" ")
      .map((word) => {
        if (word === "[options]") return this.styleOptionText(word);
        if (word === "[command]") return this.styleSubcommandText(word);
        if (word[0] === "[" || word[0] === "<") {
          return this.styleArgumentText(word);
        }
        return this.styleCommandText(word);
      })
      .join(" ");
  }

  styleCommandText(str: string): string {
    if (!this.useColors) return str;
    return chalk.bold.green(str);
  }

  styleCommandDescription(str: string): string {
    return this.styleDescriptionText(str);
  }

  styleOptionDescription(str: string): string {
    return this.styleDescriptionText(str);
  }

  styleSubcommandDescription(str: string): string {
    return this.styleDescriptionText(str);
  }

  styleArgumentDescription(str: string): string {
    return this.styleDescriptionText(str);
  }

  styleDescriptionText(str: string): string {
    if (!this.useColors) return str;
    return chalk.gray(str);
  }

  styleOptionTerm(str: string): string {
    return this.styleOptionText(str);
  }

  styleSubcommandTerm(str: string): string {
    if (!this.useColors) return str;
    return str
      .split(" ")
      .map((word) => {
        if (word === "[options]") return this.styleOptionText(word);
        if (word[0] === "[" || word[0] === "<") {
          return this.styleArgumentText(word);
        }
        return this.styleSubcommandText(word);
      })
      .join(" ");
  }

  styleArgumentTerm(str: string): string {
    return this.styleArgumentText(str);
  }

  styleOptionText(str: string): string {
    if (!this.useColors) return str;
    return chalk.yellow(str);
  }

  styleArgumentText(str: string): string {
    if (!this.useColors) return str;
    return chalk.magenta(str);
  }

  styleSubcommandText(str: string): string {
    if (!this.useColors) return str;
    return chalk.bold.green(str);
  }

  private rule(): string {
    const w = Math.min(this.helpWidth ?? 56, 72);
    const line = "─".repeat(w);
    if (!this.useColors) return line;
    return chalk.gray(line);
  }

  private banner(): string {
    if (!this.useColors) {
      return "your — macOS optimizer CLI";
    }
    return (
      chalk.bold.cyan("your") + chalk.gray(" — macOS optimizer CLI")
    );
  }

  private groupHeading(title: string): string {
    const pad = "  ";
    const bullet = this.useColors ? chalk.dim("▸") : ">";
    const label = this.useColors ? chalk.bold.white(title) : title;
    return `${pad}${bullet} ${label}`;
  }

  /**
   * Grouped subcommands for the root program; delegate to Commander default for subcommand help.
   */
  formatHelp(cmd: Command, helper: Help): string {
    if (cmd.parent !== null) {
      return super.formatHelp(cmd, helper);
    }

    const termWidth = helper.padWidth(cmd, helper);
    const helpWidth = helper.helpWidth ?? 80;

    function callFormatItem(term: string, description: string): string {
      return helper.formatItem(term, termWidth, description, helper);
    }

    const header: string[] = [];
    header.push(this.rule());
    header.push(this.banner());
    header.push(this.rule());
    header.push("");

    let output = [
      ...header,
      `${helper.styleTitle("Usage:")} ${helper.styleUsage(helper.commandUsage(cmd))}`,
      "",
    ];

    const commandDescription = helper.commandDescription(cmd);
    if (commandDescription.length > 0) {
      output = output.concat([
        helper.boxWrap(
          helper.styleCommandDescription(commandDescription),
          helpWidth,
        ),
        "",
      ]);
    }

    const argumentList = helper.visibleArguments(cmd).map((argument) => {
      return callFormatItem(
        helper.styleArgumentTerm(helper.argumentTerm(argument)),
        helper.styleArgumentDescription(helper.argumentDescription(argument)),
      );
    });
    if (argumentList.length > 0) {
      output = output.concat([helper.styleTitle("Arguments:"), ...argumentList, ""]);
    }

    const optionList = helper.visibleOptions(cmd).map((option) => {
      return callFormatItem(
        helper.styleOptionTerm(helper.optionTerm(option)),
        helper.styleOptionDescription(helper.optionDescription(option)),
      );
    });
    if (optionList.length > 0) {
      output = output.concat([helper.styleTitle("Options:"), ...optionList, ""]);
    }

    if (helper.showGlobalOptions) {
      const globalOptionList = helper
        .visibleGlobalOptions(cmd)
        .map((option) => {
          return callFormatItem(
            helper.styleOptionTerm(helper.optionTerm(option)),
            helper.styleOptionDescription(helper.optionDescription(option)),
          );
        });
      if (globalOptionList.length > 0) {
        output = output.concat([
          helper.styleTitle("Global Options:"),
          ...globalOptionList,
          "",
        ]);
      }
    }

    const visible = helper.visibleCommands(cmd);
    if (visible.length > 0) {
      const byName = new Map(visible.map((c) => [c.name(), c] as const));
      const placed = new Set<string>();
      output.push(helper.styleTitle("Commands:"));
      output.push("");

      for (const group of COMMAND_GROUPS) {
        const rows: string[] = [];
        for (const name of group.members) {
          const sub = byName.get(name);
          if (sub) {
            rows.push(
              callFormatItem(
                helper.styleSubcommandTerm(helper.subcommandTerm(sub)),
                helper.styleSubcommandDescription(
                  helper.subcommandDescription(sub),
                ),
              ),
            );
            placed.add(name);
          }
        }
        if (rows.length === 0) continue;
        output.push(this.groupHeading(group.title));
        output.push(...rows);
        output.push("");
      }

      const stray = visible.filter((c) => !placed.has(c.name()));
      if (stray.length > 0) {
        output.push(this.groupHeading("Other"));
        for (const sub of stray) {
          output.push(
            callFormatItem(
              helper.styleSubcommandTerm(helper.subcommandTerm(sub)),
              helper.styleSubcommandDescription(
                helper.subcommandDescription(sub),
              ),
            ),
          );
        }
        output.push("");
      }
    }

    return output.join("\n");
  }
}
