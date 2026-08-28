from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, func, select

from rationexa_api.database_migrations import run_alembic
from rationexa_api.db import AccountRow, WorkspaceRow
from rationexa_api.migrate_database import copy_database


def test_copy_database_requires_an_empty_target(tmp_path) -> None:
    source_url = f"sqlite:///{tmp_path / 'source.db'}"
    target_url = f"sqlite:///{tmp_path / 'target.db'}"
    source_engine = create_engine(source_url)
    target_engine = create_engine(target_url)
    run_alembic(source_engine)
    run_alembic(target_engine)
    now = datetime.now(UTC)

    with source_engine.begin() as connection:
        connection.execute(AccountRow.__table__.insert(), {"id": "account-source", "name": "Source", "created_at": now})
        connection.execute(
            WorkspaceRow.__table__.insert(),
            {"id": "workspace-source", "owner_account_id": "account-source", "name": "Source", "created_at": now},
        )

    summary = copy_database(source_url, target_url)
    assert summary.table_counts["accounts"] == 1
    assert summary.table_counts["workspaces"] == 1
    with target_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(AccountRow)) == 1

    with pytest.raises(ValueError, match="already contains application data"):
        copy_database(source_url, target_url)

    source_engine.dispose()
    target_engine.dispose()
