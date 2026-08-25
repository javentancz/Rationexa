import atexit
import os
import tempfile
from pathlib import Path

database_file = Path(tempfile.gettempdir()) / f"rationexa-test-{os.getpid()}.db"
artifact_dir = Path(tempfile.gettempdir()) / f"rationexa-artifacts-{os.getpid()}"
os.environ["DATABASE_URL"] = f"sqlite:///{database_file}"
os.environ["ARTIFACT_DIR"] = str(artifact_dir)
os.environ["AI_PROVIDER"] = "deterministic"


def cleanup() -> None:
    database_file.unlink(missing_ok=True)
    if artifact_dir.exists():
        for path in sorted(artifact_dir.rglob("*"), reverse=True):
            if path.is_file():
                path.unlink()
            elif path.is_dir():
                path.rmdir()
        artifact_dir.rmdir()


atexit.register(cleanup)
