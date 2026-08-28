from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlparse

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select

from .config import Settings, get_settings
from .db import SecretRow

PROVIDER_PRESETS = {
    "openai": {"label": "OpenAI", "base_url": "https://api.openai.com/v1", "protocol": "responses"},
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "protocol": "chat_completions",
    },
    "custom": {"label": "Custom compatible API", "base_url": None, "protocol": "chat_completions"},
}


def fernet(settings: Settings | None = None) -> Fernet | None:
    settings = settings or get_settings()
    key = settings.secret_encryption_key
    if not key:
        key_file = settings.secret_encryption_key_file
        try:
            if key_file.exists():
                key = key_file.read_text(encoding="utf-8").strip()
            else:
                key_file.parent.mkdir(parents=True, exist_ok=True)
                key = Fernet.generate_key().decode("ascii")
                key_file.write_text(key, encoding="utf-8")
                key_file.chmod(0o600)
        except OSError:
            return None
    try:
        return Fernet(key.encode("utf-8"))
    except (ValueError, SyntaxError):
        return None


def secret_available(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return fernet(settings) is not None


def store_provider_key(
    db,
    workspace_id: str,
    provider: str,
    plaintext: str,
    *,
    base_url: str | None = None,
    settings: Settings | None = None,
) -> SecretRow:
    settings = settings or get_settings()
    if provider not in PROVIDER_PRESETS:
        raise ValueError("Unknown provider for secret storage")
    value = (plaintext or "").strip()
    if not value:
        raise ValueError("Provider key is empty")
    handle = fernet(settings)
    if handle is None:
        raise ValueError("Secret encryption is not configured")
    existing = db.scalar(
         select(SecretRow).where(
             SecretRow.workspace_id == workspace_id,
             SecretRow.provider == provider,
          )
       )
    preset = PROVIDER_PRESETS[provider]
    resolved_base_url = (base_url or preset["base_url"] or "").strip().rstrip("/")
    if not resolved_base_url:
        raise ValueError("A base URL is required for a custom provider")
    parsed = urlparse(resolved_base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Provider base URL must be a valid HTTP or HTTPS URL")
    if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Remote provider base URLs must use HTTPS")
    configuration = {
        "key": value,
        "label": preset["label"],
        "base_url": resolved_base_url,
        "protocol": preset["protocol"],
        "selected_model": None,
    }
    # A rotated key may belong to a different provider project. Force the user
    # to revalidate the catalog instead of silently retaining a stale model.
    encrypted = handle.encrypt(json.dumps(configuration).encode("utf-8")).decode("ascii")
    if existing is None:
        row = SecretRow(workspace_id=workspace_id, provider=provider, encrypted_value=encrypted)
        db.add(row)
    else:
        existing.encrypted_value = encrypted
        row = existing
    db.commit()
    db.refresh(row)
    return row


def get_provider_key(
    db,
    workspace_id: str,
    provider: str,
    *,
    settings: Settings | None = None,
) -> str | None:
    settings = settings or get_settings()
    configuration = get_provider_config(db, workspace_id, provider, settings=settings)
    return str(configuration["key"]) if configuration and configuration.get("key") else None


def get_provider_config(
    db,
    workspace_id: str,
    provider: str,
    *,
    settings: Settings | None = None,
) -> dict[str, Any] | None:
    settings = settings or get_settings()
    if provider not in PROVIDER_PRESETS:
        return None
    row = db.scalar(
         select(SecretRow).where(
             SecretRow.workspace_id == workspace_id,
             SecretRow.provider == provider,
           )
        )
    if row is None:
        return None
    handle = fernet(settings)
    if handle is None:
        return None
    try:
        decrypted = handle.decrypt(row.encrypted_value.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return None
    try:
        parsed = json.loads(decrypted)
        if isinstance(parsed, dict) and parsed.get("key"):
            return parsed
    except json.JSONDecodeError:
        pass
    preset = PROVIDER_PRESETS[provider]
    return {
        "key": decrypted,
        "label": preset["label"],
        "base_url": preset["base_url"],
        "protocol": preset["protocol"],
        "selected_model": None,
    }


def select_provider_model(
    db,
    workspace_id: str,
    provider: str,
    model: str,
    *,
    settings: Settings | None = None,
) -> SecretRow:
    settings = settings or get_settings()
    row = db.scalar(select(SecretRow).where(SecretRow.workspace_id == workspace_id, SecretRow.provider == provider))
    configuration = get_provider_config(db, workspace_id, provider, settings=settings)
    handle = fernet(settings)
    if row is None or configuration is None or handle is None:
        raise ValueError("Connect this provider before selecting a model")
    configuration["selected_model"] = model.strip()
    row.encrypted_value = handle.encrypt(json.dumps(configuration).encode("utf-8")).decode("ascii")
    db.commit()
    db.refresh(row)
    return row


def has_provider_key(
    db,
    workspace_id: str,
    provider: str,
    *,
    settings: Settings | None = None,
) -> bool:
    return get_provider_key(db, workspace_id, provider, settings=settings) is not None


def delete_provider_key(
    db,
    workspace_id: str,
    provider: str,
    *,
    settings: Settings | None = None,
) -> bool:
    settings = settings or get_settings()
    row = db.scalar(
         select(SecretRow).where(
             SecretRow.workspace_id == workspace_id,
             SecretRow.provider == provider,
         )
      )
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True
