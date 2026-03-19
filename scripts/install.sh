#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${YOUR_REPO_URL:-https://github.com/Cosmos-0118/yourclix}"
PACKAGE_NAME="${YOUR_PACKAGE_NAME:-@yourclix/your}"
REPO_REF="${YOUR_REPO_REF:-main}"
TARGET_PACKAGE_NAME="${YOUR_TARGET_PACKAGE_NAME:-@yourclix/your}"
INSTALL_HOME="${YOUR_INSTALL_HOME:-$HOME/.your}"
SOURCE_DIR="${YOUR_SOURCE_DIR:-$INSTALL_HOME/source}"

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
  local marker="export PATH=\"$HOME/.npm-global/bin:$PATH\""
  local shell_rc_files=("$HOME/.zprofile" "$HOME/.zshrc")

  mkdir -p "$HOME/.npm-global"
  npm config set prefix "$HOME/.npm-global" >/dev/null

  for rc_file in "${shell_rc_files[@]}"; do
    if [[ ! -f "$rc_file" ]]; then
      touch "$rc_file"
    fi

    if ! grep -Fq "$marker" "$rc_file"; then
      print_step "Updating PATH in $rc_file"
      {
        echo ""
        echo "# your CLI global npm path"
        echo "$marker"
      } >>"$rc_file"
    fi
  done

  export PATH="$HOME/.npm-global/bin:$PATH"
}

cleanup_legacy_prefix_installs() {
  local scoped_dir="@yourclix"
  local package_dir="your"
  local prefixes=("/opt/homebrew" "/usr/local")

  for prefix in "${prefixes[@]}"; do
    local legacy_bin="${prefix}/bin/your"
    local legacy_pkg="${prefix}/lib/node_modules/${scoped_dir}/${package_dir}"
    if [[ -e "$legacy_bin" || -e "$legacy_pkg" ]]; then
      print_step "Removing legacy install from ${prefix}"
      rm -f "$legacy_bin" >/dev/null 2>&1 || true
      rm -rf "$legacy_pkg" >/dev/null 2>&1 || true

      # Remove now-empty scope directory if present.
      rmdir "${prefix}/lib/node_modules/${scoped_dir}" >/dev/null 2>&1 || true
    fi
  done
}

fix_global_bin_permissions() {
  local global_bin
  global_bin="$(npm prefix -g)/bin/your"
  if [[ -e "$global_bin" ]]; then
    chmod +x "$global_bin" >/dev/null 2>&1 || true
    if [[ -L "$global_bin" ]]; then
      local global_target
      local global_target_abs
      global_target="$(readlink "$global_bin")"
      global_target_abs="$(cd "$(dirname "$global_bin")" && cd "$(dirname "$global_target")" && pwd)/$(basename "$global_target")"
      chmod +x "$global_target_abs" >/dev/null 2>&1 || true
    fi
  fi
}

resolve_global_package_path() {
  local package_name="$1"
  local global_root
  global_root="$(npm prefix -g)/lib/node_modules"

  if [[ "$package_name" == @*/* ]]; then
    local scope
    local name
    scope="${package_name%%/*}"
    name="${package_name##*/}"
    echo "${global_root}/${scope}/${name}"
    return
  fi

  echo "${global_root}/${package_name}"
}

repair_global_package_conflict() {
  local package_name="$1"
  local install_path
  install_path="$(resolve_global_package_path "$package_name")"

  if [[ -L "$install_path" ]]; then
    print_step "Removing conflicting symlink install at ${install_path}"
    rm -f "$install_path"
    return
  fi

  if [[ -e "$install_path" && ! -d "$install_path" ]]; then
    print_step "Removing invalid install artifact at ${install_path}"
    rm -f "$install_path"
  fi
}

install_cli() {
  print_step "Installing ${PACKAGE_NAME} globally"
  if npm install -g "$PACKAGE_NAME"; then
    fix_global_bin_permissions
    return
  fi

  local git_source
  git_source="${REPO_URL}.git"

  repair_global_package_conflict "$TARGET_PACKAGE_NAME"
  print_step "npm package not available; installing from repository source"
  mkdir -p "$INSTALL_HOME"

  if [[ -d "$SOURCE_DIR/.git" ]]; then
    print_step "Updating local source at ${SOURCE_DIR}"
    if ! (
      cd "$SOURCE_DIR"
      git fetch --depth 1 origin "$REPO_REF"
      git checkout "$REPO_REF"
      git pull --ff-only origin "$REPO_REF"
    ); then
      print_step "Local source update failed; re-cloning fresh copy"
      rm -rf "$SOURCE_DIR"
      git clone --depth 1 --branch "$REPO_REF" "$git_source" "$SOURCE_DIR"
    fi
  else
    print_step "Cloning ${git_source} (${REPO_REF}) to ${SOURCE_DIR}"
    rm -rf "$SOURCE_DIR"
    git clone --depth 1 --branch "$REPO_REF" "$git_source" "$SOURCE_DIR"
  fi

  print_step "Building CLI from source"
  (
    cd "$SOURCE_DIR"
    npm install
    npm run build

    local package_tgz
    package_tgz="$(npm pack --silent | tail -n 1)"
    npm install -g "$package_tgz"
    rm -f "$package_tgz"

    # Keep source tree lightweight; next install/update will restore deps when needed.
    rm -rf node_modules
  )

  fix_global_bin_permissions
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
  local global_prefix
  local global_bin
  global_prefix="$(npm prefix -g)"
  global_bin="${global_prefix}/bin/your"

  print_step "Installation complete"
  echo "Stored source: ${SOURCE_DIR}"
  echo "Global prefix: ${global_prefix}"
  echo "CLI binary: ${global_bin}"
  echo "Run: your --help"
  echo "If command is not found, restart terminal or run: source ~/.zprofile"
}

main() {
  print_step "Starting install for your CLI"
  print_step "Source repository: ${REPO_URL}"
  ensure_homebrew
  ensure_node
  ensure_path
  cleanup_legacy_prefix_installs
  install_cli
  install_completion
  final_message
}

main "$@"
