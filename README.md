# Rationexa

Rationexa is a human-in-the-loop technical decision memory and review project. It preserves the premises and source evidence behind technical decisions, then helps people inspect when new evidence may weaken or contradict a premise worth reviewing.

## Current status

The Stage 1 prototype is complete with production accuracy validation explicitly deferred. Stage 2 is underway. The current slice adds a persistent Decision Library, search, reopening, and revisit history so the product can support repeat use rather than one disposable review session.

See [Stage 1 readiness](docs/STAGE_1_READINESS.md) for the deferred validation boundaries and [the Stage 2 execution plan](docs/STAGE_2_EXECUTION_PLAN.md) for the active product milestones.

## Product boundary

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

Extraction and revisit run as background jobs in the web app. The workspace
shows queued, model, validation, and persistence phases and lets the reviewer
cancel without keeping a browser request open. Ollama generation already in
progress may finish after cancellation, but its late result is discarded and
is not stored as an extraction or revisit finding.

Revisit results identify whether each candidate came from the selected model,
deterministic rules, or the low-confidence lifecycle safety net. Reviewers can
record `worth_reviewing`, `not_material`, `needs_context`, or `false_positive`;
the judgment and timestamp are persisted with the revisit check.

For fast tests without starting Ollama, set `AI_PROVIDER=deterministic`. To use the optional hosted adapter, set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL`.

## Compare local models on real cases

The development regression suite contains 30 curated decisions paired with later
authoritative evidence. It covers lifecycle and retirement events, security,
pricing, licensing, positive support, irrelevant evidence, and prompt injection.
The cases are suitable for development regression testing and remain marked
pending independent review. They are frozen as the visible `development-v2` dataset;
its manifest hashes prevent silently editing a case and reporting the result as
the same benchmark. To compare Qwen 3.5 with Gemma 4 locally:

```bash
ollama pull qwen3.5:9b
ollama pull gemma4:e4b
.venv/bin/python -m rationexa_api.evaluation \
  --models qwen3.5:9b gemma4:e4b
```

The command writes a detailed JSON result and a readable Markdown summary to
`packages/evals/reports/`. Extraction and revisit are scored separately; each
model receives the same curated premises for revisit so the comparison is fair.
It prints one progress line per completed case and atomically updates a
`development-model-comparison.checkpoint.json` file, so a long local run no longer
looks frozen and partial results survive interruption.

The report also applies `packages/evals/datasets/stage1-trust-gate.json`. A
model is blocked if it misses a critical relationship, invents an evidence
excerpt, exceeds the false-positive allowance, or falls below the configured
recall/precision thresholds. The overall Stage 1 gate additionally requires 30
independently reviewed cases; the visible 30-case development set cannot by
itself produce a release-ready verdict.

Production model selection must use a separately maintained, independently
reviewed holdout of at least 30 cases. Keep its content and labels outside this
repository, verify that its IDs and content hashes do not overlap the
development manifest, and pass its paths explicitly:

```bash
.venv/bin/python -m rationexa_api.evaluation \
  --dataset-manifest /secure/path/holdout.manifest.json \
  --cases-root /secure/path/holdout-cases \
  --output packages/evals/reports/holdout-model-comparison
```

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
