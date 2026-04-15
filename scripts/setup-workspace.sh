#!/usr/bin/env bash
set -euo pipefail

# Workspace prep:
# - install repo dependencies
# - ensure runtime artifact folders exist
# - regenerate runtime mirrors from source/

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "$REPO_ROOT/.xgc/logs" "$REPO_ROOT/.xgc/bootstrap" "$REPO_ROOT/.tmp"
npm install --prefix "$REPO_ROOT" --no-fund --no-audit
chmod +x "$REPO_ROOT"/scripts/*.sh
chmod +x "$REPO_ROOT"/scripts/hooks/*.sh
bash "$REPO_ROOT/scripts/generate-runtime-surfaces.sh"

echo "Workspace prepared at: $REPO_ROOT"
