import time

from fastapi.testclient import TestClient

from rationexa_api.db import ExtractionRow, SessionLocal
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
        assert revisit.json()["findings"]
        assert any(finding["relationship"] == "contradicts" for finding in revisit.json()["findings"])
        assert any(finding["source_fallback_performed"] for finding in revisit.json()["findings"])


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
