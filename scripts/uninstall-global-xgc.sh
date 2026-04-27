#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Reuse shell-profile helpers from the installer so install/remove behavior stays aligned.
# shellcheck source=./install-global-xgc.sh
source "$REPO_ROOT/scripts/install-global-xgc.sh"

xgc_uninstall_usage() {
  cat <<'EOF'
Usage:
  bash scripts/uninstall-global-xgc.sh [--disable-only] [--reset-raw-config] [--clear-raw-state]

Modes:
  --disable-only
      Remove the XGC shell activation block from shell startup files, but keep
      ~/.copilot-xgc and ~/.config/xgc on disk.

  default (no --disable-only)
      Remove the XGC shell activation block and uninstall the dedicated XGC
      profile/config homes (~/.copilot-xgc and ~/.config/xgc).

Optional raw Copilot reset flags:
  --reset-raw-config
      Rewrite ~/.copilot/config.json to login-only state, preserving only
      last_logged_in_user and logged_in_users.

  --clear-raw-state
      Remove raw Copilot runtime state under ~/.copilot and then recreate
      ~/.copilot/config.json in login-only state. This is the strongest
      "return to raw Copilot" option and also implies --reset-raw-config.

Examples:
  bash scripts/uninstall-global-xgc.sh --disable-only
  bash scripts/uninstall-global-xgc.sh
  bash scripts/uninstall-global-xgc.sh --reset-raw-config --clear-raw-state
EOF
}

xgc_backup_copy() {
  local src="$1"
  local backup_root="$2"
  [[ -e "$src" ]] || return 0
  mkdir -p "$backup_root$(dirname "$src")"
  cp -R "$src" "$backup_root$src"
}

xgc_backup_move() {
  local src="$1"
  local backup_root="$2"
  [[ -e "$src" ]] || return 0
  mkdir -p "$backup_root$(dirname "$src")"
  mv "$src" "$backup_root$src"
}

xgc_login_only_json() {
  local config_path="$1"
  node - "$config_path" <<'NODE'
const fs = require("fs");
const configPath = process.argv[2];
function stripJsonComments(input) {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];
    if (inLineComment) {
      if (current === "\n" || current === "\r") {
        inLineComment = false;
        output += current;
      }
      continue;
    }
    if (inBlockComment) {
      if (current === "\n" || current === "\r") output += current;
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === "\"") inString = false;
      continue;
    }
    if (current === "\"") {
      inString = true;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    output += current;
  }
  return output;
}
let raw = {};
try {
  raw = JSON.parse(stripJsonComments(fs.readFileSync(configPath, "utf8")));
} catch {}
const next = {};
if (raw.last_logged_in_user) next.last_logged_in_user = raw.last_logged_in_user;
if (Array.isArray(raw.logged_in_users)) next.logged_in_users = raw.logged_in_users;
process.stdout.write(JSON.stringify(next));
NODE
}

xgc_write_login_only_config() {
  local target_path="$1"
  local login_json="$2"
  mkdir -p "$(dirname "$target_path")"
  node - "$target_path" "$login_json" <<'NODE'
const fs = require("fs");
const targetPath = process.argv[2];
const loginJson = process.argv[3] || "{}";
fs.writeFileSync(targetPath, JSON.stringify(JSON.parse(loginJson), null, 2) + "\n");
NODE
}

xgc_uninstall_main() {
  local disable_only=0
  local reset_raw_config=0
  local clear_raw_state=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --disable-only)
        disable_only=1
        ;;
      --reset-raw-config)
        reset_raw_config=1
        ;;
      --clear-raw-state)
        clear_raw_state=1
        reset_raw_config=1
        ;;
      --help|-h)
        xgc_uninstall_usage
        return 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        xgc_uninstall_usage >&2
        return 1
        ;;
    esac
    shift
  done

  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  local backup_root="$HOME/xgc-uninstall-backup-$stamp"
  mkdir -p "$backup_root"

  local raw_copilot_home="$HOME/.copilot"
  local raw_config_path="$raw_copilot_home/config.json"
  local login_json="{}"
  if [[ -f "$raw_config_path" ]]; then
    login_json="$(xgc_login_only_json "$raw_config_path")"
  fi

  pkill -f 'copilot-darwin-arm64/copilot' 2>/dev/null || true
  pkill -f '/opt/homebrew/bin/copilot' 2>/dev/null || true
  pkill -f 'xgc-update.mjs' 2>/dev/null || true

  local startup_file=""
  for startup_file in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bashrc" "$HOME/.bash_profile"; do
    [[ -f "$startup_file" ]] || continue
    if xgc_shell_profile_has_block "$startup_file"; then
      xgc_backup_copy "$startup_file" "$backup_root"
      xgc_shell_profile_remove_block "$startup_file"
    fi
  done

  if [[ $disable_only -eq 0 ]]; then
    xgc_backup_move "$HOME/.copilot-xgc" "$backup_root"
    xgc_backup_move "$HOME/.config/xgc" "$backup_root"
  fi

  if [[ $clear_raw_state -eq 1 ]]; then
    xgc_backup_move "$raw_copilot_home" "$backup_root"
    xgc_write_login_only_config "$raw_config_path" "$login_json"
  elif [[ $reset_raw_config -eq 1 ]]; then
    xgc_backup_copy "$raw_config_path" "$backup_root"
    xgc_write_login_only_config "$raw_config_path" "$login_json"
  fi

  echo "X for GitHub Copilot uninstall/disable completed."
  echo "Backup directory: $backup_root"
  if [[ $disable_only -eq 1 ]]; then
    echo "Mode: disable-only (shell activation removed, XGC profile/config kept on disk)"
  else
    echo "Mode: uninstall (shell activation removed, ~/.copilot-xgc and ~/.config/xgc removed)"
  fi
  echo "Raw Copilot config reset: $([[ $reset_raw_config -eq 1 ]] && echo yes || echo no)"
  echo "Raw Copilot runtime state cleared: $([[ $clear_raw_state -eq 1 ]] && echo yes || echo no)"
  echo
  echo "Post-remove verification:"
  echo "  1. Open a new terminal, or run: exec zsh"
  echo "  2. Run: type copilot"
  echo "  3. Run: echo \"\$XGC_COPILOT_PROFILE_HOME\""
  echo "  4. Run: copilot plugin list"
  echo
  echo "Expected results after raw revert:"
  echo "  - type copilot -> /opt/homebrew/bin/copilot"
  echo "  - XGC_COPILOT_PROFILE_HOME is empty"
  echo "  - copilot plugin list does not show xgc"
  if [[ $disable_only -eq 1 ]]; then
    echo
    echo "To re-enable later without reinstalling, source the kept shim in a fresh shell:"
    echo "  source \"$HOME/.config/xgc/xgc-shell.sh\""
    echo "Or rerun:"
    echo "  bash scripts/install-global-xgc.sh --write-shell-profile"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  xgc_uninstall_main "$@"
fi
