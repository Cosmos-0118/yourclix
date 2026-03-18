#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATH_LINE='if command -v npm >/dev/null 2>&1; then export PATH="$(npm prefix -g)/bin:$PATH"; fi'

ensure_path_line() {
	local target_file="$1"

	if [[ ! -f "$target_file" ]]; then
		touch "$target_file"
	fi

	if ! grep -Fq "$PATH_LINE" "$target_file"; then
		{
			echo ""
			echo "# your CLI global npm path"
			echo "$PATH_LINE"
		} >>"$target_file"
	fi
}

cd "$ROOT_DIR"

npm config delete prefix >/dev/null 2>&1 || true

ensure_path_line "$HOME/.zprofile"
ensure_path_line "$HOME/.zshrc"

export PATH="$(npm prefix -g)/bin:$PATH"

npm install
npm run build
npm install -g .

GLOBAL_BIN="$(npm prefix -g)/bin/your"
if [[ -e "$GLOBAL_BIN" ]]; then
	chmod +x "$GLOBAL_BIN" >/dev/null 2>&1 || true
	if [[ -L "$GLOBAL_BIN" ]]; then
		GLOBAL_TARGET="$(readlink "$GLOBAL_BIN")"
		GLOBAL_TARGET_ABS="$(cd "$(dirname "$GLOBAL_BIN")" && cd "$(dirname "$GLOBAL_TARGET")" && pwd)/$(basename "$GLOBAL_TARGET")"
		chmod +x "$GLOBAL_TARGET_ABS" >/dev/null 2>&1 || true
	fi
fi

if command -v your >/dev/null 2>&1; then
	your completion install --force >/dev/null 2>&1 || true
fi

echo "Installed local your CLI globally."
echo "Run: your --help"
echo "Autocomplete: your completion install --force"
echo "If needed, restart terminal or run: source ~/.zprofile"
