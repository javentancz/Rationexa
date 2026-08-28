# Database migrations

Run migrations from `services/api` with:

```bash
../../.venv/bin/alembic upgrade head
```

Create future revisions with `revision --autogenerate -m "description"`, inspect the generated operations, and test both SQLite and PostgreSQL before committing.
