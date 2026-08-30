import hashlib
import hmac
from binascii import hexlify
from datetime import UTC, timedelta
from secrets import token_hex

from sqlalchemy import select

from .config import get_settings
from .db import AccountRow, SessionLocal, SessionRow, new_share_token, now_utc

settings = get_settings()

PASSWORD_LENGTH_MIN = 8
PASSWORD_LENGTH_MAX = 128


def hash_password(password: str, iterations: int = settings.pbkdf2_iterations) -> tuple[str, str, int]:
    salt = token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        iterations,
    )
    return hexlify(digest).decode("ascii"), salt, iterations


def verify_password(
    password: str,
    stored_hash: str,
    salt: str,
    iterations: int,
) -> bool:
    checked = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        iterations,
    )
    return hmac.compare_digest(hexlify(checked).decode("ascii"), stored_hash)


def find_account_by_email(email: str, db) -> AccountRow | None:
    normalized = email.strip().lower()
    return db.scalar(select(AccountRow).where(AccountRow.email == normalized))


def session_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_session(db, account_id: str, ttl_hours: int | None = None) -> tuple[SessionRow, str]:
    lifetime = ttl_hours if ttl_hours is not None else settings.auth_session_ttl_hours
    token = new_share_token()
    session = SessionRow(
        account_id=account_id,
        token=session_token_hash(token),
        expires_at=now_utc() + timedelta(hours=lifetime),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session, token


def resolve_session(token: str | None, db=None) -> AccountRow | None:
    if not token:
        return None
    session_db = None
    owns_session = False
    try:
        if db is None:
            session_db = SessionLocal()
            owns_session = True
            db = session_db
        digest = session_token_hash(token)
        row = db.scalar(select(SessionRow).where(SessionRow.token == digest))
        if row is None:
            # Transparently migrate sessions issued before tokens were hashed.
            row = db.scalar(select(SessionRow).where(SessionRow.token == token))
            if row is not None:
                row.token = digest
                db.commit()
        if row is None or row.revoked_at is not None:
            return None
        if row.expires_at.tzinfo is None:
            row.expires_at = row.expires_at.replace(tzinfo=UTC)
        if row.expires_at < now_utc():
            return None
        return db.get(AccountRow, row.account_id)
    finally:
        if owns_session:
            session_db.close()


def revoke_session(token: str, db=None) -> bool:
    session_db = None
    owns_session = False
    try:
        if db is None:
            session_db = SessionLocal()
            owns_session = True
            db = session_db
        digest = session_token_hash(token)
        row = db.scalar(select(SessionRow).where(SessionRow.token.in_([digest, token])))
        if row is None or row.revoked_at is not None:
            return False
        row.revoked_at = now_utc()
        db.commit()
        return True
    finally:
        if owns_session:
            session_db.close()
