import json
import tarfile
from pathlib import Path

import pytest

from rationexa_api.pilot_backup import BACKUP_FORMAT, file_sha256, postgres_url, verify_backup


def test_postgres_url_accepts_pilot_driver_and_rejects_sqlite() -> None:
    assert postgres_url("postgresql+psycopg://user:pass@localhost:5433/rationexa").drivername == "postgresql"
    with pytest.raises(ValueError, match="PostgreSQL"):
        postgres_url("sqlite:///rationexa.db")


def test_verify_backup_checks_database_digest(tmp_path: Path) -> None:
    database = tmp_path / "database.dump"
    database.write_bytes(b"pilot-backup")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps({"format": BACKUP_FORMAT, "database_sha256": file_sha256(database)}),
        encoding="utf-8",
    )
    archive_path = tmp_path / "backup.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        archive.add(database, arcname="database.dump")
        archive.add(manifest, arcname="manifest.json")

    assert verify_backup(archive_path)["format"] == BACKUP_FORMAT

    database.write_bytes(b"tampered")
    with tarfile.open(archive_path, "w:gz") as archive:
        archive.add(database, arcname="database.dump")
        archive.add(manifest, arcname="manifest.json")
    with pytest.raises(ValueError, match="checksum"):
        verify_backup(archive_path)
