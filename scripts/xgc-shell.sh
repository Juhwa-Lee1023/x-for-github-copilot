#!/usr/bin/env bash

# X for GitHub Copilot shell shim:
# - keeps raw Copilot CLI available as copilot_raw
# - makes plain `copilot` behave like the X front door in a dedicated profile
# - preserves explicit --agent and --config-dir choices
# - disables built-in GitHub MCP context on local-context lanes unless the caller explicitly opts in
# - explicitly disables github-mcp-server alongside builtin MCP suppression on local-context lanes
# - disables experimental cross-session context features on local-context lanes
# - remembers repo-level GitHub probe 404 history so repeated runs can suppress earlier
# - supports XGC_PERMISSION_MODE={ask,work,yolo} for install-time or session-time permission defaults

# This shim is commonly sourced from zsh via .zshrc. Keep BASH_SOURCE inside
# a bash-only branch: zsh with nounset treats BASH_SOURCE[0] as unset.
if [[ -n "${BASH_VERSION-}" ]]; then
  if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    echo "Source this file instead of executing it directly:" >&2
    echo "  source \"$0\"" >&2
    exit 1
  fi
fi

XGC__INITIAL_PROFILE_HOME_SET=0
XGC__INITIAL_CONFIG_HOME_SET=0
XGC__INITIAL_RAW_BIN_SET=0
XGC__INITIAL_ENV_FILE_SET=0
XGC__INITIAL_HOOK_SCRIPT_ROOT_SET=0
XGC__INITIAL_PERMISSION_MODE_SET=0
XGC__INITIAL_AUTO_UPDATE_MODE_SET=0
XGC__INITIAL_COPILOT_HOME_SET=0

if [[ ${XGC_COPILOT_PROFILE_HOME+x} ]]; then
  XGC__INITIAL_PROFILE_HOME_SET=1
  XGC__INITIAL_PROFILE_HOME="$XGC_COPILOT_PROFILE_HOME"
else
  XGC__INITIAL_PROFILE_HOME=""
fi

if [[ ${XGC_COPILOT_CONFIG_HOME+x} ]]; then
  XGC__INITIAL_CONFIG_HOME_SET=1
  XGC__INITIAL_CONFIG_HOME="$XGC_COPILOT_CONFIG_HOME"
else
  XGC__INITIAL_CONFIG_HOME=""
fi

if [[ ${XGC_COPILOT_RAW_BIN+x} ]]; then
  XGC__INITIAL_RAW_BIN_SET=1
  XGC__INITIAL_RAW_BIN="$XGC_COPILOT_RAW_BIN"
else
  XGC__INITIAL_RAW_BIN=""
fi

if [[ ${XGC_ENV_FILE+x} ]]; then
  XGC__INITIAL_ENV_FILE_SET=1
  XGC__INITIAL_ENV_FILE="$XGC_ENV_FILE"
else
  XGC__INITIAL_ENV_FILE=""
fi

if [[ ${XGC_HOOK_SCRIPT_ROOT+x} ]]; then
  XGC__INITIAL_HOOK_SCRIPT_ROOT_SET=1
  XGC__INITIAL_HOOK_SCRIPT_ROOT="$XGC_HOOK_SCRIPT_ROOT"
else
  XGC__INITIAL_HOOK_SCRIPT_ROOT=""
fi

if [[ ${XGC_PERMISSION_MODE+x} ]]; then
  XGC__INITIAL_PERMISSION_MODE_SET=1
  XGC__INITIAL_PERMISSION_MODE="$XGC_PERMISSION_MODE"
else
  XGC__INITIAL_PERMISSION_MODE=""
fi

if [[ ${XGC_AUTO_UPDATE_MODE+x} ]]; then
  XGC__INITIAL_AUTO_UPDATE_MODE_SET=1
  XGC__INITIAL_AUTO_UPDATE_MODE="$XGC_AUTO_UPDATE_MODE"
else
  XGC__INITIAL_AUTO_UPDATE_MODE=""
fi

if [[ ${COPILOT_HOME+x} ]]; then
  XGC__INITIAL_COPILOT_HOME_SET=1
  XGC__INITIAL_COPILOT_HOME="$COPILOT_HOME"
else
  XGC__INITIAL_COPILOT_HOME=""
fi

XGC_COPILOT_PROFILE_HOME="${XGC_COPILOT_PROFILE_HOME:-$HOME/.copilot-xgc}"
XGC_COPILOT_CONFIG_HOME="${XGC_COPILOT_CONFIG_HOME:-$HOME/.config/xgc}"
XGC__DEFAULT_PROFILE_HOME="$XGC_COPILOT_PROFILE_HOME"
XGC__DEFAULT_CONFIG_HOME="$XGC_COPILOT_CONFIG_HOME"
XGC_PROFILE_ENV_FILE="${XGC_PROFILE_ENV_FILE:-$XGC_COPILOT_CONFIG_HOME/profile.env}"

if [[ -f "$XGC_PROFILE_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$XGC_PROFILE_ENV_FILE"
fi

if [[ "${XGC__INITIAL_PROFILE_HOME_SET:-0}" -eq 1 ]]; then
  XGC_COPILOT_PROFILE_HOME="$XGC__INITIAL_PROFILE_HOME"
else
  XGC_COPILOT_PROFILE_HOME="$XGC__DEFAULT_PROFILE_HOME"
fi

if [[ "${XGC__INITIAL_CONFIG_HOME_SET:-0}" -eq 1 ]]; then
  XGC_COPILOT_CONFIG_HOME="$XGC__INITIAL_CONFIG_HOME"
else
  XGC_COPILOT_CONFIG_HOME="$XGC__DEFAULT_CONFIG_HOME"
fi

if [[ "${XGC__INITIAL_RAW_BIN_SET:-0}" -eq 1 ]]; then
  XGC_COPILOT_RAW_BIN="$XGC__INITIAL_RAW_BIN"
fi

if [[ "${XGC__INITIAL_ENV_FILE_SET:-0}" -eq 1 ]]; then
  XGC_ENV_FILE="$XGC__INITIAL_ENV_FILE"
fi

XGC_ENV_FILE="${XGC_ENV_FILE:-$XGC_COPILOT_CONFIG_HOME/env.sh}"
XGC_HOOK_SCRIPT_ROOT="${XGC_HOOK_SCRIPT_ROOT:-$XGC_COPILOT_CONFIG_HOME/hooks}"

if [[ "${XGC__INITIAL_HOOK_SCRIPT_ROOT_SET:-0}" -eq 1 ]]; then
  XGC_HOOK_SCRIPT_ROOT="$XGC__INITIAL_HOOK_SCRIPT_ROOT"
fi

if [[ "${XGC__INITIAL_PERMISSION_MODE_SET:-0}" -eq 1 ]]; then
  XGC_PERMISSION_MODE="$XGC__INITIAL_PERMISSION_MODE"
fi

if [[ "${XGC__INITIAL_AUTO_UPDATE_MODE_SET:-0}" -eq 1 ]]; then
  XGC_AUTO_UPDATE_MODE="$XGC__INITIAL_AUTO_UPDATE_MODE"
fi

if [[ "${XGC__INITIAL_COPILOT_HOME_SET:-0}" -eq 1 ]]; then
  COPILOT_HOME="$XGC__INITIAL_COPILOT_HOME"
  export COPILOT_HOME
else
  unset COPILOT_HOME
fi

export XGC_COPILOT_PROFILE_HOME
export XGC_COPILOT_CONFIG_HOME
export XGC_ENV_FILE
export XGC_HOOK_SCRIPT_ROOT
export XGC_PERMISSION_MODE="${XGC_PERMISSION_MODE:-ask}"
export XGC_AUTO_UPDATE_MODE="${XGC_AUTO_UPDATE_MODE:-check}"
export XGC_RUNTIME_HOME="${XGC_RUNTIME_HOME:-$HOME/.local/share/xgc/current}"

xgc__resolve_raw_copilot_bin() {
  local candidates=""
  local candidate

  if [[ -n "${ZSH_VERSION-}" ]] && command -v whence >/dev/null 2>&1; then
    candidates="$(whence -pa copilot 2>/dev/null || true)"
  fi

  if [[ -z "$candidates" && -n "${BASH_VERSION-}" ]]; then
    candidates="$(type -P -a copilot 2>/dev/null || true)"
  fi

  if [[ -z "$candidates" ]]; then
    candidates="$(command -v copilot 2>/dev/null || true)"
  fi

  while IFS= read -r candidate; do
    if xgc__valid_raw_copilot_candidate "$candidate"; then
      printf '%s\n' "$candidate"
      return
    fi
  done <<EOF
$candidates
EOF
}

xgc__xgc_wrapper_candidate() {
  local candidate="$1"
  [[ -f "$candidate" ]] || return 1
  grep -Eiq 'xgc__invoke|XGC_COPILOT_PROFILE_HOME|\.copilot-xgc|X for GitHub Copilot shell shim' "$candidate" 2>/dev/null
}

xgc__valid_raw_copilot_candidate() {
  local candidate="$1"
  [[ -n "$candidate" && -x "$candidate" && ! -d "$candidate" ]] || return 1
  xgc__xgc_wrapper_candidate "$candidate" && return 1
  return 0
}

if [[ -z "${XGC_COPILOT_RAW_BIN:-}" ]]; then
  XGC_COPILOT_RAW_BIN="$(xgc__resolve_raw_copilot_bin)"
fi

xgc__require_raw_bin() {
  if ! xgc__valid_raw_copilot_candidate "${XGC_COPILOT_RAW_BIN:-}"; then
    local resolved=""
    resolved="$(xgc__resolve_raw_copilot_bin)"
    if [[ -n "$resolved" ]]; then
      XGC_COPILOT_RAW_BIN="$resolved"
      export XGC_COPILOT_RAW_BIN
    fi
  fi

  if ! xgc__valid_raw_copilot_candidate "${XGC_COPILOT_RAW_BIN:-}"; then
    echo "X for GitHub Copilot shell shim could not find the raw GitHub Copilot CLI binary." >&2
    echo "Set XGC_COPILOT_RAW_BIN or install GitHub Copilot CLI first." >&2
    return 1
  fi
}

xgc__load_env() {
  local keep_profile_home="${XGC_COPILOT_PROFILE_HOME:-}"
  local keep_config_home="${XGC_COPILOT_CONFIG_HOME:-}"
  local keep_raw_bin="${XGC_COPILOT_RAW_BIN:-}"
  local keep_env_file="${XGC_ENV_FILE:-}"
  local keep_hook_script_root="${XGC_HOOK_SCRIPT_ROOT:-}"
  local keep_permission_mode="${XGC_PERMISSION_MODE:-}"
  local keep_auto_update_mode="${XGC_AUTO_UPDATE_MODE:-}"
  local keep_path="${PATH:-}"
  local keep_copilot_home_set=0
  local keep_copilot_home=""
  if [[ ${COPILOT_HOME+x} ]]; then
    keep_copilot_home_set=1
    keep_copilot_home="$COPILOT_HOME"
  fi
  if [[ -f "$XGC_ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$XGC_ENV_FILE"
  fi
  XGC_COPILOT_PROFILE_HOME="$keep_profile_home"
  XGC_COPILOT_CONFIG_HOME="$keep_config_home"
  XGC_COPILOT_RAW_BIN="$keep_raw_bin"
  XGC_ENV_FILE="$keep_env_file"
  XGC_HOOK_SCRIPT_ROOT="$keep_hook_script_root"
  XGC_PERMISSION_MODE="$keep_permission_mode"
  XGC_AUTO_UPDATE_MODE="$keep_auto_update_mode"
  PATH="$keep_path"
  if [[ $keep_copilot_home_set -eq 1 ]]; then
    COPILOT_HOME="$keep_copilot_home"
    export COPILOT_HOME
  else
    unset COPILOT_HOME
  fi
  export XGC_COPILOT_PROFILE_HOME
  export XGC_COPILOT_CONFIG_HOME
  export XGC_COPILOT_RAW_BIN
  export XGC_ENV_FILE
  export XGC_HOOK_SCRIPT_ROOT
  export XGC_PERMISSION_MODE
  export XGC_AUTO_UPDATE_MODE
  export PATH
}

xgc__is_management_command() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      help|version|auth|plugin|doctor|config|--help|--version|-h)
        return 0
        ;;
    esac
  done
  return 1
}

xgc__has_flag() {
  local needle="$1"
  shift
  local arg
  for arg in "$@"; do
    case "$arg" in
      "$needle"|"$needle"=*)
        return 0
        ;;
    esac
  done
  return 1
}

xgc__extract_flag_value() {
  local needle="$1"
  shift
  local arg
  local previous=""
  for arg in "$@"; do
    if [[ "$previous" == "$needle" ]]; then
      printf '%s\n' "$arg"
      return 0
    fi
    case "$arg" in
      "$needle"=*)
        printf '%s\n' "${arg#*=}"
        return 0
        ;;
    esac
    previous="$arg"
  done
  return 1
}

xgc__extract_prompt_value() {
  xgc__extract_flag_value "--prompt" "$@" && return 0
  xgc__extract_flag_value "-p" "$@" && return 0
  return 1
}

xgc__is_runtime_cli_subcommand() {
  case "${1:-}" in
    install|doctor|update|uninstall|status|help|--help|-h)
      return 0
      ;;
  esac
  return 1
}

xgc__runtime_cli_bin() {
  local runtime_home="${XGC_RUNTIME_HOME:-$HOME/.local/share/xgc/current}"
  local cli="$runtime_home/bin/xgc.mjs"
  [[ -f "$cli" ]] || return 1
  printf '%s\n' "$cli"
}

xgc__dispatch_runtime_cli() {
  local cli=""
  cli="$(xgc__runtime_cli_bin)" || {
    echo "Installed X for GitHub Copilot runtime CLI is missing." >&2
    echo "Run: npx x-for-github-copilot install" >&2
    return 1
  }
  command -v node >/dev/null 2>&1 || {
    echo "node is required for xgc ${1:-command}" >&2
    return 1
  }
  XGC_SKIP_SELF_DISPATCH=1 node "$cli" "$@"
}

xgc__agent_skips_github_context() {
  local agent_id="$1"
  case "$agent_id" in
    repo-master|repo-scout|ref-index|milestone|triage|patch-master|required-check)
      return 0
      ;;
  esac
  return 1
}

xgc__has_explicit_tool_selection() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --available-tools|--available-tools=*|--excluded-tools|--excluded-tools=*)
        return 0
        ;;
    esac
  done
  return 1
}

xgc__has_explicit_permission_override() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --allow-all|--yolo|--allow-all-tools|--allow-all-paths|--allow-all-urls|--allow-tool|--allow-tool=*|--deny-tool|--deny-tool=*|--allow-url|--allow-url=*|--deny-url|--deny-url=*)
        return 0
        ;;
    esac
  done
  return 1
}

xgc__permission_flags() {
  case "${XGC_PERMISSION_MODE:-ask}" in
    ask|"")
      ;;
    work)
      printf '%s\n' \
        "--allow-tool=write" \
        "--allow-tool=shell(git:*)" \
        "--allow-tool=shell(gh:*)" \
        "--allow-tool=shell(printf:*)" \
        "--allow-tool=shell(node:*)" \
        "--allow-tool=shell(npm:*)" \
        "--allow-tool=shell(pnpm:*)" \
        "--allow-tool=shell(npx:*)" \
        "--allow-tool=shell(tsx:*)" \
        "--allow-tool=shell(rg:*)" \
        "--allow-tool=shell(ls:*)" \
        "--allow-tool=context7" \
        "--allow-tool=grep_app" \
        "--allow-url=github.com" \
        "--allow-url=docs.github.com" \
        "--allow-url=raw.githubusercontent.com" \
        "--deny-tool=shell(rm)" \
        "--deny-tool=shell(git push)"
      ;;
    yolo)
      printf '%s\n' "--allow-all"
      ;;
    *)
      echo "[X for GitHub Copilot] Unknown XGC_PERMISSION_MODE=${XGC_PERMISSION_MODE}; falling back to ask." >&2
      ;;
  esac
}

xgc__has_explicit_github_mcp_override() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --disable-builtin-mcps|--disable-mcp-server|--disable-mcp-server=*|--enable-all-github-mcp-tools|--add-github-mcp-toolset|--add-github-mcp-toolset=*|--add-github-mcp-tool|--add-github-mcp-tool=*)
        return 0
        ;;
    esac
  done
  return 1
}

xgc__has_explicit_experimental_context_override() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --no-experimental)
        return 0
        ;;
    esac
  done
  return 1
}

xgc__probe_cache_file() {
  if [[ "${XGC_DISABLE_PROBE_CACHE:-0}" == "1" ]]; then
    return 1
  fi
  printf '%s\n' "$XGC_COPILOT_CONFIG_HOME/github-probe-cache.tsv"
}

xgc__ensure_probe_cache_file() {
  if [[ "${XGC_DISABLE_PROBE_CACHE:-0}" == "1" ]]; then
    return 0
  fi
  mkdir -p "$XGC_COPILOT_CONFIG_HOME"
  local cache_file
  cache_file="$(xgc__probe_cache_file)"
  [[ -f "$cache_file" ]] || : >"$cache_file"
}

xgc__current_repo_identity() {
  local repo_root=""
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -z "$repo_root" ]]; then
    return 1
  fi

  local remote_url=""
  remote_url="$(git -C "$repo_root" config --get remote.origin.url 2>/dev/null || true)"
  case "$remote_url" in
    git@github.com:*.git)
      printf '%s\n' "${remote_url#git@github.com:}" | xgc__normalize_github_repo_identity
      return 0
      ;;
    git@github.com:*)
      printf '%s\n' "${remote_url#git@github.com:}" | xgc__normalize_github_repo_identity
      return 0
      ;;
    https://github.com/*.git)
      printf '%s\n' "${remote_url#https://github.com/}" | xgc__normalize_github_repo_identity
      return 0
      ;;
    https://github.com/*)
      printf '%s\n' "${remote_url#https://github.com/}" | xgc__normalize_github_repo_identity
      return 0
      ;;
    ssh://git@github.com/*.git)
      printf '%s\n' "${remote_url#ssh://git@github.com/}" | xgc__normalize_github_repo_identity
      return 0
      ;;
    ssh://git@github.com/*)
      printf '%s\n' "${remote_url#ssh://git@github.com/}" | xgc__normalize_github_repo_identity
      return 0
      ;;
    git+ssh://git@github.com/*.git)
      printf '%s\n' "${remote_url#git+ssh://git@github.com/}" | xgc__normalize_github_repo_identity
      return 0
      ;;
    git+ssh://git@github.com/*)
      printf '%s\n' "${remote_url#git+ssh://git@github.com/}" | xgc__normalize_github_repo_identity
      return 0
      ;;
  esac

  return 1
}

xgc__normalize_github_repo_identity() {
  sed 's:/*$::; s/\.git$//'
}

xgc__current_repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || true
}

xgc__probe_cache_has_kind() {
  local repo_identity="$1"
  local probe_kind="$2"
  local session_identity="${3:-}"
  local cache_file=""
  cache_file="$(xgc__probe_cache_file)"
  [[ -n "$cache_file" ]] || return 1
  [[ -f "$cache_file" ]] || return 1
  local line=""
  local line_repo=""
  local line_kind=""
  local line_session=""
  local remaining=""
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    [[ "$line" == *$'\t'* ]] || continue
    line_repo="${line%%$'\t'*}"
    remaining="${line#*$'\t'}"
    [[ "$remaining" == *$'\t'* ]] || continue
    line_kind="${remaining%%$'\t'*}"
    remaining="${remaining#*$'\t'}"
    line_session=""
    if [[ "$remaining" == *$'\t'* ]]; then
      line_session="${remaining%%$'\t'*}"
    fi
    [[ "$line_repo" == "$repo_identity" ]] || continue
    [[ "$line_kind" == "$probe_kind" ]] || continue
    if [[ -n "$session_identity" && -n "$line_session" && "$line_session" != "$session_identity" ]]; then
      continue
    fi
    return 0
  done <"$cache_file"
  return 1
}

xgc__probe_cache_has_any() {
  local repo_identity="$1"
  local cache_file=""
  cache_file="$(xgc__probe_cache_file)"
  [[ -n "$cache_file" ]] || return 1
  [[ -f "$cache_file" ]] || return 1
  grep -Fqs -- "$repo_identity"$'\t' "$cache_file"
}

xgc__probe_cache_record_kind() {
  local repo_identity="$1"
  local probe_kind="$2"
  local session_identity="${3:-unknown-session}"
  xgc__ensure_probe_cache_file
  local cache_file=""
  cache_file="$(xgc__probe_cache_file)"
  [[ -n "$cache_file" ]] || return 0
  if ! xgc__probe_cache_has_kind "$repo_identity" "$probe_kind" "$session_identity"; then
    printf '%s\t%s\t%s\t%s\n' "$repo_identity" "$probe_kind" "$session_identity" "$(date -u +%FT%TZ)" >>"$cache_file"
  fi
}

xgc__process_log_session_id() {
  local log_file="$1"
  sed -n 's/^.*Workspace initialized: \([^ ]\+\) (checkpoints:.*$/\1/p' "$log_file" | head -n 1
}

xgc__process_log_matches_repo() {
  local log_file="$1"
  local repo_identity="$2"
  local repo_root="${3:-}"

  if [[ -n "$repo_root" ]] && grep -Fqs -- "$repo_root" "$log_file"; then
    return 0
  fi
  if grep -Fqs -- "/repos/$repo_identity/" "$log_file"; then
    return 0
  fi
  return 1
}

xgc__process_log_has_memory_404() {
  local log_file="$1"
  local repo_identity="$2"
  local probe_kind="$3"
  if grep -F -- "/internal/memory/v0/$repo_identity/$probe_kind" "$log_file" 2>/dev/null | grep -Eq '(^|[^0-9])404([^0-9]|$)|failed with status 404'; then
    return 0
  fi
  if grep -F -- "/internal/memory/$repo_identity/$probe_kind" "$log_file" 2>/dev/null | grep -Eq '(^|[^0-9])404([^0-9]|$)|failed with status 404'; then
    return 0
  fi
  return 1
}

xgc__probe_cache_seed_from_process_logs() {
  local repo_identity="$1"
  local repo_root="${2:-}"
  if [[ "${XGC_DISABLE_PROBE_CACHE:-0}" == "1" ]]; then
    return 0
  fi
  local log_root="$XGC_COPILOT_PROFILE_HOME/logs"
  [[ -d "$log_root" ]] || return 0

  local log_file=""
  local log_session_id=""
  local log_files=()
  local memory_enabled_success_pattern="Memory enablement check: enabled"

  while IFS= read -r log_file; do
    [[ -n "$log_file" ]] && log_files+=("$log_file")
  done < <(find "$log_root" -maxdepth 1 -type f -name 'process-*.log' 2>/dev/null | sort)

  for log_file in "${log_files[@]}"; do
    log_session_id="$(xgc__process_log_session_id "$log_file")"
    [[ -n "$log_session_id" ]] || log_session_id="unknown-session"
    if xgc__process_log_has_memory_404 "$log_file" "$repo_identity" "enabled"; then
      xgc__probe_cache_record_kind "$repo_identity" "memory-enabled" "$log_session_id"
    fi
    if xgc__process_log_has_memory_404 "$log_file" "$repo_identity" "prompt"; then
      xgc__probe_cache_record_kind "$repo_identity" "memory-prompt" "$log_session_id"
    fi
    if xgc__process_log_matches_repo "$log_file" "$repo_identity" "$repo_root" && grep -Fqs -- "$memory_enabled_success_pattern" "$log_file"; then
      xgc__probe_cache_record_kind "$repo_identity" "memory-enabled-success" "$log_session_id"
    fi
    if grep -F -- "/repos/$repo_identity/pulls?head=" "$log_file" | grep -Eq " - 2[0-9][0-9] "; then
      xgc__probe_cache_record_kind "$repo_identity" "pr-lookup-success" "$log_session_id"
    fi
    if grep -F -- "/repos/$repo_identity/pulls?head=" "$log_file" | grep -Eq " 404 "; then
      xgc__probe_cache_record_kind "$repo_identity" "pr-lookup" "$log_session_id"
    fi
  done
}

xgc__invoke() {
  local default_agent="$1"
  shift

  xgc__require_raw_bin || return 1
  xgc__load_env

  local use_xgc_profile=1
  local inject_default_agent=1

  if xgc__has_flag "--config-dir" "$@"; then
    use_xgc_profile=0
    inject_default_agent=0
  fi

  if xgc__has_flag "--agent" "$@"; then
    inject_default_agent=0
  fi

  if xgc__is_management_command "$@"; then
    inject_default_agent=0
  fi

  local cmd=("$XGC_COPILOT_RAW_BIN")
  local selected_agent="$default_agent"
  local disable_builtin_mcps=0
  local disable_experimental_context=0
  local inject_permission_flags=0
  local rewritten_args=("$@")
  local repo_identity=""
  local repo_root=""
  local repo_probe_history=0
  local repo_identity_missing=0
  local repo_memory_probe_failure_history=0
  local repo_memory_probe_success_history=0
  local repo_pr_probe_failure_history=0

  if [[ $inject_default_agent -eq 0 ]] && xgc__has_flag "--agent" "$@"; then
    selected_agent="$(xgc__extract_flag_value "--agent" "$@" || printf '%s' "$default_agent")"
  fi

  repo_identity="$(xgc__current_repo_identity 2>/dev/null || true)"
  repo_root="$(xgc__current_repo_root 2>/dev/null || true)"
  if [[ -z "$repo_identity" ]]; then
    repo_identity_missing=1
  fi
  if [[ -n "$repo_identity" ]]; then
    xgc__probe_cache_seed_from_process_logs "$repo_identity" "$repo_root"
    if xgc__probe_cache_has_any "$repo_identity"; then
      repo_probe_history=1
    fi
    if xgc__probe_cache_has_kind "$repo_identity" "memory-enabled" || xgc__probe_cache_has_kind "$repo_identity" "memory-prompt"; then
      repo_memory_probe_failure_history=1
    fi
    if xgc__probe_cache_has_kind "$repo_identity" "pr-lookup"; then
      repo_pr_probe_failure_history=1
    fi
    if xgc__probe_cache_has_kind "$repo_identity" "memory-enabled-success"; then
      repo_memory_probe_success_history=1
    fi
  fi

  if [[ $use_xgc_profile -eq 1 ]] && ! xgc__is_management_command "$@"; then
    if ! xgc__has_explicit_github_mcp_override "$@" && ! xgc__has_explicit_tool_selection "$@"; then
      if xgc__agent_skips_github_context "$selected_agent"; then
        disable_builtin_mcps=1
      elif [[ $repo_identity_missing -eq 1 ]]; then
        disable_builtin_mcps=1
      elif [[ $repo_pr_probe_failure_history -eq 1 ]]; then
        disable_builtin_mcps=1
      fi
    fi
    if ! xgc__has_explicit_experimental_context_override "$@" && ! xgc__has_explicit_github_mcp_override "$@"; then
      if xgc__agent_skips_github_context "$selected_agent" || [[ $repo_identity_missing -eq 1 ]] || [[ $repo_probe_history -eq 1 ]] || [[ $repo_memory_probe_failure_history -eq 1 ]] || [[ $repo_memory_probe_success_history -eq 1 ]]; then
        disable_experimental_context=1
      fi
    fi
    if ! xgc__has_explicit_permission_override "$@"; then
      inject_permission_flags=1
    fi
  fi

  if [[ $inject_permission_flags -eq 1 ]]; then
    local permission_flag=""
    while IFS= read -r permission_flag; do
      [[ -n "$permission_flag" ]] && cmd+=("$permission_flag")
    done < <(xgc__permission_flags)
  fi
  if [[ $disable_builtin_mcps -eq 1 ]]; then
    cmd+=("--disable-builtin-mcps")
    cmd+=("--disable-mcp-server=github-mcp-server")
  fi
  if [[ $disable_experimental_context -eq 1 ]]; then
    cmd+=("--no-experimental")
  fi

  if [[ $inject_default_agent -eq 1 ]]; then
    cmd+=("--agent" "$default_agent")
  fi

  if [[ $use_xgc_profile -eq 1 ]]; then
    COPILOT_HOME="$XGC_COPILOT_PROFILE_HOME" "${cmd[@]}" "${rewritten_args[@]}"
    local exit_code=$?
    if [[ -n "$repo_identity" ]]; then
      xgc__probe_cache_seed_from_process_logs "$repo_identity" "$repo_root"
    fi
    return $exit_code
  else
    "${cmd[@]}" "${rewritten_args[@]}"
  fi
}

copilot_raw() {
  xgc__require_raw_bin || return 1
  xgc__load_env
  "$XGC_COPILOT_RAW_BIN" "$@"
}

xgc__write_preflight_diagnostic() {
  local output="$1"
  local exit_code="$2"
  local log_root="${XGC_PREFLIGHT_LOG_ROOT:-${PWD:-.}/.xgc/validation}"
  local log_path=""

  if mkdir -p "$log_root" 2>/dev/null; then
    log_path="$log_root/preflight-diagnostic.log"
    {
      printf 'COMMAND: COPILOT_HOME="%s" "%s" --disable-builtin-mcps --disable-mcp-server=github-mcp-server --no-experimental --no-remote --no-custom-instructions --silent --prompt "Reply exactly: XGC_PREFLIGHT_OK"\n' \
        "$XGC_COPILOT_PROFILE_HOME" \
        "$XGC_COPILOT_RAW_BIN"
      printf 'EXIT_CODE: %s\n\n' "$exit_code"
      printf '%s\n' "$output"
    } > "$log_path" 2>/dev/null || log_path=""
  fi

  printf '%s' "$log_path"
}

xgc_preflight() {
  xgc__require_raw_bin || return 1
  xgc__load_env

  local output_file
  output_file="$(mktemp "${TMPDIR:-/tmp}/xgc-preflight.XXXXXX")" || return 1
  local preflight_status=0
  COPILOT_HOME="$XGC_COPILOT_PROFILE_HOME" "$XGC_COPILOT_RAW_BIN" \
    --disable-builtin-mcps \
    --disable-mcp-server=github-mcp-server \
    --no-experimental \
    --no-remote \
    --no-custom-instructions \
    --silent \
    --prompt "Reply exactly: XGC_PREFLIGHT_OK" >"$output_file" 2>&1 || preflight_status=$?

  local output
  output="$(cat "$output_file" 2>/dev/null || true)"
  rm -f "$output_file"
  local diagnostic_log=""
  if [[ $preflight_status -ne 0 ]]; then
    diagnostic_log="$(xgc__write_preflight_diagnostic "$output" "$preflight_status")"
  fi

  if printf '%s\n' "$output" | grep -Eiq 'Access denied by policy settings|Copilot CLI policy setting|organization has restricted Copilot access|subscription does not include this feature|required policies have not been enabled|Copilot Pro trials have been temporarily paused|upgrade your account|revert to Copilot Free'; then
    echo "X for GitHub Copilot live preflight failed: Copilot policy or plan entitlement blocked prompt generation." >&2
    echo "Check Copilot settings, organization policy, subscription, and model access before retrying." >&2
    [[ -n "$diagnostic_log" ]] && echo "Diagnostic log: $diagnostic_log" >&2
    return 4
  fi

  if printf '%s\n' "$output" | grep -Eiq 'Authorization error|you may need to run /login|not authenticated|authentication required|authentication failed|login required|please log in|sign in|unauthorized|forbidden|(^|[^0-9])(401|403)([^0-9]|$)'; then
    echo "X for GitHub Copilot live preflight failed: Copilot auth is not ready for prompt generation." >&2
    echo "Run: copilot --config-dir \"$XGC_COPILOT_PROFILE_HOME\" login" >&2
    [[ -n "$diagnostic_log" ]] && echo "Diagnostic log: $diagnostic_log" >&2
    return 2
  fi

  if printf '%s\n' "$output" | grep -Eiq 'Unable to load available models list'; then
    echo "X for GitHub Copilot live preflight failed: model availability could not be loaded." >&2
    echo "Check Copilot plan/model entitlement, then retry from a sourced X for GitHub Copilot shell." >&2
    [[ -n "$diagnostic_log" ]] && echo "Diagnostic log: $diagnostic_log" >&2
    return 3
  fi

  if [[ $preflight_status -ne 0 ]]; then
    echo "X for GitHub Copilot live preflight failed with exit code $preflight_status." >&2
    printf '%s\n' "$output" >&2
    [[ -n "$diagnostic_log" ]] && echo "Diagnostic log: $diagnostic_log" >&2
    return "$preflight_status"
  fi

  echo "X for GitHub Copilot live preflight passed for profile: $XGC_COPILOT_PROFILE_HOME"
}

unalias copilot xgc xgc_scout xgc_plan xgc_triage xgc_patch xgc_review xgc_check xgc_mode xgc_update copilot_raw 2>/dev/null || true

copilot() {
  xgc__invoke "repo-master" "$@"
}

xgc() {
  if xgc__is_runtime_cli_subcommand "${1:-}"; then
    xgc__dispatch_runtime_cli "$@"
    return $?
  fi
  xgc__invoke "repo-master" "$@"
}

xgc_scout() {
  xgc__invoke "repo-scout" "$@"
}

xgc_plan() {
  xgc__invoke "milestone" "$@"
}

xgc_triage() {
  xgc__invoke "triage" "$@"
}

xgc_patch() {
  xgc__invoke "patch-master" "$@"
}

xgc_review() {
  xgc__invoke "merge-gate" "$@"
}

xgc_check() {
  xgc__invoke "required-check" "$@"
}

xgc_mode() {
  case "${1:-}" in
    ask|work|yolo)
      export XGC_PERMISSION_MODE="$1"
      echo "X for GitHub Copilot permission mode: $XGC_PERMISSION_MODE"
      ;;
    "")
      echo "X for GitHub Copilot permission mode: ${XGC_PERMISSION_MODE:-ask}"
      ;;
    *)
      echo "usage: xgc_mode {ask|work|yolo}" >&2
      return 2
      ;;
  esac
}

xgc_update() {
  xgc__dispatch_runtime_cli update "$@"
}

xgc__spawn_detached() {
  if command -v nohup >/dev/null 2>&1; then
    ( nohup "$@" >/dev/null 2>&1 & ) >/dev/null 2>&1
  else
    ( "$@" >/dev/null 2>&1 & ) >/dev/null 2>&1
  fi
}

xgc__maybe_background_update() {
  [[ -n "${XGC_DISABLE_AUTO_UPDATE:-}" ]] && return 0
  [[ "$-" == *i* ]] || return 0

  local updater="$XGC_COPILOT_CONFIG_HOME/xgc-update.mjs"
  [[ -f "$updater" ]] || return 0
  command -v node >/dev/null 2>&1 || return 0

  case "${XGC_AUTO_UPDATE_MODE:-check}" in
    off)
      return 0
      ;;
    check)
      xgc__spawn_detached node "$updater" --home-dir "$HOME" --check --if-due --quiet
      ;;
    apply)
      xgc__spawn_detached node "$updater" --home-dir "$HOME" --if-due --quiet
      ;;
  esac
}

xgc__maybe_background_update
