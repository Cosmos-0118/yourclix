import { ui } from "./ui.js";

export function printNextCommands(title: string, commands: string[]): void {
  if (commands.length === 0) {
    return;
  }

  ui.list(title.replace(/:\s*$/, ""), commands);
}
