from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine

API_ROOT = Path(__file__).resolve().parents[2]


def migration_config() -> Config:
    configuration = Config(str(API_ROOT / "alembic.ini"))
    configuration.set_main_option("script_location", str(API_ROOT / "migrations"))
    return configuration


def run_alembic(db_engine: Engine, action: str = "upgrade") -> None:
    configuration = migration_config()
    with db_engine.begin() as connection:
        configuration.attributes["connection"] = connection
        if action == "stamp":
            command.stamp(configuration, "head")
        else:
            command.upgrade(configuration, "head")


def database_is_at_head(db_engine: Engine) -> bool:
    """Return whether every applied database head matches the shipped migrations."""
    configuration = migration_config()
    expected_heads = set(ScriptDirectory.from_config(configuration).get_heads())
    with db_engine.connect() as connection:
        applied_heads = set(MigrationContext.configure(connection).get_current_heads())
    return applied_heads == expected_heads
