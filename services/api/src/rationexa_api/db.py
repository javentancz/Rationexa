from collections.abc import Generator
from datetime import UTC, datetime
from secrets import token_urlsafe
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    inspect,
    select,
    text,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    sessionmaker,
)

from .config import get_settings
from .database_migrations import run_alembic


def new_id() -> str:
    return str(uuid4())


def new_share_token() -> str:
    return token_urlsafe(24)


def now_utc() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class SchemaMigrationRow(Base):
    __tablename__ = "schema_migrations"

    version: Mapped[str] = mapped_column(String(80), primary_key=True)
    description: Mapped[str] = mapped_column(String(255))
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class AccountRow(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("email", name="uq_accounts_email"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_salt: Mapped[str | None] = mapped_column(String(64), nullable=True)
    password_iterations: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class SessionRow(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, default=new_share_token)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuthAttemptRow(Base):
    __tablename__ = "auth_attempts"
    __table_args__ = (
        Index("ix_auth_attempts_created_at", "created_at"),
        Index("ix_auth_attempts_fingerprint_created", "fingerprint", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class PasswordResetRow(Base):
    __tablename__ = "password_reset_tokens"
    __table_args__ = (
        Index("ix_password_reset_tokens_token_hash", "token_hash"),
        UniqueConstraint("token_hash", name="password_reset_tokens_token_hash_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SecretRow(Base):
    __tablename__ = "workspace_secrets"
    __table_args__ = (
        Index("ix_workspace_secrets_workspace_provider", "workspace_id", "provider"),
        UniqueConstraint("workspace_id", "provider", name="uq_workspace_secrets_workspace_provider"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    provider: Mapped[str] = mapped_column(String(80))
    encrypted_value: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class WorkspaceRow(Base):
    __tablename__ = "workspaces"
    __table_args__ = (UniqueConstraint("owner_account_id", name="uq_workspaces_owner_account_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ProductEventRow(Base):
    __tablename__ = "product_events"
    __table_args__ = (Index("ix_product_events_workspace_created", "workspace_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    decision_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class JobRow(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_workspace_created", "workspace_id", "created_at"),
        Index("ix_jobs_workspace_status", "workspace_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    phase: Mapped[str] = mapped_column(String(120), default="Queued")
    progress: Mapped[int] = mapped_column(default=0)
    cancel_requested: Mapped[bool] = mapped_column(default=False)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class ArtifactRow(Base):
    __tablename__ = "artifacts"
    __table_args__ = (UniqueConstraint("workspace_id", "sha256", name="uq_artifacts_workspace_sha256"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    media_type: Mapped[str] = mapped_column(String(120))
    source_type: Mapped[str] = mapped_column(String(80), default="user_supplied")
    sha256: Mapped[str] = mapped_column(String(64))
    storage_uri: Mapped[str] = mapped_column(String(500))
    binary_content: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    extracted_text: Mapped[str] = mapped_column(Text)
    parser_version: Mapped[str] = mapped_column(String(40), default="text-v1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ExtractionRow(Base):
    __tablename__ = "extractions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"))
    status: Mapped[str] = mapped_column(String(40), default="candidate")
    provider: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    prompt_version: Mapped[str] = mapped_column(String(40), default="extract-v1")
    latency_ms: Mapped[int | None] = mapped_column(nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(nullable=True)
    estimated_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    output: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class DecisionRow(Base):
    __tablename__ = "decisions"
    __table_args__ = (Index("ix_decisions_workspace_created", "workspace_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    extraction_id: Mapped[str] = mapped_column(ForeignKey("extractions.id"), unique=True)
    title: Mapped[str] = mapped_column(String(255))
    question: Mapped[str] = mapped_column(Text)
    context: Mapped[str] = mapped_column(Text, default="")
    chosen_option: Mapped[str | None] = mapped_column(Text, nullable=True)
    rationale: Mapped[str] = mapped_column(Text, default="")
    criticality: Mapped[str] = mapped_column(String(20), default="important")
    preservation_policy: Mapped[str] = mapped_column(String(30), default="key_excerpts")
    status: Mapped[str] = mapped_column(String(30), default="decision_ready")
    challenge: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    premises: Mapped[list[PremiseRow]] = relationship(cascade="all, delete-orphan")


class PremiseRow(Base):
    __tablename__ = "premises"
    __table_args__ = (Index("ix_premises_decision_id", "decision_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    decision_id: Mapped[str] = mapped_column(ForeignKey("decisions.id"))
    kind: Mapped[str] = mapped_column(String(40))
    statement: Mapped[str] = mapped_column(Text)
    qualifiers: Mapped[str] = mapped_column(Text, default="")
    importance: Mapped[str] = mapped_column(String(20), default="normal")
    quality_state: Mapped[str] = mapped_column(String(20), default="confirmed")
    claim_status: Mapped[str] = mapped_column(String(20), default="not_applicable")
    anchor: Mapped[SourceAnchorRow | None] = relationship(cascade="all, delete-orphan")


class SourceAnchorRow(Base):
    __tablename__ = "source_anchors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    premise_id: Mapped[str] = mapped_column(ForeignKey("premises.id"), unique=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"))
    exact_excerpt: Mapped[str] = mapped_column(Text)
    start_offset: Mapped[int] = mapped_column()
    end_offset: Mapped[int] = mapped_column()
    page_number: Mapped[int | None] = mapped_column(nullable=True)
    anchor_status: Mapped[str] = mapped_column(String(20), default="confirmed")


class RevisitRow(Base):
    __tablename__ = "revisit_checks"
    __table_args__ = (Index("ix_revisit_checks_decision_created", "decision_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    decision_id: Mapped[str] = mapped_column(ForeignKey("decisions.id"))
    evidence_artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"))
    evidence_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="needs_review")
    findings: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    provider: Mapped[str | None] = mapped_column(String(80), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(nullable=True)
    estimated_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class DecisionShareRow(Base):
    __tablename__ = "decision_shares"
    __table_args__ = (Index("ix_decision_shares_decision_id", "decision_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    decision_id: Mapped[str] = mapped_column(ForeignKey("decisions.id"))
    token: Mapped[str] = mapped_column(String(64), unique=True, default=new_share_token)
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    existing_tables = set(inspect(engine).get_table_names())
    has_legacy_schema = "accounts" in existing_tables and "alembic_version" not in existing_tables
    if has_legacy_schema:
        # Bring pre-Alembic Stage 1/2 databases to the baseline shape, then
        # stamp them. New databases and all future upgrades use Alembic only.
        Base.metadata.create_all(bind=engine)
        _run_schema_migrations(only={"20260825_01_account_credentials"})
        _ensure_local_workspace()
        _run_schema_migrations()
        run_alembic(engine, "stamp")
    else:
        run_alembic(engine)
    _ensure_local_workspace()


def _run_schema_migrations(*, only: set[str] | None = None) -> None:
    migrations = (
        (
            "20260825_01_account_credentials",
            "Add account login credential fields",
            _add_missing_account_credential_columns,
        ),
        ("20260825_02_workspace_scope", "Assign persisted records to a workspace", _add_missing_workspace_columns),
        (
            "20260825_03_extraction_provenance",
            "Add extraction usage provenance",
            _add_missing_extraction_provenance_columns,
        ),
        ("20260825_04_revisit_provenance", "Add revisit usage provenance", _add_missing_revisit_provenance_columns),
        (
            "20260827_05_decision_challenge",
            "Add persisted decision challenge briefs",
            _add_missing_decision_challenge_column,
        ),
    )
    with SessionLocal() as db:
        applied = set(db.scalars(select(SchemaMigrationRow.version)).all())
    for version, description, migration in migrations:
        if version in applied or (only is not None and version not in only):
            continue
        migration()
        with SessionLocal() as db:
            if db.get(SchemaMigrationRow, version) is None:
                db.add(SchemaMigrationRow(version=version, description=description))
                db.commit()


def _ensure_local_workspace() -> None:
    with SessionLocal() as db:
        account = db.get(AccountRow, settings.local_account_id)
        if account is None:
            db.add(AccountRow(id=settings.local_account_id, name=settings.local_account_name))
        elif account.name != settings.local_account_name:
            account.name = settings.local_account_name
            _seed_local_account_credentials(account)
        if db.get(WorkspaceRow, settings.local_workspace_id) is None:
            db.add(
                WorkspaceRow(
                    id=settings.local_workspace_id,
                    owner_account_id=settings.local_account_id,
                    name=settings.local_workspace_name,
                )
            )
        db.commit()


def _seed_local_account_credentials(account: AccountRow) -> None:
    """Give the bootstrap local account a log-in credential so it owns a real session path."""
    if account.password_hash is not None:
        return
    if account.email is None:
        account.email = settings.local_account_email
    if settings.local_account_password:
        from .auth import hash_password

        account.password_hash, account.password_salt, account.password_iterations = hash_password(
            settings.local_account_password,
            settings.pbkdf2_iterations,
        )


def _add_missing_account_credential_columns() -> None:
    """Add the Stage 2 login credential fields to databases created before this milestone."""
    existing = {column["name"] for column in inspect(engine).get_columns("accounts")}
    column_definitions = {
        "email": "VARCHAR(255)",
        "password_hash": "VARCHAR(255)",
        "password_salt": "VARCHAR(64)",
        "password_iterations": "INTEGER",
    }
    with engine.begin() as connection:
        for name, sql_type in column_definitions.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE accounts ADD COLUMN {name} {sql_type}"))


def _add_missing_workspace_columns() -> None:
    """Assign existing local records to the personal workspace during the Stage 2 migration."""
    for table_name in ("artifacts", "extractions", "decisions"):
        existing = {column["name"] for column in inspect(engine).get_columns(table_name)}
        with engine.begin() as connection:
            if "workspace_id" not in existing:
                connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN workspace_id VARCHAR(36)"))
            connection.execute(
                text(f"UPDATE {table_name} SET workspace_id = :workspace_id WHERE workspace_id IS NULL"),
                {"workspace_id": settings.local_workspace_id},
            )


def _add_missing_extraction_provenance_columns() -> None:
    """Preserve usage provenance for extraction runs created after the Stage 2 upgrade."""
    existing = {column["name"] for column in inspect(engine).get_columns("extractions")}
    column_definitions = {
        "latency_ms": "INTEGER",
        "input_tokens": "INTEGER",
        "output_tokens": "INTEGER",
        "estimated_cost_usd": "FLOAT",
    }
    with engine.begin() as connection:
        for name, sql_type in column_definitions.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE extractions ADD COLUMN {name} {sql_type}"))


def _add_missing_revisit_provenance_columns() -> None:
    """Keep existing Stage 1 databases readable until formal migrations are introduced."""
    existing = {column["name"] for column in inspect(engine).get_columns("revisit_checks")}
    column_definitions = {
        "evidence_filename": "VARCHAR(255)",
        "provider": "VARCHAR(80)",
        "model": "VARCHAR(120)",
        "prompt_version": "VARCHAR(40)",
        "latency_ms": "INTEGER",
        "input_tokens": "INTEGER",
        "output_tokens": "INTEGER",
        "estimated_cost_usd": "FLOAT",
    }
    with engine.begin() as connection:
        for name, sql_type in column_definitions.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE revisit_checks ADD COLUMN {name} {sql_type}"))


def _add_missing_decision_challenge_column() -> None:
    """Add the Stage 2 challenge brief to databases created before this milestone."""
    existing = {column["name"] for column in inspect(engine).get_columns("decisions")}
    if "challenge" not in existing:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE decisions ADD COLUMN challenge JSON"))


def get_db() -> Generator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
