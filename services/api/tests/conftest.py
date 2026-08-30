import atexit
import os
import tempfile
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

test_database_url = os.environ.get("TEST_DATABASE_URL")
database_file: Path | None = None
postgres_admin_engine = None
postgres_schema: str | None = None
if test_database_url:
    postgres_schema = f"rationexa_test_{uuid4().hex}"
    postgres_admin_engine = create_engine(test_database_url, isolation_level="AUTOCOMMIT")
    with postgres_admin_engine.connect() as connection:
        connection.execute(text(f'CREATE SCHEMA "{postgres_schema}"'))
    isolated_url = make_url(test_database_url).update_query_dict({"options": f"-csearch_path={postgres_schema}"})
    os.environ["DATABASE_URL"] = isolated_url.render_as_string(hide_password=False)
else:
    database_file = Path(tempfile.gettempdir()) / f"rationexa-test-{os.getpid()}.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{database_file}"

artifact_dir = Path(tempfile.gettempdir()) / f"rationexa-artifacts-{os.getpid()}"
os.environ["ARTIFACT_DIR"] = str(artifact_dir)
os.environ["AI_PROVIDER"] = "deterministic"
os.environ["HOSTED_MODE"] = "false"
os.environ.setdefault("SECRET_ENCRYPTION_KEY", "LVOw0rMnwHO0RjG21UEe89Y8ldVc49I2H0nJX1CPzbk=")


def cleanup() -> None:
    if database_file is not None:
        database_file.unlink(missing_ok=True)
    if postgres_admin_engine is not None and postgres_schema is not None:
        with postgres_admin_engine.connect() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{postgres_schema}" CASCADE'))
        postgres_admin_engine.dispose()
    if artifact_dir.exists():
        for path in sorted(artifact_dir.rglob("*"), reverse=True):
            if path.is_file():
                path.unlink()
            elif path.is_dir():
                path.rmdir()
        artifact_dir.rmdir()


atexit.register(cleanup)
