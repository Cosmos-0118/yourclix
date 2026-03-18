# Manual Recovery Guide

This guide is for situations where reset/reconfigure commands do not verify successfully.

## Network Reset Recovery

1. Open System Settings > Network and verify Wi-Fi/Ethernet services exist.
2. Restore backup files from `~/.your-backups/network-<timestamp>` to `/Library/Preferences/SystemConfiguration/` using `sudo cp`.
3. Run:
   - `sudo killall -HUP mDNSResponder`
   - `networksetup -listallnetworkservices`
4. If still broken, reboot and retry: `your net reset -y`.

## Spotlight Reset Recovery

1. Run:
   - `sudo mdutil -i on /`
   - `sudo mdutil -E /`
   - `mdutil -s /`
2. If indexing stays disabled, reboot and run the commands again.

## Dev Reset Recovery

If `your dev reset <tool>` fails verification:

1. Reinstall manually with Homebrew:
   - `brew uninstall <tool-package>`
   - `brew install <tool-package>`
2. Verify tool:
   - Node: `node --version`
   - Python: `python3 --version`
   - Ruby: `ruby --version`
   - Rust: `rustc --version`
   - Go: `go version`

## Startup Item Recovery

If startup enable/disable verification fails:

1. Open System Settings > General > Login Items and make the change manually.
2. Verify state with `your startup list`.

## General Rule

When verification fails:

1. Use the command's printed "Manual recovery checklist".
2. Re-run in `--dry-run` mode first if available.
3. Re-run the command after manual repair.
