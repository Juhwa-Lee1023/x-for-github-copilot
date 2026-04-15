#!/usr/bin/env bash
set -euo pipefail

# Fast operator smoke:
# - prepare workspace
# - bootstrap conservative MCP/LSP config
# - run structural validation
# - leave live runtime validation as an explicit follow-up

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$REPO_ROOT/scripts/setup-workspace.sh"
bash "$REPO_ROOT/scripts/bootstrap-xgc-stack.sh" --yes --skip-install --skip-profile
bash "$REPO_ROOT/scripts/validate-plugin.sh"

if command -v copilot >/dev/null 2>&1; then
  echo "copilot CLI detected. Run 'npm run validate:runtime' for live post-install validation."
else
  echo "copilot CLI not detected. Structural smoke test only."
fi

echo "Smoke test completed. Structural parity is validated; full runtime parity is not claimed."
