from collections.abc import Generator
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, create_engine
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
    status: Mapped[str] = mapped_column(String(30), default="needs_review")
    findings: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
