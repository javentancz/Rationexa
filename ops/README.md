# Pilot operations

Use PostgreSQL and durable artifact storage for staging. Store `DATABASE_URL`,
`SECRET_ENCRYPTION_KEY`, SMTP credentials, and provider keys in the deployment
secret manager. Never bake them into an image or backup archive.

## Health checks

- `GET /healthz` is a process liveness check.
- `GET /readyz` verifies database access and the artifact storage mount.

Route traffic only when `/readyz` returns `200`.

## Password recovery

Configure SMTP and keep `PASSWORD_RESET_DEV_MODE=false`. Reset tokens are
single-use, expire after 30 minutes by default, and revoke all existing account
sessions when redeemed. Development mode may return a token to the local UI;
never enable it in staging or production.

Rate-limit registration, login, and password-reset endpoints at the staging
reverse proxy. Do not depend on application-process memory for distributed
rate limits.

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
