import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from hmac import compare_digest
from pathlib import Path
from secrets import token_urlsafe
from threading import Lock
from time import monotonic, perf_counter
from typing import Annotated
from uuid import uuid4

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import (
    find_account_by_email,
    hash_password,
    issue_session,
    resolve_session,
    revoke_session,
    session_token_hash,
    verify_password,
)
from .config import get_settings
from .db import (
    AccountRow,
    ArtifactRow,
    AuthAttemptRow,
    DecisionRow,
    DecisionShareRow,
    ExtractionRow,
    JobRow,
    PasswordResetRow,
    PremiseRow,
    ProductEventRow,
    RevisitRow,
    SecretRow,
    SessionLocal,
    SessionRow,
    SourceAnchorRow,
    WorkspaceRow,
    get_db,
    init_db,
    new_share_token,
    now_utc,
)
from .exports import export_filename, render_decision_markdown
from .jobs import job_manager
from .notifications import send_password_reset_email
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
from .read_models import decision_read, extraction_read, revisit_read
from .schemas import (
    AccountDeleteRequest,
    AccountRead,
    AccountSettingsRead,
    AccountUpdateRequest,
    ArtifactCreate,
    ArtifactRead,
    ChallengePoint,
    ClientErrorReport,
    CredentialCreate,
    Criticality,
    DecisionChallengeConfirmRequest,
    DecisionChallengeRead,
    DecisionChallengeRequest,
    DecisionFinalizeRequest,
    DecisionListItem,
    DecisionListRead,
    DecisionRead,
    DecisionWorkspaceRead,
    ExtractionRead,
    ExtractionRequest,
    ExtractionResult,
    ExtractionReviewRequest,
    GuestCleanupRead,
    HealthRead,
    JobRead,
    ModelCatalogRead,
    ModelOption,
    PasswordChangeRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    PasswordResetRequestRead,
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
    SessionSummaryRead,
    ShareCreate,
    ShareDecisionRead,
    ShareRead,
    UsageDashboardRead,
    UsageSummaryRead,
    WorkspaceBootstrapRead,
    WorkspaceRead,
    WorkspaceUpdateRequest,
)
from .secrets import (
    delete_provider_key,
    get_provider_config,
    get_provider_key,
    has_provider_key,
    select_provider_model,
    store_provider_key,
    validate_provider_base_url,
)
from .services import extract_artifact_text, persist_artifact, validate_anchor
from .share_service import is_expired, load_shared_decision, share_read
from .usage_service import build_pilot_metrics, build_usage_summary

settings = get_settings()
logger = logging.getLogger("rationexa.api")
_cache_lock = Lock()
_ollama_status_cache: dict[tuple[str, str], tuple[float, set[str], str | None]] = {}
_provider_model_cache: dict[str, tuple[float, tuple[str, ...]]] = {}

CONSEQUENTIAL_KINDS = {
    PremiseKind.HARD_CONSTRAINT,
    PremiseKind.ASSUMPTION,
    PremiseKind.UNKNOWN,
    PremiseKind.MATERIAL_CLAIM,
    PremiseKind.REVISIT_CONDITION,
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.artifact_storage == "filesystem":
        settings.artifact_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    recovered_jobs = job_manager.recover_interrupted()
    if recovered_jobs:
        logger.warning("recovered_interrupted_jobs count=%s", recovered_jobs)
    yield


app = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Server-Timing"],
)


@app.middleware("http")
async def add_operational_headers(request: Request, call_next):
    started_at = perf_counter()
    request_id = request.headers.get("x-request-id") or str(uuid4())
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (perf_counter() - started_at) * 1000
        logger.exception(
            "request_failed request_id=%s method=%s path=%s duration_ms=%.1f",
            request_id,
            request.method,
            request.url.path,
            duration_ms,
        )
        raise
    duration_ms = (perf_counter() - started_at) * 1000
    response.headers["Server-Timing"] = f'app;dur={duration_ms:.1f};desc="Rationexa API"'
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    if settings.session_cookie_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    logger.info(
        "request_complete request_id=%s method=%s path=%s status=%s duration_ms=%.1f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


Db = Annotated[Session, Depends(get_db)]


def as_utc(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)


def extract_session_token(request: Request) -> str | None:
    bearer = request.headers.get("authorization", "")
    if bearer.lower().startswith("bearer "):
        return bearer.split(" ", 1)[1].strip()
    return request.headers.get("x-session-token") or request.cookies.get(settings.session_cookie_name)


@app.post("/v1/telemetry/client-errors", status_code=status.HTTP_204_NO_CONTENT)
def report_client_error(route: Request, payload: ClientErrorReport, db: Db) -> Response:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    logger.warning(
        "client_error workspace_id=%s category=%s route=%s digest=%s component=%s",
        workspace_id,
        payload.category,
        payload.route,
        payload.digest,
        payload.component or "unknown",
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def set_session_cookie(response: Response, token: str, *, ttl_hours: int | None = None) -> None:
    lifetime = ttl_hours if ttl_hours is not None else settings.auth_session_ttl_hours
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=lifetime * 3600,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        settings.session_cookie_name,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        path="/",
    )


def enforce_auth_rate_limit(request: Request, db: Session, action: str, identity: str) -> None:
    client_host = request.client.host if request.client else "unknown"
    fingerprint = sha256(f"{action}\0{client_host}\0{identity.strip().lower()}".encode()).hexdigest()
    cutoff = now_utc() - timedelta(seconds=settings.auth_rate_limit_window_seconds)
    db.execute(delete(AuthAttemptRow).where(AuthAttemptRow.created_at < cutoff))
    attempts = (
        db.scalar(
            select(func.count(AuthAttemptRow.id)).where(
                AuthAttemptRow.fingerprint == fingerprint,
                AuthAttemptRow.created_at >= cutoff,
            )
        )
        or 0
    )
    if attempts >= settings.auth_rate_limit_attempts:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication attempts. Wait briefly and try again.",
            headers={"Retry-After": str(settings.auth_rate_limit_window_seconds)},
        )
    db.add(AuthAttemptRow(fingerprint=fingerprint))
    db.commit()


def account_workspace(db: Session, account_id: str) -> WorkspaceRow | None:
    return db.scalar(select(WorkspaceRow).where(WorkspaceRow.owner_account_id == account_id))


def is_guest_account(account: AccountRow | None) -> bool:
    return account is not None and account.id != settings.local_account_id and account.email is None


def active_workspace(db: Session, token: str | None) -> WorkspaceRow:
    """Prefer an authenticated session's workspace; fall back to the local personal workspace."""
    if token:
        account = resolve_session(token, db)
        if account is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Your session is invalid or has expired. Sign in again.",
            )
        workspace = account_workspace(db, account.id)
        if workspace is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account does not have an accessible workspace.",
            )
        return workspace
    if settings.hosted_mode:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in or create a private workspace to use the hosted application.",
        )
    workspace = db.get(WorkspaceRow, settings.local_workspace_id)
    if workspace is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Personal workspace is not initialized",
        )
    return workspace


def active_workspace_id(db: Session, token: str | None) -> str:
    return active_workspace(db, token).id


def authenticated_private_workspace(db: Session, token: str | None) -> WorkspaceRow:
    """Resolve a signed-in user's isolated workspace for private credentials."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in or create a private workspace before connecting a provider key.",
        )
    account = resolve_session(token, db)
    if is_guest_account(account):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Create or sign in to a permanent workspace before connecting a provider key.",
        )
    workspace = active_workspace(db, token)
    if workspace.id == settings.local_workspace_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Provider keys cannot be stored in the shared local workspace.",
        )
    return workspace


def provider_for(db: Session, workspace_id: str | None, model_id: str | None) -> ExtractionProvider:
    provider_name = model_id.split("/", 1)[0] if model_id and "/" in model_id else None
    private_workspace = workspace_id is not None and workspace_id != settings.local_workspace_id
    if provider_name in {"openai", "openrouter", "custom"} and not private_workspace:
        raise ValueError("Sign in to a private workspace before using a hosted model")
    if private_workspace and provider_name in {"openai", "openrouter", "custom"}:
        configuration = get_provider_config(db, workspace_id, provider_name)
        if configuration is None:
            raise ValueError("Connect this hosted provider before using its model")
        selected_model = model_id.split("/", 1)[1]
        if configuration.get("selected_model") != selected_model:
            raise ValueError("Select this hosted model in Account & keys before using it")
        if provider_name == "openai":
            return OpenAIResponsesProvider(
                settings.model_copy(
                    update={
                        "openai_api_key": str(configuration["key"]),
                        "openai_model": selected_model,
                    }
                )
            )
        base_url = validate_provider_base_url(
            str(configuration["base_url"]),
            provider=provider_name,
            settings=settings,
        )
        return OpenAICompatibleProvider(
            provider_name,
            selected_model,
            str(configuration["key"]),
            base_url,
        )
    byok_key = get_provider_key(db, workspace_id, "openai") if private_workspace else None
    return get_provider(settings, model_id, byok_key=byok_key)


@app.get("/healthz", response_model=HealthRead)
def health() -> HealthRead:
    return HealthRead(status="ok", service=settings.app_name)


@app.get("/readyz", response_model=HealthRead)
def readiness(db: Db) -> HealthRead:
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database is not ready") from exc
    if settings.artifact_storage == "filesystem" and (
        not settings.artifact_dir.exists() or not settings.artifact_dir.is_dir()
    ):
        raise HTTPException(status_code=503, detail="Artifact storage is not ready")
    return HealthRead(status="ready", service=settings.app_name)


def record_product_event(
    db: Session,
    workspace_id: str,
    event_type: str,
    *,
    decision_id: str | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        ProductEventRow(
            workspace_id=workspace_id,
            decision_id=decision_id,
            event_type=event_type,
            details=details or {},
        )
    )


def model_catalog(db: Session, workspace: WorkspaceRow | None) -> ModelCatalogRead:
    account = db.get(AccountRow, workspace.owner_account_id) if workspace is not None else None
    models = (
        available_models(settings.model_copy(update={"ai_provider": "deterministic"}))
        if workspace is None or is_guest_account(account)
        else available_models(settings)
    )
    if workspace is not None and workspace.id == settings.local_workspace_id:
        models = [model for model in models if model.location != "hosted"]
    ollama_installed, ollama_error = _ollama_model_status()
    models = [
        model.model_copy(
            update={
                "available": ollama_error is None and model.model in ollama_installed,
                "availability_reason": (
                    ollama_error
                    if ollama_error is not None
                    else None
                    if model.model in ollama_installed
                    else f"Not installed. Run `ollama pull {model.model}`."
                ),
            }
        )
        if model.provider == "ollama"
        else model
        for model in models
    ]
    existing_ids = {model.id for model in models}
    private_entries = (
        []
        if workspace is None or workspace.id == settings.local_workspace_id or is_guest_account(account)
        else db.scalars(select(SecretRow).where(SecretRow.workspace_id == workspace.id)).all()
    )
    for entry in private_entries:
        configuration = get_provider_config(db, workspace.id, entry.provider)
        selected_model = configuration.get("selected_model") if configuration else None
        if not selected_model:
            continue
        model_id = f"{entry.provider}/{selected_model}"
        if model_id in existing_ids:
            continue
        models.append(
            ModelOption(
                id=model_id,
                provider=entry.provider,
                model=selected_model,
                label=f"{selected_model} · {configuration.get('label', entry.provider)}",
                location="hosted",
                best_for="Hosted extraction, revisit, and challenge using your encrypted workspace key",
            )
        )
        existing_ids.add(model_id)
    configured_default = default_model_id(settings)
    available_default = next((model.id for model in models if model.available), configured_default)
    return ModelCatalogRead(default_model_id=available_default, models=models)


@app.get("/v1/models", response_model=ModelCatalogRead)
def list_models(request: Request, db: Db) -> ModelCatalogRead:
    token = extract_session_token(request)
    workspace = None if settings.hosted_mode and token is None else active_workspace(db, token)
    return model_catalog(db, workspace)


def _ollama_model_status() -> tuple[set[str], str | None]:
    if settings.ai_provider.lower() != "ollama":
        return set(), None
    cache_key = (settings.ollama_base_url, settings.ollama_models)
    now = monotonic()
    with _cache_lock:
        cached = _ollama_status_cache.get(cache_key)
        if cached and cached[0] > now:
            return set(cached[1]), cached[2]
    try:
        response = httpx.get(
            f"{settings.ollama_base_url.rstrip('/')}/api/tags",
            timeout=settings.ollama_status_timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        result = (set(), f"Ollama is unavailable: {exc}")
        with _cache_lock:
            _ollama_status_cache[cache_key] = (now + settings.ollama_status_cache_seconds, *result)
        return result
    entries = payload.get("models", []) if isinstance(payload, dict) else []
    installed = {
        str(entry.get("model") or entry.get("name") or "").strip() for entry in entries if isinstance(entry, dict)
    }
    result = ({model for model in installed if model}, None)
    with _cache_lock:
        _ollama_status_cache[cache_key] = (now + settings.ollama_status_cache_seconds, *result)
    return result


@app.get("/v1/workspace", response_model=WorkspaceRead)
def get_workspace(request: Request, db: Db) -> WorkspaceRead:
    workspace = active_workspace(db, extract_session_token(request))
    account = db.get(AccountRow, workspace.owner_account_id)
    if account is None:
        raise HTTPException(status_code=503, detail="Personal workspace is not initialized")
    return workspace_read(workspace, account)


def workspace_read(workspace: WorkspaceRow, account: AccountRow) -> WorkspaceRead:
    mode = (
        "local_personal"
        if workspace.id == settings.local_workspace_id
        else "guest_personal"
        if is_guest_account(account)
        else "authenticated_personal"
    )
    return WorkspaceRead(
        id=workspace.id,
        name=workspace.name,
        account_id=account.id,
        account_name=account.name,
        mode=mode,
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


@app.get("/v1/usage", response_model=UsageSummaryRead)
def usage_summary(route: Request, db: Db) -> UsageSummaryRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    return build_usage_summary(db, workspace_id)


@app.get("/v1/pilot/metrics", response_model=PilotMetricsRead)
def pilot_metrics(route: Request, db: Db) -> PilotMetricsRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    return build_pilot_metrics(db, workspace_id)


@app.get("/v1/usage-dashboard", response_model=UsageDashboardRead)
def usage_dashboard(route: Request, db: Db) -> UsageDashboardRead:
    """Load usage and pilot signals in one serverless round trip."""
    return UsageDashboardRead(usage=usage_summary(route, db), pilot_metrics=pilot_metrics(route, db))


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
        if settings.artifact_storage == "database":
            digest = sha256(content).hexdigest()
            storage_uri = f"database://artifacts/{digest}"
        else:
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
        binary_content=content if settings.artifact_storage == "database" else None,
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
            job_manager.update(
                job_id,
                _workspace_filter_key(workspace_id),
                phase="Running model extraction",
                progress=35,
            )
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
    if job_id and job_manager.is_cancelled(job_id, _workspace_filter_key(workspace_id)):
        return None
    if job_id:
        job_manager.update(
            job_id,
            _workspace_filter_key(workspace_id),
            phase="Validating and saving premises",
            progress=85,
        )
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
            job_manager.update(
                job_id,
                _workspace_filter_key(workspace_id),
                phase="Challenging preserved premises",
                progress=35,
            )
        started_at = perf_counter()
        suggestions = provider.challenge(premises)
        latency_ms = max(0, round((perf_counter() - started_at) * 1000))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if job_id and job_manager.is_cancelled(job_id, _workspace_filter_key(workspace_id)):
        return None
    if job_id:
        job_manager.update(
            job_id,
            _workspace_filter_key(workspace_id),
            phase="Validating source grounding",
            progress=85,
        )

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
    if challenge is None:
        raise HTTPException(status_code=500, detail="Challenge generation ended without a result")
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
    premise_ids = [pid for pid in db.scalars(select(PremiseRow.id).where(PremiseRow.decision_id == decision_id)).all()]
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


def cleanup_expired_guest_workspaces(db: Session, *, limit: int = 20) -> GuestCleanupRead:
    cutoff = now_utc() - timedelta(hours=settings.guest_workspace_ttl_hours)
    expired = db.scalars(
        select(AccountRow)
        .where(
            AccountRow.id != settings.local_account_id,
            AccountRow.email.is_(None),
            AccountRow.created_at < cutoff,
        )
        .order_by(AccountRow.created_at.asc())
        .limit(max(1, min(limit, 1000)))
    ).all()
    artifact_files: list[Path] = []
    for account in expired:
        workspace = account_workspace(db, account.id)
        if workspace is not None:
            artifact_files.extend(delete_private_account_data(db, account, workspace))
    if expired:
        db.commit()
    artifact_files_deleted = 0
    artifact_file_errors = 0
    for artifact_file in artifact_files:
        try:
            existed = artifact_file.exists()
            artifact_file.unlink(missing_ok=True)
            if existed:
                artifact_files_deleted += 1
        except OSError:
            artifact_file_errors += 1
    return GuestCleanupRead(
        guest_workspaces_deleted=len(expired),
        artifact_files_deleted=artifact_files_deleted,
        artifact_file_errors=artifact_file_errors,
        cutoff=cutoff,
    )


@app.get("/v1/maintenance/cleanup-guests", response_model=GuestCleanupRead)
def scheduled_guest_cleanup(route: Request, db: Db) -> GuestCleanupRead:
    """Delete expired temporary workspaces when invoked by the deployment scheduler."""
    expected = settings.cron_secret
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Scheduled cleanup is not configured",
        )
    supplied = route.headers.get("authorization", "")
    if not compare_digest(supplied, f"Bearer {expected}"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid maintenance credential")
    result = cleanup_expired_guest_workspaces(db, limit=settings.guest_cleanup_batch_size)
    logger.info(
        "guest_cleanup_complete deleted=%s artifact_files_deleted=%s artifact_file_errors=%s cutoff=%s",
        result.guest_workspaces_deleted,
        result.artifact_files_deleted,
        result.artifact_file_errors,
        result.cutoff.isoformat(),
    )
    return result


def create_guest_workspace(response: Response, db: Session) -> WorkspaceRow:
    cleanup_expired_guest_workspaces(db)
    account = AccountRow(name="Guest reviewer")
    db.add(account)
    db.flush()
    workspace = WorkspaceRow(owner_account_id=account.id, name="Guest workspace")
    db.add(workspace)
    db.commit()
    db.refresh(workspace)
    _, token = issue_session(db, account.id, ttl_hours=settings.guest_workspace_ttl_hours)
    set_session_cookie(response, token, ttl_hours=settings.guest_workspace_ttl_hours)
    return workspace


@app.get("/v1/bootstrap", response_model=WorkspaceBootstrapRead)
def workspace_bootstrap(route: Request, response: Response, db: Db) -> WorkspaceBootstrapRead:
    """Load the initial workspace in one serverless round trip."""
    token = extract_session_token(route)
    if settings.hosted_mode and resolve_session(token, db) is None:
        workspace = create_guest_workspace(response, db)
        account = db.get(AccountRow, workspace.owner_account_id)
        if account is None:
            raise HTTPException(status_code=503, detail="Guest workspace could not be initialized")
        return WorkspaceBootstrapRead(
            models=model_catalog(db, workspace),
            workspace=workspace_read(workspace, account),
            library=DecisionListRead(items=[], total=0),
            guest=True,
        )
    workspace = active_workspace(db, token)
    account = db.get(AccountRow, workspace.owner_account_id)
    if account is None:
        raise HTTPException(status_code=503, detail="Workspace account is unavailable")
    return WorkspaceBootstrapRead(
        models=model_catalog(db, workspace),
        workspace=workspace_read(workspace, account),
        library=list_decisions(route, db),
        guest=is_guest_account(account),
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


@app.get("/v1/decisions/{decision_id}/workspace", response_model=DecisionWorkspaceRead)
def decision_workspace(route: Request, decision_id: str, db: Db) -> DecisionWorkspaceRead:
    """Load a decision conversation, its revisits, and shares together."""
    workspace_id = active_workspace_id(db, extract_session_token(route))
    decision = workspace_decision(db, decision_id, workspace_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    revisits = db.scalars(
        select(RevisitRow)
        .where(RevisitRow.decision_id == decision_id)
        .order_by(RevisitRow.created_at.desc(), RevisitRow.id.desc())
    ).all()
    shares = db.scalars(
        select(DecisionShareRow)
        .where(DecisionShareRow.decision_id == decision_id)
        .order_by(DecisionShareRow.created_at.desc())
    ).all()
    return DecisionWorkspaceRead(
        decision=decision_read(decision),
        revisits=[revisit_read(row) for row in revisits],
        shares=[share_read(row, settings.public_base_url) for row in shares],
    )


@app.delete("/v1/decisions/{decision_id}/shares/{share_id}", response_model=ShareRead)
def revoke_share(route: Request, decision_id: str, share_id: str, db: Db) -> ShareRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    if workspace_decision(db, decision_id, workspace_id) is None:
        raise HTTPException(status_code=404, detail="Shared decision link not found")
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
def delete_share_record(route: Request, decision_id: str, share_id: str, db: Db) -> Response:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    if workspace_decision(db, decision_id, workspace_id) is None:
        raise HTTPException(status_code=404, detail="Shared decision link not found")
    share = db.get(DecisionShareRow, share_id)
    if share is None or share.decision_id != decision_id:
        raise HTTPException(status_code=404, detail="Shared decision link not found")
    if share.status == "active" and not is_expired(share):
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
            job_manager.update(
                job_id,
                _workspace_filter_key(workspace_id),
                phase="Comparing evidence with premises",
                progress=35,
            )
        started_at = perf_counter()
        findings = provider.revisit(premises, evidence.extracted_text, decision.criticality)
        latency_ms = max(0, round((perf_counter() - started_at) * 1000))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if job_id and job_manager.is_cancelled(job_id, _workspace_filter_key(workspace_id)):
        return None
    if job_id:
        job_manager.update(
            job_id,
            _workspace_filter_key(workspace_id),
            phase="Validating and saving findings",
            progress=85,
        )
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

    return JobRead.model_validate(
        job_manager.create(
            workspace_id,
            "extraction",
            worker,
            execution_mode=settings.job_execution_mode,
        )
    )


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

    return JobRead.model_validate(
        job_manager.create(
            workspace_id,
            "revisit",
            worker,
            execution_mode=settings.job_execution_mode,
        )
    )


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

    return JobRead.model_validate(
        job_manager.create(
            workspace_id,
            "challenge",
            worker,
            execution_mode=settings.job_execution_mode,
        )
    )


@app.get("/v1/jobs/{job_id}", response_model=JobRead)
def get_job(route: Request, job_id: str, db: Db) -> JobRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    try:
        return JobRead.model_validate(job_manager.get(job_id, workspace_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@app.delete("/v1/jobs/{job_id}", response_model=JobRead)
def cancel_job(route: Request, job_id: str, response: Response, db: Db) -> JobRead:
    workspace_id = active_workspace_id(db, extract_session_token(route))
    try:
        job = job_manager.cancel(job_id, workspace_id)
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
def create_account(payload: CredentialCreate, request: Request, db: Db) -> AccountRead:
    enforce_auth_rate_limit(request, db, "register", payload.email)
    return account_read(_create_account(payload, db))


def _create_account(payload: CredentialCreate, db: Session) -> AccountRow:
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
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        ) from exc
    db.refresh(account)
    return account


def _upgrade_guest_account(payload: CredentialCreate, account: AccountRow, db: Session) -> AccountRow:
    email = payload.email.strip().lower()
    if find_account_by_email(email, db) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")
    account.name = payload.name.strip() or email
    account.email = email
    account.password_hash, account.password_salt, account.password_iterations = hash_password(
        payload.password,
        settings.pbkdf2_iterations,
    )
    workspace = account_workspace(db, account.id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Guest workspace not found")
    workspace.name = f"{account.name}'s workspace"
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        ) from exc
    db.refresh(account)
    return account


def session_read(account: AccountRow, session: SessionRow, token: str) -> SessionRead:
    return SessionRead(
        account_id=account.id,
        account_name=account.name,
        email=account.email or "",
        session_token=token,
        created_at=as_utc(session.created_at),
        expires_at=as_utc(session.expires_at),
    )


def authenticated_account(request: Request, db: Session) -> AccountRow:
    account = resolve_session(extract_session_token(request), db)
    if account is None or is_guest_account(account):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return account


def revoke_account_sessions(db: Session, account_id: str, *, except_token: str | None = None) -> int:
    sessions = db.scalars(
        select(SessionRow).where(SessionRow.account_id == account_id, SessionRow.revoked_at.is_(None))
    ).all()
    revoked = 0
    except_hash = session_token_hash(except_token) if except_token else None
    for session in sessions:
        if except_token and session.token in {except_token, except_hash}:
            continue
        session.revoked_at = now_utc()
        revoked += 1
    return revoked


@app.post("/v1/auth/register", response_model=SessionRead, status_code=status.HTTP_201_CREATED)
def register(payload: CredentialCreate, request: Request, response: Response, db: Db) -> SessionRead:
    enforce_auth_rate_limit(request, db, "register", payload.email)
    guest = resolve_session(extract_session_token(request), db)
    account = _upgrade_guest_account(payload, guest, db) if is_guest_account(guest) else _create_account(payload, db)
    revoke_account_sessions(db, account.id)
    db.commit()
    session, token = issue_session(db, account.id)
    set_session_cookie(response, token)
    return session_read(account, session, token)


@app.get("/v1/account", response_model=AccountRead)
def whoami(request: Request, db: Db) -> AccountRead:
    return account_read(authenticated_account(request, db))


@app.patch("/v1/account", response_model=AccountRead)
def update_account(payload: AccountUpdateRequest, request: Request, db: Db) -> AccountRead:
    account = authenticated_account(request, db)
    account.name = payload.name.strip()
    workspace = account_workspace(db, account.id)
    if workspace is not None and workspace.name.endswith("'s workspace"):
        workspace.name = f"{account.name}'s workspace"
    db.commit()
    db.refresh(account)
    return account_read(account)


def delete_private_account_data(db: Session, account: AccountRow, workspace: WorkspaceRow) -> list[Path]:
    """Delete an account-owned workspace in dependency order and return unreferenced artifact files."""
    decision_ids = list(db.scalars(select(DecisionRow.id).where(DecisionRow.workspace_id == workspace.id)).all())
    premise_ids = (
        list(db.scalars(select(PremiseRow.id).where(PremiseRow.decision_id.in_(decision_ids))).all())
        if decision_ids
        else []
    )
    artifact_rows = list(db.scalars(select(ArtifactRow).where(ArtifactRow.workspace_id == workspace.id)).all())
    artifact_locations = {
        row.storage_uri for row in artifact_rows if row.storage_uri and not row.storage_uri.startswith("database://")
    }

    if premise_ids:
        db.execute(delete(SourceAnchorRow).where(SourceAnchorRow.premise_id.in_(premise_ids)))
    if decision_ids:
        db.execute(delete(PremiseRow).where(PremiseRow.decision_id.in_(decision_ids)))
        db.execute(delete(RevisitRow).where(RevisitRow.decision_id.in_(decision_ids)))
        db.execute(delete(DecisionShareRow).where(DecisionShareRow.decision_id.in_(decision_ids)))
        db.execute(delete(DecisionRow).where(DecisionRow.id.in_(decision_ids)))
    db.execute(delete(ExtractionRow).where(ExtractionRow.workspace_id == workspace.id))
    db.execute(delete(JobRow).where(JobRow.workspace_id == workspace.id))
    db.execute(delete(ProductEventRow).where(ProductEventRow.workspace_id == workspace.id))
    db.execute(delete(SecretRow).where(SecretRow.workspace_id == workspace.id))
    db.execute(delete(ArtifactRow).where(ArtifactRow.workspace_id == workspace.id))
    db.execute(delete(WorkspaceRow).where(WorkspaceRow.id == workspace.id))
    db.execute(delete(PasswordResetRow).where(PasswordResetRow.account_id == account.id))
    db.execute(delete(SessionRow).where(SessionRow.account_id == account.id))
    db.execute(delete(AccountRow).where(AccountRow.id == account.id))
    db.flush()

    still_referenced = set()
    if artifact_locations:
        still_referenced = set(
            db.scalars(select(ArtifactRow.storage_uri).where(ArtifactRow.storage_uri.in_(artifact_locations))).all()
        )
    return [Path(location) for location in artifact_locations - still_referenced]


@app.delete("/v1/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(payload: AccountDeleteRequest, request: Request, response: Response, db: Db) -> Response:
    account = authenticated_account(request, db)
    if account.id == settings.local_account_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The bootstrap local account cannot be deleted",
        )
    if (
        account.password_hash is None
        or account.password_salt is None
        or not verify_password(
            payload.password,
            account.password_hash,
            account.password_salt,
            account.password_iterations or settings.pbkdf2_iterations,
        )
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    workspace = account_workspace(db, account.id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    artifact_files = delete_private_account_data(db, account, workspace)
    db.commit()
    for artifact_file in artifact_files:
        try:
            artifact_file.unlink(missing_ok=True)
        except OSError:
            pass
    clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@app.patch("/v1/workspace", response_model=WorkspaceRead)
def update_workspace(payload: WorkspaceUpdateRequest, request: Request, db: Db) -> WorkspaceRead:
    token = extract_session_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to rename a pilot workspace")
    account = authenticated_account(request, db)
    workspace = account_workspace(db, account.id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    workspace.name = payload.name.strip()
    db.commit()
    db.refresh(workspace)
    return WorkspaceRead(
        id=workspace.id,
        name=workspace.name,
        account_id=account.id,
        account_name=account.name,
        mode="authenticated_personal",
        created_at=as_utc(workspace.created_at),
    )


@app.post("/v1/auth/login", response_model=SessionRead)
def login(payload: SessionRequest, request: Request, response: Response, db: Db) -> SessionRead:
    enforce_auth_rate_limit(request, db, "login", payload.email)
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
    guest = resolve_session(extract_session_token(request), db)
    if is_guest_account(guest) and guest.id != account.id:
        guest_workspace = account_workspace(db, guest.id)
        if guest_workspace is not None:
            artifact_files = delete_private_account_data(db, guest, guest_workspace)
            db.commit()
            for artifact_file in artifact_files:
                try:
                    artifact_file.unlink(missing_ok=True)
                except OSError:
                    pass
    session, token = issue_session(db, account.id)
    set_session_cookie(response, token)
    return session_read(account, session, token)


@app.post("/v1/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Db) -> Response:
    revoke_session(extract_session_token(request), db)
    clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@app.get("/v1/auth/sessions", response_model=list[SessionSummaryRead])
def list_sessions(request: Request, db: Db) -> list[SessionSummaryRead]:
    account = authenticated_account(request, db)
    current_token = extract_session_token(request)
    current_hash = session_token_hash(current_token) if current_token else None
    rows = db.scalars(
        select(SessionRow)
        .where(
            SessionRow.account_id == account.id,
            SessionRow.revoked_at.is_(None),
            SessionRow.expires_at > now_utc(),
        )
        .order_by(SessionRow.created_at.desc())
    ).all()
    return [
        SessionSummaryRead(
            id=row.id,
            created_at=as_utc(row.created_at),
            expires_at=as_utc(row.expires_at),
            current=row.token in {current_token, current_hash},
        )
        for row in rows
    ]


@app.delete("/v1/auth/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str, request: Request, db: Db) -> Response:
    account = authenticated_account(request, db)
    row = db.scalar(select(SessionRow).where(SessionRow.id == session_id, SessionRow.account_id == account.id))
    if row is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if row.revoked_at is None:
        row.revoked_at = now_utc()
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/v1/auth/logout-others", status_code=status.HTTP_204_NO_CONTENT)
def logout_other_sessions(request: Request, db: Db) -> Response:
    account = authenticated_account(request, db)
    revoke_account_sessions(db, account.id, except_token=extract_session_token(request))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/v1/auth/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(payload: PasswordChangeRequest, request: Request, db: Db) -> Response:
    account = authenticated_account(request, db)
    if (
        account.password_hash is None
        or account.password_salt is None
        or not verify_password(
            payload.current_password,
            account.password_hash,
            account.password_salt,
            account.password_iterations or settings.pbkdf2_iterations,
        )
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    account.password_hash, account.password_salt, account.password_iterations = hash_password(
        payload.new_password,
        settings.pbkdf2_iterations,
    )
    revoke_account_sessions(db, account.id, except_token=extract_session_token(request))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/v1/auth/password-reset/request", response_model=PasswordResetRequestRead)
def request_password_reset(
    payload: PasswordResetRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Db,
) -> PasswordResetRequestRead:
    enforce_auth_rate_limit(request, db, "password-reset", payload.email)
    generic_message = "If that account exists, a password reset link has been prepared."
    account = find_account_by_email(payload.email, db)
    if account is None or account.email is None:
        return PasswordResetRequestRead(message=generic_message)
    now = now_utc()
    for previous in db.scalars(
        select(PasswordResetRow).where(
            PasswordResetRow.account_id == account.id,
            PasswordResetRow.used_at.is_(None),
        )
    ).all():
        previous.used_at = now
    token = token_urlsafe(32)
    db.add(
        PasswordResetRow(
            account_id=account.id,
            token_hash=sha256(token.encode("utf-8")).hexdigest(),
            expires_at=now + timedelta(minutes=settings.password_reset_ttl_minutes),
        )
    )
    db.commit()
    development_token = token if settings.password_reset_dev_mode else None
    if not settings.password_reset_dev_mode and settings.smtp_host and settings.smtp_from_email:
        background_tasks.add_task(send_password_reset_email, settings, account.email, token)
    return PasswordResetRequestRead(message=generic_message, development_token=development_token)


@app.post("/v1/auth/password-reset/confirm", response_model=SessionRead)
def confirm_password_reset(
    payload: PasswordResetConfirmRequest,
    request: Request,
    response: Response,
    db: Db,
) -> SessionRead:
    enforce_auth_rate_limit(request, db, "password-reset-confirm", payload.token[:12])
    token_hash = sha256(payload.token.encode("utf-8")).hexdigest()
    row = db.scalar(select(PasswordResetRow).where(PasswordResetRow.token_hash == token_hash))
    if row is None or row.used_at is not None or as_utc(row.expires_at) <= now_utc():
        raise HTTPException(status_code=400, detail="This password reset link is invalid or has expired")
    account = db.get(AccountRow, row.account_id)
    if account is None:
        raise HTTPException(status_code=400, detail="This password reset link is invalid or has expired")
    account.password_hash, account.password_salt, account.password_iterations = hash_password(
        payload.new_password,
        settings.pbkdf2_iterations,
    )
    row.used_at = now_utc()
    revoke_account_sessions(db, account.id)
    db.commit()
    session, token = issue_session(db, account.id)
    set_session_cookie(response, token)
    return session_read(account, session, token)


@app.get("/v1/secrets", response_model=list[SecretRead])
def list_provider_secrets(request: Request, db: Db) -> list[SecretRead]:
    workspace = authenticated_private_workspace(db, extract_session_token(request))
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


def _fetch_provider_model_ids(provider: str, configuration: dict) -> list[str]:
    try:
        base_url = validate_provider_base_url(
            str(configuration["base_url"]),
            provider=provider,
            settings=settings,
        )
        response = httpx.get(
            f"{base_url}/models",
            headers={"Authorization": f"Bearer {configuration['key']}"},
            timeout=20,
            follow_redirects=False,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise ValueError(f"Could not load models from this provider: {exc}") from exc
    entries = payload.get("data", []) if isinstance(payload, dict) else []
    models = sorted(
        {str(entry.get("id", "")).strip() for entry in entries if isinstance(entry, dict) and entry.get("id")}
    )
    if not models:
        raise ValueError("The provider returned no callable models")
    return models


def _cached_provider_model_ids(provider: str, configuration: dict, *, force: bool = False) -> list[str]:
    fingerprint = sha256(f"{configuration.get('base_url', '')}\0{configuration.get('key', '')}".encode()).hexdigest()
    now = monotonic()
    if not force:
        with _cache_lock:
            cached = _provider_model_cache.get(fingerprint)
            if cached and cached[0] > now:
                return list(cached[1])
    models = _fetch_provider_model_ids(provider, configuration)
    with _cache_lock:
        if len(_provider_model_cache) >= 64:
            expired = [key for key, value in _provider_model_cache.items() if value[0] <= now]
            for key in expired:
                _provider_model_cache.pop(key, None)
            if len(_provider_model_cache) >= 64:
                _provider_model_cache.pop(next(iter(_provider_model_cache)))
        _provider_model_cache[fingerprint] = (now + settings.provider_model_cache_seconds, tuple(models))
    return models


@app.get("/v1/secrets/{provider}/models")
def list_provider_models(route: Request, provider: str, db: Db) -> dict[str, list[str]]:
    workspace = authenticated_private_workspace(db, extract_session_token(route))
    configuration = get_provider_config(db, workspace.id, provider)
    if configuration is None:
        raise HTTPException(status_code=404, detail="Connect this provider before loading its models")
    try:
        return {"models": _cached_provider_model_ids(provider, configuration)}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@app.post("/v1/secrets/{provider}/test", response_model=SecretConnectionTestRead)
def test_provider_connection(route: Request, provider: str, db: Db) -> SecretConnectionTestRead:
    workspace = authenticated_private_workspace(db, extract_session_token(route))
    configuration = get_provider_config(db, workspace.id, provider)
    if configuration is None:
        raise HTTPException(status_code=404, detail="Connect this provider before testing it")
    started_at = perf_counter()
    try:
        models = _cached_provider_model_ids(provider, configuration, force=True)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return SecretConnectionTestRead(
        provider=provider,
        model_count=len(models),
        latency_ms=max(0, round((perf_counter() - started_at) * 1000)),
    )


@app.post("/v1/secrets/{provider}/model", response_model=SecretRead)
def choose_provider_model(route: Request, provider: str, payload: SecretModelSelectRequest, db: Db) -> SecretRead:
    workspace = authenticated_private_workspace(db, extract_session_token(route))
    configuration = get_provider_config(db, workspace.id, provider)
    if configuration is None:
        raise HTTPException(status_code=404, detail="Connect this provider before selecting its model")
    try:
        available = _cached_provider_model_ids(provider, configuration)
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
    workspace = authenticated_private_workspace(db, extract_session_token(route))
    try:
        row = store_provider_key(db, workspace.id, payload.provider, payload.key, base_url=payload.base_url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return _secret_read(db, workspace.id, row)


@app.delete("/v1/secrets/{provider}", response_model=SecretRead)
def remove_provider_secret(route: Request, provider: str, db: Db) -> SecretRead:
    workspace = authenticated_private_workspace(db, extract_session_token(route))
    if delete_provider_key(db, workspace.id, provider):
        return SecretRead(provider=provider, configured=False, source="workspace_store")
    raise HTTPException(status_code=404, detail="No stored secret for this provider")


@app.get("/v1/account-settings", response_model=AccountSettingsRead)
def account_settings(route: Request, db: Db) -> AccountSettingsRead:
    """Load account, workspace, sessions, and provider status together."""
    token = extract_session_token(route)
    workspace = active_workspace(db, token)
    account = db.get(AccountRow, workspace.owner_account_id)
    if account is None:
        raise HTTPException(status_code=503, detail="Workspace account is unavailable")
    authenticated = not is_guest_account(account) and account.email is not None
    return AccountSettingsRead(
        authenticated=authenticated,
        account=account_read(account),
        workspace=workspace_read(workspace, account),
        sessions=list_sessions(route, db) if authenticated else [],
        secrets=list_provider_secrets(route, db) if authenticated else [],
    )
