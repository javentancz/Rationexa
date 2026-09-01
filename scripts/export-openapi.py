#!/usr/bin/env python3
"""Export Rationexa's FastAPI schema as a stable, reviewable JSON contract."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
API_SOURCE = REPO_ROOT / "services" / "api" / "src"
OUTPUT = REPO_ROOT / "packages" / "api-contract" / "openapi.json"

sys.path.insert(0, str(API_SOURCE))

from rationexa_api.main import app  # noqa: E402


def rendered_contract() -> str:
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Fail when the committed contract is stale")
    args = parser.parse_args()
    rendered = rendered_contract()

    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != rendered:
            print("FastAPI's OpenAPI contract is stale. Run `pnpm api:contract:generate`.", file=sys.stderr)
            return 1
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(rendered, encoding="utf-8")
    print(f"Exported {OUTPUT.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
