# your

Developer-first macOS optimizer CLI.

Tagline: One command. Your Mac, optimized.

## Install

Requires Node.js 22.12.0 or newer. If Node.js is already installed, update it
before running the installer; the installer installs Node.js through Homebrew
when it is missing.

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

## Cleaner

Preview the cleanup plan before applying it:

```bash
node dist/index.js clean --mode deep --days 5 --dry-run
node dist/index.js clean --mode deep --days 5 --dry-run --verbose
node dist/index.js clean --verify
```

The cleaner scans explicit cache and log locations rather than sweeping every
hidden directory. Deep mode also discovers Bun and npx package caches, Gradle
temporary files, ignored project caches, user temporary files, and Trash.
Chromium profiles and named Electron cache directories are covered; profile
storage, unsaved editor backups, sessions, credentials, device backups, Xcode
archives, simulator runtimes, and VM/emulator disks are preserved. Reinstallable
browser binaries and managed tool runtimes are also protected. Use `your dev
clean` separately when you intend to remove project dependency trees.

`--days` applies to every ordinary cleanup target and its nested contents.
A directory with recent contents is kept even if its own modification time is
old. Paths with open files, active package-manager use, symlinks, another owner,
nested Git repositories, unreadable contents, or incomplete size measurements
are kept. Project caches must also be untracked and explicitly Git-ignored.
The process snapshot and target identity are checked again before removal;
filesystem scans are not atomic, so avoid starting builds during cleanup.

The plan separates discovered disk usage, eligible cleanup size, kept paths,
and tool-managed caches. Scan/measurement failures are reported as partial
coverage, not empty folders. `--verbose` lists eligible paths, skipped paths,
and inaccessible locations. Scans cover the configured locations, limit
project traversal to ten levels, and cap each category at 5,000 matches.
Preflight keeps any tree whose content inspection exceeds 50,000 entries.
macOS privacy restrictions can still prevent access to some locations.

By default, ordinary cleanup moves eligible paths to `~/.your-backups`; it does not
immediately free disk space. Restore with `your undo restore <id>` or review
`your backup prune --dry-run` when ready to permanently remove old backups.
At the final interactive step, choose **Move to undo backup** (the default),
**Permanently delete**, or **Cancel**. The choice applies only to that run.
Permanent deletion removes eligible paths directly with the same safety checks,
creates no undo backup, and cannot be undone through this CLI. The final
confirmation includes the selected size and removal method. Use `--permanent`
to select this mode from the command line; `-y` alone keeps backup enabled.

```bash
your clean --mode deep --days 5 --permanent --dry-run  # Preview only
your clean --mode deep --days 5 --permanent            # Confirm direct deletion
```

Permanent mode reports observed free space on the home volume before and after
removal. This measurement can include concurrent activity and APFS effects;
selected size is not a promise of bytes freed.
A dry run does not prompt, move files, prune caches, modify shell profiles, or
create an undo backup. `--verify` checks discovery and retention using an
isolated temporary fixture, without changing real caches or backup history.

uv and Gradle shared caches are measured separately. Gradle retains control
of its own dependency-cache lifecycle. uv pruning is an explicit, permanent
operation using uv's locks and unreachable-object policy, independent of
`--days` and the undo backup:

```bash
your clean --prune-uv --dry-run  # Preview only; does not invoke uv pruning
your clean --prune-uv            # Separate confirmation before native pruning
```

The uv operation uses the standard `~/.cache/uv` and `~/Library/Caches/uv`
locations, does not force locks, and fails rather than bypassing a busy cache.
Its full cache size is not an estimate of what pruning will free.

To keep additional paths, create `~/.your-config/cleaner-excludes.json` with a
JSON array of absolute or home-relative paths. Exclusions protect both ordinary
cleanup and native uv pruning; they cannot override built-in protections.
If an existing exclusion file is invalid or unreadable, cleanup stops.

```json
["~/Library/Caches/app-to-keep", "~/Developer/work/.cache"]
```

References used to check cleanup behavior: [uv cache safety](https://docs.astral.sh/uv/concepts/cache/),
[Gradle cache lifecycle](https://docs.gradle.org/current/userguide/directory_layout.html),
[Bun cache layout](https://bun.sh/docs/pm/global-cache), and
[Mole's exclusions and preview model](https://github.com/tw93/Mole#safety).
Rules and implementation remain local to this project.

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
