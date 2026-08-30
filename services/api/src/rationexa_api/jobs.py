from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Literal

from sqlalchemy import select

from .db import JobRow, SessionLocal, now_utc


class JobManager:
    """Persist job state and scope every operation to its owning workspace."""

    def __init__(self, max_workers: int = 2):
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="rationexa-job")

    def create(
        self,
        workspace_id: str,
        kind: str,
        worker: Callable[[str], dict[str, Any] | None],
        *,
        execution_mode: Literal["inline", "thread"] = "inline",
    ) -> dict[str, Any]:
        with SessionLocal() as db:
            row = JobRow(workspace_id=workspace_id, kind=kind)
            db.add(row)
            db.commit()
            db.refresh(row)
            job_id = row.id
        if execution_mode == "thread":
            self._executor.submit(self._run, job_id, workspace_id, worker)
        else:
            self._run(job_id, workspace_id, worker)
        return self.get(job_id, workspace_id)

    def _run(self, job_id: str, workspace_id: str, worker: Callable[[str], dict[str, Any] | None]) -> None:
        self.update(job_id, workspace_id, status="running", phase="Preparing input", progress=10)
        try:
            result = worker(job_id)
            if self.is_cancelled(job_id, workspace_id):
                return
            if result is None:
                self.cancel(job_id, workspace_id)
                return
            self.update(
                job_id,
                workspace_id,
                status="succeeded",
                phase="Complete",
                progress=100,
                result=result,
                error=None,
            )
        except Exception as exc:
            if not self.is_cancelled(job_id, workspace_id):
                self.update(job_id, workspace_id, status="failed", phase="Failed", error=str(exc))

    def _row(self, db, job_id: str, workspace_id: str) -> JobRow:
        row = db.scalar(select(JobRow).where(JobRow.id == job_id, JobRow.workspace_id == workspace_id))
        if row is None:
            raise KeyError(job_id)
        return row

    @staticmethod
    def _read(row: JobRow) -> dict[str, Any]:
        return {
            "id": row.id,
            "kind": row.kind,
            "status": row.status,
            "phase": row.phase,
            "progress": row.progress,
            "cancel_requested": row.cancel_requested,
            "result": row.result,
            "error": row.error,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def update(self, job_id: str, workspace_id: str, **changes: Any) -> dict[str, Any]:
        with SessionLocal() as db:
            row = self._row(db, job_id, workspace_id)
            if row.status == "cancelled" and changes.get("status") != "cancelled":
                return self._read(row)
            for key, value in changes.items():
                setattr(row, key, value)
            row.updated_at = now_utc()
            db.commit()
            db.refresh(row)
            return self._read(row)

    def get(self, job_id: str, workspace_id: str) -> dict[str, Any]:
        with SessionLocal() as db:
            return self._read(self._row(db, job_id, workspace_id))

    def cancel(self, job_id: str, workspace_id: str) -> dict[str, Any]:
        with SessionLocal() as db:
            row = self._row(db, job_id, workspace_id)
            if row.status not in {"succeeded", "failed", "cancelled"}:
                row.status = "cancelled"
                row.phase = "Cancelled; late model output will be discarded"
                row.cancel_requested = True
                row.updated_at = now_utc()
                db.commit()
                db.refresh(row)
            return self._read(row)

    def is_cancelled(self, job_id: str, workspace_id: str) -> bool:
        with SessionLocal() as db:
            return self._row(db, job_id, workspace_id).cancel_requested

    def recover_interrupted(self) -> int:
        """Fail work that cannot survive a process restart instead of polling forever."""
        with SessionLocal() as db:
            rows = db.scalars(select(JobRow).where(JobRow.status.in_({"queued", "running"}))).all()
            for row in rows:
                row.status = "failed"
                row.phase = "Interrupted by a service restart"
                row.error = "The service restarted before this job completed. Retry the action."
                row.updated_at = now_utc()
            db.commit()
            return len(rows)


job_manager = JobManager()
