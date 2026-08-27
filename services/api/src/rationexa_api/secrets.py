from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select

from .config import Settings, get_settings
from .db import SecretRow

_PROVIDER_KEY_FIELD = {"openai": "openai_api_key"}


def fernet(settings: Settings | None = None) -> Fernet | None:
    settings = settings or get_settings()
    key = settings.secret_encryption_key
    if not key:
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
    settings: Settings | None = None,
) -> SecretRow:
    settings = settings or get_settings()
    if provider not in _PROVIDER_KEY_FIELD:
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
    encrypted = handle.encrypt(value.encode("utf-8")).decode("ascii")
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
    if provider not in _PROVIDER_KEY_FIELD:
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
        return handle.decrypt(row.encrypted_value.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return None


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
