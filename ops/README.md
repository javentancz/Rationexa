# Pilot operations

Use PostgreSQL and durable artifact storage for staging. On serverless staging,
set `ARTIFACT_STORAGE=database` so original artifact bytes are included in the
PostgreSQL backup. On a VM with a durable volume, keep `filesystem`. Store `DATABASE_URL`,
`SECRET_ENCRYPTION_KEY`, SMTP credentials, and provider keys in the deployment
secret manager. Never bake them into an image or backup archive.

## Health checks

- `GET /healthz` is a process liveness check.
- `GET /readyz` verifies database access and, when configured, the artifact storage mount.

Route traffic only when `/readyz` returns `200`.

## Serverless release migrations

The Vercel API configuration sets `STARTUP_DATABASE_MAINTENANCE=false` to keep
schema inspection, Alembic upgrades, and interrupted-job recovery out of the
request cold-start path. Before deploying any API revision that introduces a
database migration, run the migration once against the staging database from a
trusted release environment:

```bash
cd services/api
../../.venv/bin/alembic upgrade head
```

Do not route a schema-dependent deployment until that command succeeds. Local
and long-running environments keep startup maintenance enabled by default.

## Private Vercel staging

Rationexa uses two Vercel projects: a Next.js web project rooted at `apps/web`
and a FastAPI project rooted at `services/api`. Keep both Preview deployments
protected with Vercel Authentication.

The API Preview uses Neon PostgreSQL and `ARTIFACT_STORAGE=database`. Add the web
project as an API **Trusted Source** in Vercel Deployment Protection. The web
Preview then calls the API through `/api/backend`, which forwards Vercel's
short-lived OIDC header server-to-server. Configure these web variables:

```text
NEXT_PUBLIC_API_URL=/api/backend
RATIONEXA_API_URL=https://your-api-preview.vercel.app
```

The API project still enforces Rationexa sessions and workspace isolation after
the Vercel protection layer.

Set `HOSTED_MODE=true`, `SESSION_COOKIE_SECURE=true`, and
`JOB_EXECUTION_MODE=inline`. Hosted visitors receive isolated temporary guest
workspaces through an HttpOnly cookie; registered accounts receive permanent
workspaces, while raw bearer tokens remain available for explicit API clients.
Session tokens are stored only as hashes.

## Temporary guest cleanup

Set `CRON_SECRET` in the production API project to a random value of at least 16
characters. Vercel invokes `GET /v1/maintenance/cleanup-guests` once daily with
that value in the `Authorization: Bearer ...` header. The endpoint deletes guest
workspaces older than `GUEST_WORKSPACE_TTL_HOURS` in bounded batches controlled
by `GUEST_CLEANUP_BATCH_SIZE`; it never selects registered accounts. Cleanup is
kept off the visitor bootstrap path so an expired-workspace sweep cannot delay a
new user's first screen.

The checked-in schedule is daily because Vercel Hobby projects do not support a
shorter interval. Monitor `guest_cleanup_complete` logs and increase the batch
size only if the daily run consistently reaches the configured limit.

Set `PUBLIC_BASE_URL` to the canonical web-project origin, not the API-project
origin. The browser always copies share links using its current web origin, while
password-reset email links and direct API consumers use `PUBLIC_BASE_URL`.

## Password recovery

Configure SMTP and keep `PASSWORD_RESET_DEV_MODE=false`. Reset tokens are
single-use, expire after 30 minutes by default, and revoke all existing account
sessions when redeemed. Development mode may return a token to the local UI;
never enable it in staging or production.

Registration, login, and password-reset endpoints use database-backed throttling.
Keep an edge or reverse-proxy limit as a second layer against volumetric abuse.
Tune `AUTH_RATE_LIMIT_ATTEMPTS`, `AUTH_RATE_LIMIT_WINDOW_SECONDS`, `COMPUTE_RATE_LIMIT_ATTEMPTS`, and
`COMPUTE_RATE_LIMIT_WINDOW_SECONDS` for the pilot. Compute limits apply per workspace and operation type.

Custom OpenAI-compatible endpoints are disabled in hosted mode unless their DNS
host appears in `CUSTOM_PROVIDER_ALLOWED_HOSTS`. Resolved private, loopback, and
non-public addresses are rejected to prevent server-side request forgery. Prefer
the first-class OpenAI and OpenRouter presets unless a pilot requires a reviewed
custom endpoint.

## Operational signals

Every API response includes `X-Request-ID` and `Server-Timing`; the API emits a
privacy-safe completion log with request ID, method, path, status, and duration.
Do not log request bodies, cookies, provider keys, reset tokens, or evidence.
Alert on `/readyz` failures, repeated 5xx responses, and sustained latency above
the pilot baseline. A Redis cache is deliberately not required: the library and
model catalogs already use client/server freshness windows, while authoritative
decision and session state remains in PostgreSQL.

## Backup and recovery

Create and verify a backup:

```bash
.venv/bin/python -m rationexa_api.pilot_backup create backups/rationexa-$(date +%F).tar.gz
.venv/bin/python -m rationexa_api.pilot_backup verify backups/rationexa-$(date +%F).tar.gz
```

When PostgreSQL runs through this repository's Compose service, use its matching
client instead of an older host `pg_dump`:

```bash
.venv/bin/python -m rationexa_api.pilot_backup create backups/rationexa-$(date +%F).tar.gz \
  --compose-service db
```

The archive contains a PostgreSQL custom dump, artifact files, and a checksum
manifest. It intentionally excludes `SECRET_ENCRYPTION_KEY`; retain that key in
a separate protected recovery location or encrypted BYOK records cannot be
decrypted after restoration.

Restore only into an empty PostgreSQL database and empty artifact directory:

```bash
.venv/bin/python -m rationexa_api.pilot_backup restore backups/rationexa-2026-08-28.tar.gz \
  --database-url postgresql+psycopg://user:password@host:5432/empty_rationexa \
  --artifact-dir /var/lib/rationexa/artifacts \
  --confirm-empty-target
```

For a local Compose recovery drill, add `--compose-service db` to the restore
command as well.

After every backup, run `verify`. Before inviting pilot users, perform one
restoration drill into an isolated database and confirm `/readyz`, login, a
saved decision, its evidence history, and one export.

## Docker network exposure

The trial Compose file binds web, API, and PostgreSQL ports to `127.0.0.1`.
For remote access, put an HTTPS reverse proxy in front of the web service and
keep the database private. Set a unique database password, the public URL,
allowed origins, secure session cookies, and SMTP before accepting users.
Development password-reset links are disabled by default; configure SMTP for
account recovery. Never enable `PASSWORD_RESET_DEV_MODE` on a public instance.
