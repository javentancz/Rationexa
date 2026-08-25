from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import uuid4


class JobManager:
    def __init__(self, max_workers: int = 2):
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="rationexa-job")
        self._jobs: dict[str, dict[str, Any]] = {}
        self._lock = Lock()

    def create(self, kind: str, worker: Callable[[str], dict[str, Any] | None]) -> dict[str, Any]:
        job_id = str(uuid4())
        now = datetime.now(UTC).isoformat()
        record = {
            "id": job_id,
            "kind": kind,
            "status": "queued",
            "phase": "Queued",
            "progress": 0,
            "cancel_requested": False,
            "result": None,
            "error": None,
            "created_at": now,
            "updated_at": now,
        }
        with self._lock:
            self._jobs[job_id] = record
        self._executor.submit(self._run, job_id, worker)
        return self.get(job_id)

    def _run(self, job_id: str, worker: Callable[[str], dict[str, Any] | None]) -> None:
        self.update(job_id, status="running", phase="Preparing input", progress=10)
        try:
            result = worker(job_id)
            if self.is_cancelled(job_id):
                return
            if result is None:
                self.cancel(job_id)
                return
            self.update(job_id, status="succeeded", phase="Complete", progress=100, result=result)
        except Exception as exc:
            if not self.is_cancelled(job_id):
                self.update(job_id, status="failed", phase="Failed", error=str(exc))

    def update(self, job_id: str, **changes: Any) -> dict[str, Any]:
        with self._lock:
            record = self._jobs[job_id]
            if record["status"] == "cancelled" and changes.get("status") != "cancelled":
                return dict(record)
            record.update(changes)
            record["updated_at"] = datetime.now(UTC).isoformat()
            return dict(record)

    def get(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            if job_id not in self._jobs:
                raise KeyError(job_id)
            return dict(self._jobs[job_id])

    def cancel(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            if job_id not in self._jobs:
                raise KeyError(job_id)
            record = self._jobs[job_id]
            if record["status"] not in {"succeeded", "failed", "cancelled"}:
                record.update(
                    status="cancelled",
                    phase="Cancelled; late model output will be discarded",
                    cancel_requested=True,
                    updated_at=datetime.now(UTC).isoformat(),
                )
            return dict(record)

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            return self._jobs[job_id]["cancel_requested"]


job_manager = JobManager()
