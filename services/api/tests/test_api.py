import time

from fastapi.testclient import TestClient
from sqlalchemy import inspect, select

from rationexa_api.db import ExtractionRow, RevisitRow, SessionLocal, engine
from rationexa_api.main import app


def test_stage_one_vertical_slice() -> None:
    source = (
        "We decided to use Vendor B because we assumed Vendor B does not support external users. "
        "The service must support SAML. "
        "Revisit if Vendor B introduces external-user support."
    )

    with TestClient(app) as client:
        health = client.get("/healthz")
        assert health.status_code == 200

        models = client.get("/v1/models")
        assert models.status_code == 200
        assert models.json()["default_model_id"] == "deterministic/rules-v1"

        artifact = client.post(
            "/v1/artifacts",
            json={"filename": "decision.txt", "media_type": "text/plain", "content": source},
        )
        assert artifact.status_code == 201

        extraction = client.post("/v1/decisions/extractions", json={"artifact_id": artifact.json()["id"]})
        assert extraction.status_code == 201
        extraction_body = extraction.json()
        assert extraction_body["result"]["premises"]
        assert all(
            premise["anchor"]["exact_excerpt"] in source
            for premise in extraction_body["result"]["premises"]
            if premise["anchor"]
        )

        reviews = [
            {
                "candidate_id": premise["candidate_id"],
                "action": "confirm",
                "statement": premise["statement"],
                "kind": premise["kind"],
            }
            for premise in extraction_body["result"]["premises"]
        ]
        reviewed = client.post(
            f"/v1/extractions/{extraction_body['id']}/review",
            json={
                "reviews": reviews,
                "title": "Reviewed vendor decision",
                "decision_question": "Should we continue with Vendor B?",
                "chosen_option": "Vendor B",
                "rationale": "Current workflow fit.",
            },
        )
        assert reviewed.status_code == 200
        assert reviewed.json()["result"]["title"] == "Reviewed vendor decision"
        assert reviewed.json()["result"]["decision_question"] == "Should we continue with Vendor B?"

        finalized = client.post(
            f"/v1/extractions/{extraction_body['id']}/finalize",
            json={"criticality": "important"},
        )
        assert finalized.status_code == 201
        decision = finalized.json()
        assert decision["preservation_policy"] == "key_excerpts"

        revisit = client.post(
            f"/v1/decisions/{decision['id']}/revisit-checks",
            json={
                "filename": "vendor-update.txt",
                "content": "Vendor B now supports external users and still supports SAML.",
            },
        )
        assert revisit.status_code == 201
        revisit_body = revisit.json()
        assert revisit_body["findings"]
        assert revisit_body["provider"] == "deterministic"
        assert revisit_body["model"] == "rules-v1"
        assert revisit_body["prompt_version"] == "revisit-v2"
        assert revisit_body["latency_ms"] >= 0
        assert revisit_body["input_tokens"] == 0
        assert revisit_body["output_tokens"] == 0
        assert revisit_body["estimated_cost_usd"] == 0.0
        assert any(finding["relationship"] == "contradicts" for finding in revisit_body["findings"])
        assert any(finding["source_fallback_performed"] for finding in revisit_body["findings"])


def test_revisit_provenance_columns_exist() -> None:
    with TestClient(app):
        columns = {column["name"] for column in inspect(engine).get_columns("revisit_checks")}

    assert {
        "provider",
        "model",
        "prompt_version",
        "latency_ms",
        "input_tokens",
        "output_tokens",
        "estimated_cost_usd",
    } <= columns


def test_rejects_model_outside_server_allowlist() -> None:
    with TestClient(app) as client:
        artifact = client.post(
            "/v1/artifacts",
            json={"filename": "decision.txt", "content": "We decided to use PostgreSQL."},
        ).json()

        response = client.post(
            "/v1/decisions/extractions",
            json={"artifact_id": artifact["id"], "model_id": "ollama/not-installed"},
        )

        assert response.status_code == 422
        assert "allowlist" in response.json()["detail"]


def test_extraction_background_job_completes() -> None:
    with TestClient(app) as client:
        artifact = client.post(
            "/v1/artifacts",
            json={"filename": "job.txt", "content": "We decided to use SQLite because it is portable."},
        ).json()
        created = client.post(
            "/v1/decisions/extractions/jobs",
            json={"artifact_id": artifact["id"]},
        )

        assert created.status_code == 202
        job = created.json()
        for _ in range(100):
            job = client.get(f"/v1/jobs/{job['id']}").json()
            if job["status"] in {"succeeded", "failed", "cancelled"}:
                break
            time.sleep(0.01)

        assert job["status"] == "succeeded"
        assert job["result"]["result"]["premises"]


def test_parallel_revisit_jobs_persist_independent_runs() -> None:
    source = "We assumed Vendor B would not support external users."
    with TestClient(app) as client:
        artifact = client.post(
            "/v1/artifacts",
            json={"filename": "parallel.txt", "content": source},
        ).json()
        extraction = client.post(
            "/v1/decisions/extractions",
            json={"artifact_id": artifact["id"]},
        ).json()
        premise = extraction["result"]["premises"][0]
        client.post(
            f"/v1/extractions/{extraction['id']}/review",
            json={
                "reviews": [
                    {
                        "candidate_id": premise["candidate_id"],
                        "action": "confirm",
                        "statement": premise["statement"],
                        "kind": premise["kind"],
                    }
                ]
            },
        )
        decision = client.post(
            f"/v1/extractions/{extraction['id']}/finalize",
            json={"criticality": "important"},
        ).json()
        payload = {
            "filename": "same-evidence.txt",
            "content": "Vendor B now supports external users.",
        }
        jobs = [client.post(f"/v1/decisions/{decision['id']}/revisit-jobs", json=payload).json() for _ in range(2)]

        for _ in range(100):
            jobs = [client.get(f"/v1/jobs/{job['id']}").json() for job in jobs]
            if all(job["status"] in {"succeeded", "failed", "cancelled"} for job in jobs):
                break
            time.sleep(0.01)

        assert all(job["status"] == "succeeded" for job in jobs)
        assert all(job["result"]["provider"] == "deterministic" for job in jobs)
        with SessionLocal() as db:
            rows = db.scalars(select(RevisitRow).where(RevisitRow.decision_id == decision["id"])).all()
        assert len(rows) == 2


def test_critical_decision_rejects_unanchored_consequential_premise() -> None:
    source = "We assumed the controller would remain maintained."

    with TestClient(app) as client:
        artifact = client.post(
            "/v1/artifacts",
            json={"filename": "decision.txt", "media_type": "text/plain", "content": source},
        ).json()
        extraction = client.post(
            "/v1/decisions/extractions",
            json={"artifact_id": artifact["id"]},
        ).json()
        candidate = extraction["result"]["premises"][0]

        with SessionLocal() as db:
            row = db.get(ExtractionRow, extraction["id"])
            output = dict(row.output)
            output["premises"] = [dict(output["premises"][0], anchor=None)]
            row.output = output
            db.commit()

        reviewed = client.post(
            f"/v1/extractions/{extraction['id']}/review",
            json={
                "reviews": [
                    {
                        "candidate_id": candidate["candidate_id"],
                        "action": "confirm",
                        "statement": candidate["statement"],
                        "kind": "assumption",
                    }
                ]
            },
        )
        assert reviewed.status_code == 200

        finalized = client.post(
            f"/v1/extractions/{extraction['id']}/finalize",
            json={"criticality": "critical"},
        )

        assert finalized.status_code == 422
        assert "require source anchors" in finalized.json()["detail"]
