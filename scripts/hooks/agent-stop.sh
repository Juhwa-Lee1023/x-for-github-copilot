#!/usr/bin/env bash
set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
payload="$(cat)"
xgc_hook_log_event "agentStop" "$payload"
