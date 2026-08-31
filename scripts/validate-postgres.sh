#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
  PYTHON_RUNNER="$REPO_ROOT/.venv/bin/python"
else
  PYTHON_RUNNER="${PYTHON_RUNNER:-python}"
fi

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  echo "[validate-postgres] TEST_DATABASE_URL is required" >&2
  exit 2
fi

if [[ "$TEST_DATABASE_URL" != postgresql* ]]; then
  echo "[validate-postgres] TEST_DATABASE_URL must use PostgreSQL" >&2
  exit 2
fi

echo "[validate-postgres] API tests in an isolated PostgreSQL schema"
"$PYTHON_RUNNER" -m pytest services/api/tests

echo "[validate-postgres] All PostgreSQL checks passed"
