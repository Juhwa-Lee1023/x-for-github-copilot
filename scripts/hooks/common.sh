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
        xgc_hook_schedule_shutdown_watcher "$log_root" "$payload" "$finalize_script"
      fi
    fi
  fi
}

xgc_hook_payload_transcript_path() {
  local payload="$1"
  if ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi
  python3 - "$payload" <<'PY'
import json
import sys

try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(1)

value = data.get("transcriptPath")
if not isinstance(value, str) or not value:
    nested = data.get("input")
    if isinstance(nested, dict):
        value = nested.get("transcriptPath")
if isinstance(value, str) and value:
    print(value)
    sys.exit(0)
sys.exit(1)
PY
}

xgc_hook_transcript_has_shutdown() {
  local transcript_path="$1"
  if [[ ! -f "$transcript_path" ]] || ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi
  python3 - "$transcript_path" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
except OSError:
    sys.exit(1)

for line in lines:
    if not line.strip():
        continue
    try:
        entry = json.loads(line)
    except Exception:
        continue
    if entry.get("type") == "session.shutdown":
        sys.exit(0)
sys.exit(1)
PY
}

xgc_hook_spawn_detached_runner() {
  local runner_path="$1"

  if [[ -z "$runner_path" || ! -f "$runner_path" ]]; then
    return 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi

  python3 - "$runner_path" <<'PY'
import os
import subprocess
import sys

runner = sys.argv[1]
try:
    subprocess.Popen(
        ["bash", runner],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        start_new_session=True,
    )
except Exception:
    sys.exit(1)
PY
}

xgc_hook_schedule_shutdown_watcher() {
  local log_root="$1"
  local payload="$2"
  local finalize_script="$3"
  local max_seconds="${XGC_FINALIZER_SHUTDOWN_WATCH_SECONDS:-600}"
  local interval_seconds="${XGC_FINALIZER_SHUTDOWN_WATCH_INTERVAL_SECONDS:-15}"

  if [[ "${XGC_FINALIZER_SHUTDOWN_WATCH:-1}" == "0" ]]; then
    return 0
  fi
  if ! [[ "$max_seconds" =~ ^[0-9]+$ ]]; then
    max_seconds=600
  fi
  if ! [[ "$interval_seconds" =~ ^[0-9]+$ ]]; then
    interval_seconds=15
  fi
  if [[ "$max_seconds" -le 0 ]]; then
    return 0
  fi
  if [[ "$interval_seconds" -le 0 ]]; then
    interval_seconds=1
  fi

  local transcript_path=""
  transcript_path="$(xgc_hook_payload_transcript_path "$payload" 2>/dev/null || true)"
  if [[ -z "$transcript_path" || ! -f "$transcript_path" ]]; then
    return 0
  fi
  if xgc_hook_transcript_has_shutdown "$transcript_path"; then
    return 0
  fi

  local payload_file=""
  local runner_file=""
  payload_file="$(mktemp "${TMPDIR:-/tmp}/xgc-hook-payload.XXXXXX")" || return 0
  runner_file="$(mktemp "${TMPDIR:-/tmp}/xgc-hook-shutdown-watcher.XXXXXX")" || {
    rm -f "$payload_file"
    return 0
  }
  printf '%s' "$payload" > "$payload_file"
  cat > "$runner_file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  rm -f "${XGC_HOOK_RUNNER_FILE:-}" "${XGC_HOOK_PAYLOAD_FILE:-}"
}
trap cleanup EXIT

# shellcheck disable=SC1090
source "$XGC_HOOK_COMMON_SH"
payload="$(cat "$XGC_HOOK_PAYLOAD_FILE")"
elapsed=0
while [[ "$elapsed" -lt "$XGC_HOOK_MAX_SECONDS" ]]; do
  sleep "$XGC_HOOK_INTERVAL_SECONDS"
  elapsed=$((elapsed + XGC_HOOK_INTERVAL_SECONDS))
  if xgc_hook_transcript_has_shutdown "$XGC_HOOK_TRANSCRIPT_PATH"; then
    recovery_output=""
    recovery_status=0
    recovery_output="$(printf '%s' "$payload" | python3 "$XGC_HOOK_FINALIZE_SCRIPT" "sessionShutdownRecovery" 2>&1)" || recovery_status=$?
    if [[ "$recovery_status" -ne 0 ]]; then
      xgc_hook_log_finalizer_status "$XGC_HOOK_LOG_ROOT" "sessionShutdownRecovery" "failed" "late_shutdown_recovery_error" "$recovery_status" "$recovery_output"
    else
      xgc_hook_log_finalizer_status "$XGC_HOOK_LOG_ROOT" "sessionShutdownRecovery" "succeeded" "late_shutdown_recovery"
    fi
    exit 0
  fi
done
xgc_hook_log_finalizer_status "$XGC_HOOK_LOG_ROOT" "sessionShutdownRecovery" "skipped" "late_shutdown_not_observed"
SH
  chmod 700 "$runner_file"

  XGC_HOOK_RUNNER_FILE="$runner_file" \
    XGC_HOOK_PAYLOAD_FILE="$payload_file" \
    XGC_HOOK_COMMON_SH="${BASH_SOURCE[0]}" \
    XGC_HOOK_LOG_ROOT="$log_root" \
    XGC_HOOK_FINALIZE_SCRIPT="$finalize_script" \
    XGC_HOOK_TRANSCRIPT_PATH="$transcript_path" \
    XGC_HOOK_MAX_SECONDS="$max_seconds" \
    XGC_HOOK_INTERVAL_SECONDS="$interval_seconds" \
    xgc_hook_spawn_detached_runner "$runner_file" || {
      rm -f "$runner_file" "$payload_file"
      xgc_hook_log_finalizer_status "$log_root" "sessionShutdownRecovery" "failed" "shutdown_watcher_spawn_error"
    }
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

  local payload_file=""
  local runner_file=""
  payload_file="$(mktemp "${TMPDIR:-/tmp}/xgc-hook-payload.XXXXXX")" || return 0
  runner_file="$(mktemp "${TMPDIR:-/tmp}/xgc-hook-deferred-finalizer.XXXXXX")" || {
    rm -f "$payload_file"
    return 0
  }
  printf '%s' "$payload" > "$payload_file"
  cat > "$runner_file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  rm -f "${XGC_HOOK_RUNNER_FILE:-}" "${XGC_HOOK_PAYLOAD_FILE:-}"
}
trap cleanup EXIT

# shellcheck disable=SC1090
source "$XGC_HOOK_COMMON_SH"
payload="$(cat "$XGC_HOOK_PAYLOAD_FILE")"
sleep "$XGC_HOOK_WAIT_SECONDS"
deferred_output=""
deferred_status=0
deferred_output="$(printf '%s' "$payload" | python3 "$XGC_HOOK_FINALIZE_SCRIPT" "$XGC_HOOK_EVENT_NAME" 2>&1)" || deferred_status=$?
if [[ "$deferred_status" -ne 0 ]]; then
  xgc_hook_log_finalizer_status "$XGC_HOOK_LOG_ROOT" "$XGC_HOOK_EVENT_NAME" "failed" "deferred_finalizer_error" "$deferred_status" "$deferred_output"
else
  xgc_hook_log_finalizer_status "$XGC_HOOK_LOG_ROOT" "$XGC_HOOK_EVENT_NAME" "succeeded" "deferred_shutdown_settle"
fi
SH
  chmod 700 "$runner_file"

  XGC_HOOK_RUNNER_FILE="$runner_file" \
    XGC_HOOK_PAYLOAD_FILE="$payload_file" \
    XGC_HOOK_COMMON_SH="${BASH_SOURCE[0]}" \
    XGC_HOOK_LOG_ROOT="$log_root" \
    XGC_HOOK_FINALIZE_SCRIPT="$finalize_script" \
    XGC_HOOK_EVENT_NAME="$event_name" \
    XGC_HOOK_WAIT_SECONDS="$wait_seconds" \
    xgc_hook_spawn_detached_runner "$runner_file" || {
      rm -f "$runner_file" "$payload_file"
      xgc_hook_log_finalizer_status "$log_root" "$event_name" "failed" "deferred_finalizer_spawn_error"
    }
}
