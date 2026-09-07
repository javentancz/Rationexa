# Rationexa

[![CI](https://github.com/javentancz/Rationexa/actions/workflows/ci.yml/badge.svg)](https://github.com/javentancz/Rationexa/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.2.0-1f6b4f.svg)](https://github.com/javentancz/Rationexa/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> Teams remember what they decided. They forget why it was reasonable, which
> assumptions mattered, and when those assumptions stopped being true.

Rationexa is a human-in-the-loop decision memory for technical teams. It turns
an ADR, proposal, meeting note, or short decision memo into a source-grounded
record of the decision and its premises. When new evidence arrives, Rationexa
maps it back to those preserved premises so a person can decide whether action
is warranted.

For example: a team selects an identity provider because it supports SAML,
fits the current budget, and promises external-user administration before a
pilot. Three months later, the roadmap slips. Rationexa shows exactly which
preserved premise the new evidence conflicts with; it does not silently change
the decision.

**AI proposes; a human confirms.** Model output is always a review aid.
Rationexa does not autonomously reverse decisions, declare organizational
truth, or assign business materiality.

Current version: **0.2.0**, a supervised-pilot release. The hosted application
is a staging preview, while the repository can also be run locally or
self-hosted.

## What the workflow preserves

1. **Import** the original decision source.
2. **Review** candidate assumptions, constraints, unknowns, and exact excerpts.
3. **Finalize** only the premises a human confirms.
4. **Revisit** the record when later evidence supports, weakens, or conflicts
   with those premises.

The built-in deterministic runtime needs no model key. Registered workspaces
may connect an encrypted BYOK provider and explicitly activate a model. Public
share links are read-only, expiring, revocable, and exclude provider keys and
private source artifacts.

## Where Rationexa fits

Rationexa is a decision-memory and evidence-review layer between source
material, optional AI models, and the people accountable for a decision. It is
not a replacement for a document store, project tracker, model provider, or
human approval process.

### Core three-layer trust engine

The backend does not send model text directly into decision memory. Every run
passes through three explicit trust layers:

1. **L1 · Candidate reasoning.** The selected runtime—deterministic rules, local
   Ollama, or a workspace-scoped BYOK adapter—turns untrusted source material
   into schema-constrained candidate fields and premises. These are proposals,
   not saved organizational facts. Provider adapters and output repair live in
   [`providers.py`](services/api/src/rationexa_api/providers.py); their contracts
   are defined in [`schemas.py`](services/api/src/rationexa_api/schemas.py).
2. **L2 · Deterministic grounding.** The API validates every proposed source anchor
   against the immutable input. Matching normalizes Unicode and whitespace to
   tolerate copied documents, but the stored excerpt and character offsets
   always point back to the exact original text. Unsupported consequential
   claims cannot silently pass as grounded. During Revisit, the same integrity
   layer checks new evidence against every preserved premise and retains
   ambiguous results for human review. Exact locating and the deterministic
   comparison safety net live in
   [`services.py`](services/api/src/rationexa_api/services.py).
3. **L3 · Human-gated memory.** A person must confirm, preserve as unknown, edit, or
   reject each candidate before finalization. Revisit findings and challenge
   prompts also remain proposals until a human records a judgment. Only this
   reviewed state becomes durable decision memory. The API orchestration and
   workspace authorization gates live in
   [`main.py`](services/api/src/rationexa_api/main.py); persistence models and
   migrations begin in [`db.py`](services/api/src/rationexa_api/db.py) and
   [`services/api/migrations`](services/api/migrations).

The execution path is therefore:

`workspace/session scope -> rate limit -> runtime selection -> structured candidate output -> source-anchor validation -> human review -> finalized record -> evidence comparison across all premises -> human judgment and audit trail`

Every model-assisted run retains provider, model, prompt version, latency,
token usage, runtime location, and known cost. Provider secrets and private raw
artifacts never enter public shares or exports.

The Revisit engine applies the same boundary to later evidence; the Challenge
engine only proposes source-grounded questions. Workspace isolation, encrypted
BYOK, scrubbed shares, provenance, and regression tests support these three
layers without changing who owns the final judgment.

### Coding-agent initialization

There is no separate `init.md`. A coding agent working in this repository must
read the root [`AGENTS.md`](AGENTS.md) first, then the nearest scoped
`AGENTS.md` for the files it will change (currently
[`apps/web/AGENTS.md`](apps/web/AGENTS.md) for the web application). Those files
define the product trust boundary, database rules, UI change discipline, and
required checks. The README explains setup and architecture; durable design
decisions live in [`docs/adr`](docs/adr).

Before handing work back, run `pnpm validate`.

## Example use cases

- **Vendor selection:** preserve the security, price, capability, and roadmap
  assumptions behind choosing an identity, observability, or infrastructure
  provider; revisit the choice when a capability is delayed or retired.
- **Architecture decisions:** retain why a team selected a database, deployment
  model, framework, or cloud service and identify which premise an incident or
  lifecycle notice affects.
- **Build versus buy:** separate hard constraints from forecasts and unknowns,
  then track whether later delivery, staffing, or cost evidence changes the
  original reasoning.
- **Compliance and risk reviews:** anchor requirements to their original source
  and record the human response when a policy, advisory, or audit finding
  introduces conflicting evidence.

One concrete flow: a team chooses Vendor B because it supports SAML, fits the
budget, and promises external-user administration before launch. Rationexa
preserves those three premises and their source excerpts. When Vendor B moves
external-user administration to the next quarter, the revisit engine maps that
evidence to the affected premise; the owner—not the model—decides whether to
accept the risk, investigate, or reopen the vendor decision.

## Technology stack

- **Web:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Radix UI/shadcn-style
  primitives, TanStack Query, Vitest, Storybook, Playwright, and Vercel Web
  Analytics.
- **API:** Python 3.14, FastAPI, Pydantic Settings, SQLAlchemy 2, Alembic,
  Psycopg, Uvicorn, HTTPX, and encrypted provider credentials via Cryptography.
- **Data:** PostgreSQL 18 for shared and hosted workspaces; SQLite remains an
  optional offline development and test runtime.
- **Model runtimes:** deterministic rules with no key, optional local Ollama,
  and workspace-scoped BYOK adapters for OpenRouter, OpenAI, and reviewed
  OpenAI-compatible endpoints.
- **Delivery and assurance:** pnpm monorepo tooling, Docker Compose for the full
  local stack, GitHub Actions, Vercel web/API deployments, generated OpenAPI and
  TypeScript contracts, Ruff, Pytest, dependency audits, and Alembic migration
  checks.

## Use the hosted staging preview

The [staging application](https://rationexa-web-staging.vercel.app/) is the
fastest way to understand the product:

1. Select **Try a sample decision**, or open **New decision review** and paste a
   short ADR, proposal, assessment, or meeting-note excerpt.
2. Review each proposed premise: **Confirm**, **Keep unknown**, or **Reject**.
3. **Finalize** the reviewed record.
4. Open **Revisit** and add the smallest useful piece of new evidence. Rationexa
   maps it to preserved premises; you record the human judgment.

Hosted guests receive separate cookie-bound workspaces that expire after 24
hours. Account workspaces are durable and may connect encrypted BYOK models.
Guests use deterministic rules; hosted staging cannot run Ollama on a visitor's
computer.

Do not put confidential customer or production decision material into staging.
It is a pilot environment and may be reset during development.

## One-command Docker trial

Docker Compose runs the complete application: PostgreSQL, the FastAPI service,
and the production Next.js server. It uses the no-key deterministic runtime,
creates an isolated guest workspace per browser, persists database and artifact
data in named volumes, and routes browser API calls through the web container.

Requirement: Docker Desktop or another Docker Compose implementation.

```bash
git clone https://github.com/javentancz/Rationexa.git
cd Rationexa
docker compose up --build
```

Open `http://localhost:3000`, choose **Try a sample decision**, and complete
Import → Review → Finalize → Revisit. The API health endpoints remain
available on `http://localhost:8000/healthz` and `/readyz`.

Stop the stack without deleting its data:

```bash
docker compose down
```

`docker compose down -v` also removes the PostgreSQL, artifact, and generated
encryption-key volumes and permanently deletes the local Docker data. For a
network-accessible deployment, replace the default PostgreSQL password and set
secure cookie, SMTP, public URL, and provider-host settings through environment
variables or a deployment secret manager.

Confirm all containers are healthy:

```bash
docker compose ps
```

Local Ollama remains a host-development option because desktop Docker cannot
portably expose the same acceleration across macOS, Linux, and Windows. Use the
manual development setup below when testing Ollama. Hosted and default Compose
guests use deterministic rules; registered users can connect a BYOK provider.

## Repository map

```text
apps/web          Next.js 16 and React 19 client
services/api      FastAPI, SQLAlchemy, Alembic, PostgreSQL/SQLite API
packages/evals    Development regression cases and holdout controls
packages/api-contract  Generated OpenAPI-to-TypeScript contract
docs/adr          Durable architecture decisions
ops               Pilot deployment, recovery, backup, and restore guidance
```

## Safe to publish

The current monorepo—web, API, migrations, engines, provider interfaces,
contracts, sanitized development cases, tests, CI, and documentation—is the
intended open-source unit. The `private: true` package flags only prevent
accidental npm publication.

The following must never be committed to this or another public repository:

- populated `.env` files or deployment-platform environment exports;
- `SECRET_ENCRYPTION_KEY`, provider keys, database passwords, SMTP credentials,
  cron secrets, session tokens, password-reset tokens, or signing keys;
- database dumps, uploaded source documents, raw logs, analytics, or customer
  records;
- private holdout evaluation cases and any copyrighted source material that is
  not licensed for redistribution.

Production and staging secrets belong in platform secret managers, never Git.
See [SECURITY.md](SECURITY.md) for reporting and handling rules.

## Model runtimes

The default deterministic runtime needs no key. Self-hosters can use Ollama with
Qwen 3.5 9B, Gemma 4 E4B, or Ornith 1.5 9B. Registered workspaces can connect
OpenRouter, OpenAI, or a reviewed OpenAI-compatible endpoint, load its model
catalog, and explicitly activate a model. Keys are encrypted per workspace and
never returned by the API or included in shares.

There is intentionally no misleading universal API-key field. Providers with incompatible native protocols require dedicated adapters; OpenRouter or a custom OpenAI-compatible endpoint provides the broadest current hosted-model coverage.

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

The Compose database is exposed on `localhost:5433`. Set
`AI_PROVIDER=deterministic` when no Ollama process is running. Deployment,
migration, backup, and recovery details are in [Pilot operations](ops/README.md).

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

Architecture decisions are recorded in [docs/adr](docs/adr); deployment and
recovery instructions are in [ops](ops/README.md).

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request and [SECURITY.md](SECURITY.md) before reporting a
vulnerability. Do not place provider keys, session tokens, private source
material, production data, or holdout evaluation cases in public issues.

Reproducible bug reports, accessibility fixes, deterministic-rule edge cases,
performance measurements, and sanitized examples are welcome. Larger changes
should begin with an issue.

## License

The source code is licensed under the [Apache License 2.0](LICENSE). The
license does not grant permission to use the Rationexa name or logo to identify
derived products or services; see [NOTICE](NOTICE).
