#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "scripts/sync-agents.sh is deprecated. Use scripts/generate-runtime-surfaces.sh instead." >&2
exec bash "$REPO_ROOT/scripts/generate-runtime-surfaces.sh" "$@"
