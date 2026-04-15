#!/usr/bin/env bash
set -euo pipefail

xgc_hook_resolve_workspace_root() {
  local payload="$1"
  if ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi
  python3 - "$payload" <<'PY'
import json
import sys

raw = sys.argv[1]
try:
    data = json.loads(raw)
except Exception:
    sys.exit(0)

input_data = data.get("input") if isinstance(data, dict) else None
candidates = []
if isinstance(data, dict):
    candidates.extend([data.get("gitRoot"), data.get("cwd")])
if isinstance(input_data, dict):
    candidates.extend([input_data.get("gitRoot"), input_data.get("cwd")])

for item in candidates:
    if isinstance(item, str) and item:
        print(item)
        break
PY
}

xgc_hook_json_escape() {
  local text="$1"

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$text" <<'PY'
import json
import sys

text = sys.argv[1]
print(json.dumps(text)[1:-1], end="")
PY
    return
  fi

  text="${text//\\/\\\\}"
  text="${text//\"/\\\"}"
  text="${text//$'\b'/\\b}"
  text="${text//$'\f'/\\f}"
  text="${text//$'\n'/\\n}"
  text="${text//$'\r'/\\r}"
  text="${text//$'\t'/\\t}"
  printf '%s' "$text"
}

xgc_hook_log_finalizer_status() {
  local log_root="$1"
  local event_name="$2"
  local status="$3"
  local reason="$4"
  local exit_code="${5:-0}"
  local message="${6:-}"
  local escaped_reason=""
  local escaped_message=""

  escaped_reason="$(xgc_hook_json_escape "$reason")"
  escaped_message="$(xgc_hook_json_escape "$message")"
  printf '%s finalizeSessionSummary {"triggerEvent":"%s","status":"%s","reason":"%s","exitCode":%s,"message":"%s"}\n' \
    "$(date -u +%FT%TZ)" \
    "$event_name" \
    "$status" \
    "$escaped_reason" \
    "$exit_code" \
    "$escaped_message" >> "$log_root/hooks.log"
}

xgc_hook_log_event() {
  local event_name="$1"
  local payload="$2"
  local log_root="${XGC_LOG_ROOT:-}"

  if [[ -z "$log_root" ]]; then
    local workspace_root=""
    workspace_root="$(xgc_hook_resolve_workspace_root "$payload")"
    if [[ -n "$workspace_root" ]]; then
      log_root="$workspace_root/.xgc/logs"
    else
      local fallback_root
      fallback_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
      log_root="$fallback_root/.xgc/logs"
    fi
  fi

  mkdir -p "$log_root"
  printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$event_name" "$payload" >> "$log_root/hooks.log"

  local finalize_script=""
  finalize_script="$(dirname "${BASH_SOURCE[0]}")/finalize-session-summary.py"
  if [[ "$event_name" == "sessionStart" || "$event_name" == "agentStop" || "$event_name" == "subagentStop" || "$event_name" == "errorOccurred" ]]; then
    if ! command -v python3 >/dev/null 2>&1; then
      xgc_hook_log_finalizer_status "$log_root" "$event_name" "skipped" "python3_unavailable"
    elif [[ ! -f "$finalize_script" ]]; then
      xgc_hook_log_finalizer_status "$log_root" "$event_name" "skipped" "finalizer_missing"
    else
      local finalize_output=""
      local finalize_status=0
      finalize_output="$(printf '%s' "$payload" | python3 "$finalize_script" "$event_name" 2>&1)" || finalize_status=$?
      if [[ "$finalize_status" -ne 0 ]]; then
        xgc_hook_log_finalizer_status "$log_root" "$event_name" "failed" "finalizer_error" "$finalize_status" "$finalize_output"
      fi
      if [[ "$event_name" == "agentStop" || "$event_name" == "subagentStop" ]]; then
        xgc_hook_schedule_deferred_finalizer "$log_root" "$event_name" "$payload" "$finalize_script"
      fi
    fi
  fi
}

xgc_hook_schedule_deferred_finalizer() {
  local log_root="$1"
  local event_name="$2"
  local payload="$3"
  local finalize_script="$4"
  local wait_seconds="${XGC_FINALIZER_DEFERRED_WAIT_SECONDS:-45}"

  if [[ "${XGC_FINALIZER_DEFERRED:-1}" == "0" ]]; then
    return 0
  fi
  if ! [[ "$wait_seconds" =~ ^[0-9]+$ ]]; then
    wait_seconds=45
  fi
  if [[ "$wait_seconds" -le 0 ]]; then
    return 0
  fi

  (
    sleep "$wait_seconds"
    local deferred_output=""
    local deferred_status=0
    deferred_output="$(printf '%s' "$payload" | python3 "$finalize_script" "$event_name" 2>&1)" || deferred_status=$?
    if [[ "$deferred_status" -ne 0 ]]; then
      xgc_hook_log_finalizer_status "$log_root" "$event_name" "failed" "deferred_finalizer_error" "$deferred_status" "$deferred_output"
    else
      xgc_hook_log_finalizer_status "$log_root" "$event_name" "succeeded" "deferred_shutdown_settle"
    fi
  ) >/dev/null 2>&1 < /dev/null &
}
