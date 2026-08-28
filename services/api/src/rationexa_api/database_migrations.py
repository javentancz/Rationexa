from pathlib import Path

from alembic import command
from alembic.config import Config
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
