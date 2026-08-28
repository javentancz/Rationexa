"""Create, verify, and safely restore pilot PostgreSQL and artifact backups."""

import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL, make_url

from .config import get_settings

BACKUP_FORMAT = "rationexa-pilot-backup-v1"


def postgres_url(value: str) -> URL:
    url = make_url(value)
    if not url.drivername.startswith("postgresql"):
        raise ValueError("Pilot backups require a PostgreSQL DATABASE_URL")
    return url.set(drivername="postgresql")


def command_connection(url: URL) -> tuple[list[str], dict[str, str]]:
    args: list[str] = []
    if url.host:
        args.extend(["--host", url.host])
    if url.port:
        args.extend(["--port", str(url.port)])
    if url.username:
        args.extend(["--username", url.username])
    if url.database:
        args.extend(["--dbname", url.database])
    environment = {"PGPASSWORD": url.password} if url.password else {}
    return args, environment


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_backup(
    database_url: str,
    artifact_dir: Path,
    output: Path,
    *,
    compose_service: str | None = None,
) -> Path:
    url = postgres_url(database_url)
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="rationexa-backup-") as temp_name:
        temp = Path(temp_name)
        dump = temp / "database.dump"
        import os
        if compose_service:
            with dump.open("wb") as stream:
                subprocess.run(
                    [
                        "docker",
                        "compose",
                        "exec",
                        "-T",
                        compose_service,
                        "pg_dump",
                        "--format=custom",
                        "--no-owner",
                        "--username",
                        url.username or "rationexa",
                        "--dbname",
                        url.database or "rationexa",
                    ],
                    check=True,
                    stdout=stream,
                    env=os.environ,
                )
        else:
            connection_args, secret_env = command_connection(url)
            subprocess.run(
                ["pg_dump", "--format=custom", "--no-owner", "--file", str(dump), *connection_args],
                check=True,
                env={**os.environ, **secret_env},
            )
        manifest = {
            "format": BACKUP_FORMAT,
            "created_at": datetime.now(UTC).isoformat(),
            "database_sha256": file_sha256(dump),
            "artifact_files": sum(1 for entry in artifact_dir.rglob("*") if entry.is_file())
            if artifact_dir.exists()
            else 0,
            "includes_encryption_key": False,
        }
        (temp / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        with tarfile.open(output, "w:gz") as archive:
            archive.add(dump, arcname="database.dump")
            archive.add(temp / "manifest.json", arcname="manifest.json")
            if artifact_dir.exists():
                archive.add(artifact_dir, arcname="artifacts")
    return output


def verify_backup(path: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="rationexa-verify-") as temp_name:
        temp = Path(temp_name)
        with tarfile.open(path, "r:gz") as archive:
            archive.extractall(temp, filter="data")
        manifest = json.loads((temp / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("format") != BACKUP_FORMAT:
            raise ValueError("Unsupported Rationexa backup format")
        if file_sha256(temp / "database.dump") != manifest.get("database_sha256"):
            raise ValueError("Backup database checksum does not match")
        return manifest


def restore_backup(
    path: Path,
    database_url: str,
    artifact_dir: Path,
    *,
    compose_service: str | None = None,
) -> None:
    verify_backup(path)
    url = postgres_url(database_url)
    target_engine = create_engine(url.set(drivername="postgresql+psycopg"))
    try:
        if inspect(target_engine).get_table_names():
            raise ValueError("Restore target database must be empty")
    finally:
        target_engine.dispose()
    if artifact_dir.exists() and any(artifact_dir.iterdir()):
        raise ValueError("Restore artifact directory must be empty")
    with tempfile.TemporaryDirectory(prefix="rationexa-restore-") as temp_name:
        temp = Path(temp_name)
        with tarfile.open(path, "r:gz") as archive:
            archive.extractall(temp, filter="data")
        import os
        if compose_service:
            with (temp / "database.dump").open("rb") as stream:
                subprocess.run(
                    [
                        "docker",
                        "compose",
                        "exec",
                        "-T",
                        compose_service,
                        "pg_restore",
                        "--exit-on-error",
                        "--no-owner",
                        "--username",
                        url.username or "rationexa",
                        "--dbname",
                        url.database or "rationexa",
                    ],
                    check=True,
                    stdin=stream,
                    env=os.environ,
                )
        else:
            connection_args, secret_env = command_connection(url)
            subprocess.run(
                ["pg_restore", "--exit-on-error", "--no-owner", *connection_args, str(temp / "database.dump")],
                check=True,
                env={**os.environ, **secret_env},
            )
        restored_artifacts = temp / "artifacts"
        if restored_artifacts.exists():
            artifact_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(restored_artifacts, artifact_dir, dirs_exist_ok=True)
        restored_engine = create_engine(url.set(drivername="postgresql+psycopg"))
        try:
            with restored_engine.begin() as connection:
                artifacts = connection.execute(text("SELECT id, sha256, storage_uri FROM artifacts")).mappings()
                for artifact in artifacts:
                    suffix = Path(str(artifact["storage_uri"])).suffix
                    storage_uri = artifact_dir / str(artifact["sha256"])[:2] / f"{artifact['sha256']}{suffix}"
                    connection.execute(
                        text("UPDATE artifacts SET storage_uri = :storage_uri WHERE id = :id"),
                        {"storage_uri": str(storage_uri), "id": artifact["id"]},
                    )
        finally:
            restored_engine.dispose()


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create")
    create.add_argument("output", type=Path)
    create.add_argument(
        "--compose-service",
        help="Run pg_dump inside this Docker Compose service so its client matches the server",
    )
    verify = subparsers.add_parser("verify")
    verify.add_argument("backup", type=Path)
    restore = subparsers.add_parser("restore")
    restore.add_argument("backup", type=Path)
    restore.add_argument("--database-url", required=True)
    restore.add_argument("--artifact-dir", required=True, type=Path)
    restore.add_argument("--confirm-empty-target", action="store_true")
    restore.add_argument(
        "--compose-service",
        help="Run pg_restore inside this Docker Compose service so its client matches the server",
    )
    args = parser.parse_args()
    if args.command == "create":
        print(
            create_backup(
                settings.database_url,
                settings.artifact_dir,
                args.output,
                compose_service=args.compose_service,
            )
        )
    elif args.command == "verify":
        print(json.dumps(verify_backup(args.backup), indent=2))
    else:
        if not args.confirm_empty_target:
            parser.error("restore requires --confirm-empty-target")
        restore_backup(
            args.backup,
            args.database_url,
            args.artifact_dir,
            compose_service=args.compose_service,
        )
        print("Restore completed")


if __name__ == "__main__":
    main()
