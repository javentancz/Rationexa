import time

from alembic.runtime.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select

from rationexa_api.config import get_settings
from rationexa_api.db import (
    AccountRow,
    ArtifactRow,
    DecisionRow,
    DecisionShareRow,
    ExtractionRow,
    PremiseRow,
    RevisitRow,
    SessionLocal,
    SourceAnchorRow,
    WorkspaceRow,
    engine,
)
from rationexa_api.main import app


def test_database_is_at_the_alembic_head() -> None:
    with TestClient(app):
        with engine.connect() as connection:
            revision = MigrationContext.configure(connection).get_current_revision()
    assert revision == "20260828_04"


def test_readiness_checks_database_and_artifact_storage() -> None:
    with TestClient(app) as client:
        response = client.get("/readyz")
        assert response.status_code == 200
        assert response.json()["status"] == "ready"


def test_database_artifact_storage_preserves_original_bytes() -> None:
    settings = get_settings()
    original_storage = settings.artifact_storage
    settings.artifact_storage = "database"
    try:
        with TestClient(app) as client:
            response = client.post(
                "/v1/artifacts",
                json={"filename": "durable.txt", "media_type": "text/plain", "content": "durable evidence"},
            )
            assert response.status_code == 201
            with SessionLocal() as db:
                artifact = db.get(ArtifactRow, response.json()["id"])
                assert artifact is not None
                assert artifact.storage_uri.startswith("database://artifacts/")
                assert artifact.binary_content == b"durable evidence"
    finally:
        settings.artifact_storage = original_storage


def create_finalized_decision(
    client: TestClient,
    *,
    source: str,
    title: str,
    criticality: str = "important",
) -> dict:
    artifact = client.post(
        "/v1/artifacts",
        json={"filename": f"{title}.txt", "media_type": "text/plain", "content": source},
    ).json()
    extraction = client.post("/v1/decisions/extractions", json={"artifact_id": artifact["id"]}).json()
    reviewed = client.post(
        f"/v1/extractions/{extraction['id']}/review",
        json={
            "title": title,
            "reviews": [
                {
                    "candidate_id": premise["candidate_id"],
                    "action": "confirm",
                    "statement": premise["statement"],
                    "kind": premise["kind"],
                }
                for premise in extraction["result"]["premises"]
            ],
        },
    )
    assert reviewed.status_code == 200
    finalized = client.post(
        f"/v1/extractions/{extraction['id']}/finalize",
        json={"criticality": criticality},
    )
    assert finalized.status_code == 201
    return finalized.json()


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

        workspace = client.get("/v1/workspace")
        assert workspace.status_code == 200
        assert workspace.json()["mode"] == "local_personal"
        assert workspace.json()["name"] == "Personal workspace"
        assert workspace.json()["account_name"] == "Demo User"

        artifact = client.post(
            "/v1/artifacts",
            json={"filename": "decision.txt", "media_type": "text/plain", "content": source},
        )
        assert artifact.status_code == 201

        extraction = client.post("/v1/decisions/extractions", json={"artifact_id": artifact.json()["id"]})
        assert extraction.status_code == 201
        extraction_body = extraction.json()
        assert extraction_body["result"]["premises"]
        assert extraction_body["latency_ms"] >= 0
        assert extraction_body["input_tokens"] == 0
        assert extraction_body["output_tokens"] == 0
        assert extraction_body["estimated_cost_usd"] == 0.0
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
        assert revisit_body["prompt_version"] == "revisit-v4"
        assert revisit_body["latency_ms"] >= 0
        assert revisit_body["input_tokens"] == 0
        assert revisit_body["output_tokens"] == 0
        assert revisit_body["estimated_cost_usd"] == 0.0
        assert any(finding["relationship"] == "contradicts" for finding in revisit_body["findings"])
        assert any(finding["source_fallback_performed"] for finding in revisit_body["findings"])
        for finding in revisit_body["findings"]:
            judged = client.post(
                f"/v1/revisit-checks/{revisit_body['id']}/findings/{finding['premise_id']}/judgment",
                json={"judgment": "worth_reviewing", "notes": "Confirmed during Stage 1 review."},
            )
            assert judged.status_code == 200
        judged_body = judged.json()
        assert judged_body["status"] == "completed"
        assert all(finding["human_judgment"] == "worth_reviewing" for finding in judged_body["findings"])
        assert all(finding["judged_at"] for finding in judged_body["findings"])


def test_stage_two_challenge_is_source_grounded_and_requires_confirmation() -> None:
    source = (
        "We decided to use Vendor B because we assumed its external-user limitation would remain. "
        "The service must support SAML. "
        "Revisit if Vendor B introduces external-user support."
    )
    with TestClient(app) as client:
        decision = create_finalized_decision(
            client,
            source=source,
            title="Challenge-ready vendor decision",
        )
        created = client.post(
            f"/v1/decisions/{decision['id']}/challenge",
            json={"model_id": "deterministic/rules-v1"},
        )

        assert created.status_code == 200
        challenge = created.json()
        assert challenge["status"] == "draft"
        assert challenge["provider"] == "deterministic"
        assert challenge["prompt_version"] == "challenge-v1"
        for field in (
            "weakest_assumption",
            "missing_evidence",
            "strongest_counterargument",
            "reversal_condition",
        ):
            assert challenge[field]["premise_id"]
            assert challenge[field]["source_excerpt"] in source

        reopened = client.get(f"/v1/decisions/{decision['id']}").json()
        assert reopened["challenge"]["status"] == "draft"

        confirmed = client.post(
            f"/v1/decisions/{decision['id']}/challenge/confirm",
            json={"notes": "Reviewed against the preserved source."},
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["status"] == "confirmed"
        assert confirmed.json()["confirmed_at"]
        assert confirmed.json()["reviewer_notes"] == "Reviewed against the preserved source."


def test_revisit_provenance_columns_exist() -> None:
    with TestClient(app):
        columns = {column["name"] for column in inspect(engine).get_columns("revisit_checks")}

    assert {
        "evidence_filename",
        "provider",
        "model",
        "prompt_version",
        "latency_ms",
        "input_tokens",
        "output_tokens",
        "estimated_cost_usd",
    } <= columns
    decision_columns = {column["name"] for column in inspect(engine).get_columns("decisions")}
    assert "challenge" in decision_columns
    extraction_columns = {column["name"] for column in inspect(engine).get_columns("extractions")}
    assert {"latency_ms", "input_tokens", "output_tokens", "estimated_cost_usd"} <= extraction_columns
    assert "workspace_id" in extraction_columns
    assert "workspace_id" in {column["name"] for column in inspect(engine).get_columns("artifacts")}
    assert "workspace_id" in {column["name"] for column in inspect(engine).get_columns("decisions")}

    with SessionLocal() as db:
        assert db.get(AccountRow, get_settings().local_account_id) is not None
        assert db.get(WorkspaceRow, get_settings().local_workspace_id) is not None
        assert all(row.workspace_id for row in db.scalars(select(ArtifactRow)).all())
        assert all(row.workspace_id for row in db.scalars(select(ExtractionRow)).all())
        assert all(row.workspace_id for row in db.scalars(select(DecisionRow)).all())


def test_stage_two_usage_summary_distinguishes_known_and_unpriced_runs() -> None:
    source = (
        "We decided to use the internal service because we assume it remains available. "
        "Revisit if the service is retired."
    )
    with TestClient(app) as client:
        decision = create_finalized_decision(client, source=source, title="Usage summary decision")
        challenge = client.post(
            f"/v1/decisions/{decision['id']}/challenge",
            json={"model_id": "deterministic/rules-v1"},
        )
        assert challenge.status_code == 200
        revisit = client.post(
            f"/v1/decisions/{decision['id']}/revisit-checks",
            json={"content": "The internal service remains available."},
        )
        assert revisit.status_code == 201

        response = client.get("/v1/usage")
        assert response.status_code == 200
        usage = response.json()
        assert usage["total_runs"] >= 3
        assert usage["extraction_runs"] >= 1
        assert usage["revisit_runs"] >= 1
        assert usage["challenge_runs"] >= 1
        assert usage["local_runs"] >= 3
        assert usage["known_cost_usd"] == 0.0
        assert any(
            run["decision_id"] == decision["id"] and run["kind"] == "challenge"
            for run in usage["recent_runs"]
        )
        assert any(model["provider"] == "deterministic" for model in usage["models"])


def test_pilot_metrics_capture_real_product_actions() -> None:
    with TestClient(app) as client:
        decision = create_finalized_decision(
            client,
            source="We selected Vendor B because availability is assumed. Revisit if availability changes.",
            title="Pilot metrics decision",
        )
        assert client.get(f"/v1/decisions/{decision['id']}/export/markdown").status_code == 200
        assert client.post(f"/v1/decisions/{decision['id']}/shares", json={}).status_code == 201

        metrics = client.get("/v1/pilot/metrics")
        assert metrics.status_code == 200
        payload = metrics.json()
        assert payload["decision_count"] >= 1
        assert payload["share_count"] >= 1
        assert payload["export_count"] >= 1
        assert payload["active_days"] >= 1


def test_personal_workspace_excludes_other_workspace_records() -> None:
    other_account_id = "10000000-0000-4000-8000-000000000001"
    other_workspace_id = "10000000-0000-4000-8000-000000000002"
    other_artifact_id = "10000000-0000-4000-8000-000000000003"
    other_extraction_id = "10000000-0000-4000-8000-000000000004"
    other_decision_id = "10000000-0000-4000-8000-000000000005"
    with TestClient(app) as client:
        library_before = client.get("/v1/decisions").json()["total"]
        usage_before = client.get("/v1/usage").json()["total_runs"]
        with SessionLocal() as db:
            db.add(AccountRow(id=other_account_id, name="Other user"))
            db.flush()
            db.add(WorkspaceRow(id=other_workspace_id, owner_account_id=other_account_id, name="Other workspace"))
            db.flush()
            db.add(
                ArtifactRow(
                    id=other_artifact_id,
                    workspace_id=other_workspace_id,
                    filename="private.txt",
                    media_type="text/plain",
                    sha256="f" * 64,
                    storage_uri="memory://private",
                    extracted_text="Private decision source.",
                )
            )
            db.flush()
            db.add(
                ExtractionRow(
                    id=other_extraction_id,
                    workspace_id=other_workspace_id,
                    artifact_id=other_artifact_id,
                    provider="deterministic",
                    model="rules-v1",
                    output={},
                )
            )
            db.flush()
            db.add(
                DecisionRow(
                    id=other_decision_id,
                    workspace_id=other_workspace_id,
                    extraction_id=other_extraction_id,
                    title="Other workspace decision",
                    question="Should this remain private?",
                )
            )
            db.commit()

        assert client.get("/v1/decisions").json()["total"] == library_before
        assert client.get("/v1/usage").json()["total_runs"] == usage_before
        assert client.get(f"/v1/decisions/{other_decision_id}").status_code == 404


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


def test_keep_unknown_preserves_premise_in_final_decision() -> None:
    source = "The client's deployment framework is still unknown and must be confirmed later."

    with TestClient(app) as client:
        artifact = client.post(
            "/v1/artifacts",
            json={"filename": "unknown.txt", "media_type": "text/plain", "content": source},
        ).json()
        extraction = client.post(
            "/v1/decisions/extractions",
            json={"artifact_id": artifact["id"]},
        ).json()
        candidate = extraction["result"]["premises"][0]

        reviewed = client.post(
            f"/v1/extractions/{extraction['id']}/review",
            json={
                "reviews": [
                    {
                        "candidate_id": candidate["candidate_id"],
                        "action": "unknown",
                        "statement": candidate["statement"],
                        "kind": candidate["kind"],
                    }
                ]
            },
        )

        assert reviewed.status_code == 200
        reviewed_premise = reviewed.json()["result"]["premises"][0]
        assert reviewed_premise["kind"] == "unknown"
        assert reviewed_premise["quality_state"] == "confirmed"

        finalized = client.post(
            f"/v1/extractions/{extraction['id']}/finalize",
            json={"criticality": "critical"},
        )

        assert finalized.status_code == 201
        assert len(finalized.json()["premises"]) == 1
        assert finalized.json()["premises"][0]["kind"] == "unknown"


def test_stage_two_decision_library_search_and_revisit_history() -> None:
    with TestClient(app) as client:
        vendor = create_finalized_decision(
            client,
            source=(
                "We decided to use Vendor B because we assumed Vendor B does not support external users. "
                "Revisit if Vendor B introduces external-user support."
            ),
            title="Library Atlas vendor decision",
            criticality="important",
        )
        create_finalized_decision(
            client,
            source="We decided to use SQLite because the application must remain portable.",
            title="Portable database decision",
            criticality="routine",
        )

        library = client.get("/v1/decisions")
        assert library.status_code == 200
        assert library.json()["total"] >= 2
        assert {
            "Library Atlas vendor decision",
            "Portable database decision",
        } <= {item["title"] for item in library.json()["items"]}

        search = client.get("/v1/decisions", params={"q": "Library Atlas", "criticality": "important"})
        assert search.status_code == 200
        assert search.json()["total"] == 1
        assert search.json()["items"][0]["id"] == vendor["id"]
        assert search.json()["items"][0]["premise_count"] == len(vendor["premises"])

        revisit = client.post(
            f"/v1/decisions/{vendor['id']}/revisit-checks",
            json={
                "filename": "vendor-release-note.txt",
                "content": "Vendor B now supports external users.",
            },
        )
        assert revisit.status_code == 201

        history = client.get(f"/v1/decisions/{vendor['id']}/revisit-checks")
        assert history.status_code == 200
        assert len(history.json()) == 1
        assert history.json()[0]["id"] == revisit.json()["id"]
        assert history.json()[0]["evidence_filename"] == "vendor-release-note.txt"

        refreshed = client.get("/v1/decisions", params={"q": "Library Atlas"}).json()["items"][0]
        assert refreshed["revisit_count"] == 1
        assert refreshed["pending_revisit_count"] == 1
        assert refreshed["last_revisited_at"] is not None


def test_stage_two_markdown_export_contains_reviewed_record_and_revisit_history() -> None:
    with TestClient(app) as client:
        decision = create_finalized_decision(
            client,
            source=(
                "We decided to use Vendor B because we assumed Vendor B does not support external users. "
                "Revisit if Vendor B introduces external-user support."
            ),
            title="Exportable vendor decision",
            criticality="critical",
        )
        revisit = client.post(
            f"/v1/decisions/{decision['id']}/revisit-checks",
            json={
                "filename": "vendor-release-note.txt",
                "content": "Vendor B now supports external users.",
            },
        )
        assert revisit.status_code == 201
        finding = revisit.json()["findings"][0]
        judged = client.post(
            f"/v1/revisit-checks/{revisit.json()['id']}/findings/{finding['premise_id']}/judgment",
            json={"judgment": "worth_reviewing", "notes": "Confirmed by the project owner."},
        )
        assert judged.status_code == 200

        exported = client.get(
            f"/v1/decisions/{decision['id']}/export/markdown",
            headers={"Origin": "http://localhost:3000"},
        )

        assert exported.status_code == 200
        assert exported.headers["content-type"].startswith("text/markdown")
        assert exported.headers["content-disposition"] == (
            'attachment; filename="exportable-vendor-decision-record.md"'
        )
        assert exported.headers["access-control-expose-headers"] == "Content-Disposition"
        assert "# Exportable vendor decision" in exported.text
        assert "## Preserved premises" in exported.text
        assert "Reviewed source excerpt" in exported.text
        assert "## Revisit history" in exported.text
        assert "vendor-release-note.txt" in exported.text
        assert "deterministic / rules-v1" in exported.text
        assert "worth reviewing" in exported.text
        assert "Confirmed by the project owner." in exported.text
        assert "storage_uri" not in exported.text


def test_markdown_export_returns_not_found_for_unknown_decision() -> None:
    with TestClient(app) as client:
        response = client.get("/v1/decisions/missing/export/markdown")

    assert response.status_code == 404


def test_stage_two_pdf_export_returns_valid_pdf_with_reviewed_record() -> None:
    with TestClient(app) as client:
        decision = create_finalized_decision(
            client,
            source=(
                  "We decided to use Vendor B because it was assumed Vendor B does not support external users. "
                  "The service must support SAML. Revisit if Vendor B introduces external-user support."
               ),
            title="Pdf export decision",
            criticality="critical",
          )
        revisit = client.post(
            f"/v1/decisions/{decision['id']}/revisit-checks",
            json={
                  "filename": "vendor-release-note.txt",
                  "content": "Vendor B now supports external users.",
              },
          )
        assert revisit.status_code == 201
        finding = revisit.json()["findings"][0]
        judged = client.post(
            f"/v1/revisit-checks/{revisit.json()['id']}/findings/{finding['premise_id']}/judgment",
            json={"judgment": "worth_reviewing"},
          )
        assert judged.status_code == 200

        response = client.get(f"/v1/decisions/{decision['id']}/export/pdf")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/pdf")
        assert response.headers["content-disposition"] == 'attachment; filename="pdf-export-decision-record.pdf"'
        assert response.content[:4] == b"%PDF"
        assert len(response.content) > 100


def test_pdf_export_returns_not_found_for_unknown_decision() -> None:
    with TestClient(app) as client:
        response = client.get("/v1/decisions/missing/export/pdf")

    assert response.status_code == 404


def test_delete_decision_removes_all_related_records() -> None:
    with TestClient(app) as client:
        decision = create_finalized_decision(
            client,
            source="We decided to use Vendor B because it was assumed Vendor B does not support external users.",
            title="Deletable decision",
            criticality="critical",
          )
        revisit = client.post(
            f"/v1/decisions/{decision['id']}/revisit-checks",
            json={"content": "Vendor B now supports external users."},
          )
        assert revisit.status_code == 201
        share = client.post(f"/v1/decisions/{decision['id']}/shares", json={}).json()
        assert share["status"] == "active"

        with SessionLocal() as db:
            premise_ids = [
                 row.id for row in db.scalars(select(PremiseRow).where(PremiseRow.decision_id == decision["id"])).all()
             ]
            assert premise_ids
            anchored = db.scalar(
                 select(func.count()).select_from(SourceAnchorRow).where(SourceAnchorRow.premise_id.in_(premise_ids))
              )
            assert anchored > 0

        deleted = client.delete(f"/v1/decisions/{decision['id']}")
        assert deleted.status_code == 204

        with SessionLocal() as db:
            assert db.get(DecisionRow, decision["id"]) is None
            remaining_premises = db.scalar(
                 select(func.count()).select_from(PremiseRow).where(PremiseRow.decision_id == decision["id"])
               )
            assert remaining_premises == 0
            remaining_revisits = db.scalar(
                 select(func.count()).select_from(RevisitRow).where(RevisitRow.decision_id == decision["id"])
               )
            assert remaining_revisits == 0
            remaining_shares = db.scalar(
                 select(func.count())
                   .select_from(DecisionShareRow)
                   .where(DecisionShareRow.decision_id == decision["id"])
               )
            assert remaining_shares == 0
            remaining_anchors = db.scalar(
                 select(func.count())
                   .select_from(SourceAnchorRow)
                   .where(SourceAnchorRow.premise_id.in_(premise_ids))
               )
            assert remaining_anchors == 0

        assert client.get(f"/v1/decisions/{decision['id']}").status_code == 404
        assert client.get(f"/v1/shares/{share['token']}").status_code == 404


def test_delete_unknown_decision_returns_not_found() -> None:
    with TestClient(app) as client:
        assert client.delete("/v1/decisions/missing").status_code == 404
