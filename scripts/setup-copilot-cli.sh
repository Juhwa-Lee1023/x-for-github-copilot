#!/usr/bin/env bash
set -euo pipefail

# Project-local setup:
# - prepare workspace dependencies
# - bootstrap MCP/LSP choices
# - install the plugin into the active Copilot profile
# - optionally run live runtime validation

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_RUNTIME_VALIDATION=0
BOOTSTRAP_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --validate-runtime)
      RUN_RUNTIME_VALIDATION=1
      shift
      ;;
    *)
      BOOTSTRAP_ARGS+=("$1")
      shift
      ;;
  esac
done

bash "$REPO_ROOT/scripts/setup-workspace.sh"
bash "$REPO_ROOT/scripts/bootstrap-xgc-stack.sh" "${BOOTSTRAP_ARGS[@]}"

if ! command -v copilot >/dev/null 2>&1; then
  echo "GitHub Copilot CLI ('copilot') is not installed or not on PATH." >&2
  echo "Install GitHub Copilot CLI first, then rerun this script." >&2
  exit 1
fi

bash "$REPO_ROOT/scripts/use-xgc-env.sh" copilot plugin install "$REPO_ROOT"
bash "$REPO_ROOT/scripts/use-xgc-env.sh" copilot plugin list

echo "Installed plugin from: $REPO_ROOT"

if [[ $RUN_RUNTIME_VALIDATION -eq 1 ]]; then
  npm run --prefix "$REPO_ROOT" validate:runtime
else
  echo "Next steps:"
  echo "- Structural validation: npm run validate"
  echo "- Optional live runtime validation: npm run validate:runtime"
fi
