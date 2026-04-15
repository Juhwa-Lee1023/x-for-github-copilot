#!/usr/bin/env bash
set -euo pipefail

# Structural validation:
# - validate manifest/config wiring
# - typecheck and test the repo
# - verify runtime mirrors stay aligned with source/

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
  npm install --prefix "$REPO_ROOT" --no-fund --no-audit
fi

npm exec --prefix "$REPO_ROOT" -- tsx "$REPO_ROOT/scripts/validate-plugin.ts"
npm run --prefix "$REPO_ROOT" typecheck
npm test --prefix "$REPO_ROOT"

echo "Plugin structure validated."
