from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from rationexa_api.db import DecisionRow, RevisitRow, SessionLocal, now_utc
from rationexa_api.main import app


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


def _created_share(client: TestClient, decision_id: str) -> dict:
    created = client.post(f"/v1/decisions/{decision_id}/shares", json={})
    assert created.status_code == 201
    return created.json()


def test_share_link_round_trips_read_only_record_and_revoke() -> None:
    with TestClient(app) as client:
        decision = create_finalized_decision(
            client,
            source="We decided to use Vendor B because it was assumed Vendor B does not support external users.",
            title="Shared vendor decision",
            criticality="important",
         )
        revisit = client.post(
            f"/v1/decisions/{decision['id']}/revisit-checks",
            json={"filename": "vendor-note.txt", "content": "Vendor B now supports external users."},
         )
        assert revisit.status_code == 201

        share = _created_share(client, decision["id"])
        assert share["status"] == "active"
        assert share["url"] == f"http://localhost:3000/share/{share['token']}"
        assert share["expires_at"] is not None
        expires_at = datetime.fromisoformat(share["expires_at"])
        assert expires_at.tzinfo is not None
        assert timedelta(days=29) < expires_at - now_utc() <= timedelta(days=30)

        listed = client.get(f"/v1/decisions/{decision['id']}/shares")
        assert listed.status_code == 200
        assert len(listed.json()) == 1

        reading = client.get(f"/v1/shares/{share['token']}")
        assert reading.status_code == 200
        body = reading.json()
        assert body["title"] == "Shared vendor decision"
        assert body["premises"]
        assert [revisit_["evidence_filename"] for revisit_ in body["revisits"]] == [None]
        assert body["shared_at"]

        revoked = client.delete(f"/v1/decisions/{decision['id']}/shares/{share['id']}")
        assert revoked.status_code == 200
        assert revoked.json()["status"] == "revoked"
        assert revoked.json()["url"] is None

        after_revoke = client.get(f"/v1/shares/{share['token']}")
        assert after_revoke.status_code == 404


def test_expired_share_link_is_not_served() -> None:
    with TestClient(app) as client:
        decision = create_finalized_decision(
            client,
            source="We decided to use SQLite because the application must remain portable.",
            title="Expired share decision",
            criticality="routine",
         )
        created = client.post(
            f"/v1/decisions/{decision['id']}/shares",
            json={"expires_at": (now_utc() - timedelta(minutes=1)).isoformat()},
         )
        assert created.status_code == 201
        token = created.json()["token"]

        assert client.get(f"/v1/shares/{token}").status_code == 404


def test_shared_record_never_leaks_provider_secrets_or_private_artifacts() -> None:
    import json

    with TestClient(app) as client:
        decision = create_finalized_decision(
            client,
            source=(
                 "We decided to use Vendor B because it was assumed Vendor B does not support external users. "
                 "The service must support SAML. Revisit if Vendor B introduces external-user support."
             ),
            title="Secret scrub decision",
            criticality="critical",
          )

        with SessionLocal() as db:
            row = db.get(DecisionRow, decision["id"])
            assert row is not None
            row.question = "The deployment requires OPENAI_API_KEY to remain unset in production."
            assert row.premises and row.premises[0].anchor is not None
            row.premises[0].anchor.exact_excerpt = "Authorization: Bearer sk-anchor-should-not-leak"
            db.commit()

        revisit = client.post(
            f"/v1/decisions/{decision['id']}/revisit-checks",
            json={
                 "filename": "private-evidence.txt",
                 "content": "Vendor B now supports external users and still supports SAML for enterprise tenants.",
             },
         )
        assert revisit.status_code == 201

        with SessionLocal() as db:
            checks = db.scalars(select(RevisitRow).where(RevisitRow.decision_id == decision["id"])).all()
            assert checks
            for check in checks:
                check.findings = [
                     {
                         "premise_id": "p1",
                         "premise_statement": "Vendor B does not support external users.",
                         "relationship": "contradicts",
                         "confidence_band": "high",
                         "explanation": "The new evidence contradicts the preserved premise.",
                         "new_excerpt": "Vendor B now supports external users.",
                         "old_excerpt": "Vendor B does not support external users.",
                         "source_fallback_performed": True,
                         "evidence_artifact_id": "artifact-should-not-leak",
                         "provider_secret": "sk-live-should-not-leak",
                         "human_judgment": "worth_reviewing",
                     }
                 ]
            db.commit()

        share = _created_share(client, decision["id"])
        body = client.get(f"/v1/shares/{share['token']}").json()
        assert isinstance(body, dict)
        rendered = json.dumps(body)

        assert "OPENAI_API_KEY to remain unset" not in rendered
        assert "sk-anchor-should-not-leak" not in rendered
        assert "***redacted provider secret***" in rendered
