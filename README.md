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
- durable, workspace-scoped jobs with progress, cancellation, restart recovery, and late-result suppression;
- model, provider, prompt, latency, token, runtime, and known-cost provenance;
- local Ollama models and encrypted bring-your-own-key (BYOK) providers with live connection checks;
- Alembic database migrations and supervised-pilot repeat-use metrics.

The next milestone is a supervised user pilot. The checked-in 30-case suite is a development regression set, not independent proof of production accuracy.

Pilot operations now include private account registration, one-time password
recovery, active-session revocation, workspace profile management, database-aware
readiness checks, persistent authentication throttling, hashed session tokens,
HttpOnly browser cookies, and guarded PostgreSQL-plus-artifact backup/restore tooling.

## Model runtimes

Local Ollama is free and requires no account. The configured local models are:

- Qwen 3.5 9B
- Gemma 4 E4B
- Ornith 1.5 9B

The Account & keys screen also supports OpenRouter, OpenAI direct, and custom OpenAI-compatible endpoints. After connecting a key, load that provider's model catalog and activate the model you want to expose in Rationexa. Keys are encrypted per workspace before database storage and are never returned by the API or included in shared records. Hosted deployments require sign-in before any workspace data or BYOK configuration is available.

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

The Compose database is exposed on `localhost:5433`. The API applies pending Alembic migrations at startup. SQLite remains supported for an offline demo by setting `DATABASE_URL=sqlite:///./rationexa.db`, but PostgreSQL is the supported pilot database.

### Move existing SQLite data to PostgreSQL

Stop the API, start the empty PostgreSQL service, and run the guarded one-time copy command from the repository root:

```bash
docker compose up -d db
.venv/bin/python -m rationexa_api.migrate_database \
  --source sqlite:///./rationexa.db \
  --target postgresql+psycopg://rationexa:rationexa@localhost:5433/rationexa
```

The command refuses to write into a target that already contains application data. It preserves IDs, decisions, premises, revisits, shares, provenance, and encrypted BYOK records. Keep the same `SECRET_ENCRYPTION_KEY` or `.rationexa-secret.key` to decrypt migrated provider records. Artifact files remain in `ARTIFACT_DIR`; back up and move that directory separately when changing machines.

For fast development without a model process, set `AI_PROVIDER=deterministic`. To expose additional installed Ollama models, update the comma-separated `OLLAMA_MODELS` value and restart the API.

Use `JOB_EXECUTION_MODE=thread` for a long-running local API process. Hosted
serverless deployments must use `JOB_EXECUTION_MODE=inline`; the job record is
still durable, and interrupted records fail explicitly after restart instead of
remaining stuck. A queue worker can replace inline execution later if pilot
traffic proves it necessary; Redis is not required for the current pilot load.

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

Run the same API suite in an isolated temporary PostgreSQL schema:

```bash
docker compose up -d db
TEST_DATABASE_URL=postgresql+psycopg://rationexa:rationexa@localhost:5433/rationexa \
  .venv/bin/pytest services/api/tests
```

Staging environment, password recovery, health-check, backup, and restore
instructions are in [Pilot operations](ops/README.md).

The durable Stage 1 safety boundary is recorded in [ADR-0001](docs/adr/0001-stage-1-trust-boundary.md).
