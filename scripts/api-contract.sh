#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
  PYTHON_RUNNER="$REPO_ROOT/.venv/bin/python"
else
  PYTHON_RUNNER="${PYTHON_RUNNER:-python}"
fi

case "${1:-}" in
  generate)
    "$PYTHON_RUNNER" scripts/export-openapi.py
    pnpm --filter @rationexa/api-contract generate
    ;;
  check)
    "$PYTHON_RUNNER" scripts/export-openapi.py --check
    pnpm --filter @rationexa/api-contract check
    ;;
  *)
    echo "Usage: scripts/api-contract.sh <generate|check>" >&2
    exit 2
    ;;
esac
