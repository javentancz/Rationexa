from threading import Event

from fastapi.testclient import TestClient

from rationexa_api.config import get_settings
from rationexa_api.db import JobRow, SessionLocal
from rationexa_api.jobs import JobManager
from rationexa_api.main import app


def test_job_manager_completes_and_returns_result() -> None:
    with TestClient(app):
        manager = JobManager(max_workers=1)
        workspace_id = get_settings().local_workspace_id
        job = manager.create(workspace_id, "extraction", lambda _: {"id": "result-1"}, execution_mode="thread")

        for _ in range(100):
            job = manager.get(job["id"], workspace_id)
            if job["status"] == "succeeded":
                break

        assert job["status"] == "succeeded"
        assert job["progress"] == 100
        assert job["result"] == {"id": "result-1"}


def test_cancelled_job_discards_late_worker_result() -> None:
    with TestClient(app):
        manager = JobManager(max_workers=1)
        started = Event()
        release = Event()

        def worker(_: str) -> dict:
            started.set()
            release.wait(timeout=2)
            return {"should": "be discarded"}

        workspace_id = get_settings().local_workspace_id
        job = manager.create(workspace_id, "revisit", worker, execution_mode="thread")
        assert started.wait(timeout=1)
        cancelled = manager.cancel(job["id"], workspace_id)
        release.set()

        assert cancelled["status"] == "cancelled"
        assert cancelled["cancel_requested"] is True
        assert manager.get(job["id"], workspace_id)["result"] is None


def test_interrupted_jobs_fail_closed_after_restart() -> None:
    with TestClient(app):
        workspace_id = get_settings().local_workspace_id
        with SessionLocal() as db:
            row = JobRow(workspace_id=workspace_id, kind="challenge", status="running", phase="Calling model")
            db.add(row)
            db.commit()
            db.refresh(row)
            job_id = row.id

        recovered = JobManager().recover_interrupted()
        assert recovered >= 1
        with SessionLocal() as db:
            row = db.get(JobRow, job_id)
            assert row.status == "failed"
            assert "restart" in row.error.lower()
