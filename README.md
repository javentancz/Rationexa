# Rationexa

Rationexa is a human-in-the-loop technical decision review project. Its Stage 1 goal is to preserve the premises and source evidence behind technical decisions, then identify when new evidence may weaken or contradict a premise worth reviewing.

## Current status

Stage 1 implementation is underway. The first vertical slice imports source text, extracts typed decision premises, validates exact source anchors, records human review, finalizes a decision record, and compares it with new evidence.

See [the Stage 1 execution plan](docs/STAGE_1_EXECUTION_PLAN.md) for the proposed architecture, data contracts, APIs, evaluation strategy, acceptance gates, and first 10 working days.

## Stage 1 boundary

Rationexa assists review; it does not autonomously declare decisions wrong, reverse recommendations, assign authoritative business materiality, or monitor sources continuously.

## Run locally

```bash
cp .env.example .env
docker compose up -d db
python3 -m venv .venv
. .venv/bin/activate
pip install -e 'services/api[dev]'
uvicorn rationexa_api.main:app --reload --port 8000
```

In another terminal:

```bash
pnpm install
pnpm dev:web
```

Open `http://localhost:3000`. Without an API key, the API uses a deterministic development provider. Set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL` to use the optional live adapter.

## Quality checks

```bash
pnpm check
.venv/bin/pytest services/api/tests
.venv/bin/ruff check services/api
```
