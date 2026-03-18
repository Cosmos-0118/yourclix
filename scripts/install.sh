#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${YOUR_REPO_URL:-https://github.com/yourclix/your}"
PACKAGE_NAME="${YOUR_PACKAGE_NAME:-@yourclix/your}"

print_step() {
  echo "[your-install] $1"
}

ensure_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    print_step "Homebrew already installed"
    return
  fi

  print_step "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    print_step "Node.js already installed"
    return
  fi

  print_step "Installing Node.js via Homebrew"
  brew install node
}

ensure_path() {
  local zprofile="$HOME/.zprofile"
  local marker="export PATH=\"$HOME/.npm-global/bin:$PATH\""

  mkdir -p "$HOME/.npm-global"
  npm config set prefix "$HOME/.npm-global" >/dev/null

  if [[ ! -f "$zprofile" ]]; then
    touch "$zprofile"
  fi

  if ! grep -Fq "$marker" "$zprofile"; then
    print_step "Updating PATH in $zprofile"
    {
      echo ""
      echo "# your CLI global npm path"
      echo "$marker"
    } >>"$zprofile"
  fi

  export PATH="$HOME/.npm-global/bin:$PATH"
}

install_cli() {
  print_step "Installing ${PACKAGE_NAME} globally"
  npm install -g "$PACKAGE_NAME"
}

install_completion() {
  print_step "Installing zsh autocomplete"
  if command -v your >/dev/null 2>&1; then
    if your completion install --force >/dev/null 2>&1; then
      print_step "Autocomplete installed"
    else
      print_step "Autocomplete install skipped (run: your completion install --force)"
    fi
  else
    print_step "Autocomplete install skipped because 'your' is not yet on PATH"
  fi
}

final_message() {
  print_step "Installation complete"
  echo "Run: your --help"
  echo "If command is not found, restart terminal or run: source ~/.zprofile"
}

main() {
  print_step "Starting install for your CLI"
  print_step "Source repository: ${REPO_URL}"
  ensure_homebrew
  ensure_node
  ensure_path
  install_cli
  install_completion
  final_message
}

main "$@"
