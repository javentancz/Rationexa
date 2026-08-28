# Rationexa engineering guidance

## Product boundary

Rationexa is human-in-the-loop decision memory. AI may extract premises, map later evidence, and propose challenge questions, but it must never silently change a decision or present model output as organizational truth. Preserve source excerpts, model/provider provenance, prompt version, latency, cost metadata, and explicit human judgments.

## Architecture

- `apps/web`: Next.js 16 and React 19 client.
- `services/api`: FastAPI, SQLAlchemy, Alembic, PostgreSQL for shared/pilot use, and SQLite for offline development tests.
- `packages/evals`: development regression cases and holdout-set controls.
- `docs/adr`: durable architectural decisions.

## Database rules

- PostgreSQL is the supported pilot and deployment database. SQLite remains an optional local/demo runtime.
- Change SQLAlchemy models and add a reviewed Alembic revision in the same change.
- Never edit an applied Alembic revision; add a new revision.
- Test migrations against both SQLite and PostgreSQL.
- Never copy or expose encrypted provider secrets in logs, exports, shares, fixtures, or telemetry.
- Database import targets must be empty. Do not overwrite a populated target.

## Required checks

```bash
pnpm check
pnpm --filter @rationexa/web build
pnpm --filter @rationexa/web test:e2e
.venv/bin/ruff check services/api/src services/api/tests services/api/migrations
.venv/bin/pytest services/api/tests
```

For PostgreSQL validation, start Docker and run the API suite with `TEST_DATABASE_URL` as documented in the README.

## Change discipline

- Keep user-visible errors contextual and preserve unfinished drafts.
- Require confirmation for destructive UI actions.
- Maintain keyboard, focus, tooltip, portal, and responsive behavior when changing UI primitives.
- Add regression coverage for trust-boundary, persistence, deletion, sharing, authentication, and migration changes.
- Treat evaluation scores as development evidence, not production accuracy claims.
