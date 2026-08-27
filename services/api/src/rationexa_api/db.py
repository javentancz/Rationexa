from collections.abc import Generator
from datetime import UTC, datetime
from secrets import token_urlsafe
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, String, Text, create_engine, inspect, text
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    sessionmaker,
)

from .config import get_settings


def new_id() -> str:
    return str(uuid4())


def new_share_token() -> str:
    return token_urlsafe(24)


def now_utc() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class ArtifactRow(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    filename: Mapped[str] = mapped_column(String(255))
    media_type: Mapped[str] = mapped_column(String(120))
    source_type: Mapped[str] = mapped_column(String(80), default="user_supplied")
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    storage_uri: Mapped[str] = mapped_column(String(500))
    extracted_text: Mapped[str] = mapped_column(Text)
    parser_version: Mapped[str] = mapped_column(String(40), default="text-v1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ExtractionRow(Base):
    __tablename__ = "extractions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"))
    status: Mapped[str] = mapped_column(String(40), default="candidate")
    provider: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    prompt_version: Mapped[str] = mapped_column(String(40), default="extract-v1")
    output: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class DecisionRow(Base):
    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
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
    Base.metadata.create_all(bind=engine)
    _add_missing_revisit_provenance_columns()
    _add_missing_decision_challenge_column()


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
