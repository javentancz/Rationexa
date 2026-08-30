import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from rationexa_api.auth import hash_password, verify_password
from rationexa_api.config import Settings
from rationexa_api.db import AccountRow, SecretRow, SessionLocal, SessionRow, WorkspaceRow
from rationexa_api.main import app, provider_for, settings
from rationexa_api.providers import OpenAIResponsesProvider, get_provider
from rationexa_api.secrets import (
    delete_provider_key,
    fernet,
    select_provider_model,
    store_provider_key,
    validate_provider_base_url,
)


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

        client.cookies.clear()
        without = client.get("/v1/account")
        assert without.status_code == 401

        wrong = client.post("/v1/auth/login", json={"email": "owner@rationexa.local", "password": "nope"})
        assert wrong.status_code == 401

        after_logout = client.post("/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
        assert after_logout.status_code == 204
        assert client.get("/v1/account", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_browser_session_uses_an_httponly_cookie_and_hashed_storage() -> None:
    with TestClient(app) as client:
        registered = client.post(
            "/v1/auth/register",
            json={"email": "cookie@rationexa.local", "name": "Cookie Pilot", "password": "cookie-pass"},
        )
        assert registered.status_code == 201
        raw_token = registered.json()["session_token"]
        cookie = registered.headers["set-cookie"].lower()
        assert "httponly" in cookie
        assert "samesite=lax" in cookie
        assert client.get("/v1/account").status_code == 200

        with SessionLocal() as db:
            account = db.scalar(select(AccountRow).where(AccountRow.email == "cookie@rationexa.local"))
            stored = db.scalar(select(SessionRow).where(SessionRow.account_id == account.id))
            assert stored is not None
            assert stored.token != raw_token
            assert len(stored.token) == 64


def test_hosted_mode_requires_a_private_authenticated_workspace(monkeypatch) -> None:
    from rationexa_api import main

    monkeypatch.setattr(main, "settings", Settings(hosted_mode=True, session_cookie_secure=True))
    with TestClient(app) as client:
        assert client.get("/v1/workspace").status_code == 401
        assert client.get("/v1/bootstrap").status_code == 401


def test_login_rate_limit_is_persistent_and_contextual(monkeypatch) -> None:
    from rationexa_api import main

    monkeypatch.setattr(
        main,
        "settings",
        Settings(auth_rate_limit_attempts=2, auth_rate_limit_window_seconds=90),
    )
    with TestClient(app) as client:
        client.post(
            "/v1/auth/register",
            json={"email": "rate-limit@rationexa.local", "password": "rate-limit-pass"},
        )
        for _ in range(2):
            assert (
                client.post(
                    "/v1/auth/login",
                    json={"email": "rate-limit@rationexa.local", "password": "wrong-password"},
                ).status_code
                == 401
            )
        limited = client.post(
            "/v1/auth/login",
            json={"email": "rate-limit@rationexa.local", "password": "wrong-password"},
        )
        assert limited.status_code == 429
        assert limited.headers["retry-after"] == "90"


def test_register_creates_an_authenticated_private_workspace() -> None:
    with TestClient(app) as client:
        registered = client.post(
            "/v1/auth/register",
            json={"email": "pilot@rationexa.local", "name": "Pilot Reviewer", "password": "pilot-pass-1"},
        )
        assert registered.status_code == 201
        token = registered.json()["session_token"]
        workspace = client.get("/v1/workspace", headers={"Authorization": f"Bearer {token}"})
        assert workspace.status_code == 200
        assert workspace.json()["account_name"] == "Pilot Reviewer"
        assert workspace.json()["mode"] == "authenticated_personal"


def test_invalid_session_never_falls_back_to_the_local_workspace() -> None:
    with TestClient(app) as client:
        response = client.get("/v1/workspace", headers={"Authorization": "Bearer invalid-session"})
        assert response.status_code == 401
        assert "expired" in response.json()["detail"]


def test_profile_and_workspace_names_can_be_updated_only_by_the_owner() -> None:
    with TestClient(app) as client:
        client.post("/v1/account", json={"email": "profile@rationexa.local", "password": "profile-pass"})
        token = _login(client, client, "profile@rationexa.local", "profile-pass")
        headers = {"Authorization": f"Bearer {token}"}

        profile = client.patch("/v1/account", headers=headers, json={"name": "Pilot One"})
        workspace = client.patch("/v1/workspace", headers=headers, json={"name": "Architecture pilot"})

        assert profile.status_code == 200 and profile.json()["name"] == "Pilot One"
        assert workspace.status_code == 200 and workspace.json()["name"] == "Architecture pilot"
        client.cookies.clear()
        assert client.patch("/v1/workspace", json={"name": "Local renamed"}).status_code == 401


def test_active_sessions_can_be_listed_and_other_sessions_revoked() -> None:
    with TestClient(app) as client:
        client.post("/v1/account", json={"email": "sessions@rationexa.local", "password": "session-pass"})
        first = _login(client, client, "sessions@rationexa.local", "session-pass")
        second = _login(client, client, "sessions@rationexa.local", "session-pass")
        first_headers = {"Authorization": f"Bearer {first}"}
        second_headers = {"Authorization": f"Bearer {second}"}

        sessions = client.get("/v1/auth/sessions", headers=first_headers)
        assert sessions.status_code == 200
        assert len(sessions.json()) == 2
        assert sum(1 for entry in sessions.json() if entry["current"]) == 1

        assert client.post("/v1/auth/logout-others", headers=first_headers).status_code == 204
        assert client.get("/v1/account", headers=first_headers).status_code == 200
        assert client.get("/v1/account", headers=second_headers).status_code == 401


def test_password_change_keeps_current_session_and_revokes_others() -> None:
    with TestClient(app) as client:
        client.post("/v1/account", json={"email": "change@rationexa.local", "password": "before-pass"})
        current = _login(client, client, "change@rationexa.local", "before-pass")
        other = _login(client, client, "change@rationexa.local", "before-pass")
        response = client.post(
            "/v1/auth/password",
            headers={"Authorization": f"Bearer {current}"},
            json={"current_password": "before-pass", "new_password": "after-pass"},
        )
        assert response.status_code == 204
        assert client.get("/v1/account", headers={"Authorization": f"Bearer {current}"}).status_code == 200
        assert client.get("/v1/account", headers={"Authorization": f"Bearer {other}"}).status_code == 401
        assert (
            client.post(
                "/v1/auth/login", json={"email": "change@rationexa.local", "password": "before-pass"}
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/v1/auth/login", json={"email": "change@rationexa.local", "password": "after-pass"}
            ).status_code
            == 200
        )


def test_account_deletion_requires_password_and_removes_private_workspace() -> None:
    with TestClient(app) as client:
        registered = client.post(
            "/v1/auth/register",
            json={"email": "delete-me@rationexa.local", "name": "Delete Me", "password": "delete-pass"},
        ).json()
        headers = {"Authorization": f"Bearer {registered['session_token']}"}
        account_id = registered["account_id"]
        with SessionLocal() as db:
            workspace = db.scalar(select(WorkspaceRow).where(WorkspaceRow.owner_account_id == account_id))
            assert workspace is not None
            workspace_id = workspace.id

        assert (
            client.post(
                "/v1/secrets",
                headers=headers,
                json={"provider": "openai", "key": "sk-delete-with-workspace"},
            ).status_code
            == 201
        )
        assert (
            client.request(
                "DELETE",
                "/v1/account",
                headers=headers,
                json={"password": "wrong-password"},
            ).status_code
            == 401
        )
        assert (
            client.request(
                "DELETE",
                "/v1/account",
                headers=headers,
                json={"password": "delete-pass"},
            ).status_code
            == 204
        )
        assert client.get("/v1/account", headers=headers).status_code == 401

        with SessionLocal() as db:
            assert db.get(AccountRow, account_id) is None
            assert db.get(WorkspaceRow, workspace_id) is None
            assert db.scalar(select(SessionRow).where(SessionRow.account_id == account_id)) is None
            assert db.scalar(select(SecretRow).where(SecretRow.workspace_id == workspace_id)) is None
            assert db.get(AccountRow, settings.local_account_id) is not None


def test_password_reset_is_single_use_and_revokes_existing_sessions(monkeypatch) -> None:
    monkeypatch.setattr(settings, "password_reset_dev_mode", True)
    with TestClient(app) as client:
        client.post("/v1/account", json={"email": "reset@rationexa.local", "password": "before-reset"})
        old_token = _login(client, client, "reset@rationexa.local", "before-reset")
        requested = client.post("/v1/auth/password-reset/request", json={"email": "reset@rationexa.local"})
        assert requested.status_code == 200
        reset_token = requested.json()["development_token"]
        assert reset_token

        confirmed = client.post(
            "/v1/auth/password-reset/confirm",
            json={"token": reset_token, "new_password": "after-reset"},
        )
        assert confirmed.status_code == 200
        assert client.get("/v1/account", headers={"Authorization": f"Bearer {old_token}"}).status_code == 401
        assert (
            client.get(
                "/v1/account", headers={"Authorization": f"Bearer {confirmed.json()['session_token']}"}
            ).status_code
            == 200
        )
        assert (
            client.post(
                "/v1/auth/password-reset/confirm",
                json={"token": reset_token, "new_password": "another-pass"},
            ).status_code
            == 400
        )


def test_password_reset_request_does_not_reveal_unknown_accounts() -> None:
    with TestClient(app) as client:
        response = client.post("/v1/auth/password-reset/request", json={"email": "missing@rationexa.local"})
        assert response.status_code == 200
        assert response.json()["accepted"] is True
        assert response.json()["development_token"] is None


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

        client.cookies.clear()
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


def test_durable_jobs_are_scoped_to_the_owning_workspace() -> None:
    with TestClient(app) as client:
        a = client.post(
            "/v1/auth/register",
            json={"email": "job-a@rationexa.local", "password": "job-owner-a"},
        ).json()
        b = client.post(
            "/v1/auth/register",
            json={"email": "job-b@rationexa.local", "password": "job-owner-b"},
        ).json()
        headers_a = {"Authorization": f"Bearer {a['session_token']}"}
        headers_b = {"Authorization": f"Bearer {b['session_token']}"}
        artifact = client.post(
            "/v1/artifacts",
            headers=headers_a,
            json={"filename": "job.txt", "content": "We decided to keep the current contract."},
        ).json()
        created = client.post(
            "/v1/decisions/extractions/jobs",
            headers=headers_a,
            json={"artifact_id": artifact["id"], "model_id": "deterministic/rules-v1"},
        )
        assert created.status_code == 202
        job_id = created.json()["id"]
        assert client.get(f"/v1/jobs/{job_id}", headers=headers_a).status_code == 200
        assert client.get(f"/v1/jobs/{job_id}", headers=headers_b).status_code == 404
        assert client.delete(f"/v1/jobs/{job_id}", headers=headers_b).status_code == 404


def test_share_management_is_scoped_to_the_owning_workspace() -> None:
    with TestClient(app) as client:
        a = client.post(
            "/v1/auth/register",
            json={"email": "share-a@rationexa.local", "password": "share-owner-a"},
        ).json()
        b = client.post(
            "/v1/auth/register",
            json={"email": "share-b@rationexa.local", "password": "share-owner-b"},
        ).json()
        headers_a = {"Authorization": f"Bearer {a['session_token']}"}
        headers_b = {"Authorization": f"Bearer {b['session_token']}"}
        artifact = client.post(
            "/v1/artifacts",
            headers=headers_a,
            json={"filename": "share.txt", "content": "We decided to retain the current service."},
        ).json()
        extraction = client.post(
            "/v1/decisions/extractions",
            headers=headers_a,
            json={"artifact_id": artifact["id"]},
        ).json()
        client.post(
            f"/v1/extractions/{extraction['id']}/review",
            headers=headers_a,
            json={
                "title": "Private share",
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
        decision = client.post(
            f"/v1/extractions/{extraction['id']}/finalize",
            headers=headers_a,
            json={"criticality": "important"},
        ).json()
        share = client.post(f"/v1/decisions/{decision['id']}/shares", headers=headers_a, json={}).json()

        revoke_path = f"/v1/decisions/{decision['id']}/shares/{share['id']}"
        assert client.delete(revoke_path, headers=headers_b).status_code == 404
        assert client.delete(revoke_path + "/record", headers=headers_b).status_code == 404
        assert client.get(f"/v1/shares/{share['token']}").status_code == 200


def test_identical_artifacts_are_isolated_between_workspaces() -> None:
    with TestClient(app) as client:
        client.post("/v1/account", json={"email": "same-a@rationexa.local", "password": "aaaaa123"})
        client.post("/v1/account", json={"email": "same-b@rationexa.local", "password": "bbbbb123"})
        token_a = _login(client, client, "same-a@rationexa.local", "aaaaa123")
        token_b = _login(client, client, "same-b@rationexa.local", "bbbbb123")
        payload = {"filename": "same.txt", "content": "The same source belongs to two reviewers."}

        artifact_a = client.post(
            "/v1/artifacts",
            headers={"Authorization": f"Bearer {token_a}"},
            json=payload,
        )
        artifact_b = client.post(
            "/v1/artifacts",
            headers={"Authorization": f"Bearer {token_b}"},
            json=payload,
        )

        assert artifact_a.status_code == 201
        assert artifact_b.status_code == 201
        assert artifact_a.json()["id"] != artifact_b.json()["id"]


def test_byok_connections_and_models_do_not_leak_between_workspaces(monkeypatch) -> None:
    class ModelResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"data": [{"id": "provider/private-model"}]}

    monkeypatch.setattr("rationexa_api.main.httpx.get", lambda *args, **kwargs: ModelResponse())
    with TestClient(app) as client:
        client.post("/v1/account", json={"email": "key-a@rationexa.local", "password": "aaaaa123"})
        client.post("/v1/account", json={"email": "key-b@rationexa.local", "password": "bbbbb123"})
        token_a = _login(client, client, "key-a@rationexa.local", "aaaaa123")
        token_b = _login(client, client, "key-b@rationexa.local", "bbbbb123")
        headers_a = {"Authorization": f"Bearer {token_a}"}
        headers_b = {"Authorization": f"Bearer {token_b}"}

        assert (
            client.post(
                "/v1/secrets",
                headers=headers_a,
                json={"provider": "openrouter", "key": "workspace-a-key"},
            ).status_code
            == 201
        )
        assert (
            client.post(
                "/v1/secrets/openrouter/model",
                headers=headers_a,
                json={"model": "provider/private-model"},
            ).status_code
            == 200
        )

        assert client.get("/v1/secrets", headers=headers_b).json() == []
        assert not any(
            model["id"] == "openrouter/provider/private-model"
            for model in client.get("/v1/models", headers=headers_b).json()["models"]
        )


def test_anonymous_workspace_cannot_access_or_publish_byok_credentials() -> None:
    with TestClient(app) as client:
        assert client.get("/v1/secrets").status_code == 401
        assert (
            client.post(
                "/v1/secrets",
                json={"provider": "openai", "key": "sk-must-stay-private"},
            ).status_code
            == 401
        )
        assert client.get("/v1/secrets/openai/models").status_code == 401
        assert client.post("/v1/secrets/openai/test").status_code == 401
        assert client.post("/v1/secrets/openai/model", json={"model": "gpt-private"}).status_code == 401
        assert client.delete("/v1/secrets/openai").status_code == 401

        with SessionLocal() as db:
            store_provider_key(db, settings.local_workspace_id, "openai", "sk-legacy-local")
            select_provider_model(db, settings.local_workspace_id, "openai", "gpt-legacy-local")
        try:
            catalog = client.get("/v1/models").json()["models"]
            assert not any(model["id"] == "openai/gpt-legacy-local" for model in catalog)
            with SessionLocal() as db:
                try:
                    provider_for(db, settings.local_workspace_id, "openai/gpt-legacy-local")
                except ValueError as exc:
                    assert "private workspace" in str(exc)
                else:
                    raise AssertionError("Anonymous local workspace resolved a hosted BYOK model")
        finally:
            with SessionLocal() as db:
                delete_provider_key(db, settings.local_workspace_id, "openai")


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
        session = client.post(
            "/v1/auth/register",
            json={"email": "openrouter@rationexa.local", "name": "OpenRouter Pilot", "password": "openrouter-pass"},
        ).json()
        headers = {"Authorization": f"Bearer {session['session_token']}"}
        connected = client.post("/v1/secrets", headers=headers, json={"provider": "openrouter", "key": "sk-or-test"})
        assert connected.status_code == 201
        assert connected.json()["provider"] == "openrouter"
        assert connected.json()["selected_model"] is None

        catalog = client.get("/v1/secrets/openrouter/models", headers=headers)
        assert catalog.status_code == 200
        assert catalog.json()["models"] == ["anthropic/claude-test", "deepseek/deepseek-test"]

        tested = client.post("/v1/secrets/openrouter/test", headers=headers)
        assert tested.status_code == 200
        assert tested.json()["ok"] is True
        assert tested.json()["model_count"] == 2

        selected = client.post(
            "/v1/secrets/openrouter/model",
            headers=headers,
            json={"model": "anthropic/claude-test"},
        )
        assert selected.status_code == 200
        assert selected.json()["selected_model"] == "anthropic/claude-test"

        workspace_models = client.get("/v1/models", headers=headers).json()["models"]
        assert any(model["id"] == "openrouter/anthropic/claude-test" for model in workspace_models)

        rotated = client.post("/v1/secrets", headers=headers, json={"provider": "openrouter", "key": "sk-or-rotated"})
        assert rotated.status_code == 201
        assert rotated.json()["selected_model"] is None
        assert not any(
            model["id"] == "openrouter/anthropic/claude-test"
            for model in client.get("/v1/models", headers=headers).json()["models"]
        )

        removed = client.delete("/v1/secrets/openrouter", headers=headers)
        assert removed.status_code == 200


def test_provider_connection_failure_is_contextual(monkeypatch) -> None:
    def unavailable(*args, **kwargs):
        raise httpx.ConnectError("provider is offline")

    monkeypatch.setattr("rationexa_api.main.httpx.get", unavailable)
    with TestClient(app) as client:
        session = client.post(
            "/v1/auth/register",
            json={"email": "offline-provider@rationexa.local", "name": "Offline Provider", "password": "offline-pass"},
        ).json()
        headers = {"Authorization": f"Bearer {session['session_token']}"}
        assert (
            client.post(
                "/v1/secrets",
                headers=headers,
                json={"provider": "openrouter", "key": "sk-or-offline"},
            ).status_code
            == 201
        )
        tested = client.post("/v1/secrets/openrouter/test", headers=headers)
        assert tested.status_code == 422
        assert "Could not load models from this provider" in tested.json()["detail"]


def test_model_catalog_marks_missing_ollama_models_unavailable(monkeypatch) -> None:
    from rationexa_api import main

    class TagsResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"models": [{"model": "qwen3.5:9b"}]}

    runtime = Settings(
        ai_provider="ollama",
        ollama_model="qwen3.5:9b",
        ollama_models="qwen3.5:9b,missing:latest",
    )
    monkeypatch.setattr(main, "settings", runtime)
    monkeypatch.setattr(main.httpx, "get", lambda *args, **kwargs: TagsResponse())

    with TestClient(app) as client:
        catalog = client.get("/v1/models").json()

    by_id = {model["id"]: model for model in catalog["models"]}
    assert by_id["ollama/qwen3.5:9b"]["available"] is True
    assert by_id["ollama/missing:latest"]["available"] is False
    assert "ollama pull missing:latest" in by_id["ollama/missing:latest"]["availability_reason"]


def test_ollama_discovery_is_cached(monkeypatch) -> None:
    from rationexa_api import main

    class TagsResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"models": [{"model": "qwen3.5:9b"}]}

    calls = 0

    def tags(*args, **kwargs):
        nonlocal calls
        calls += 1
        return TagsResponse()

    runtime = Settings(
        ai_provider="ollama",
        ollama_model="qwen3.5:9b",
        ollama_models="qwen3.5:9b",
        ollama_status_cache_seconds=30,
    )
    monkeypatch.setattr(main, "settings", runtime)
    monkeypatch.setattr(main.httpx, "get", tags)
    main._ollama_status_cache.clear()

    with TestClient(app) as client:
        assert client.get("/v1/models").status_code == 200
        assert client.get("/v1/models").status_code == 200

    assert calls == 1


def test_provider_catalog_cache_uses_a_key_fingerprint(monkeypatch) -> None:
    from rationexa_api import main

    calls = 0

    def provider_models(provider: str, configuration: dict) -> list[str]:
        nonlocal calls
        assert provider == "custom"
        calls += 1
        return ["provider/model"]

    runtime = Settings(provider_model_cache_seconds=30)
    monkeypatch.setattr(main, "settings", runtime)
    monkeypatch.setattr(main, "_fetch_provider_model_ids", provider_models)
    main._provider_model_cache.clear()
    configuration = {"base_url": "https://models.example.test", "key": "private-provider-key"}

    assert main._cached_provider_model_ids("custom", configuration) == ["provider/model"]
    assert main._cached_provider_model_ids("custom", configuration) == ["provider/model"]
    assert calls == 1
    assert all("private-provider-key" not in cache_key for cache_key in main._provider_model_cache)

    assert main._cached_provider_model_ids("custom", configuration, force=True) == ["provider/model"]
    assert calls == 2


def test_custom_provider_urls_are_restricted_in_hosted_mode(monkeypatch) -> None:
    monkeypatch.setattr(
        "rationexa_api.secrets.socket.getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )
    hosted = Settings(hosted_mode=True, custom_provider_allowed_hosts="models.example.com")
    assert (
        validate_provider_base_url(
            "https://models.example.com/v1",
            provider="custom",
            settings=hosted,
        )
        == "https://models.example.com/v1"
    )
    try:
        validate_provider_base_url(
            "https://unapproved.example.com/v1",
            provider="custom",
            settings=hosted,
        )
    except ValueError as exc:
        assert "not allowed" in str(exc)
    else:
        raise AssertionError("An unapproved custom provider host was accepted")


def test_custom_provider_rejects_private_network_targets(monkeypatch) -> None:
    monkeypatch.setattr(
        "rationexa_api.secrets.socket.getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("10.0.0.12", 443))],
    )
    hosted = Settings(hosted_mode=True, custom_provider_allowed_hosts="models.example.com")
    try:
        validate_provider_base_url(
            "https://models.example.com/v1",
            provider="custom",
            settings=hosted,
        )
    except ValueError as exc:
        assert "private or non-public" in str(exc)
    else:
        raise AssertionError("A private network provider target was accepted")


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
