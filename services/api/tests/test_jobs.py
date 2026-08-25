from threading import Event

from rationexa_api.jobs import JobManager


def test_job_manager_completes_and_returns_result() -> None:
    manager = JobManager(max_workers=1)
    job = manager.create("extraction", lambda _: {"id": "result-1"})

    for _ in range(100):
        job = manager.get(job["id"])
        if job["status"] == "succeeded":
            break

    assert job["status"] == "succeeded"
    assert job["progress"] == 100
    assert job["result"] == {"id": "result-1"}


def test_cancelled_job_discards_late_worker_result() -> None:
    manager = JobManager(max_workers=1)
    started = Event()
    release = Event()

    def worker(_: str) -> dict:
        started.set()
        release.wait(timeout=2)
        return {"should": "be discarded"}

    job = manager.create("revisit", worker)
    assert started.wait(timeout=1)
    cancelled = manager.cancel(job["id"])
    release.set()

    assert cancelled["status"] == "cancelled"
    assert cancelled["cancel_requested"] is True
    assert manager.get(job["id"])["result"] is None
