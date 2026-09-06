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
- a shadcn component foundation with persistent light, dark, and system themes.

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

The Account & keys screen also supports OpenRouter, OpenAI direct, and custom OpenAI-compatible endpoints. After connecting a key, load that provider's model catalog and activate the model you want to expose in Rationexa. Keys are encrypted per workspace before database storage and are never returned by the API or included in shared records. Hosted visitors receive an isolated, cookie-bound 24-hour guest workspace for deterministic-rule trials. Different browser profiles and devices receive different libraries. Creating an account upgrades the same guest workspace and preserves its decisions; BYOK remains unavailable until that upgrade is complete.

There is intentionally no misleading universal API-key field. Providers with incompatible native protocols require dedicated adapters; OpenRouter or a custom OpenAI-compatible endpoint provides the broadest current hosted-model coverage.

### Hosted workspace isolation

`HOSTED_MODE` defaults to `true`, so a missing environment variable cannot
expose the shared local development library. Hosted visitors receive separate
temporary guest workspaces; registered accounts receive permanent workspaces.
Every artifact,
extraction, decision, job, provider key, and usage query is filtered by that
workspace. Separate physical databases per user are not required for pilot
isolation; PostgreSQL stores all tenants while the API returns `404` for a
record owned by another workspace.

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

Vercel disables request-time database maintenance with
`STARTUP_DATABASE_MAINTENANCE=false` so a cold request does not inspect or
migrate the schema before serving traffic. Apply migrations as a release step
before deploying API code that depends on a new schema:

```bash
cd services/api
../../.venv/bin/alembic upgrade head
```

Keep startup maintenance enabled for local development and long-running
deployments unless their release pipeline applies migrations explicitly.

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
pnpm validate
```

This is the same validation entry point used by CI. It runs type checking,
fast Vitest unit tests, FastAPI-to-TypeScript contract drift checks, security
linting, the production web build, API tests, Python and JavaScript dependency
audits, and Playwright browser tests. CI also installs the Playwright Chromium
runtime through the same script.

During frontend development, run the fast unit layer independently:

```bash
pnpm test:unit
```

FastAPI is the source of truth for frontend API response types. After changing
a Pydantic request or response schema, regenerate the committed OpenAPI contract
and TypeScript declarations:

```bash
pnpm api:contract:generate
```

`pnpm validate` fails when either generated artifact is stale.

Run the same API suite in an isolated temporary PostgreSQL schema:

```bash
docker compose up -d db
TEST_DATABASE_URL=postgresql+psycopg://rationexa:rationexa@localhost:5433/rationexa \
  pnpm validate:postgres
```

GitHub CI runs this PostgreSQL validation as a separate required job alongside
the SQLite, web-build, dependency-audit, and browser-test job. This keeps local
offline coverage fast while proving the complete API and Alembic migration path
against the same database engine used by staging and pilot workspaces.

Staging environment, password recovery, health-check, backup, and restore
instructions are in [Pilot operations](ops/README.md).

The durable Stage 1 safety boundary is recorded in [ADR-0001](docs/adr/0001-stage-1-trust-boundary.md).
