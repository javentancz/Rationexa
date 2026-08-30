#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir/.."

if [ -x .venv/bin/python ]; then
  exec .venv/bin/python -m uvicorn rationexa_api.main:app --host 127.0.0.1 --port 8000
fi

exec python -m uvicorn rationexa_api.main:app --host 127.0.0.1 --port 8000
