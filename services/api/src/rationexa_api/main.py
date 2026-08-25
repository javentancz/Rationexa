from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import (
    ArtifactRow,
    DecisionRow,
    ExtractionRow,
    PremiseRow,
    RevisitRow,
    SourceAnchorRow,
    get_db,
    init_db,
)
from .prompts import EXTRACTION_PROMPT_VERSION
from .providers import get_provider
from .schemas import (
    ArtifactCreate,
    ArtifactRead,
    DecisionFinalizeRequest,
    DecisionPremiseRead,
    DecisionRead,
    ExtractionRead,
    ExtractionRequest,
    ExtractionResult,
    ExtractionReviewRequest,
    HealthRead,
    RevisitRead,
    RevisitRequest,
    SourceAnchor,
)
from .services import compare_premise, extract_artifact_text, persist_artifact, validate_anchor

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.artifact_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Db = Annotated[Session, Depends(get_db)]


@app.get("/healthz", response_model=HealthRead)
def health() -> HealthRead:
    return HealthRead(status="ok", service=settings.app_name)


def save_artifact(db: Session, filename: str, media_type: str, content: bytes, source_type: str) -> ArtifactRow:
    try:
        text, parser_version = extract_artifact_text(content, media_type)
        digest, storage_uri = persist_artifact(content, settings.artifact_dir, filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    existing = db.scalar(select(ArtifactRow).where(ArtifactRow.sha256 == digest))
    if existing:
        return existing
    row = ArtifactRow(
        filename=filename,
        media_type=media_type,
        source_type=source_type,
        sha256=digest,
        storage_uri=storage_uri,
        extracted_text=text,
        parser_version=parser_version,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.post("/v1/artifacts", response_model=ArtifactRead, status_code=status.HTTP_201_CREATED)
def create_artifact(payload: ArtifactCreate, db: Db) -> ArtifactRow:
    return save_artifact(db, payload.filename, payload.media_type, payload.content.encode(), payload.source_type)


@app.post("/v1/artifacts/upload", response_model=ArtifactRead, status_code=status.HTTP_201_CREATED)
async def upload_artifact(file: UploadFile, db: Db) -> ArtifactRow:
    content = await file.read()
    if len(content) > 10_000_000:
        raise HTTPException(status_code=413, detail="Artifact exceeds the 10 MB Stage 1 limit")
    return save_artifact(
        db,
        file.filename or "artifact",
        file.content_type or "application/octet-stream",
        content,
        "user_supplied",
    )


@app.post("/v1/decisions/extractions", response_model=ExtractionRead, status_code=status.HTTP_201_CREATED)
def create_extraction(payload: ExtractionRequest, db: Db) -> ExtractionRead:
    artifact = db.get(ArtifactRow, payload.artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    provider = get_provider(settings)
    try:
        result = provider.extract(artifact.extracted_text, artifact.filename)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    validated = []
    for premise in result.premises:
        premise.anchor = validate_anchor(premise.anchor, artifact.extracted_text)
        validated.append(premise)
    result.premises = validated
    row = ExtractionRow(
        artifact_id=artifact.id,
        provider=provider.name,
        model=provider.model,
        prompt_version=EXTRACTION_PROMPT_VERSION,
        output=result.model_dump(mode="json"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return extraction_read(row)


@app.get("/v1/extractions/{extraction_id}", response_model=ExtractionRead)
def get_extraction(extraction_id: str, db: Db) -> ExtractionRead:
    row = db.get(ExtractionRow, extraction_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Extraction not found")
    return extraction_read(row)


@app.post("/v1/extractions/{extraction_id}/review", response_model=ExtractionRead)
def review_extraction(extraction_id: str, payload: ExtractionReviewRequest, db: Db) -> ExtractionRead:
    row = db.get(ExtractionRow, extraction_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Extraction not found")
    result = ExtractionResult.model_validate(row.output)
    if payload.title is not None:
        result.title = payload.title
    if payload.decision_question is not None:
        result.decision_question = payload.decision_question
    if payload.context is not None:
        result.context = payload.context
    if payload.chosen_option is not None:
        result.chosen_option = payload.chosen_option or None
    if payload.rationale is not None:
        result.rationale = payload.rationale
    reviews = {review.candidate_id: review for review in payload.reviews}
    reviewed = []
    for premise in result.premises:
        review = reviews.get(premise.candidate_id)
        if review is None:
            reviewed.append(premise)
            continue
        if review.action == "reject":
            continue
        if review.statement is not None:
            premise.statement = review.statement or premise.statement
        if review.kind is not None:
            premise.kind = review.kind or premise.kind
        if review.action == "unknown":
            premise.quality_state = "draft"
        else:
            premise.quality_state = "confirmed"
        reviewed.append(premise)
    result.premises = reviewed
    row.output = result.model_dump(mode="json")
    row.status = "reviewed"
    db.commit()
    db.refresh(row)
    return extraction_read(row)


@app.post(
    "/v1/extractions/{extraction_id}/finalize",
    response_model=DecisionRead,
    status_code=status.HTTP_201_CREATED,
)
def finalize_decision(extraction_id: str, payload: DecisionFinalizeRequest, db: Db) -> DecisionRead:
    extraction = db.get(ExtractionRow, extraction_id)
    if extraction is None:
        raise HTTPException(status_code=404, detail="Extraction not found")
    existing = db.scalar(select(DecisionRow).where(DecisionRow.extraction_id == extraction_id))
    if existing:
        return decision_read(existing)
    result = ExtractionResult.model_validate(extraction.output)
    policy = {"routine": "compact", "important": "key_excerpts", "critical": "strict"}[payload.criticality.value]
    decision = DecisionRow(
        extraction_id=extraction.id,
        title=result.title,
        question=result.decision_question,
        context=result.context,
        chosen_option=result.chosen_option,
        rationale=result.rationale,
        criticality=payload.criticality.value,
        preservation_policy=policy,
    )
    db.add(decision)
    db.flush()
    for item in result.premises:
        if item.quality_state != "confirmed":
            continue
        premise = PremiseRow(
            decision_id=decision.id,
            kind=item.kind.value,
            statement=item.statement,
            qualifiers=item.qualifiers,
            importance=item.importance,
            quality_state=item.quality_state,
            claim_status=item.claim_status,
        )
        db.add(premise)
        db.flush()
        if item.anchor:
            db.add(
                SourceAnchorRow(
                    premise_id=premise.id,
                    artifact_id=extraction.artifact_id,
                    exact_excerpt=item.anchor.exact_excerpt,
                    start_offset=item.anchor.start_offset,
                    end_offset=item.anchor.end_offset,
                    page_number=item.anchor.page_number,
                )
            )
    extraction.status = "finalized"
    db.commit()
    db.refresh(decision)
    return decision_read(decision)


@app.get("/v1/decisions/{decision_id}", response_model=DecisionRead)
def get_decision(decision_id: str, db: Db) -> DecisionRead:
    decision = db.get(DecisionRow, decision_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    return decision_read(decision)


@app.post(
    "/v1/decisions/{decision_id}/revisit-checks",
    response_model=RevisitRead,
    status_code=status.HTTP_201_CREATED,
)
def create_revisit(decision_id: str, payload: RevisitRequest, db: Db) -> RevisitRead:
    decision = db.get(DecisionRow, decision_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    evidence = save_artifact(db, payload.filename, payload.media_type, payload.content.encode(), "new_evidence")
    findings = []
    for premise in decision.premises:
        finding = compare_premise(
            premise.id,
            premise.statement,
            premise.anchor.exact_excerpt if premise.anchor else None,
            evidence.extracted_text,
            decision.criticality,
        )
        if finding:
            findings.append(finding)
    row = RevisitRow(
        decision_id=decision.id,
        evidence_artifact_id=evidence.id,
        findings=[finding.model_dump(mode="json") for finding in findings],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return revisit_read(row)


def extraction_read(row: ExtractionRow) -> ExtractionRead:
    return ExtractionRead(
        id=row.id,
        artifact_id=row.artifact_id,
        status=row.status,
        provider=row.provider,
        model=row.model,
        prompt_version=row.prompt_version,
        result=ExtractionResult.model_validate(row.output),
        created_at=row.created_at,
    )


def decision_read(row: DecisionRow) -> DecisionRead:
    premises = []
    for premise in row.premises:
        anchor = None
        if premise.anchor:
            anchor = SourceAnchor(
                exact_excerpt=premise.anchor.exact_excerpt,
                start_offset=premise.anchor.start_offset,
                end_offset=premise.anchor.end_offset,
                page_number=premise.anchor.page_number,
            )
        premises.append(
            DecisionPremiseRead(
                id=premise.id,
                kind=premise.kind,
                statement=premise.statement,
                qualifiers=premise.qualifiers,
                importance=premise.importance,
                quality_state=premise.quality_state,
                claim_status=premise.claim_status,
                anchor=anchor,
            )
        )
    return DecisionRead(
        id=row.id,
        title=row.title,
        question=row.question,
        context=row.context,
        chosen_option=row.chosen_option,
        rationale=row.rationale,
        criticality=row.criticality,
        preservation_policy=row.preservation_policy,
        status=row.status,
        premises=premises,
    )


def revisit_read(row: RevisitRow) -> RevisitRead:
    return RevisitRead(
        id=row.id,
        decision_id=row.decision_id,
        status=row.status,
        findings=row.findings,
        created_at=row.created_at,
    )
