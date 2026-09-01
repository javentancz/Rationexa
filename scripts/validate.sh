#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
  PYTHON_RUNNER="$REPO_ROOT/.venv/bin/python"
else
  PYTHON_RUNNER="${PYTHON_RUNNER:-python}"
fi

echo "[validate] API contract"
pnpm api:contract:check

echo "[validate] TypeScript and lint"
pnpm check

echo "[validate] Next.js production build"
pnpm --filter @rationexa/web build

echo "[validate] Python lint"
"$PYTHON_RUNNER" -m ruff check services/api/src services/api/tests services/api/migrations

echo "[validate] API tests"
"$PYTHON_RUNNER" -m pytest services/api/tests

echo "[validate] Python dependency audit"
"$PYTHON_RUNNER" -m pip_audit --local

echo "[validate] Production dependency audit"
pnpm audit --prod --audit-level high

if [[ "${CI:-false}" == "true" ]]; then
  echo "[validate] Install Playwright Chromium"
  pnpm --filter @rationexa/web exec playwright install --with-deps chromium
fi

echo "[validate] Browser tests"
pnpm --filter @rationexa/web test:e2e

echo "[validate] All checks passed"
