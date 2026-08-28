# Rationexa

Rationexa is a human-in-the-loop decision memory for technical teams. It preserves a decision, its premises, and exact source evidence, then helps a reviewer examine whether later evidence weakens, supports, or changes what the decision depended on.

AI output is always a review aid. Rationexa does not autonomously reverse decisions, declare organizational truth, or assign business materiality.

## Status

Stage 1 established the trusted Import → Review → Finalize → Revisit workflow. The Stage 2 product foundation is implemented:

- persistent personal workspaces and searchable decision history;
- chronological evidence-revisit conversations with human judgments;
- Markdown and PDF export;
- revocable, expiring, scrubbed read-only share links;
- source-grounded challenge briefs;
- background jobs with progress, cancellation, and late-result suppression;
- model, provider, prompt, latency, token, runtime, and known-cost provenance;
- local Ollama models and encrypted bring-your-own-key (BYOK) providers with live connection checks;
- versioned database migrations and supervised-pilot repeat-use metrics.

The next milestone is a supervised user pilot. The checked-in 30-case suite is a development regression set, not independent proof of production accuracy.

## Model runtimes

Local Ollama is free and requires no account. The configured local models are:

- Qwen 3.5 9B
- Gemma 4 E4B
- Ornith 1.5 9B

The Account & keys screen also supports OpenRouter, OpenAI direct, and custom OpenAI-compatible endpoints. After connecting a key, load that provider's model catalog and activate the model you want to expose in Rationexa. Keys are encrypted before database storage and are never returned by the API or included in shared records.

There is intentionally no misleading universal API-key field. Providers with incompatible native protocols require dedicated adapters; OpenRouter or a custom OpenAI-compatible endpoint provides the broadest current hosted-model coverage.

## Run locally

Requirements:

- Node.js 24.19 and pnpm 11.23
- Python 3.14
- PostgreSQL 18
- Ollama when using local models

```bash
nvm use
corepack enable
pnpm install
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
pnpm dev:web
```

Open `http://localhost:3000`.

For fast development without a model process, set `AI_PROVIDER=deterministic`. To expose additional installed Ollama models, update the comma-separated `OLLAMA_MODELS` value and restart the API.

Local models only reason over evidence supplied to Rationexa. They do not fetch current web evidence by themselves.

## Evaluation

Run the frozen development suite against the local models:

```bash
ollama pull qwen3.5:9b
ollama pull gemma4:e4b
ollama pull ornith-1.5:9b
.venv/bin/python -m rationexa_api.evaluation \
  --models qwen3.5:9b gemma4:e4b ornith-1.5:9b
```

Reports are written to `packages/evals/reports/`. Production claims require a separately maintained, independently reviewed holdout set with no case-ID or content-hash overlap with development data.

## Quality checks

```bash
pnpm check
pnpm --filter @rationexa/web build
pnpm --filter @rationexa/web test:e2e
pnpm --filter @rationexa/web build-storybook
.venv/bin/pytest services/api/tests
.venv/bin/ruff check services/api
```

The durable Stage 1 safety boundary is recorded in [ADR-0001](docs/adr/0001-stage-1-trust-boundary.md).
