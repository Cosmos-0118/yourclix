# your

Developer-first macOS optimizer CLI.

Tagline: One command. Your Mac, optimized.

## Install

One-line installer:

```bash
curl -fsSL https://raw.githubusercontent.com/Cosmos-0118/yourclix/main/scripts/install.sh | bash
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
your clean [--mode basic|deep|system] [--days 30] [--verify] [--dry-run] [-y]
your net fix [--dry-run]
your net reset [--dry-run] [-y]
your spotlight status
your spotlight reset [--path /target] [--dry-run]
your brew status
your brew doctor|clean|autoremove [--dry-run]
your brew optimize [--dry-run] [--verbose] [--greedy]
your brew upgrade [--dry-run] [--verbose] [--greedy]
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
your terminal [--soft] [--history] [--dry-run] [-y]
your terminal clean  # legacy alias, same flags
your backup list [--limit 100]
your backup remove <name> [--dry-run] [-y]
your backup prune [--days 30] [--dry-run] [-y]
```

Homebrew maintenance is preview-first: `upgrade` refreshes metadata before
discovering targets, `clean` and `autoremove` preview before applying changes,
and failures in package discovery stop upgrades. Individual upgrade failures
retain their diagnostic output and allow other packages to finish. Optimize
still runs cleanup and a final doctor check, then exits nonzero for unresolved
failures. Upgrade success is verified with another outdated-package query,
so pinned or unchanged packages are not counted as successfully upgraded. Use
`your brew status` for a read-only health/freshness report and `--greedy` when
you explicitly want casks with automatic or latest-version updates included.

Deprecated and disabled packages show their reason and an interactive removal
choice in `brew doctor`, `brew upgrade`, `brew optimize`, and Homebrew fixes.
Keep is the default. Formulae required by installed packages are kept, and
Homebrew's uninstall dependency checks remain enabled. Disabled packages are
excluded from upgrades; deprecated packages can still be upgraded. A general
`--yes` does not approve removing newly discovered packages. Dry runs and
noninteractive runs keep them.

When a cask's application is missing, the CLI offers reinstall, ordinary cask
uninstall, or skip. Skipping an upgrade failure leaves it unresolved and
preserves a nonzero exit status. Reinstall/removal only runs after an explicit
interactive choice.

## Terminal UI

All commands share `src/core/ui.ts` for human output, task status, prompts, and
completion. One progress line is active at a time, including nested steps.
Logs are appended above it; prompts and inherited child processes suspend
animation. Completed commands return to the shell automatically.

Section titles and active steps use cyan; completed steps use green, warnings
amber, failures red, and skipped steps grey. Details are indented underneath
their step. Sections and detailed steps have a blank line between them, while
short successful steps stay compact. Set `NO_COLOR=1` to disable colours.
Outcome summaries show counts instead of replaying completed steps and raw
commands. Authentication guidance, advisories, and next commands use the same
indentation. Failure diagnostics stay visible; setup and network logs retain
detailed subprocess output.

Pipes, CI, dumb terminals, and redirected stdin use static output without
cursor control or input prompts. Shell completion output stays raw. Ctrl-C
cancels further work and interrupts subprocesses, with a bounded termination
fallback for children that ignore it.

New services should return structured task results and write through `ui`,
`CommandProgress`, or the shared prompt helpers. Do not start independent
spinners, mount a separate dashboard, or write directly while a task owns the
terminal. Use `runCommand` with `stdio: "inherit"` when a subprocess needs
password input; it hands over the terminal automatically.
Use `ui.heading` for sections, `ui.notice` for informational advisories,
`ui.status` for results, `ui.summary` for outcome counts, and `ui.list` for
commands or grouped values. Avoid hand-built banners and status summaries.

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
- Cleanup scans report discovered bytes first, then show the smaller set that
  passes retention and safety checks; protected paths are never overrideable.
- `your clean` and `your dev clean` move selected paths into the undo backup.
  They do not free disk space until that backup is pruned with `your backup
  prune`.
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
