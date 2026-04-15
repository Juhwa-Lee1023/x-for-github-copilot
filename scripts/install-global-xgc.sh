#!/usr/bin/env bash
set -euo pipefail

# Global X for GitHub Copilot installer:
# - prepares the workspace and generated runtime mirrors
# - materializes a dedicated ~/.copilot-xgc profile
# - optionally appends a shell activation block
# - validates that the practical `copilot` front door points at X for GitHub Copilot

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

xgc_require_runtime_node_entry() {
  local compiled_path="$REPO_ROOT/runtime-dist/$1"
  if [[ -f "$compiled_path" ]]; then
    printf '%s\n' "$compiled_path"
    return 0
  fi
  echo "Missing packaged runtime entry: $compiled_path" >&2
  if [[ "${packaged_runtime:-0}" == "1" ]]; then
    echo "This packaged release is incomplete. Reinstall with: npx x-for-github-copilot install" >&2
    echo "If XGC is already installed, try: xgc update" >&2
  else
    echo "Run: npm run generate:runtime-dist" >&2
  fi
  return 1
}

resolve_raw_copilot_bin() {
  if [[ -n "${XGC_COPILOT_RAW_BIN:-}" ]]; then
    if [[ -x "${XGC_COPILOT_RAW_BIN}" ]]; then
      if xgc_is_probably_xgc_wrapper_candidate "$XGC_COPILOT_RAW_BIN"; then
        echo "XGC_COPILOT_RAW_BIN appears to point at an X for GitHub Copilot wrapper, not the raw GitHub Copilot CLI: ${XGC_COPILOT_RAW_BIN}" >&2
        return 1
      fi
      printf '%s\n' "$XGC_COPILOT_RAW_BIN"
      return 0
    fi
    echo "XGC_COPILOT_RAW_BIN is set but not executable: ${XGC_COPILOT_RAW_BIN}" >&2
    return 1
  fi

  local candidate=""
  while IFS= read -r candidate; do
    if [[ -n "$candidate" && -x "$candidate" ]] && ! xgc_is_probably_xgc_wrapper_candidate "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(
    {
      type -a copilot 2>/dev/null || true
      which -a copilot 2>/dev/null || true
    } | sed -E 's/^copilot is //' | awk '/^\// { print }' | awk '!seen[$0]++'
  )

  return 1
}

xgc_is_probably_xgc_wrapper_candidate() {
  local candidate="$1"
  local resolved_dir=""
  local resolved=""
  resolved_dir="$(cd "$(dirname "$candidate")" 2>/dev/null && pwd -P || true)"
  if [[ -n "$resolved_dir" ]]; then
    resolved="$resolved_dir/$(basename "$candidate")"
  else
    resolved="$candidate"
  fi

  case "$resolved" in
    "$HOME/.config/xgc/"*|"$REPO_ROOT/scripts/xgc-shell.sh")
      return 0
      ;;
  esac

  if [[ -f "$candidate" ]] && grep -Iq . "$candidate" 2>/dev/null; then
    if sed -n '1,120p' "$candidate" 2>/dev/null | grep -Eq 'xgc-shell\.sh|XGC_COPILOT_PROFILE_HOME|xgc__invoke|xgc global mode'; then
      return 0
    fi
  fi

  return 1
}

xgc_detect_shell_profile_path() {
  local shell_name="${1:-$(basename "${SHELL:-}")}"
  local home_dir="${2:-$HOME}"

  if [[ -n "${XGC_SHELL_PROFILE_PATH:-}" ]]; then
    printf '%s\n' "$XGC_SHELL_PROFILE_PATH"
    return 0
  fi

  case "$shell_name" in
    zsh|zsh-*) printf '%s\n' "$home_dir/.zshrc" ;;
    bash|bash-*) printf '%s\n' "$home_dir/.bashrc" ;;
    *) return 1 ;;
  esac
}

xgc_shell_source_block() {
  local config_home="$1"
  cat <<EOF
# >>> xgc global mode >>>
[[ -f "$config_home/xgc-shell.sh" ]] && source "$config_home/xgc-shell.sh"
# <<< xgc global mode <<<
EOF
}

xgc_shell_profile_has_block() {
  local profile_path="$1"
  local start_marker="# >>> xgc global mode >>>"
  local end_marker="# <<< xgc global mode <<<"

  if [[ ! -f "$profile_path" ]]; then
    return 1
  fi

  grep -Fq "$start_marker" "$profile_path" && grep -Fq "$end_marker" "$profile_path"
}

xgc_shell_profile_current_block() {
  local profile_path="$1"
  local start_marker="# >>> xgc global mode >>>"
  local end_marker="# <<< xgc global mode <<<"

  if [[ ! -f "$profile_path" ]]; then
    return 1
  fi

  awk -v start="$start_marker" -v end="$end_marker" '
    $0 == start { in_block = 1 }
    in_block { print }
    $0 == end { exit }
  ' "$profile_path"
}

xgc_shell_profile_block_matches() {
  local profile_path="$1"
  local source_block="$2"
  local existing_block=""
  existing_block="$(xgc_shell_profile_current_block "$profile_path" || true)"
  [ "$existing_block" = "$source_block" ]
}

xgc_shell_profile_remove_block() {
  local profile_path="$1"
  local start_marker="# >>> xgc global mode >>>"
  local end_marker="# <<< xgc global mode <<<"
  local tmp_path="${profile_path}.xgc-tmp.$$"

  awk -v start="$start_marker" -v end="$end_marker" '
    $0 == start { in_block = 1; next }
    $0 == end { in_block = 0; next }
    !in_block { print }
  ' "$profile_path" >"$tmp_path"
  mv "$tmp_path" "$profile_path"
}

xgc_preview_shell_profile_change() {
  local profile_path="$1"
  local source_block="$2"
  local source_command="$3"

  echo "Shell profile writes are disabled by default."
  if [[ -z "$profile_path" ]]; then
    echo "No supported shell startup file was detected for automatic X for GitHub Copilot activation."
  else
    echo "Shell profile target: $profile_path"
    if xgc_shell_profile_has_block "$profile_path"; then
      if xgc_shell_profile_block_matches "$profile_path" "$source_block"; then
        echo "X for GitHub Copilot shell block already present: yes"
      else
        echo "X for GitHub Copilot shell block already present: stale"
      fi
    else
      echo "X for GitHub Copilot shell block already present: no"
    fi
  fi
  echo "Manual activation for this shell:"
  echo "  $source_command"
  echo "To append the X for GitHub Copilot shell block automatically, rerun:"
  echo "  bash scripts/install-global-xgc.sh --write-shell-profile"
  echo "Proposed shell block:"
  printf '%s\n' "$source_block"
}

xgc_write_shell_profile_block() {
  local profile_path="$1"
  local source_block="$2"
  local source_command="$3"

  if [[ -z "$profile_path" ]]; then
    echo "Unable to determine a supported shell startup file for automatic X for GitHub Copilot activation." >&2
    echo "Activate manually with:" >&2
    echo "  $source_command" >&2
    return 1
  fi

  mkdir -p "$(dirname "$profile_path")"

  local replacing_existing_block=0
  if xgc_shell_profile_has_block "$profile_path"; then
    if ! xgc_shell_profile_block_matches "$profile_path" "$source_block"; then
      replacing_existing_block=1
    else
      echo "Shell profile already contains the X for GitHub Copilot activation block: $profile_path"
      echo "Rollback: remove the block between '# >>> xgc global mode >>>' and '# <<< xgc global mode <<<'."
      return 0
    fi
  fi

  local backup_path=""
  if [[ -f "$profile_path" ]]; then
    backup_path="${profile_path}.xgc-backup.$(date +%Y%m%d%H%M%S)"
    cp "$profile_path" "$backup_path"
  fi

  if [[ $replacing_existing_block -eq 1 ]]; then
    xgc_shell_profile_remove_block "$profile_path"
  fi

  if [[ -f "$profile_path" && -s "$profile_path" ]]; then
    printf '\n' >>"$profile_path"
  fi

  printf '%s\n' "$source_block" >>"$profile_path"

  if [[ $replacing_existing_block -eq 1 ]]; then
    echo "Refreshed stale X for GitHub Copilot activation block in shell profile: $profile_path"
  else
    echo "Updated shell profile: $profile_path"
  fi
  if [[ -n "$backup_path" ]]; then
    echo "Backup created: $backup_path"
    echo "Rollback: cp \"$backup_path\" \"$profile_path\""
  else
    echo "No previous profile existed, so no backup was needed."
    echo "Rollback: remove the block between '# >>> xgc global mode >>>' and '# <<< xgc global mode <<<'."
  fi
  echo "Manual activation command remains:"
  echo "  $source_command"
}

xgc_valid_permission_mode() {
  case "${1:-}" in
    ask|work|yolo) return 0 ;;
    *) return 1 ;;
  esac
}

xgc_valid_reasoning_effort() {
  case "${1:-}" in
    low|medium|high|xhigh|off) return 0 ;;
    *) return 1 ;;
  esac
}

xgc_prompt_permission_mode() {
  local default_mode="${1:-work}"
  local answer=""

  echo "Choose the default X for GitHub Copilot permission mode:" >&2
  echo "  ask  - prompt normally; safest default" >&2
  echo "  work - pre-approve common write/git/gh/node/npm/pnpm/npx/tsx plus selected low-risk repo discovery commands and selected MCP work, with selected denies" >&2
  echo "  yolo - pass --allow-all; fully unattended and least safe" >&2
  printf 'Default permission mode [%s]: ' "$default_mode" >&2
  read -r answer
  answer="${answer:-$default_mode}"

  if ! xgc_valid_permission_mode "$answer"; then
    echo "Invalid permission mode: $answer" >&2
    return 1
  fi

  printf '%s\n' "$answer"
}

install_global_xgc_main() {
  local run_runtime_validation=0
  local write_shell_profile=0
  local legacy_skip_profile_source=0
  local packaged_runtime=0
  local permission_mode="${XGC_PERMISSION_MODE:-}"
  local reasoning_effort="${XGC_REASONING_EFFORT:-xhigh}"
  local release_repo="${GITHUB_REPOSITORY:-Juhwa-Lee1023/x-for-github-copilot}"
  local release_tag=""
  local update_track=""
  local update_channel="stable"
  local auto_update_mode="${XGC_AUTO_UPDATE_MODE:-check}"
  local bootstrap_args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --validate-runtime)
        run_runtime_validation=1
        shift
        ;;
      --write-shell-profile|--install-shell-hook)
        write_shell_profile=1
        shift
        ;;
      --skip-profile-source)
        legacy_skip_profile_source=1
        shift
        ;;
      --packaged-runtime)
        packaged_runtime=1
        shift
        ;;
      --release-repo)
        release_repo="${2:-}"
        shift 2
        ;;
      --release-tag)
        release_tag="${2:-}"
        shift 2
        ;;
      --update-track)
        update_track="${2:-}"
        shift 2
        ;;
      --update-channel)
        update_channel="${2:-}"
        shift 2
        ;;
      --auto-update-mode)
        auto_update_mode="${2:-}"
        shift 2
        ;;
      --permission-mode)
        if [[ -z "${2:-}" ]] || ! xgc_valid_permission_mode "$2"; then
          echo "--permission-mode requires one of: ask, work, yolo" >&2
          exit 2
        fi
        permission_mode="$2"
        shift 2
        ;;
      --permission-mode=*)
        permission_mode="${1#*=}"
        if ! xgc_valid_permission_mode "$permission_mode"; then
          echo "--permission-mode requires one of: ask, work, yolo" >&2
          exit 2
        fi
        shift
        ;;
      --reasoning-effort|--effort)
        if [[ -z "${2:-}" ]] || ! xgc_valid_reasoning_effort "$2"; then
          echo "--reasoning-effort requires one of: low, medium, high, xhigh, off" >&2
          exit 2
        fi
        reasoning_effort="$2"
        shift 2
        ;;
      --reasoning-effort=*|--effort=*)
        reasoning_effort="${1#*=}"
        if ! xgc_valid_reasoning_effort "$reasoning_effort"; then
          echo "--reasoning-effort requires one of: low, medium, high, xhigh, off" >&2
          exit 2
        fi
        shift
        ;;
      *)
        bootstrap_args+=("$1")
        shift
        ;;
    esac
  done

  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to install global X for GitHub Copilot mode." >&2
    exit 1
  fi

  if [[ $packaged_runtime -eq 0 ]] && ! command -v npm >/dev/null 2>&1; then
    echo "npm is required for the repo-checkout install path." >&2
    exit 1
  fi

  if ! command -v copilot >/dev/null 2>&1; then
    echo "GitHub Copilot CLI ('copilot') is not installed or not on PATH." >&2
    echo "Install GitHub Copilot CLI first, then rerun this script." >&2
    exit 1
  fi

  local raw_copilot_bin
  raw_copilot_bin="$(resolve_raw_copilot_bin || true)"
  if [[ -z "$raw_copilot_bin" ]]; then
    echo "Unable to resolve the raw GitHub Copilot CLI binary path." >&2
    exit 1
  fi

  if [[ -z "$permission_mode" ]]; then
    if [[ -t 0 && -t 1 ]]; then
      permission_mode="$(xgc_prompt_permission_mode "work")"
    else
      permission_mode="ask"
      echo "No TTY available for permission-mode selection; using conservative default: ask"
    fi
  fi

  local install_source="repo-checkout"
  if [[ $packaged_runtime -eq 1 ]]; then
    install_source="npm-package"
  fi

  if [[ $packaged_runtime -eq 1 ]]; then
    chmod +x "$REPO_ROOT"/scripts/*.sh
    chmod +x "$REPO_ROOT"/scripts/hooks/*.sh
    echo "Using packaged XGC runtime from: $REPO_ROOT"
  else
    bash "$REPO_ROOT/scripts/setup-workspace.sh"
    if [[ ${#bootstrap_args[@]} -gt 0 ]]; then
      bash "$REPO_ROOT/scripts/bootstrap-xgc-stack.sh" "${bootstrap_args[@]}"
    else
      bash "$REPO_ROOT/scripts/bootstrap-xgc-stack.sh"
    fi
  fi

  local materialize_args=(
    --repo-root "$REPO_ROOT"
    --home-dir "$HOME"
    --raw-copilot-bin "$raw_copilot_bin"
    --permission-mode "$permission_mode"
    --reasoning-effort "$reasoning_effort"
    --install-source "$install_source"
    --release-repo "$release_repo"
    --update-channel "$update_channel"
    --auto-update-mode "$auto_update_mode"
  )
  if [[ -n "$release_tag" ]]; then
    materialize_args+=(--release-tag "$release_tag")
  fi
  if [[ -n "$update_track" ]]; then
    materialize_args+=(--update-track "$update_track")
  fi

  if [[ $packaged_runtime -eq 1 ]]; then
    node "$(xgc_require_runtime_node_entry "materialize-global-xgc.mjs")" "${materialize_args[@]}"
  else
    npm exec --prefix "$REPO_ROOT" -- tsx "$REPO_ROOT/scripts/materialize-global-xgc.ts" "${materialize_args[@]}"
  fi

  local config_home="$HOME/.config/xgc"
  local profile_home="$HOME/.copilot-xgc"
  mkdir -p "$config_home"
  cp "$REPO_ROOT/scripts/xgc-shell.sh" "$config_home/xgc-shell.sh"
  chmod +x "$config_home/xgc-shell.sh"

  COPILOT_HOME="$profile_home" bash "$REPO_ROOT/scripts/use-xgc-env.sh" "$raw_copilot_bin" plugin install "$REPO_ROOT"
  COPILOT_HOME="$profile_home" bash "$REPO_ROOT/scripts/use-xgc-env.sh" "$raw_copilot_bin" plugin list

  local shell_profile=""
  shell_profile="$(xgc_detect_shell_profile_path "$(basename "${SHELL:-}")" "$HOME" || true)"
  local source_command="source \"$config_home/xgc-shell.sh\""
  local source_block
  source_block="$(xgc_shell_source_block "$config_home")"

  if [[ $legacy_skip_profile_source -eq 1 ]]; then
    echo "--skip-profile-source is deprecated and now a no-op because shell profile writes are opt-in by default."
  fi

  if [[ $write_shell_profile -eq 1 ]]; then
    xgc_write_shell_profile_block "$shell_profile" "$source_block" "$source_command"
  else
    xgc_preview_shell_profile_change "$shell_profile" "$source_block" "$source_command"
  fi

  echo "Global X for GitHub Copilot mode installed."
  echo "Profile home: $profile_home"
  echo "Config home: $config_home"
  echo "Raw Copilot binary: $raw_copilot_bin"
  echo "Permission mode: $permission_mode"
  echo "Reasoning effort: $reasoning_effort"
  echo
  echo "Start using it:"
  echo "  1. Open a new terminal, or run: exec zsh"
  echo "  2. Run: copilot"
  echo "  3. Optional: use /model inside Copilot if you want a different root model for this session"
  echo
  echo "Useful commands:"
  echo "  copilot      - X for GitHub Copilot front door"
  echo "  copilot_raw  - raw GitHub Copilot CLI without the XGC shim"
  echo "  xgc_mode ask|work|yolo - change the current shell permission mode"
  echo "  XGC_REASONING_EFFORT=off copilot - run without the default reasoning-effort injection"
  echo
  echo "Later, if you want raw Copilot again:"
  if [[ $packaged_runtime -eq 1 ]]; then
    echo "  xgc uninstall --disable-only"
    echo "  xgc uninstall --reset-raw-config --clear-raw-state"
    echo
    echo "Installed-runtime maintenance commands:"
    echo "  xgc doctor"
    echo "  xgc update --check"
    echo "  xgc update"
    echo "  xgc status"
  else
    echo "  bash scripts/uninstall-global-xgc.sh --disable-only"
    echo "  bash scripts/uninstall-global-xgc.sh --reset-raw-config --clear-raw-state"
  fi
  echo
  echo "Verify shell activation in a new interactive shell, for example: zsh -ic 'type copilot; copilot --version'"
  echo "Do not use 'zsh -l -c' as the activation check on macOS; .zshrc is interactive-shell startup state."
  echo "Use 'copilot_raw' to bypass the X for GitHub Copilot shim after you source or reload your shell."
  echo "Convenience wrappers: xgc, xgc_scout, xgc_plan, xgc_triage, xgc_patch, xgc_review, xgc_check"

  if [[ $run_runtime_validation -eq 1 ]]; then
    if [[ $packaged_runtime -eq 1 ]]; then
      echo "Skipping live runtime validation for packaged install; it requires repo-checkout dev tooling." >&2
      echo "Packaged validation continues with: xgc doctor / runtime-dist validate-global-xgc." >&2
    else
      npm run --prefix "$REPO_ROOT" validate:runtime
    fi
  fi

  if [[ $packaged_runtime -eq 1 ]]; then
    node "$(xgc_require_runtime_node_entry "validate-global-xgc.mjs")" \
      --repo-root "$REPO_ROOT" \
      --home-dir "$HOME"
  else
    npm exec --prefix "$REPO_ROOT" -- tsx "$REPO_ROOT/scripts/validate-global-xgc.ts" \
      --repo-root "$REPO_ROOT" \
      --home-dir "$HOME"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  install_global_xgc_main "$@"
fi
