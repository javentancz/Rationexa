# Rationexa

Rationexa is a human-in-the-loop technical decision review project. Its Stage 1 goal is to preserve the premises and source evidence behind technical decisions, then identify when new evidence may weaken or contradict a premise worth reviewing.

## Current status

Stage 1 implementation is underway. The first vertical slice imports source text, extracts typed decision premises, validates exact source anchors, records human review, finalizes a decision record, and compares it with new evidence.

See [the Stage 1 execution plan](docs/STAGE_1_EXECUTION_PLAN.md) for the proposed architecture, data contracts, APIs, evaluation strategy, acceptance gates, and first 10 working days.

## Stage 1 boundary

Rationexa assists review; it does not autonomously declare decisions wrong, reverse recommendations, assign authoritative business materiality, or monitor sources continuously.

## Run locally

The August 2026 development baseline is Node.js 24.19 LTS, pnpm 11.23,
Python 3.14.7, and PostgreSQL 18. Use `.nvmrc` and `.python-version` with your
preferred runtime manager.

```bash
nvm use
corepack enable
cp .env.example .env
ollama pull qwen3.5:9b
docker compose up -d db
python3.14 -m venv .venv
. .venv/bin/activate
pip install -e 'services/api[dev]'
uvicorn rationexa_api.main:app --reload --port 8000
```

In another terminal:

```bash
pnpm install
pnpm dev:web
```

Open `http://localhost:3000`. The default provider is local Ollama running Qwen3.5 9B, so no external API key is required. The first model download is approximately 6.6 GB.

For fast tests without starting Ollama, set `AI_PROVIDER=deterministic`. To use the optional hosted adapter, set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL`.

## Compare local models on real cases

The real-case suite contains public decisions paired with later authoritative
evidence. To compare Qwen 3.5 with Gemma 4 locally:

```bash
ollama pull qwen3.5:9b
ollama pull gemma4:e4b
.venv/bin/python -m rationexa_api.evaluation \
  --models qwen3.5:9b gemma4:e4b
```

The command writes a detailed JSON result and a readable Markdown summary to
`packages/evals/reports/`. Extraction and revisit are scored separately; each
model receives the same curated premises for revisit so the comparison is fair.

The web app reads its model dropdown from `GET /v1/models`. Select Qwen or
Gemma before extraction, and you may select a different model before the
revisit check. See [the model provider standard](docs/MODEL_PROVIDER_STANDARD.md)
for the adapter contract, provenance rules, and evaluation gates.

To expose another installed Ollama model, add it to the comma-separated
`OLLAMA_MODELS` allowlist in `.env` and restart the API. Local models only
reason over text supplied to Rationexa; they do not browse the live web by
themselves.

## Quality checks

```bash
pnpm check
.venv/bin/pytest services/api/tests
.venv/bin/ruff check services/api
```
