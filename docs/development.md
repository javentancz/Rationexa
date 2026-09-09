# Development

## Full local development setup

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
docker compose up -d db
python3.14 -m venv .venv
. .venv/bin/activate
pip install -e 'services/api[dev]'
AI_PROVIDER=deterministic uvicorn rationexa_api.main:app --reload --port 8000
```

In another terminal:

```bash
pnpm dev:web
```

Open `http://localhost:3000`.

The Compose database is exposed on `localhost:5433`. Set
`AI_PROVIDER=deterministic` when no Ollama process is running. Deployment,
migration, backup, and recovery details are in [Pilot operations](../ops/README.md).

## Evaluation

Run the frozen development suite against local models:

```bash
ollama pull qwen3.5:9b
ollama pull gemma4:e4b
ollama pull ornith-1.5:9b
.venv/bin/python -m rationexa_api.evaluation \
  --models qwen3.5:9b gemma4:e4b ornith-1.5:9b
```

Reports are written to `packages/evals/reports/`. These development regressions
are not production-accuracy claims.

## Quality checks

```bash
pnpm validate
```

This is the same validation entry point used by CI. After changing a Pydantic
schema, regenerate the API contract before validating:

```bash
pnpm api:contract:generate
```

Architecture decisions are recorded in [docs/adr](adr); deployment and
recovery instructions are in [ops](../ops/README.md).


## PostgreSQL validation

Start Docker, then run the API suite in an isolated test schema:

```bash
docker compose up -d db
TEST_DATABASE_URL=postgresql+psycopg://rationexa:rationexa@localhost:5433/rationexa pnpm validate:postgres
```

Tests create and remove their own schema; never use production credentials.

## Browser tests alongside a running app

Tests start their own servers and fail if a port is occupied. Use separate ports
when Docker or a development server is already running:

```bash
E2E_WEB_PORT=3100 E2E_API_PORT=8100 pnpm --filter @rationexa/web test:e2e
```

Set `E2E_REUSE_SERVERS=true` only when intentionally testing existing servers.
