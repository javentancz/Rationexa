from contextlib import asynccontextmanager
from time import perf_counter
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import get_settings
from .db import (
    ArtifactRow,
    DecisionRow,
    ExtractionRow,
    PremiseRow,
    RevisitRow,
    SessionLocal,
    SourceAnchorRow,
    get_db,
    init_db,
    now_utc,
)
from .jobs import job_manager
from .prompts import EXTRACTION_PROMPT_VERSION, REVISIT_PROMPT_VERSION
from .providers import available_models, default_model_id, get_provider
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
    JobRead,
    ModelCatalogRead,
    PremiseKind,
    RevisitFindingJudgmentRequest,
    RevisitPremiseInput,
    RevisitRead,
    RevisitRequest,
    SourceAnchor,
)
from .services import extract_artifact_text, persist_artifact, validate_anchor

settings = get_settings()

CONSEQUENTIAL_KINDS = {
    PremiseKind.HARD_CONSTRAINT,
    PremiseKind.ASSUMPTION,
    PremiseKind.UNKNOWN,
    PremiseKind.MATERIAL_CLAIM,
    PremiseKind.REVISIT_CONDITION,
}


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


@app.get("/v1/models", response_model=ModelCatalogRead)
def list_models() -> ModelCatalogRead:
    return ModelCatalogRead(
        default_model_id=default_model_id(settings),
        models=available_models(settings),
    )


def save_artifact(db: Session, filename: str, media_type: str, content: bytes, source_type: str) -> ArtifactRow:
    try:
        text, parser_version = extract_artifact_text(content, media_type)
        digest, storage_uri = persist_artifact(content, settings.artifact_dir, filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
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
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(ArtifactRow).where(ArtifactRow.sha256 == digest))
        if existing:
            return existing
        raise
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
    return perform_extraction(payload, db)


def perform_extraction(
    payload: ExtractionRequest,
    db: Session,
    job_id: str | None = None,
) -> ExtractionRead | None:
    artifact = db.get(ArtifactRow, payload.artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    try:
        provider = get_provider(settings, payload.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    try:
        if job_id:
            job_manager.update(job_id, phase="Running model extraction", progress=35)
        result = provider.extract(artifact.extracted_text, artifact.filename)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    validated = []
    for premise in result.premises:
        premise.anchor = validate_anchor(premise.anchor, artifact.extracted_text)
        validated.append(premise)
    result.premises = validated
    if job_id and job_manager.is_cancelled(job_id):
        return None
    if job_id:
        job_manager.update(job_id, phase="Validating and saving premises", progress=85)
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
            premise.importance = "high" if premise.kind in CONSEQUENTIAL_KINDS else "normal"
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
    if payload.criticality.value == "critical":
        unanchored = [
            item.candidate_id
            for item in result.premises
            if item.quality_state == "confirmed" and item.kind in CONSEQUENTIAL_KINDS and item.anchor is None
        ]
        if unanchored:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "Critical decisions require source anchors for every confirmed consequential premise. "
                    f"Reject or mark these premises unknown before finalizing: {', '.join(unanchored)}"
                ),
            )
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
    return perform_revisit(decision_id, payload, db)


def perform_revisit(
    decision_id: str,
    payload: RevisitRequest,
    db: Session,
    job_id: str | None = None,
) -> RevisitRead | None:
    decision = db.get(DecisionRow, decision_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    evidence = save_artifact(db, payload.filename, payload.media_type, payload.content.encode(), "new_evidence")
    premises = [
        RevisitPremiseInput(
            premise_id=premise.id,
            kind=PremiseKind(premise.kind),
            statement=premise.statement,
            old_excerpt=premise.anchor.exact_excerpt if premise.anchor else None,
        )
        for premise in decision.premises
        if PremiseKind(premise.kind) in CONSEQUENTIAL_KINDS
    ]
    try:
        provider = get_provider(settings, payload.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    try:
        if job_id:
            job_manager.update(job_id, phase="Comparing evidence with premises", progress=35)
        started_at = perf_counter()
        findings = provider.revisit(premises, evidence.extracted_text, decision.criticality)
        latency_ms = max(0, round((perf_counter() - started_at) * 1000))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if job_id and job_manager.is_cancelled(job_id):
        return None
    if job_id:
        job_manager.update(job_id, phase="Validating and saving findings", progress=85)
    row = RevisitRow(
        decision_id=decision.id,
        evidence_artifact_id=evidence.id,
        status="needs_review" if findings else "completed",
        findings=[finding.model_dump(mode="json") for finding in findings],
        provider=provider.name,
        model=provider.model,
        prompt_version=REVISIT_PROMPT_VERSION,
        latency_ms=latency_ms,
        input_tokens=provider.last_usage.get("input_tokens"),
        output_tokens=provider.last_usage.get("output_tokens"),
        estimated_cost_usd=provider.last_usage.get("estimated_cost_usd"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return revisit_read(row)


@app.post(
    "/v1/revisit-checks/{revisit_id}/findings/{premise_id}/judgment",
    response_model=RevisitRead,
)
def record_revisit_judgment(
    revisit_id: str,
    premise_id: str,
    payload: RevisitFindingJudgmentRequest,
    db: Db,
) -> RevisitRead:
    revisit = db.get(RevisitRow, revisit_id)
    if revisit is None:
        raise HTTPException(status_code=404, detail="Revisit check not found")

    findings = [dict(finding) for finding in revisit.findings]
    target = next((finding for finding in findings if finding.get("premise_id") == premise_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Revisit finding not found")

    target["human_judgment"] = payload.judgment
    target["human_notes"] = payload.notes.strip() if payload.notes and payload.notes.strip() else None
    target["judged_at"] = now_utc().isoformat()
    revisit.findings = findings
    revisit.status = "completed" if all(finding.get("human_judgment") for finding in findings) else "needs_review"
    db.commit()
    db.refresh(revisit)
    return revisit_read(revisit)


@app.post("/v1/decisions/extractions/jobs", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
def create_extraction_job(payload: ExtractionRequest, db: Db) -> JobRead:
    if db.get(ArtifactRow, payload.artifact_id) is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    try:
        get_provider(settings, payload.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    def worker(job_id: str) -> dict | None:
        with SessionLocal() as worker_db:
            result = perform_extraction(payload, worker_db, job_id)
            return result.model_dump(mode="json") if result else None

    return JobRead.model_validate(job_manager.create("extraction", worker))


@app.post(
    "/v1/decisions/{decision_id}/revisit-jobs",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_revisit_job(decision_id: str, payload: RevisitRequest, db: Db) -> JobRead:
    if db.get(DecisionRow, decision_id) is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    try:
        get_provider(settings, payload.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    def worker(job_id: str) -> dict | None:
        with SessionLocal() as worker_db:
            result = perform_revisit(decision_id, payload, worker_db, job_id)
            return result.model_dump(mode="json") if result else None

    return JobRead.model_validate(job_manager.create("revisit", worker))


@app.get("/v1/jobs/{job_id}", response_model=JobRead)
def get_job(job_id: str) -> JobRead:
    try:
        return JobRead.model_validate(job_manager.get(job_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@app.delete("/v1/jobs/{job_id}", response_model=JobRead)
def cancel_job(job_id: str, response: Response) -> JobRead:
    try:
        job = job_manager.cancel(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    response.status_code = status.HTTP_202_ACCEPTED if job["status"] == "cancelled" else status.HTTP_200_OK
    return JobRead.model_validate(job)


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
        provider=row.provider,
        model=row.model,
        prompt_version=row.prompt_version,
        latency_ms=row.latency_ms,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        estimated_cost_usd=row.estimated_cost_usd,
        created_at=row.created_at,
    )
