#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
  npm install --prefix "$REPO_ROOT" --no-fund --no-audit
fi

npm exec --prefix "$REPO_ROOT" -- tsx "$REPO_ROOT/scripts/generate-runtime-surfaces.ts" "$@"
