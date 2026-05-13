import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";

const COMPLETION_DIR = path.join(os.homedir(), ".your", "completions");
const COMPLETION_FILE = path.join(COMPLETION_DIR, "_your");
const ZSHRC = path.join(os.homedir(), ".zshrc");

const ZSH_BLOCK_START = "# >>> your completion >>>";
const ZSH_BLOCK_END = "# <<< your completion <<<";

export function getZshCompletionScript(): string {
  return `#compdef your

_your() {
  local -a top_commands
  top_commands=(
    'setup:Install and configure developer essentials'
    'clean:Scan and clean system clutter'
    'net:Network tools'
    'spotlight:Spotlight index manager'
    'brew:Homebrew manager'
    'doctor:Analyze macOS health'
    'fix:Automatically apply safe fixes'
    'dev:Developer environment tools'
    'space:Visual disk space analyzer'
    'privacy:Privacy cleanup tools'
    'startup:Startup/login item manager'
    'plugin:Plugin management'
    'completion:Shell completion assistant'
    'backup:Backup manager'
    'help:Display help for command'
  )

  local curcontext="$curcontext" state line

  _arguments -C \
    '--help[Display help]' \
    '--version[Show version]' \
    '1:command:->command' \
    '*::arg:->args'

  case "$state" in
    command)
      _describe 'your command' top_commands
      return
      ;;
    args)
      case "\${words[2]}" in
        setup)
          _arguments '--fast[Non-interactive setup]' '--apps[Install common desktop apps]' '--profile=[Setup profile]:profile:(minimal webdev full)' '--app-mode=[Desktop app mode]:mode:(none minimal webdev full)' '--config=[Path to setup JSON config]' '--debug[Verbose setup logging]' '--dry-run[Preview only]'
          ;;
        clean)
          _arguments '--mode=[Run level]:mode:(basic deep system)' '--safe[Legacy alias for basic mode]' '--deep[Legacy alias for deep mode]' '--system[System-level cleanup mode]' '--days=[Delete only files older than N days]:days' '--verify[Run cleaner self-check]' '--dry-run[Preview only]' '-y[Skip confirmation]' '--yes[Skip confirmation]'
          ;;
        net)
          if (( CURRENT == 3 )); then
            _values 'net command' 'fix[Apply safe network fixes]' 'reset[Reset network config with backup]'
          else
            case "\${words[3]}" in
              fix)
                _arguments '--dry-run[Preview only]'
                ;;
              reset)
                _arguments '--dry-run[Preview only]' '-y[Skip confirmation]' '--yes[Skip confirmation]'
                ;;
            esac
          fi
          ;;
        spotlight)
          if (( CURRENT == 3 )); then
            _values 'spotlight command' 'status[Show indexing status]' 'reset[Reset Spotlight index]'
          else
            case "\${words[3]}" in
              reset)
                _arguments '--path=[Target path]' '--dry-run[Preview only]'
                ;;
            esac
          fi
          ;;
        brew)
          if (( CURRENT == 3 )); then
            _values 'brew command' 'doctor[Run brew doctor]' 'clean[Cleanup brew cache]' 'upgrade[Upgrade brew packages]' 'optimize[Run doctor + upgrade + clean]'
          else
            _arguments '--dry-run[Preview only]'
          fi
          ;;
        doctor)
          ;;
        fix)
          _arguments '--dry-run[Preview only]' '-y[Skip confirmation]' '--yes[Skip confirmation]'
          ;;
        dev)
          if (( CURRENT == 3 )); then
            _values 'dev command' 'clean[Clean developer caches]' 'reset[Reset one tool]'
          else
            case "\${words[3]}" in
              clean)
                _arguments '--dry-run[Preview only]' '-y[Skip confirmation]' '--yes[Skip confirmation]'
                ;;
              reset)
                if (( CURRENT == 4 )); then
                  _values 'tool' 'node[Reset Node.js]' 'python[Reset Python]' 'ruby[Reset Ruby]' 'rust[Reset Rust]' 'go[Reset Go]'
                else
                  _arguments '--dry-run[Preview only]'
                fi
                ;;
            esac
          fi
          ;;
        space)
          _arguments '--path=[Path to analyze]' '--depth=[Tree depth]'
          _files -/
          ;;
        privacy)
          if (( CURRENT == 3 )); then
            _values 'privacy command' 'clean[Clear safe privacy artifacts]'
          else
            _arguments '--dry-run[Preview only]' '-y[Skip confirmation]' '--yes[Skip confirmation]'
          fi
          ;;
        startup)
          if (( CURRENT == 3 )); then
            _values 'startup command' 'list[List startup items]' 'enable[Enable startup item]' 'disable[Disable startup item]'
          else
            case "\${words[3]}" in
              enable)
                _arguments '--path=[Full app path]' '--dry-run[Preview only]' '1:item name:_message "startup item name"'
                ;;
              disable)
                _arguments '--dry-run[Preview only]' '1:item name:_message "startup item name"'
                ;;
            esac
          fi
          ;;
        plugin)
          if (( CURRENT == 3 )); then
            _values 'plugin command' 'install[Install plugin]' 'remove[Remove plugin]'
          else
            case "\${words[3]}" in
              install|remove)
                _arguments '--dry-run[Preview only]' '1:plugin name:_message "plugin name"'
                ;;
            esac
          fi
          ;;
        completion)
          if (( CURRENT == 3 )); then
            _values 'completion command' 'zsh[Print zsh completion script]' 'install[Install zsh completion]' 'uninstall[Remove zsh completion]'
          else
            case "\${words[3]}" in
              install)
                _arguments '--shell=[Shell type]:shell:(zsh)' '--force[Re-install completion block]'
                ;;
              uninstall)
                _arguments '--shell=[Shell type]:shell:(zsh)'
                ;;
            esac
          fi
          ;;
        backup)
          if (( CURRENT == 3 )); then
            _values 'backup command' 'list[List backups]' 'remove[Delete one backup item]' 'prune[Delete old backups]'
          else
            case "\${words[3]}" in
              list)
                _arguments '--limit=[Max rows to show]'
                ;;
              remove)
                _arguments '--dry-run[Preview only]' '-y[Skip confirmation]' '--yes[Skip confirmation]' '1:backup name:_message "backup name"'
                ;;
              prune)
                _arguments '--days=[Age threshold in days]' '--dry-run[Preview only]' '-y[Skip confirmation]' '--yes[Skip confirmation]'
                ;;
            esac
          fi
          ;;
      esac
      ;;
  esac
}

compdef _your your
`;
}

export async function printZshCompletionScript(): Promise<void> {
  process.stdout.write(getZshCompletionScript());
}

export async function installZshCompletion(force = false): Promise<void> {
  await fs.mkdir(COMPLETION_DIR, { recursive: true });
  await fs.writeFile(COMPLETION_FILE, getZshCompletionScript(), "utf8");

  let zshrcContent = "";
  try {
    zshrcContent = await fs.readFile(ZSHRC, "utf8");
  } catch {
    zshrcContent = "";
  }

  const block = [
    ZSH_BLOCK_START,
    'if [ -f "$HOME/.your/completions/_your" ]; then',
    '  source "$HOME/.your/completions/_your"',
    "fi",
    ZSH_BLOCK_END,
    "",
  ].join("\n");

  const hasBlock =
    zshrcContent.includes(ZSH_BLOCK_START) &&
    zshrcContent.includes(ZSH_BLOCK_END);

  if (!hasBlock) {
    await fs.writeFile(ZSHRC, `${zshrcContent.trimEnd()}\n\n${block}`, "utf8");
  } else if (force) {
    const pattern = new RegExp(
      `${escapeRegExp(ZSH_BLOCK_START)}[\\s\\S]*?${escapeRegExp(ZSH_BLOCK_END)}\\n?`,
      "m",
    );
    const replaced = zshrcContent.replace(pattern, `${block}`);
    await fs.writeFile(ZSHRC, replaced, "utf8");
  }

  console.log(chalk.green("Zsh completion installed."));
  console.log("Run: source ~/.zshrc");
  console.log("Then try: your <TAB>");
}

export async function uninstallZshCompletion(): Promise<void> {
  let zshrcContent = "";
  try {
    zshrcContent = await fs.readFile(ZSHRC, "utf8");
  } catch {
    zshrcContent = "";
  }

  const pattern = new RegExp(
    `${escapeRegExp(ZSH_BLOCK_START)}[\\s\\S]*?${escapeRegExp(ZSH_BLOCK_END)}\\n?`,
    "m",
  );

  if (pattern.test(zshrcContent)) {
    const replaced = zshrcContent.replace(pattern, "").trimEnd() + "\n";
    await fs.writeFile(ZSHRC, replaced, "utf8");
  }

  await fs.rm(COMPLETION_FILE, { force: true });
  console.log(chalk.green("Zsh completion uninstalled."));
  console.log("Run: source ~/.zshrc");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}
