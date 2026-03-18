# your

Developer-first macOS optimizer CLI.

Tagline: One command. Your Mac, optimized.

## Install

One-line installer:

```bash
curl -fsSL https://raw.githubusercontent.com/yourclix/your/main/scripts/install.sh | bash
```

Local development install:

```bash
./scripts/dev-install-local.sh
```

## Global Command

After installation, the CLI is available as:

```bash
your
```

## Core Commands

```bash
your setup [--fast] [--apps] [--profile minimal|webdev|full] [--app-mode none|minimal|webdev|full] [--config ./setup.config.json] [--debug] [--dry-run]
your clean [--mode basic|deep|system] [--verify] [--dry-run] [-y]
your net fix [--dry-run]
your net reset [--dry-run] [-y]
your spotlight status
your spotlight reset [--path /target] [--dry-run]
your brew doctor|clean|upgrade|optimize [--dry-run]
your doctor
your fix [--dry-run] [-y]
your dev clean [--dry-run] [-y]
your dev reset <tool> [--dry-run]
your space [--path ~/Developer] [--depth 2]
your privacy clean [--dry-run] [-y]
your startup list
your startup disable <name> [--dry-run]
your plugin install <name> [--dry-run]
your plugin remove <name> [--dry-run]
your completion zsh
your completion install [--shell zsh] [--force]
```

## Autocomplete Assistant

Install zsh autocomplete:

```bash
your completion install
source ~/.zshrc
```

Manual setup:

```bash
your completion zsh > ~/.your/completions/_your
source ~/.zshrc
```

## Safety Model

- Safe by default.
- Global `--dry-run` on destructive operations.
- Confirmation prompts for risky deletions and resets.
- Network reset creates backups before removing plist files.

## Architecture

```text
src/
  commands/   # Commander command bindings
  services/   # Business logic for each domain
  core/       # Shared execution, prompts, formatting, fs helpers
  index.ts    # CLI entrypoint
scripts/
  install.sh          # One-line install target
  dev-install-local.sh
```

## Build and Run

```bash
npm install
npm run build
node dist/index.js --help
```

## Publish

```bash
npm publish --access public
```

## Notes

- Requires macOS for most optimization commands.
- Some network and Spotlight operations require sudo.
