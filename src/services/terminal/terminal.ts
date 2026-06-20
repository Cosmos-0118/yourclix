export function runTerminalClean(): void {
  if (!process.stdout.isTTY) {
    return;
  }

  // Clear entire screen (\x1b[2J), clear scrollback buffer (\x1b[3J), 
  // and move cursor to home (\x1b[H)
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}
