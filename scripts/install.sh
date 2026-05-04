#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${YOUR_REPO_URL:-https://github.com/Cosmos-0118/yourclix}"
PACKAGE_NAME="${YOUR_PACKAGE_NAME:-@yourclix/your}"
REPO_REF="${YOUR_REPO_REF:-main}"
TARGET_PACKAGE_NAME="${YOUR_TARGET_PACKAGE_NAME:-@yourclix/your}"
INSTALL_HOME="${YOUR_INSTALL_HOME:-$HOME/.your}"
SOURCE_DIR="${YOUR_SOURCE_DIR:-$INSTALL_HOME/source}"
# User-level global installs without touching ~/.npmrc `prefix` (avoids nvm conflict & zsh init warnings).
GLOBAL_NPM_PREFIX="${YOUR_GLOBAL_NPM_PREFIX:-$HOME/.npm-global}"
export GLOBAL_NPM_PREFIX

# ── terminal styling (disabled when not a TTY or NO_COLOR is set) ─────────────
if [[ -z "${NO_COLOR:-}" ]] && [[ -t 1 ]]; then
  _b=$'\033[1m'
  _dim=$'\033[2m'
  _grn=$'\033[32m'
  _cyn=$'\033[36m'
  _ylw=$'\033[33m'
  _red=$'\033[31m'
  _rst=$'\033[0m'
else
  _b="" _dim="" _grn="" _cyn="" _ylw="" _red="" _rst=""
fi

rule() { printf '%s\n' "${_dim}────────────────────────────────────────────────────────${_rst}"; }

banner() {
  rule
  printf '%s\n' "${_b}${_cyn}  your${_rst} ${_dim}— macOS optimizer CLI${_rst}"
  rule
  echo
}

msg() { printf '%s %s\n' "${_dim}•${_rst}" "$*"; }
step() { printf '%s\n' "${_cyn}▸${_rst} $*"; }
ok() { printf '%s %s\n' "${_grn}✓${_rst}" "$*"; }
warn() { printf '%s %s\n' "${_ylw}!${_rst}" "$*" >&2; }
note() { printf '%s\n' "${_dim}$*${_rst}"; }

ensure_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    ok "Homebrew present"
    return
  fi

  step "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  ok "Homebrew installed"
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    ok "Node.js $(node -p process.version 2>/dev/null || echo '') present"
    return
  fi

  step "Installing Node.js (Homebrew)"
  brew install node
  ok "Node.js installed"
}

ensure_path() {
  local shell_rc_files=("$HOME/.zprofile" "$HOME/.zshrc")

  mkdir -p "${GLOBAL_NPM_PREFIX}"

  for rc_file in "${shell_rc_files[@]}"; do
    if [[ ! -f "$rc_file" ]]; then
      touch "$rc_file"
    fi

    # Idempotent: skip if a prior run (old or new installer) already added this PATH entry.
    if grep -Fq '.npm-global/bin' "$rc_file"; then
      continue
    fi

    step "Adding user npm global bin to PATH (${rc_file})"
    cat >>"$rc_file" <<EOF

# your CLI — global npm packages (PATH only; no ~/.npmrc prefix — compatible with nvm)
export PATH="${GLOBAL_NPM_PREFIX}/bin:\$PATH"
EOF
  done

  export PATH="${GLOBAL_NPM_PREFIX}/bin:$PATH"
}

cleanup_legacy_prefix_installs() {
  local scoped_dir="@yourclix"
  local package_dir="your"
  local prefixes=("/opt/homebrew" "/usr/local")

  for prefix in "${prefixes[@]}"; do
    local legacy_bin="${prefix}/bin/your"
    local legacy_pkg="${prefix}/lib/node_modules/${scoped_dir}/${package_dir}"
    if [[ -e "$legacy_bin" || -e "$legacy_pkg" ]]; then
      step "Removing legacy install under ${prefix}"
      rm -f "$legacy_bin" >/dev/null 2>&1 || true
      rm -rf "$legacy_pkg" >/dev/null 2>&1 || true
      rmdir "${prefix}/lib/node_modules/${scoped_dir}" >/dev/null 2>&1 || true
    fi
  done
}

fix_global_bin_permissions() {
  local global_bin
  global_bin="${GLOBAL_NPM_PREFIX}/bin/your"
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
  global_root="${GLOBAL_NPM_PREFIX}/lib/node_modules"

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
    step "Removing conflicting symlink at ${install_path}"
    rm -f "$install_path"
    return
  fi

  if [[ -e "$install_path" && ! -d "$install_path" ]]; then
    step "Removing invalid artifact at ${install_path}"
    rm -f "$install_path"
  fi
}

try_install_from_registry() {
  # Expected to fail with 404 until the package is published; keep output quiet.
  if npm install -g --prefix "${GLOBAL_NPM_PREFIX}" "$PACKAGE_NAME" --no-audit --no-fund >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

sync_git_source() {
  local git_source="${REPO_URL}.git"
  mkdir -p "$INSTALL_HOME"

  if [[ -d "$SOURCE_DIR/.git" ]]; then
    step "Updating source tree (${SOURCE_DIR})"
    if ! (
      set -e
      cd "$SOURCE_DIR"
      git remote set-url origin "$git_source" 2>/dev/null || git remote add origin "$git_source"
      git fetch --depth 1 origin "$REPO_REF"
      git checkout -B "$REPO_REF" "origin/${REPO_REF}"
      git reset --hard "origin/${REPO_REF}"
    ); then
      warn "Could not fast-sync repo (resetting to fresh clone)"
      rm -rf "$SOURCE_DIR"
      git clone --depth 1 --branch "$REPO_REF" "$git_source" "$SOURCE_DIR"
    fi
    ok "Source at ${REPO_REF}"
  else
    step "Cloning ${REPO_URL} (${REPO_REF})"
    rm -rf "$SOURCE_DIR"
    git clone --depth 1 --branch "$REPO_REF" "$git_source" "$SOURCE_DIR"
    ok "Repository cloned"
  fi
}

install_from_source() {
  local git_source="${REPO_URL}.git"

  repair_global_package_conflict "$TARGET_PACKAGE_NAME"
  note "The npm package is not published yet — building from Git source."

  sync_git_source

  step "Installing dependencies and building (TypeScript compile runs via npm prepare)"
  (
    set -e
    cd "$SOURCE_DIR"
    npm install --no-audit --no-fund
    # prepare → npm run build produces dist/ for npm pack

    local package_tgz
    package_tgz="$(npm pack --silent 2>/dev/null | tail -n 1)"
    npm install -g --prefix "${GLOBAL_NPM_PREFIX}" "$package_tgz" --no-audit --no-fund
    rm -f "$package_tgz"

    rm -rf node_modules
  )
  ok "CLI installed from source"
}

install_cli() {
  step "Installing CLI (${PACKAGE_NAME})"
  if try_install_from_registry; then
    ok "Installed from npm registry"
    fix_global_bin_permissions
    return
  fi

  install_from_source
  fix_global_bin_permissions
}

install_completion() {
  step "Zsh completion"
  if command -v your >/dev/null 2>&1; then
    if your completion install --force >/dev/null 2>&1; then
      ok "Completion installed"
    else
      note "Run later: your completion install --force"
    fi
  else
    warn "'your' not on PATH yet — open a new terminal or: source ~/.zprofile"
  fi
}

final_summary() {
  local global_bin
  global_bin="${GLOBAL_NPM_PREFIX}/bin/your"

  echo
  rule
  printf '%s\n' "${_b}${_grn}Installation complete${_rst}"
  rule
  msg "Source (updates):     ${SOURCE_DIR}"
  msg "User global prefix:   ${GLOBAL_NPM_PREFIX} (not written to ~/.npmrc — nvm-safe)"
  msg "CLI:                   ${global_bin}"
  echo
  ok "Try: ${_b}your --help${_rst}"
  note "If \`your\` is not found, restart the terminal or run: source ~/.zprofile"
  if [[ -f "${HOME}/.npmrc" ]] && grep -q '^prefix=' "${HOME}/.npmrc" 2>/dev/null; then
    note "Still seeing nvm/npm warnings? Remove the old prefix line: ${_b}npm config delete prefix${_rst}"
  fi
  echo
}

main() {
  banner
  msg "Repository: ${REPO_URL}"
  echo

  ensure_homebrew
  ensure_node
  ensure_path
  cleanup_legacy_prefix_installs
  install_cli
  install_completion
  final_summary
}

main "$@"
