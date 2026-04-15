#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${XGC_ENV_FILE:-$HOME/.config/xgc/env.sh}"
SESSION_ENV_FILE="${XGC_SESSION_ENV_FILE:-$REPO_ROOT/.xgc/bootstrap/session-env.sh}"
XGC__KEEP_PATH="${PATH:-}"
XGC__KEEP_COPILOT_HOME="${COPILOT_HOME:-}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

if [[ -f "$SESSION_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$SESSION_ENV_FILE"
fi

PATH="$XGC__KEEP_PATH"
if [[ -n "$XGC__KEEP_COPILOT_HOME" ]]; then
  COPILOT_HOME="$XGC__KEEP_COPILOT_HOME"
  export COPILOT_HOME
else
  unset COPILOT_HOME
fi
export PATH

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 1
fi

exec "$@"
