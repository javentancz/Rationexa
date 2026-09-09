# Rationexa

[![CI](https://github.com/javentancz/Rationexa/actions/workflows/ci.yml/badge.svg)](https://github.com/javentancz/Rationexa/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Remember why you decided. See when the reasoning changes.**

Rationexa turns decision notes into reviewed records of choices, assumptions,
and source excerpts. Add later evidence to see which premises need another look.
**AI proposes; a person decides.**

For example: you choose a vendor expecting a feature before launch. Its roadmap
slips. Rationexa connects that update to the original assumption so you can
record what to do next.

[Try the staging preview](https://rationexa-web-staging.vercel.app/) ·
[Report an issue](https://github.com/javentancz/Rationexa/issues)

## Try it locally

Requires Docker Compose. No account or model key needed.

```bash
git clone https://github.com/javentancz/Rationexa.git
cd Rationexa
docker compose up --build
```

Open [localhost:3000](http://localhost:3000) and choose **Try a sample decision**.

1. **Import** a decision note or upload a PDF, Markdown, or text file.
2. **Review** the proposed premises against their source excerpts.
3. **Finalize** the record you have reviewed.
4. **Revisit** with new evidence and record your judgment.

Examples cover vendor selection, launch pricing, and build versus buy.

`docker compose down` stops the app and keeps its data. Adding `-v` permanently
deletes the database and encryption-key volumes. Ports bind to localhost by
default; see the [operations guide](ops/README.md) before deploying publicly.

## What to expect

- **Human control:** models cannot silently change accepted decisions.
- **Traceable reasoning:** exact excerpts, model/provider provenance, prompt
  version, latency, and known cost stay attached to the work.
- **Model choice:** deterministic rules by default, optional local Ollama, or
  encrypted workspace keys for supported hosted providers.
- **Private workspaces:** guest trials expire after 24 hours; accounts keep
  durable history. Read-only share links expire and can be revoked.

Version 0.2.0 is a supervised pilot. The hosted preview may be reset; use sample
or non-confidential material. Deterministic examples demonstrate the workflow,
not general AI accuracy. See the [privacy policy](https://rationexa-web-staging.vercel.app/privacy).

## Development

- `apps/web` — Next.js 16, React 19, TypeScript, and Radix UI.
- `services/api` — FastAPI, SQLAlchemy, and Alembic.
- `packages/evals` — development regression cases and holdout controls.
- PostgreSQL is the deployment database; SQLite supports offline development.

[Local setup and checks](docs/development.md) · [Architecture decisions](docs/adr) ·
[Deployment and backups](ops/README.md)

```bash
pnpm validate
```

## Contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and pull requests,
[SUPPORT.md](SUPPORT.md) for help, and [SECURITY.md](SECURITY.md) to report a
vulnerability privately. Coding agents must follow [AGENTS.md](AGENTS.md).
Never post keys, private decision material, or production data in issues.

Licensed under [Apache 2.0](LICENSE). See [NOTICE](NOTICE) for name and logo use.
