from fastapi.testclient import TestClient
from sqlalchemy import select

from rationexa_api.auth import hash_password, verify_password
from rationexa_api.config import Settings
from rationexa_api.db import AccountRow, SecretRow, SessionLocal, SessionRow, WorkspaceRow
from rationexa_api.main import app
from rationexa_api.providers import OpenAIResponsesProvider, get_provider
from rationexa_api.secrets import fernet


def _login(client: TestClient, client_obj, email: str, password: str) -> str:
    response = client_obj.post("/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response.json()["session_token"]


def test_account_create_login_whoami_and_logout() -> None:
    with TestClient(app) as client:
        created = client.post(
            "/v1/account",
            json={"email": "owner@rationexa.local", "name": "Owner", "password": "s3cret-pass"},
        )
        assert created.status_code == 201
        body = created.json()
        assert body["email"] == "owner@rationexa.local"
        assert body["has_password"] is True

        logged = client.post("/v1/auth/login", json={"email": "owner@rationexa.local", "password": "s3cret-pass"})
        assert logged.status_code == 200
        token = logged.json()["session_token"]

        who = client.get("/v1/account", headers={"Authorization": f"Bearer {token}"})
        assert who.status_code == 200
        assert who.json()["id"] == body["id"]

        without = client.get("/v1/account")
        assert without.status_code == 401

        wrong = client.post("/v1/auth/login", json={"email": "owner@rationexa.local", "password": "nope"})
        assert wrong.status_code == 401

        after_logout = client.post("/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
        assert after_logout.status_code == 204
        assert client.get("/v1/account", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_duplicate_email_is_rejected() -> None:
    with TestClient(app) as client:
        client.post("/v1/account", json={"email": "dup@rationexa.local", "password": "password-one"})
        again = client.post("/v1/account", json={"email": "dup@rationexa.local", "password": "password-two"})
        assert again.status_code == 409


def test_short_password_is_rejected() -> None:
    with TestClient(app) as client:
        response = client.post("/v1/account", json={"email": "short@rationexa.local", "password": "123"})
        assert response.status_code == 422


def test_authenticated_session_uses_the_owning_workspace() -> None:
    with TestClient(app) as client:
        created = client.post(
            "/v1/account",
            json={"email": "alice@rationexa.local", "name": "Alice", "password": "alice-pass"},
        )
        token = _login(client, client, "alice@rationexa.local", "alice-pass")
        account = created.json()

        with SessionLocal() as db:
            workspace = db.scalar(select(WorkspaceRow).where(WorkspaceRow.owner_account_id == account["id"]))
            assert workspace is not None
            assert workspace.id != "00000000-0000-4000-8000-000000000002"

        who = client.get("/v1/workspace", headers={"Authorization": f"Bearer {token}"})
        assert who.status_code == 200
        assert who.json()["account_id"] == account["id"]
        assert who.json()["id"] == workspace.id

        local = client.get("/v1/workspace")
        assert local.json()["id"] == "00000000-0000-4000-8000-000000000002"


def test_records_created_in_one_workspace_do_not_leak_to_another() -> None:
    with TestClient(app) as client:
        client.post("/v1/account", json={"email": "a@rationexa.local", "password": "aaaaa123"})
        client.post("/v1/account", json={"email": "b@rationexa.local", "password": "bbbbb123"})
        token_a = _login(client, client, "a@rationexa.local", "aaaaa123")
        token_b = _login(client, client, "b@rationexa.local", "bbbbb123")

        artifact = client.post(
            "/v1/artifacts",
            headers={"Authorization": f"Bearer {token_a}"},
            json={"filename": "a.txt", "content": "We decided to use Vendor B."},
         ).json()
        extraction = client.post(
            "/v1/decisions/extractions",
            headers={"Authorization": f"Bearer {token_a}"},
            json={"artifact_id": artifact["id"]},
         ).json()

        b_list = client.get("/v1/decisions", headers={"Authorization": f"Bearer {token_b}"})
        assert b_list.status_code == 200
        assert b_list.json()["total"] == 0
        hidden = client.get(
             f"/v1/extractions/{extraction['id']}",
            headers={"Authorization": f"Bearer {token_b}"},
         )
        assert hidden.status_code == 404


def test_byok_secret_is_encrypted_at_rest_and_exposed_only_as_metadata() -> None:
    with TestClient(app) as client:
        account = client.post(
            "/v1/account",
            json={"email": "byok@rationexa.local", "password": "byokpass1"},
        ).json()
        token = _login(client, client, "byok@rationexa.local", "byokpass1")
        with SessionLocal() as db:
            workspace = db.scalar(select(WorkspaceRow).where(WorkspaceRow.owner_account_id == account["id"])).id

        stored = client.post(
            "/v1/secrets",
            headers={"Authorization": f"Bearer {token}"},
            json={"provider": "openai", "key": "sk-live-should-not-appear-plaintext"},
        )
        assert stored.status_code == 201
        assert stored.json()["configured"] is True
        assert "sk-live-should-not-appear-plaintext" not in stored.text

        with SessionLocal() as db:
            row = db.scalar(select(SecretRow).where(SecretRow.workspace_id == workspace))
            assert row is not None
            assert "sk-live-should-not-appear-plaintext" not in row.encrypted_value

        listing = client.get("/v1/secrets", headers={"Authorization": f"Bearer {token}"})
        assert listing.json()[0]["provider"] == "openai"
        assert "sk-live" not in listing.text

        removed = client.delete("/v1/secrets/openai", headers={"Authorization": f"Bearer {token}"})
        assert removed.status_code == 200 and removed.json()["configured"] is False
        with SessionLocal() as db:
            assert db.scalar(select(SecretRow).where(SecretRow.workspace_id == workspace)) is None


def test_byok_stored_key_is_resolved_for_the_openai_provider() -> None:
    settings = Settings(
        ai_provider="openai",
        openai_model="gpt-test",
        openai_api_key=None,
        secret_encryption_key="LVOw0rMnwHO0RjG21UEe89Y8ldVc49I2H0nJX1CPzbk=",
    )
    injected = get_provider(settings, "openai/gpt-test", byok_key="sk-byok-value")
    assert isinstance(injected, OpenAIResponsesProvider)
    assert injected.client.api_key == "sk-byok-value"


def test_local_workspace_generates_a_private_secret_key_file(tmp_path) -> None:
    key_file = tmp_path / "rationexa-secret.key"
    settings = Settings(secret_encryption_key=None, secret_encryption_key_file=key_file)

    first = fernet(settings)
    second = fernet(settings)

    assert first is not None
    assert second is not None
    assert key_file.exists()
    assert key_file.stat().st_mode & 0o777 == 0o600
    encrypted = first.encrypt(b"sk-local-byok")
    assert second.decrypt(encrypted) == b"sk-local-byok"


def test_openrouter_connection_loads_models_and_activates_one(monkeypatch) -> None:
    class ModelResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"data": [{"id": "anthropic/claude-test"}, {"id": "deepseek/deepseek-test"}]}

    monkeypatch.setattr("rationexa_api.main.httpx.get", lambda *args, **kwargs: ModelResponse())

    with TestClient(app) as client:
        connected = client.post("/v1/secrets", json={"provider": "openrouter", "key": "sk-or-test"})
        assert connected.status_code == 201
        assert connected.json()["provider"] == "openrouter"
        assert connected.json()["selected_model"] is None

        catalog = client.get("/v1/secrets/openrouter/models")
        assert catalog.status_code == 200
        assert catalog.json()["models"] == ["anthropic/claude-test", "deepseek/deepseek-test"]

        selected = client.post(
            "/v1/secrets/openrouter/model",
            json={"model": "anthropic/claude-test"},
        )
        assert selected.status_code == 200
        assert selected.json()["selected_model"] == "anthropic/claude-test"

        workspace_models = client.get("/v1/models").json()["models"]
        assert any(model["id"] == "openrouter/anthropic/claude-test" for model in workspace_models)

        removed = client.delete("/v1/secrets/openrouter")
        assert removed.status_code == 200


def test_password_hash_round_trips() -> None:
    hashed, salt, iterations = hash_password("correct-horse", 10_000)
    assert hashed
    assert verify_password("correct-horse", hashed, salt, iterations)
    assert not verify_password("wrong", hashed, salt, iterations)


def test_sessions_table_is_initialised() -> None:
    with TestClient(app):
        with SessionLocal() as db:
            sessions = db.scalar(select(SessionRow).limit(1))
            accounts = db.scalar(select(AccountRow).limit(1))
            assert sessions is not None or accounts is not None
