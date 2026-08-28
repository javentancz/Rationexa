from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from time import perf_counter
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import (
    find_account_by_email,
    hash_password,
    issue_session,
    resolve_session,
    revoke_session,
    verify_password,
)
from .config import get_settings
from .db import (
    AccountRow,
    ArtifactRow,
    DecisionRow,
    DecisionShareRow,
    ExtractionRow,
    PremiseRow,
    ProductEventRow,
    RevisitRow,
    SecretRow,
    SessionLocal,
    SourceAnchorRow,
    WorkspaceRow,
    get_db,
    init_db,
    new_share_token,
    now_utc,
)
from .exports import export_filename, render_decision_markdown
from .jobs import job_manager
from .pdf_export import render_decision_pdf
from .prompts import CHALLENGE_PROMPT_VERSION, EXTRACTION_PROMPT_VERSION, REVISIT_PROMPT_VERSION
from .providers import (
    ExtractionProvider,
    OpenAICompatibleProvider,
    OpenAIResponsesProvider,
    available_models,
    default_model_id,
    get_provider,
)
from .schemas import (
    AccountRead,
    ArtifactCreate,
    ArtifactRead,
    ChallengePoint,
    CredentialCreate,
    Criticality,
    DecisionChallengeConfirmRequest,
    DecisionChallengeRead,
    DecisionChallengeRequest,
    DecisionFinalizeRequest,
    DecisionListItem,
    DecisionListRead,
    DecisionPremiseRead,
    DecisionRead,
    ExtractionRead,
    ExtractionRequest,
    ExtractionResult,
    ExtractionReviewRequest,
    HealthRead,
    JobRead,
    ModelCatalogRead,
    ModelOption,
    PilotMetricsRead,
    PremiseKind,
    RevisitFindingJudgmentRequest,
    RevisitPremiseInput,
    RevisitRead,
    RevisitRequest,
    SecretConnectionTestRead,
    SecretModelSelectRequest,
    SecretRead,
    SecretStoreRequest,
    SessionRead,
    SessionRequest,
    ShareCreate,
    ShareDecisionRead,
    ShareRead,
    SourceAnchor,
    UsageModelRead,
    UsageRunRead,
    UsageSummaryRead,
    WorkspaceRead,
)
from .secrets import (
    delete_provider_key,
    get_provider_config,
    get_provider_key,
    has_provider_key,
    select_provider_model,
    store_provider_key,
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


app = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

Db = Annotated[Session, Depends(get_db)]


def as_utc(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)


def extract_session_token(request: Request) -> str | None:
    bearer = request.headers.get("authorization", "")
    if bearer.lower().startswith("bearer "):
        return bearer.split(" ", 1)[1].strip()
    return request.headers.get("x-session-token")


def account_workspace(db: Session, account_id: str) -> WorkspaceRow | None:
     return db.scalar(select(WorkspaceRow).where(WorkspaceRow.owner_account_id == account_id))


def active_workspace(db: Session, token: str | None) -> WorkspaceRow:
    """Prefer an authenticated session's workspace; fall back to the local personal workspace."""
    account = resolve_session(token, db) if token else None
    if account is not None:
        workspace = account_workspace(db, account.id)
        if workspace is not None:
            return workspace
    workspace = db.get(WorkspaceRow, settings.local_workspace_id)
    if workspace is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Personal workspace is not initialized",
           )
    return workspace


def active_workspace_id(db: Session, token: str | None) -> str:
    return active_workspace(db, token).id


def provider_for(db: Session, workspace_id: str | None, model_id: str | None) -> ExtractionProvider:
    provider_name = model_id.split("/", 1)[0] if model_id and "/" in model_id else None
    if workspace_id is not None and provider_name in {"openai", "openrouter", "custom"}:
        configuration = get_provider_config(db, workspace_id, provider_name)
        if configuration is None:
            raise ValueError("Connect this hosted provider before using its model")
        selected_model = model_id.split("/", 1)[1]
        if configuration.get("selected_model") != selected_model:
            raise ValueError("Select this hosted model in Account & keys before using it")
        if provider_name == "openai":
            return OpenAIResponsesProvider(settings.model_copy(update={
                "openai_api_key": str(configuration["key"]),
                "openai_model": selected_model,
            }))
        return OpenAICompatibleProvider(
            provider_name,
            selected_model,
            str(configuration["key"]),
            str(configuration["base_url"]),
        )
    byok_key = get_provider_key(db, workspace_id, "openai") if workspace_id is not None else None
    return get_provider(settings, model_id, byok_key=byok_key)


@app.get("/healthz", response_model=HealthRead)
def health() -> HealthRead:
    return HealthRead(status="ok", service=settings.app_name)


def record_product_event(
    db: Session,
    workspace_id: str,
    event_type: str,
    *,
    decision_id: str | None = None,
    details: dict | None = None,
) -> None:
    db.add(ProductEventRow(
        workspace_id=workspace_id,
        decision_id=decision_id,
        event_type=event_type,
        details=details or {},
    ))


@app.get("/v1/models", response_model=ModelCatalogRead)
def list_models(request: Request, db: Db) -> ModelCatalogRead:
    workspace = active_workspace(db, extract_session_token(request))
    models = available_models(settings)
    existing_ids = {model.id for model in models}
    for entry in db.scalars(select(SecretRow).where(SecretRow.workspace_id == workspace.id)).all():
        configuration = get_provider_config(db, workspace.id, entry.provider)
        selected_model = configuration.get("selected_model") if configuration else None
        if not selected_model:
            continue
        model_id = f"{entry.provider}/{selected_model}"
        if model_id in existing_ids:
            continue
        models.append(ModelOption(
            id=model_id,
            provider=entry.provider,
            model=selected_model,
            label=f"{selected_model} · {configuration.get('label', entry.provider)}",
            location="hosted",
            best_for="Hosted extraction, revisit, and challenge using your encrypted workspace key",
        ))
        existing_ids.add(model_id)
    return ModelCatalogRead(
        default_model_id=default_model_id(settings),
        models=models,
    )


@app.get("/v1/workspace", response_model=WorkspaceRead)
def get_workspace(request: Request, db: Db) -> WorkspaceRead:
    workspace = active_workspace(db, extract_session_token(request))
    account = db.get(AccountRow, workspace.owner_account_id)
    if account is None:
        raise HTTPException(status_code=503, detail="Personal workspace is not initialized")
    return WorkspaceRead(
        id=workspace.id,
        name=workspace.name,
        account_id=account.id,
        account_name=account.name,
        created_at=as_utc(workspace.created_at),
     )


def _workspace_filter(column, workspace_id: str | None):
    target = workspace_id if workspace_id is not None else settings.local_workspace_id
    return column == target


def workspace_artifact(db: Session, artifact_id: str, workspace_id: str | None = None) -> ArtifactRow | None:
    return db.scalar(
        select(ArtifactRow).where(
            ArtifactRow.id == artifact_id,
            _workspace_filter(ArtifactRow.workspace_id, workspace_id),
            )
        )


def workspace_extraction(db: Session, extraction_id: str, workspace_id: str | None = None) -> ExtractionRow | None:
    return db.scalar(
         select(ExtractionRow).where(
             ExtractionRow.id == extraction_id,
             _workspace_filter(ExtractionRow.workspace_id, workspace_id),
         )
       )


def workspace_decision(db: Session, decision_id: str, workspace_id: str | None = None) -> DecisionRow | None:
    return db.scalar(
         select(DecisionRow).where(
             DecisionRow.id == decision_id,
             _workspace_filter(DecisionRow.workspace_id, workspace_id),
         )
       )


def _provider_location(provider: str) -> str:
    if provider in {"ollama", "deterministic"}:
        return "local"
    if provider == "unknown":
        return "unknown"
    return "hosted"


@app.get("/v1/usage", response_model=UsageSummaryRead)
def usage_summary(route: Request, db: Db) -> UsageSummaryRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    decision_by_extraction = dict(
        db.execute(
            select(DecisionRow.extraction_id, DecisionRow.id).where(DecisionRow.workspace_id == workspace_id)
        ).all()
    )
    runs: list[UsageRunRead] = []
    for extraction in db.scalars(select(ExtractionRow).where(ExtractionRow.workspace_id == workspace_id)).all():
        runs.append(
            UsageRunRead(
                id=extraction.id,
                kind="extraction",
                provider=extraction.provider,
                model=extraction.model,
                prompt_version=extraction.prompt_version,
                location=_provider_location(extraction.provider),
                latency_ms=extraction.latency_ms,
                input_tokens=extraction.input_tokens,
                output_tokens=extraction.output_tokens,
                estimated_cost_usd=extraction.estimated_cost_usd,
                created_at=as_utc(extraction.created_at),
                decision_id=decision_by_extraction.get(extraction.id),
            )
        )
    for revisit in db.scalars(
        select(RevisitRow).join(DecisionRow).where(DecisionRow.workspace_id == workspace_id)
    ).all():
        runs.append(
            UsageRunRead(
                id=revisit.id,
                kind="revisit",
                provider=revisit.provider or "unknown",
                model=revisit.model or "unknown",
                prompt_version=revisit.prompt_version or "unknown",
                location=_provider_location(revisit.provider or "unknown"),
                latency_ms=revisit.latency_ms,
                input_tokens=revisit.input_tokens,
                output_tokens=revisit.output_tokens,
                estimated_cost_usd=revisit.estimated_cost_usd,
                created_at=as_utc(revisit.created_at),
                decision_id=revisit.decision_id,
            )
        )
    for decision in db.scalars(
        select(DecisionRow).where(
            DecisionRow.workspace_id == workspace_id,
            DecisionRow.challenge.is_not(None),
        )
    ).all():
        challenge = DecisionChallengeRead.model_validate(decision.challenge)
        runs.append(
            UsageRunRead(
                id=f"challenge-{decision.id}",
                kind="challenge",
                provider=challenge.provider,
                model=challenge.model,
                prompt_version=challenge.prompt_version,
                location=_provider_location(challenge.provider),
                latency_ms=challenge.latency_ms,
                input_tokens=challenge.input_tokens,
                output_tokens=challenge.output_tokens,
                estimated_cost_usd=challenge.estimated_cost_usd,
                created_at=challenge.generated_at,
                decision_id=decision.id,
            )
        )

    grouped: dict[tuple[str, str, str], list[UsageRunRead]] = {}
    for run in runs:
        grouped.setdefault((run.provider, run.model, run.location), []).append(run)
    models = []
    for (provider, model, location), model_runs in grouped.items():
        latencies = [run.latency_ms for run in model_runs if run.latency_ms is not None]
        models.append(
            UsageModelRead(
                provider=provider,
                model=model,
                location=location,
                run_count=len(model_runs),
                total_tokens=sum((run.input_tokens or 0) + (run.output_tokens or 0) for run in model_runs),
                known_cost_usd=round(
                    sum(run.estimated_cost_usd for run in model_runs if run.estimated_cost_usd is not None),
                    8,
                ),
                unpriced_run_count=sum(run.estimated_cost_usd is None for run in model_runs),
                average_latency_ms=round(sum(latencies) / len(latencies)) if latencies else None,
            )
        )
    models.sort(key=lambda item: (-item.run_count, item.provider, item.model))
    runs.sort(key=lambda run: run.created_at, reverse=True)
    return UsageSummaryRead(
        total_runs=len(runs),
        extraction_runs=sum(run.kind == "extraction" for run in runs),
        revisit_runs=sum(run.kind == "revisit" for run in runs),
        challenge_runs=sum(run.kind == "challenge" for run in runs),
        local_runs=sum(run.location == "local" for run in runs),
        hosted_runs=sum(run.location == "hosted" for run in runs),
        unknown_location_runs=sum(run.location == "unknown" for run in runs),
        total_tokens=sum((run.input_tokens or 0) + (run.output_tokens or 0) for run in runs),
        tokenized_run_count=sum(run.input_tokens is not None or run.output_tokens is not None for run in runs),
        known_cost_usd=round(sum(run.estimated_cost_usd for run in runs if run.estimated_cost_usd is not None), 8),
        unpriced_run_count=sum(run.estimated_cost_usd is None for run in runs),
        models=models,
        recent_runs=runs[:20],
    )


@app.get("/v1/pilot/metrics", response_model=PilotMetricsRead)
def pilot_metrics(route: Request, db: Db) -> PilotMetricsRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    events = db.scalars(
        select(ProductEventRow)
        .where(ProductEventRow.workspace_id == workspace_id)
        .order_by(ProductEventRow.created_at.desc())
    ).all()
    event_counts: dict[str, int] = {}
    for event in events:
        event_counts[event.event_type] = event_counts.get(event.event_type, 0) + 1
    active_days = len({as_utc(event.created_at).date() for event in events})
    decision_count = db.scalar(
        select(func.count()).select_from(DecisionRow).where(DecisionRow.workspace_id == workspace_id)
    ) or 0
    revisit_count = db.scalar(
        select(func.count()).select_from(RevisitRow).join(DecisionRow).where(DecisionRow.workspace_id == workspace_id)
    ) or 0
    share_count = db.scalar(
        select(func.count())
        .select_from(DecisionShareRow)
        .join(DecisionRow)
        .where(DecisionRow.workspace_id == workspace_id)
    ) or 0
    return PilotMetricsRead(
        decision_count=decision_count,
        revisit_count=revisit_count,
        judgment_count=event_counts.get("finding_judged", 0),
        share_count=share_count,
        export_count=event_counts.get("decision_exported", 0),
        challenge_confirmation_count=event_counts.get("challenge_confirmed", 0),
        active_days=active_days,
        repeat_use_observed=active_days >= 2 and revisit_count > 0,
        latest_activity_at=as_utc(events[0].created_at) if events else None,
    )


def save_artifact(
    db: Session,
    filename: str,
    media_type: str,
    content: bytes,
    source_type: str,
     workspace_id: str | None = None,
) -> ArtifactRow:
    target = _workspace_filter_key(workspace_id)
    try:
        text, parser_version = extract_artifact_text(content, media_type)
        digest, storage_uri = persist_artifact(content, settings.artifact_dir, filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    existing = db.scalar(
        select(ArtifactRow).where(
            ArtifactRow.workspace_id == target,
            ArtifactRow.sha256 == digest,
         )
      )
    if existing:
        return existing
    row = ArtifactRow(
        workspace_id=target,
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
        existing = db.scalar(
            select(ArtifactRow).where(
                ArtifactRow.workspace_id == target,
                ArtifactRow.sha256 == digest,
              )
          )
        if existing:
            return existing
        raise
    db.refresh(row)
    return row


def _workspace_filter_key(workspace_id: str | None) -> str:
    return workspace_id if workspace_id is not None else settings.local_workspace_id


@app.post("/v1/artifacts", response_model=ArtifactRead, status_code=status.HTTP_201_CREATED)
def create_artifact(route: Request, payload: ArtifactCreate, db: Db) -> ArtifactRow:
    return save_artifact(
        db,
        payload.filename,
        payload.media_type,
        payload.content.encode(),
        payload.source_type,
        active_workspace_id(db, extract_session_token(route)),
      )


@app.post("/v1/artifacts/upload", response_model=ArtifactRead, status_code=status.HTTP_201_CREATED)
async def upload_artifact(route: Request, file: UploadFile, db: Db) -> ArtifactRow:
    content = await file.read()
    if len(content) > 10_000_000:
        raise HTTPException(status_code=413, detail="Artifact exceeds the 10 MB Stage 1 limit")
    return save_artifact(
        db,
        file.filename or "artifact",
        file.content_type or "application/octet-stream",
        content,
         "user_supplied",
        active_workspace_id(db, extract_session_token(route)),
      )


@app.post("/v1/decisions/extractions", response_model=ExtractionRead, status_code=status.HTTP_201_CREATED)
def create_extraction(route: Request, payload: ExtractionRequest, db: Db) -> ExtractionRead:
    return perform_extraction(payload, db, workspace_id=active_workspace_id(db, extract_session_token(route)))


def perform_extraction(
    payload: ExtractionRequest,
    db: Session,
    job_id: str | None = None,
     workspace_id: str | None = None,
) -> ExtractionRead | None:
    artifact = workspace_artifact(db, payload.artifact_id, workspace_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    try:
        provider = provider_for(db, workspace_id, payload.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    try:
        if job_id:
            job_manager.update(job_id, phase="Running model extraction", progress=35)
        started_at = perf_counter()
        result = provider.extract(artifact.extracted_text, artifact.filename)
        latency_ms = max(0, round((perf_counter() - started_at) * 1000))
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
        workspace_id=_workspace_filter_key(workspace_id),
        artifact_id=artifact.id,
        provider=provider.name,
        model=provider.model,
        prompt_version=EXTRACTION_PROMPT_VERSION,
        latency_ms=latency_ms,
        input_tokens=provider.last_usage.get("input_tokens"),
        output_tokens=provider.last_usage.get("output_tokens"),
        estimated_cost_usd=provider.last_usage.get("estimated_cost_usd"),
        output=result.model_dump(mode="json"),
     )
    db.add(row)
    db.commit()
    db.refresh(row)
    return extraction_read(row)


@app.get("/v1/extractions/{extraction_id}", response_model=ExtractionRead)
def get_extraction(route: Request, extraction_id: str, db: Db) -> ExtractionRead:
    row = workspace_extraction(db, extraction_id, active_workspace_id(db, extract_session_token(route)))
    if row is None:
        raise HTTPException(status_code=404, detail="Extraction not found")
    return extraction_read(row)


@app.post("/v1/extractions/{extraction_id}/review", response_model=ExtractionRead)
def review_extraction(route: Request, extraction_id: str, payload: ExtractionReviewRequest, db: Db) -> ExtractionRead:
    row = workspace_extraction(db, extraction_id, active_workspace_id(db, extract_session_token(route)))
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
            premise.kind = PremiseKind.UNKNOWN
            premise.quality_state = "confirmed"
            premise.claim_status = "unverified"
            premise.importance = "high"
            premise.attention_reason = "Human reviewer preserved this premise as unknown"
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
def finalize_decision(route: Request, extraction_id: str, payload: DecisionFinalizeRequest, db: Db) -> DecisionRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    extraction = workspace_extraction(db, extraction_id, workspace_id)
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
            if item.quality_state == "confirmed"
            and item.kind in CONSEQUENTIAL_KINDS - {PremiseKind.UNKNOWN}
            and item.anchor is None
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
        workspace_id=workspace_id,
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
    record_product_event(db, workspace_id, "decision_finalized", decision_id=decision.id)
    db.commit()
    db.refresh(decision)
    return decision_read(decision)


@app.get("/v1/decisions/{decision_id}", response_model=DecisionRead)
def get_decision(route: Request, decision_id: str, db: Db) -> DecisionRead:
    decision = workspace_decision(db, decision_id, active_workspace_id(db, extract_session_token(route)))
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    return decision_read(decision)


def perform_challenge(
    decision_id: str,
    payload: DecisionChallengeRequest,
    db: Session,
    job_id: str | None = None,
     workspace_id: str | None = None,
) -> DecisionChallengeRead | None:
    decision = workspace_decision(db, decision_id, workspace_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    premises = [
        RevisitPremiseInput(
            premise_id=premise.id,
            kind=PremiseKind(premise.kind),
            statement=premise.statement,
            old_excerpt=premise.anchor.exact_excerpt if premise.anchor else None,
        )
        for premise in decision.premises
    ]
    try:
        provider = provider_for(db, workspace_id, payload.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    try:
        if job_id:
            job_manager.update(job_id, phase="Challenging preserved premises", progress=35)
        started_at = perf_counter()
        suggestions = provider.challenge(premises)
        latency_ms = max(0, round((perf_counter() - started_at) * 1000))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if job_id and job_manager.is_cancelled(job_id):
        return None
    if job_id:
        job_manager.update(job_id, phase="Validating source grounding", progress=85)

    premise_by_id = {premise.id: premise for premise in decision.premises}

    def point(suggestion) -> ChallengePoint:
        premise = premise_by_id[suggestion.premise_id]
        return ChallengePoint(
            premise_id=premise.id,
            premise_statement=premise.statement,
            source_excerpt=premise.anchor.exact_excerpt if premise.anchor else None,
            prompt=suggestion.prompt,
            explanation=suggestion.explanation,
        )

    challenge = DecisionChallengeRead(
        status="draft",
        weakest_assumption=point(suggestions.weakest_assumption),
        missing_evidence=point(suggestions.missing_evidence),
        strongest_counterargument=point(suggestions.strongest_counterargument),
        reversal_condition=point(suggestions.reversal_condition),
        provider=provider.name,
        model=provider.model,
        prompt_version=CHALLENGE_PROMPT_VERSION,
        latency_ms=latency_ms,
        input_tokens=provider.last_usage.get("input_tokens"),
        output_tokens=provider.last_usage.get("output_tokens"),
        estimated_cost_usd=provider.last_usage.get("estimated_cost_usd"),
        generated_at=now_utc(),
    )
    decision.challenge = challenge.model_dump(mode="json")
    record_product_event(db, decision.workspace_id, "challenge_confirmed", decision_id=decision.id)
    db.commit()
    db.refresh(decision)
    return challenge


@app.post("/v1/decisions/{decision_id}/challenge", response_model=DecisionChallengeRead)
def create_decision_challenge(
    route: Request,
    decision_id: str,
    payload: DecisionChallengeRequest,
    db: Db,
) -> DecisionChallengeRead:
    challenge = perform_challenge(
        decision_id,
        payload,
        db,
        workspace_id=active_workspace_id(db, extract_session_token(route)),
       )
    assert challenge is not None
    return challenge


@app.post("/v1/decisions/{decision_id}/challenge/confirm", response_model=DecisionChallengeRead)
def confirm_decision_challenge(
    route: Request,
    decision_id: str,
    payload: DecisionChallengeConfirmRequest,
    db: Db,
) -> DecisionChallengeRead:
    decision = workspace_decision(db, decision_id, active_workspace_id(db, extract_session_token(route)))
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    if decision.challenge is None:
        raise HTTPException(status_code=409, detail="Generate a challenge brief before confirming it")
    challenge = DecisionChallengeRead.model_validate(decision.challenge).model_copy(
        update={
            "status": "confirmed",
            "confirmed_at": now_utc(),
            "reviewer_notes": payload.notes.strip() if payload.notes and payload.notes.strip() else None,
        }
    )
    decision.challenge = challenge.model_dump(mode="json")
    db.commit()
    db.refresh(decision)
    return challenge


@app.delete("/v1/decisions/{decision_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_decision(route: Request, decision_id: str, db: Db) -> Response:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    if workspace_decision(db, decision_id, workspace_id) is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    premise_ids = [
         pid
         for pid in db.scalars(select(PremiseRow.id).where(PremiseRow.decision_id == decision_id)).all()
        ]
    if premise_ids:
        db.execute(delete(SourceAnchorRow).where(SourceAnchorRow.premise_id.in_(premise_ids)))
    db.execute(delete(PremiseRow).where(PremiseRow.decision_id == decision_id))
    db.execute(delete(RevisitRow).where(RevisitRow.decision_id == decision_id))
    db.execute(delete(DecisionShareRow).where(DecisionShareRow.decision_id == decision_id))
    db.execute(delete(DecisionRow).where(DecisionRow.id == decision_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/v1/decisions", response_model=DecisionListRead)
def list_decisions(
    route: Request,
    db: Db,
    q: Annotated[str | None, Query(max_length=200)] = None,
    criticality: Annotated[Criticality | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> DecisionListRead:
    filters = [DecisionRow.workspace_id == active_workspace_id(db, extract_session_token(route))]
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                DecisionRow.title.ilike(pattern),
                DecisionRow.question.ilike(pattern),
                DecisionRow.context.ilike(pattern),
                DecisionRow.chosen_option.ilike(pattern),
            )
        )
    if criticality:
        filters.append(DecisionRow.criticality == criticality.value)

    premise_count = func.count(func.distinct(PremiseRow.id)).label("premise_count")
    revisit_count = func.count(func.distinct(RevisitRow.id)).label("revisit_count")
    pending_revisit_count = (
        func.count(func.distinct(RevisitRow.id))
        .filter(RevisitRow.status == "needs_review")
        .label("pending_revisit_count")
    )
    last_revisited_at = func.max(RevisitRow.created_at).label("last_revisited_at")
    statement = (
        select(
            DecisionRow,
            premise_count,
            revisit_count,
            pending_revisit_count,
            last_revisited_at,
        )
        .outerjoin(PremiseRow, PremiseRow.decision_id == DecisionRow.id)
        .outerjoin(RevisitRow, RevisitRow.decision_id == DecisionRow.id)
        .where(*filters)
        .group_by(DecisionRow.id)
        .order_by(DecisionRow.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = db.execute(statement).all()
    total = db.scalar(select(func.count()).select_from(DecisionRow).where(*filters)) or 0
    return DecisionListRead(
        items=[
            DecisionListItem(
                id=decision.id,
                title=decision.title,
                question=decision.question,
                chosen_option=decision.chosen_option,
                criticality=decision.criticality,
                status=decision.status,
                premise_count=premises,
                revisit_count=revisits,
                pending_revisit_count=pending,
                last_revisited_at=as_utc(last_revisited),
                created_at=as_utc(decision.created_at),
            )
            for decision, premises, revisits, pending, last_revisited in rows
        ],
        total=total,
    )


@app.get("/v1/decisions/{decision_id}/revisit-checks", response_model=list[RevisitRead])
def list_revisit_checks(route: Request, decision_id: str, db: Db) -> list[RevisitRead]:
    if workspace_decision(db, decision_id, active_workspace_id(db, extract_session_token(route))) is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    rows = db.scalars(
        select(RevisitRow).where(RevisitRow.decision_id == decision_id).order_by(RevisitRow.created_at.desc())
    ).all()
    return [revisit_read(row) for row in rows]


@app.get("/v1/decisions/{decision_id}/export/markdown")
def export_decision_markdown(route: Request, decision_id: str, db: Db) -> Response:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    decision = workspace_decision(db, decision_id, workspace_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    revisits = db.scalars(
        select(RevisitRow)
         .where(RevisitRow.decision_id == decision_id)
         .order_by(RevisitRow.created_at.asc(), RevisitRow.id.asc())
        ).all()
    filename = export_filename(decision.title)
    record_product_event(db, workspace_id, "decision_exported", decision_id=decision.id, details={"format": "markdown"})
    db.commit()
    return Response(
        content=render_decision_markdown(decision, revisits),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
       )


@app.get("/v1/decisions/{decision_id}/export/pdf")
def export_decision_pdf(route: Request, decision_id: str, db: Db) -> Response:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    decision = workspace_decision(db, decision_id, workspace_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    revisits = db.scalars(
        select(RevisitRow)
          .where(RevisitRow.decision_id == decision_id)
          .order_by(RevisitRow.created_at.asc(), RevisitRow.id.asc())
         ).all()
    content = render_decision_pdf(decision, revisits)
    filename = export_filename(decision.title, extension="pdf")
    record_product_event(db, workspace_id, "decision_exported", decision_id=decision.id, details={"format": "pdf"})
    db.commit()
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


SECRET_PLACEHOLD = "***redacted provider secret***"
ARTIFACT_NOTICE = "Private source artifact not included in the shared record."
_SECRET_KEYWORDS = ("api_key", "apikey", "secret", "token", "password", "authorization", "bearer", "openai", "ollama")


def _scrub_shared_text(value: object | None) -> str | None:
    """Scrub provider secrets and private artifact references out of shared text."""
    if value is None:
        return None
    text = str(value)
    lowered = text.lower()
    if "storage_uri" in lowered or "artifact" in lowered and "file" in lowered:
        return ARTIFACT_NOTICE
    for keyword in _SECRET_KEYWORDS:
        if keyword in lowered:
            return SECRET_PLACEHOLD
    return text


def _scrub_shared_dict(data: object) -> object:
    if isinstance(data, dict):
        scrubbed = {}
        for key, value in data.items():
            if isinstance(key, str) and "artifact" in key.lower():
                scrubbed[key] = ARTIFACT_NOTICE
            elif isinstance(key, str) and any(secret in key.lower() for secret in _SECRET_KEYWORDS):
                scrubbed[key] = SECRET_PLACEHOLD
            else:
                scrubbed[key] = _scrub_shared_dict(value)
        return scrubbed
    if isinstance(data, list):
        return [_scrub_shared_dict(item) for item in data]
    return _scrub_shared_text(data)


def share_read(share: DecisionShareRow, base_url: str) -> ShareRead:
    url = f"{base_url.rstrip('/')}/share/{share.token}" if share.status == "active" else None
    return ShareRead(
        id=share.id,
        decision_id=share.decision_id,
        token=share.token,
        status=share.status,
        url=url,
        created_at=as_utc(share.created_at),
        expires_at=as_utc(share.expires_at),
        revoked_at=as_utc(share.revoked_at),
        )


def shared_premise(premise: PremiseRow) -> DecisionPremiseRead:
    anchor = None
    if premise.anchor is not None:
        anchor = SourceAnchor(
            exact_excerpt=_scrub_shared_text(premise.anchor.exact_excerpt) or "",
            start_offset=premise.anchor.start_offset,
            end_offset=premise.anchor.end_offset,
            page_number=premise.anchor.page_number,
        )
    return DecisionPremiseRead(
        id=premise.id,
        kind=premise.kind,
        statement=_scrub_shared_text(premise.statement) or "",
        qualifiers=_scrub_shared_text(premise.qualifiers) or "",
        importance=premise.importance,
        quality_state=premise.quality_state,
        claim_status=premise.claim_status,
        anchor=anchor,
        )


def decision_share_payload(decision: DecisionRow, revisits: list[RevisitRow], shared_at) -> ShareDecisionRead:
    revisits_for_share = [
        RevisitRead(
            id=revisit.id,
            decision_id=revisit.decision_id,
            status=revisit.status,
            findings=_scrub_shared_dict(revisit.findings) or [],
            provider=revisit.provider,
            model=revisit.model,
            prompt_version=revisit.prompt_version,
            latency_ms=revisit.latency_ms,
            input_tokens=revisit.input_tokens,
            output_tokens=revisit.output_tokens,
            estimated_cost_usd=revisit.estimated_cost_usd,
            evidence_filename=None,
            created_at=as_utc(revisit.created_at),
        )
        for revisit in revisits
       ]
    return ShareDecisionRead(
        id=decision.id,
        title=_scrub_shared_text(decision.title) or "",
        question=_scrub_shared_text(decision.question) or "",
        context=_scrub_shared_text(decision.context) or "",
        chosen_option=_scrub_shared_text(decision.chosen_option),
        rationale=_scrub_shared_text(decision.rationale) or "",
        criticality=decision.criticality,
        preservation_policy=decision.preservation_policy,
        status=decision.status,
        premises=[shared_premise(premise) for premise in decision.premises],
        revisits=revisits_for_share,
        shared_at=as_utc(shared_at),
       )


def _is_expired(share: DecisionShareRow) -> bool:
    if share.expires_at is None:
        return False
    expires_at = share.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at < now_utc()


def load_shared_decision(db: Session, token: str) -> ShareDecisionRead:
    share = db.scalar(select(DecisionShareRow).where(DecisionShareRow.token == token))
    if share is None or share.status != "active":
        raise HTTPException(status_code=404, detail="Shared decision not found")
    if _is_expired(share):
        raise HTTPException(status_code=404, detail="Shared decision link has expired")
    decision = db.get(DecisionRow, share.decision_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Shared decision not found")
    revisits = db.scalars(
        select(RevisitRow)
        .where(RevisitRow.decision_id == decision.id)
        .order_by(RevisitRow.created_at.asc(), RevisitRow.id.asc())
     ).all()
    return decision_share_payload(decision, revisits, share.created_at)


@app.post(
     "/v1/decisions/{decision_id}/shares",
    response_model=ShareRead,
    status_code=status.HTTP_201_CREATED,
)
def create_share(route: Request, decision_id: str, payload: ShareCreate, db: Db) -> ShareRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    if workspace_decision(db, decision_id, workspace_id) is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    existing = db.scalar(
        select(DecisionShareRow).where(
            DecisionShareRow.decision_id == decision_id,
            DecisionShareRow.status == "active",
          )
    )
    if existing is not None:
        if existing.expires_at is None:
            existing.expires_at = now_utc() + timedelta(days=settings.share_default_ttl_days)
            db.add(existing)
            db.commit()
            db.refresh(existing)
        return share_read(existing, settings.public_base_url)
    expires_at = payload.expires_at or now_utc() + timedelta(days=settings.share_default_ttl_days)
    share = DecisionShareRow(decision_id=decision_id, token=new_share_token(), expires_at=expires_at)
    db.add(share)
    record_product_event(db, workspace_id, "share_created", decision_id=decision_id)
    db.commit()
    db.refresh(share)
    return share_read(share, settings.public_base_url)


@app.get("/v1/decisions/{decision_id}/shares", response_model=list[ShareRead])
def list_shares(route: Request, decision_id: str, db: Db) -> list[ShareRead]:
    if workspace_decision(db, decision_id, active_workspace_id(db, extract_session_token(route))) is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    shares = db.scalars(
        select(DecisionShareRow)
         .where(DecisionShareRow.decision_id == decision_id)
         .order_by(DecisionShareRow.created_at.desc())
      ).all()
    return [share_read(share, settings.public_base_url) for share in shares]


@app.delete("/v1/decisions/{decision_id}/shares/{share_id}", response_model=ShareRead)
def revoke_share(decision_id: str, share_id: str, db: Db) -> ShareRead:
    share = db.get(DecisionShareRow, share_id)
    if share is None or share.decision_id != decision_id:
        raise HTTPException(status_code=404, detail="Shared decision link not found")
    share.status = "revoked"
    share.revoked_at = now_utc()
    db.commit()
    db.refresh(share)
    return share_read(share, settings.public_base_url)


@app.delete(
    "/v1/decisions/{decision_id}/shares/{share_id}/record",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_share_record(decision_id: str, share_id: str, db: Db) -> Response:
    share = db.get(DecisionShareRow, share_id)
    if share is None or share.decision_id != decision_id:
        raise HTTPException(status_code=404, detail="Shared decision link not found")
    if share.status == "active" and not _is_expired(share):
        raise HTTPException(status_code=409, detail="Revoke the active share link before deleting its record")
    db.delete(share)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/v1/shares/{token}", response_model=ShareDecisionRead)
def get_shared_decisions(token: str, db: Db) -> ShareDecisionRead:
    return load_shared_decision(db, token)


@app.post(
     "/v1/decisions/{decision_id}/revisit-checks",
    response_model=RevisitRead,
    status_code=status.HTTP_201_CREATED,
)
def create_revisit(route: Request, decision_id: str, payload: RevisitRequest, db: Db) -> RevisitRead:
    return perform_revisit(
        decision_id,
        payload,
        db,
        workspace_id=active_workspace_id(db, extract_session_token(route)),
        )


def perform_revisit(
    decision_id: str,
    payload: RevisitRequest,
    db: Session,
    job_id: str | None = None,
     workspace_id: str | None = None,
) -> RevisitRead | None:
    decision = workspace_decision(db, decision_id, workspace_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    evidence = save_artifact(
        db,
        payload.filename,
        payload.media_type,
        payload.content.encode(),
        "new_evidence",
         workspace_id,
        )
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
        provider = provider_for(db, workspace_id, payload.model_id)
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
        evidence_filename=payload.filename,
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
    record_product_event(
        db,
        decision.workspace_id,
        "revisit_completed",
        decision_id=decision.id,
        details={"finding_count": len(findings), "model": provider.model, "provider": provider.name},
    )
    db.commit()
    db.refresh(row)
    return revisit_read(row)


@app.post(
    "/v1/revisit-checks/{revisit_id}/findings/{premise_id}/judgment",
    response_model=RevisitRead,
)
def record_revisit_judgment(
    route: Request,
    revisit_id: str,
    premise_id: str,
    payload: RevisitFindingJudgmentRequest,
    db: Db,
) -> RevisitRead:
    revisit = db.get(RevisitRow, revisit_id)
    if revisit is None:
        raise HTTPException(status_code=404, detail="Revisit check not found")
    decision = workspace_decision(db, revisit.decision_id, active_workspace_id(db, extract_session_token(route)))
    if decision is None:
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
    record_product_event(
        db,
        decision.workspace_id,
        "finding_judged",
        decision_id=decision.id,
        details={"judgment": payload.judgment},
    )
    db.commit()
    db.refresh(revisit)
    return revisit_read(revisit)


@app.post("/v1/decisions/extractions/jobs", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
def create_extraction_job(route: Request, payload: ExtractionRequest, db: Db) -> JobRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    if workspace_artifact(db, payload.artifact_id, workspace_id) is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    try:
        provider_for(db, workspace_id, payload.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    def worker(job_id: str) -> dict | None:
        with SessionLocal() as worker_db:
            result = perform_extraction(payload, worker_db, job_id, workspace_id=workspace_id)
            return result.model_dump(mode="json") if result else None

    return JobRead.model_validate(job_manager.create("extraction", worker))


@app.post(
    "/v1/decisions/{decision_id}/revisit-jobs",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_revisit_job(route: Request, decision_id: str, payload: RevisitRequest, db: Db) -> JobRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    if workspace_decision(db, decision_id, workspace_id) is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    try:
        provider_for(db, workspace_id, payload.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    def worker(job_id: str) -> dict | None:
        with SessionLocal() as worker_db:
            result = perform_revisit(decision_id, payload, worker_db, job_id, workspace_id=workspace_id)
            return result.model_dump(mode="json") if result else None

    return JobRead.model_validate(job_manager.create("revisit", worker))


@app.post(
    "/v1/decisions/{decision_id}/challenge-jobs",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_challenge_job(route: Request, decision_id: str, payload: DecisionChallengeRequest, db: Db) -> JobRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    if workspace_decision(db, decision_id, workspace_id) is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    try:
        provider_for(db, workspace_id, payload.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    def worker(job_id: str) -> dict | None:
        with SessionLocal() as worker_db:
            result = perform_challenge(decision_id, payload, worker_db, job_id, workspace_id=workspace_id)
            return result.model_dump(mode="json") if result else None

    return JobRead.model_validate(job_manager.create("challenge", worker))


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


def account_read(account: AccountRow) -> AccountRead:
    return AccountRead(
        id=account.id,
        name=account.name,
        email=account.email,
        has_password=account.password_hash is not None,
        created_at=as_utc(account.created_at),
      )


@app.post("/v1/account", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
def create_account(payload: CredentialCreate, db: Db) -> AccountRead:
    email = payload.email.strip().lower()
    if find_account_by_email(email, db) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")
    account = AccountRow(
        name=payload.name.strip() or email,
        email=email,
       )
    db.add(account)
    db.flush()
    account.password_hash, account.password_salt, account.password_iterations = hash_password(
        payload.password,
        settings.pbkdf2_iterations,
     )
    db.add(
        WorkspaceRow(
            owner_account_id=account.id,
            name=f"{account.name}'s workspace",
          )
    )
    db.commit()
    db.refresh(account)
    return account_read(account)


@app.get("/v1/account", response_model=AccountRead)
def whoami(request: Request, db: Db) -> AccountRead:
    account = resolve_session(extract_session_token(request), db)
    if account is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return account_read(account)


@app.post("/v1/auth/login", response_model=SessionRead)
def login(payload: SessionRequest, db: Db) -> SessionRead:
    account = find_account_by_email(payload.email, db)
    if account is None or account.password_hash is None or account.password_salt is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not verify_password(
        payload.password,
        account.password_hash,
        account.password_salt,
        account.password_iterations or settings.pbkdf2_iterations,
     ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    session = issue_session(db, account.id)
    return SessionRead(
        account_id=account.id,
        account_name=account.name,
        email=account.email or "",
        session_token=session.token,
        created_at=as_utc(session.created_at),
        expires_at=as_utc(session.expires_at),
      )


@app.post("/v1/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, db: Db) -> Response:
    revoke_session(extract_session_token(request), db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/v1/secrets", response_model=list[SecretRead])
def list_provider_secrets(request: Request, db: Db) -> list[SecretRead]:
    workspace = active_workspace(db, extract_session_token(request))
    entries = db.scalars(
        select(SecretRow).where(SecretRow.workspace_id == workspace.id).order_by(SecretRow.provider)
     ).all()
    return [_secret_read(db, workspace.id, entry) for entry in entries]


def _secret_read(db: Session, workspace_id: str, row: SecretRow) -> SecretRead:
    configuration = get_provider_config(db, workspace_id, row.provider) or {}
    return SecretRead(
        provider=row.provider,
        configured=has_provider_key(db, workspace_id, row.provider),
        label=str(configuration.get("label") or row.provider),
        base_url=str(configuration.get("base_url")) if configuration.get("base_url") else None,
        selected_model=str(configuration.get("selected_model")) if configuration.get("selected_model") else None,
        protocol=str(configuration.get("protocol")) if configuration.get("protocol") else None,
        last_updated_at=as_utc(row.updated_at),
        source="workspace_store",
    )


def _fetch_provider_model_ids(configuration: dict) -> list[str]:
    try:
        response = httpx.get(
            f"{str(configuration['base_url']).rstrip('/')}/models",
            headers={"Authorization": f"Bearer {configuration['key']}"},
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise ValueError(f"Could not load models from this provider: {exc}") from exc
    entries = payload.get("data", []) if isinstance(payload, dict) else []
    models = sorted({
        str(entry.get("id", "")).strip()
        for entry in entries
        if isinstance(entry, dict) and entry.get("id")
    })
    if not models:
        raise ValueError("The provider returned no callable models")
    return models


@app.get("/v1/secrets/{provider}/models")
def list_provider_models(route: Request, provider: str, db: Db) -> dict[str, list[str]]:
    workspace = active_workspace(db, extract_session_token(route))
    configuration = get_provider_config(db, workspace.id, provider)
    if configuration is None:
        raise HTTPException(status_code=404, detail="Connect this provider before loading its models")
    try:
        return {"models": _fetch_provider_model_ids(configuration)}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@app.post("/v1/secrets/{provider}/test", response_model=SecretConnectionTestRead)
def test_provider_connection(route: Request, provider: str, db: Db) -> SecretConnectionTestRead:
    workspace = active_workspace(db, extract_session_token(route))
    configuration = get_provider_config(db, workspace.id, provider)
    if configuration is None:
        raise HTTPException(status_code=404, detail="Connect this provider before testing it")
    started_at = perf_counter()
    try:
        models = _fetch_provider_model_ids(configuration)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return SecretConnectionTestRead(
        provider=provider,
        model_count=len(models),
        latency_ms=max(0, round((perf_counter() - started_at) * 1000)),
    )


@app.post("/v1/secrets/{provider}/model", response_model=SecretRead)
def choose_provider_model(route: Request, provider: str, payload: SecretModelSelectRequest, db: Db) -> SecretRead:
    workspace = active_workspace(db, extract_session_token(route))
    configuration = get_provider_config(db, workspace.id, provider)
    if configuration is None:
        raise HTTPException(status_code=404, detail="Connect this provider before selecting its model")
    try:
        available = _fetch_provider_model_ids(configuration)
        if payload.model not in available:
            raise ValueError("The selected model is not in this provider's current model catalog")
        row = select_provider_model(db, workspace.id, provider, payload.model)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return _secret_read(db, workspace.id, row)


@app.post("/v1/secrets", response_model=SecretRead, status_code=status.HTTP_201_CREATED)
def store_provider_secret(
    route: Request,
    payload: SecretStoreRequest,
    db: Db,
) -> SecretRead:
    workspace = active_workspace(db, extract_session_token(route))
    try:
        row = store_provider_key(db, workspace.id, payload.provider, payload.key, base_url=payload.base_url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return _secret_read(db, workspace.id, row)


@app.delete("/v1/secrets/{provider}", response_model=SecretRead)
def remove_provider_secret(route: Request, provider: str, db: Db) -> SecretRead:
    workspace = active_workspace(db, extract_session_token(route))
    if delete_provider_key(db, workspace.id, provider):
        return SecretRead(provider=provider, configured=False, source="workspace_store")
    raise HTTPException(status_code=404, detail="No stored secret for this provider")



def extraction_read(row: ExtractionRow) -> ExtractionRead:
    return ExtractionRead(
        id=row.id,
        artifact_id=row.artifact_id,
        status=row.status,
        provider=row.provider,
        model=row.model,
        prompt_version=row.prompt_version,
        latency_ms=row.latency_ms,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        estimated_cost_usd=row.estimated_cost_usd,
        result=ExtractionResult.model_validate(row.output),
        created_at=as_utc(row.created_at),
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
        challenge=DecisionChallengeRead.model_validate(row.challenge) if row.challenge else None,
        created_at=as_utc(row.created_at),
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
        evidence_filename=row.evidence_filename,
        created_at=as_utc(row.created_at),
    )
