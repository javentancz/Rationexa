import argparse
from dataclasses import dataclass

from sqlalchemy import Engine, create_engine, func, inspect, select

from .database_migrations import run_alembic
from .db import Base

SKIPPED_TABLES = {"schema_migrations"}


@dataclass(frozen=True)
class MigrationSummary:
    table_counts: dict[str, int]

    @property
    def total_rows(self) -> int:
        return sum(self.table_counts.values())


def copy_database(source_url: str, target_url: str) -> MigrationSummary:
    if source_url == target_url:
        raise ValueError("Source and target database URLs must be different")

    source_engine = _engine_for(source_url)
    target_engine = _engine_for(target_url)
    try:
        required_tables = {table.name for table in Base.metadata.sorted_tables if table.name not in SKIPPED_TABLES}
        source_tables = set(inspect(source_engine).get_table_names())
        missing = sorted(required_tables - source_tables)
        if missing:
            raise ValueError(f"Source database is missing required tables: {', '.join(missing)}")

        run_alembic(target_engine)
        table_counts: dict[str, int] = {}
        with source_engine.connect() as source, target_engine.begin() as target:
            populated = [
                table.name
                for table in Base.metadata.sorted_tables
                if table.name not in SKIPPED_TABLES
                and target.scalar(select(func.count()).select_from(table))
            ]
            if populated:
                raise ValueError(
                    "Target database already contains application data in: " + ", ".join(populated)
                )

            for table in Base.metadata.sorted_tables:
                if table.name in SKIPPED_TABLES:
                    continue
                rows = source.execute(select(table)).mappings().all()
                if rows:
                    target.execute(table.insert(), [dict(row) for row in rows])
                table_counts[table.name] = len(rows)
        return MigrationSummary(table_counts=table_counts)
    finally:
        source_engine.dispose()
        target_engine.dispose()


def _engine_for(database_url: str) -> Engine:
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Copy a Rationexa database into a fresh migrated database")
    parser.add_argument("--source", required=True, help="Source SQLAlchemy database URL")
    parser.add_argument("--target", required=True, help="Empty target SQLAlchemy database URL")
    args = parser.parse_args()
    summary = copy_database(args.source, args.target)
    print(f"Copied {summary.total_rows} rows across {len(summary.table_counts)} tables.")
    for table, count in summary.table_counts.items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()
