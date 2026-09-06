# Rationexa

[![CI](https://github.com/javentancz/Rationexa/actions/workflows/ci.yml/badge.svg)](https://github.com/javentancz/Rationexa/actions/workflows/ci.yml)
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

## Choose how to use it

- **Try the hosted preview:** open the
  [staging application](https://rationexa-web-staging.vercel.app/) and use a
  browser-isolated guest workspace with deterministic rules. It is a pilot
  environment, not a production SLA.
- **Run it yourself:** clone this repository and follow the deterministic local
  trial below. PostgreSQL is the supported shared deployment database.
- **Improve the project:** start with a
  [good first issue](https://github.com/javentancz/Rationexa/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22),
  report a bug through the structured issue form, or open a feature request for
  a larger proposal before writing a pull request.

## Use the hosted staging preview

The staging preview is the fastest way to understand the current product:

1. Open [Rationexa staging](https://rationexa-web-staging.vercel.app/).
2. Select **Try a sample decision**, or open **New decision review** and paste a
   short ADR, proposal, assessment, or meeting-note excerpt.
3. Use **Deterministic rules** for the trial. No account or model key is needed.
4. Review each proposed premise against its source excerpt:
   - **Confirm** preserves a source-supported premise.
   - **Keep unknown** preserves an unresolved question explicitly as unknown.
   - **Reject** excludes a proposal that did not materially support the decision.
5. Continue to **Finalize**, check the title, chosen option, rationale,
   criticality, and preserved premises, then save the reviewed record.
6. Open **Revisit** and add the smallest useful piece of new evidence. Rationexa
   maps it to preserved premises; you record the human judgment.
7. Use **Decision library** to reopen or rename a record. Guests can exercise
   sharing and export during the temporary trial; create an account if you want
   durable history and encrypted BYOK models.

Hosted guests receive separate cookie-bound workspaces that expire after 24
hours. Different browser profiles and devices do not share a guest library.
Account workspaces are durable and isolated in PostgreSQL. Staging does not run
Ollama on a visitor's computer; guests use deterministic rules, while signed-in
users may connect OpenRouter, OpenAI, or a reviewed OpenAI-compatible endpoint,
load that provider's model catalog, and explicitly activate a model.

Do not put confidential customer or production decision material into staging.
It is a pilot environment and may be reset during development.

## Five-minute local trial

The Compose file starts PostgreSQL; the API and web development servers run on
the host for fast iteration. Deterministic extraction avoids downloading a
model or configuring a provider key.

Requirements: Node.js 24.19, pnpm 11.23, Python 3.14, and Docker.

```bash
git clone https://github.com/javentancz/Rationexa.git
cd Rationexa
nvm use
corepack enable
pnpm install
cp .env.example .env
docker compose up -d db
python3.14 -m venv .venv
.venv/bin/pip install -e 'services/api[dev]'
AI_PROVIDER=deterministic .venv/bin/uvicorn rationexa_api.main:app --reload --port 8000
```

In another terminal:

```bash
pnpm dev:web
```

Open `http://localhost:3000`, choose **Try a sample decision**, and complete
Import → Review → Finalize → Revisit. The default local profile is intended for
one developer; hosted mode creates a separate cookie-bound guest workspace for
each browser profile.

Confirm the services are ready:

```bash
curl --fail http://localhost:8000/healthz
curl --fail http://localhost:8000/readyz
```

The command above forces the no-key deterministic runtime. To test an installed
local model instead, run `ollama pull qwen3.5:9b`, set `AI_PROVIDER=ollama`, and
restart the API. Local Ollama is a developer/self-hosting option; the hosted
staging website cannot connect directly to Ollama running on a visitor's device.

## Repository map

```text
apps/web          Next.js 16 and React 19 client
services/api      FastAPI, SQLAlchemy, Alembic, PostgreSQL/SQLite API
packages/evals    Development regression cases and holdout controls
packages/api-contract  Generated OpenAPI-to-TypeScript contract
docs/adr          Durable architecture decisions
ops               Pilot deployment, recovery, backup, and restore guidance
```

## Public and private source boundary

The recommended open-source shape is the current monorepo. Keep the web client,
API, migrations, deterministic engine, provider interfaces, local Ollama
integration, API contract, tests, sanitized development cases, CI, setup
scripts, architecture decisions, and placeholder deployment examples together.
These are the parts users need to inspect, run, modify, and contribute to.
The `private: true` flags in workspace `package.json` files only prevent
accidental publication to npm; they do not make the GitHub source proprietary.

The following must never be committed to this or another public repository:

- populated `.env` files or deployment-platform environment exports;
- `SECRET_ENCRYPTION_KEY`, provider keys, database passwords, SMTP credentials,
  cron secrets, session tokens, password-reset tokens, or signing keys;
- PostgreSQL dumps, artifact directories, uploaded source documents, raw logs,
  error payloads, or analytics containing user data;
- pilot identities, customer decision records, support conversations, incident
  investigations, or internal infrastructure addresses;
- private holdout evaluation cases and any copyrighted source material that is
  not licensed for redistribution.

Production and staging secrets belong in their respective platform secret
managers, not in Git branches. Public files such as `.env.example`,
`ops/staging.env.example`, and `services/api/vercel.json` should contain only
placeholders and non-sensitive behavior. The real holdout set stays outside Git;
only its manifest example and handling rules belong here.

There is no current application module that needs to become private merely
because Rationexa may become a hosted business. Authentication, workspace
isolation, BYOK encryption, and share sanitization benefit from public review.
If billing, enterprise administration, managed connectors, or proprietary
ranking systems are built later, place them behind explicit package/service
boundaries and decide then whether a private cloud repository is justified.

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
- Alembic database migrations and supervised-pilot repeat-use metrics;
- a shadcn component foundation with persistent light, dark, and system themes;
- workspace-scoped authentication, encrypted BYOK, compute throttling, share
  sanitization, database timing, backup/restore tooling, and automated browser
  regression coverage.

The next milestone is a supervised user pilot. The checked-in 30-case suite is a development regression set, not independent proof of production accuracy.

Pilot operations now include private account registration, one-time password
recovery, active-session revocation, workspace profile management, database-aware
readiness checks, persistent authentication throttling, hashed session tokens,
HttpOnly browser cookies, and guarded PostgreSQL-plus-artifact backup/restore tooling.

### Project maturity

Rationexa is currently a private, supervised-pilot project. The hosted link is
staging infrastructure for evaluation and may change without notice. It is not
yet offered with production support, availability guarantees, or independently
validated model-accuracy claims. Self-hosters are responsible for deployment,
secrets, database maintenance, backups, and access controls.

## Deployment model

Keep one monorepo and promote reviewed commits through separate environments:

- **Local development:** deterministic rules or optional Ollama, with PostgreSQL
  from Docker Compose and the web/API processes running on the host.
- **Staging:** the current hosted preview, isolated staging PostgreSQL, staging
  SMTP credentials, and non-production secrets. Use it for pilot workflows and
  deployment verification.
- **Production:** a separate web/API deployment, database, encryption key, SMTP
  credentials, monitoring environment, and public domain created only after the
  operational checks below pass and before inviting production users.

Never clone staging records, provider credentials, session data, or encryption
keys into production. Deploy immutable commit SHAs and apply reviewed Alembic
migrations before routing production traffic to schema-dependent API code.

### Manual public-release gate

Before changing the GitHub repository from private to public:

- [ ] Scan the complete Git history for credentials and private source data;
      rotate anything that may ever have been committed, even if later deleted.
- [ ] Review dependency licenses, bundled fonts, images, sample documents, and
      evaluation cases for public redistribution rights.
- [ ] Verify account deletion, workspace isolation, share expiry/revocation,
      export sanitization, and PostgreSQL backup/restore against staging.
- [ ] Confirm the hosted preview is clearly labeled as staging and contains no
      production credentials, customer records, or private evaluation material.
- [ ] Enable GitHub secret scanning and push protection, private vulnerability
      reporting, CodeQL, Dependabot alerts, and a reviewed `main` ruleset.
- [ ] Add repository topics and a social-preview image, then seed three to five
      genuinely scoped `good first issue` or `help wanted` issues.
- [ ] Confirm that the hosted sample workflow works without an account and that
      clone/setup instructions succeed on a clean machine.
- [ ] Publish `v0.1.0` release notes that state pilot limitations, upgrade steps,
      and the supported PostgreSQL and runtime versions.

Do not check an item merely because a file exists—the behavior should be tested
in the environment that will be exposed to users.

Making the source public does not require launching the hosted service as a
production product. Before inviting non-pilot production users, create the
separate production environment described above, complete a backup/restore and
account-deletion drill there, establish alerting and latency/error baselines,
and confirm a rollback path for both code and migrations.

## Near-term roadmap

1. Run a small pilot focused on whether users understand the product and return
   with real new evidence, not only whether the workflow technically completes.
2. Establish staging and production latency/error baselines, including API cold
   starts and database query timing, before adding caching infrastructure.
3. Convert recurring pilot friction into focused issues with acceptance tests;
   mark a few safe documentation, accessibility, and deterministic-rule tasks
   for first-time contributors.
4. Add a full containerized self-hosting path only after users demonstrate that
   they need it; the current Compose scope is intentionally PostgreSQL only.

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

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request and [SECURITY.md](SECURITY.md) before reporting a
vulnerability. Do not place provider keys, session tokens, private source
material, production data, or holdout evaluation cases in public issues.

Useful contributions are not limited to feature code. Reproducible bug reports,
accessibility fixes, documentation, deterministic-rule edge cases, PostgreSQL
performance measurements, and sanitized real-world decision examples are all
valuable. Larger product or schema changes should begin with an issue so work
is not duplicated and the human-review boundary is agreed before implementation.

## License

The source code is licensed under the [Apache License 2.0](LICENSE). The
license does not grant permission to use the Rationexa name or logo to identify
derived products or services; see [NOTICE](NOTICE).
