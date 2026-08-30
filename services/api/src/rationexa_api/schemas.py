from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PASSWORD_LENGTH_MIN = 8
PASSWORD_LENGTH_MAX = 128


class PremiseKind(StrEnum):
    REQUIREMENT = "requirement"
    HARD_CONSTRAINT = "hard_constraint"
    SOFT_CONSTRAINT = "soft_constraint"
    FACT = "fact"
    ASSUMPTION = "assumption"
    UNKNOWN = "unknown"
    MATERIAL_CLAIM = "material_claim"
    REVISIT_CONDITION = "revisit_condition"


class Criticality(StrEnum):
    ROUTINE = "routine"
    IMPORTANT = "important"
    CRITICAL = "critical"


class Relationship(StrEnum):
    SUPPORTS = "supports"
    WEAKENS = "weakens"
    CONTRADICTS = "contradicts"
    SUPERSEDES = "supersedes"
    UNCLEAR = "unclear"
    INTRODUCES = "introduces"


class ArtifactCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    media_type: str = "text/plain"
    content: str = Field(min_length=1, max_length=2_000_000)
    source_type: str = "user_supplied"


class ArtifactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    media_type: str
    source_type: str
    sha256: str
    parser_version: str
    created_at: datetime


class ModelOption(BaseModel):
    id: str
    provider: str
    model: str
    label: str
    location: Literal["local", "hosted"]
    best_for: str
    available: bool = True
    availability_reason: str | None = None


class ModelCatalogRead(BaseModel):
    default_model_id: str
    models: list[ModelOption]


class ClientErrorReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_-]+$")
    route: str = Field(min_length=1, max_length=160)
    digest: str = Field(min_length=16, max_length=128, pattern=r"^[a-f0-9]+$")
    component: str | None = Field(default=None, max_length=80)


class WorkspaceRead(BaseModel):
    id: str
    name: str
    account_id: str
    account_name: str
    mode: Literal["local_personal", "authenticated_personal"] = "local_personal"
    created_at: datetime


class CredentialCreate(BaseModel):
    email: str = Field(min_length=1, max_length=255)
    name: str = Field(default="", max_length=120)
    password: str = Field(min_length=PASSWORD_LENGTH_MIN, max_length=PASSWORD_LENGTH_MAX)


class SessionRead(BaseModel):
    account_id: str
    account_name: str
    email: str
    session_token: str
    created_at: datetime
    expires_at: datetime


class SessionRequest(BaseModel):
    email: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=PASSWORD_LENGTH_MAX)


class SessionSummaryRead(BaseModel):
    id: str
    created_at: datetime
    expires_at: datetime
    current: bool


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=PASSWORD_LENGTH_MAX)
    new_password: str = Field(min_length=PASSWORD_LENGTH_MIN, max_length=PASSWORD_LENGTH_MAX)


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=1, max_length=255)


class PasswordResetRequestRead(BaseModel):
    accepted: bool = True
    message: str
    development_token: str | None = None


class PasswordResetConfirmRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    new_password: str = Field(min_length=PASSWORD_LENGTH_MIN, max_length=PASSWORD_LENGTH_MAX)


class AccountUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class AccountDeleteRequest(BaseModel):
    password: str = Field(min_length=1, max_length=PASSWORD_LENGTH_MAX)


class WorkspaceUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SecretRead(BaseModel):
    provider: str
    configured: bool
    label: str | None = None
    base_url: str | None = None
    selected_model: str | None = None
    protocol: str | None = None
    last_updated_at: datetime | None = None
    source: Literal["workspace_store", "server_environment"] = "workspace_store"


class SecretStoreRequest(BaseModel):
    provider: str = Field(pattern="^(openai|openrouter|custom)$")
    key: str = Field(min_length=1, max_length=500)
    base_url: str | None = Field(default=None, min_length=1, max_length=500)


class SecretModelSelectRequest(BaseModel):
    model: str = Field(min_length=1, max_length=240)


class SecretConnectionTestRead(BaseModel):
    provider: str
    ok: bool = True
    model_count: int
    latency_ms: int


class AccountRead(BaseModel):
    id: str
    name: str
    email: str | None
    has_password: bool
    created_at: datetime


class JobRead(BaseModel):
    id: str
    kind: Literal["extraction", "revisit", "challenge"]
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    phase: str
    progress: int = Field(ge=0, le=100)
    cancel_requested: bool
    result: dict | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class SourceAnchor(BaseModel):
    exact_excerpt: str
    start_offset: int = Field(ge=0)
    end_offset: int = Field(ge=0)
    page_number: int | None = Field(default=None, ge=1)


class CandidatePremise(BaseModel):
    candidate_id: str
    kind: PremiseKind
    statement: str = Field(min_length=1)
    qualifiers: str = ""
    importance: str = "normal"
    quality_state: str = "draft"
    claim_status: str = "not_applicable"
    attention_reason: str | None = None
    anchor: SourceAnchor | None = None


class ExtractionResult(BaseModel):
    title: str
    decision_question: str
    context: str = ""
    chosen_option: str | None = None
    rationale: str = ""
    suggested_criticality: Criticality = Criticality.IMPORTANT
    criticality_reason: str = "Defaulted to Important pending human review."
    premises: list[CandidatePremise]


class ExtractionRequest(BaseModel):
    artifact_id: str
    model_id: str | None = Field(default=None, min_length=1, max_length=160)


class ExtractionRead(BaseModel):
    id: str
    artifact_id: str
    status: str
    provider: str
    model: str
    prompt_version: str
    latency_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float | None = None
    result: ExtractionResult
    created_at: datetime


class PremiseReview(BaseModel):
    candidate_id: str
    action: str = Field(pattern="^(confirm|edit|reject|unknown)$")
    statement: str | None = None
    kind: PremiseKind | None = None


class ExtractionReviewRequest(BaseModel):
    reviews: list[PremiseReview]
    title: str | None = Field(default=None, min_length=1, max_length=255)
    decision_question: str | None = Field(default=None, min_length=1)
    context: str | None = None
    chosen_option: str | None = None
    rationale: str | None = None


class DecisionFinalizeRequest(BaseModel):
    criticality: Criticality = Criticality.IMPORTANT
    owner_name: str | None = None


class DecisionPremiseRead(BaseModel):
    id: str
    kind: PremiseKind
    statement: str
    qualifiers: str
    importance: str
    quality_state: str
    claim_status: str
    anchor: SourceAnchor | None


class ChallengeSuggestion(BaseModel):
    premise_id: str
    prompt: str = Field(min_length=1)
    explanation: str = Field(min_length=1)


class ChallengeSuggestionBatch(BaseModel):
    weakest_assumption: ChallengeSuggestion
    missing_evidence: ChallengeSuggestion
    strongest_counterargument: ChallengeSuggestion
    reversal_condition: ChallengeSuggestion


class ChallengePoint(BaseModel):
    premise_id: str
    premise_statement: str
    source_excerpt: str | None = None
    prompt: str
    explanation: str


class DecisionChallengeRead(BaseModel):
    status: Literal["draft", "confirmed"]
    weakest_assumption: ChallengePoint
    missing_evidence: ChallengePoint
    strongest_counterargument: ChallengePoint
    reversal_condition: ChallengePoint
    provider: str
    model: str
    prompt_version: str
    latency_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float | None = None
    generated_at: datetime
    confirmed_at: datetime | None = None
    reviewer_notes: str | None = None


class DecisionChallengeRequest(BaseModel):
    model_id: str | None = Field(default=None, min_length=1, max_length=160)


class DecisionChallengeConfirmRequest(BaseModel):
    notes: str | None = Field(default=None, max_length=4000)


class DecisionRead(BaseModel):
    id: str
    title: str
    question: str
    context: str
    chosen_option: str | None
    rationale: str
    criticality: Criticality
    preservation_policy: str
    status: str
    premises: list[DecisionPremiseRead]
    challenge: DecisionChallengeRead | None = None
    created_at: datetime


class DecisionListItem(BaseModel):
    id: str
    title: str
    question: str
    chosen_option: str | None
    criticality: Criticality
    status: str
    premise_count: int
    revisit_count: int
    pending_revisit_count: int
    last_revisited_at: datetime | None
    created_at: datetime


class DecisionListRead(BaseModel):
    items: list[DecisionListItem]
    total: int


class WorkspaceBootstrapRead(BaseModel):
    models: ModelCatalogRead
    workspace: WorkspaceRead | None
    library: DecisionListRead
    guest: bool = False


class UsageRunRead(BaseModel):
    id: str
    kind: Literal["extraction", "revisit", "challenge"]
    provider: str
    model: str
    prompt_version: str
    location: Literal["local", "hosted", "unknown"]
    latency_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float | None = None
    created_at: datetime
    decision_id: str | None = None


class UsageModelRead(BaseModel):
    provider: str
    model: str
    location: Literal["local", "hosted", "unknown"]
    run_count: int
    total_tokens: int
    known_cost_usd: float
    unpriced_run_count: int
    average_latency_ms: int | None = None


class UsageSummaryRead(BaseModel):
    total_runs: int
    extraction_runs: int
    revisit_runs: int
    challenge_runs: int
    local_runs: int
    hosted_runs: int
    unknown_location_runs: int
    total_tokens: int
    tokenized_run_count: int
    known_cost_usd: float
    unpriced_run_count: int
    models: list[UsageModelRead]
    recent_runs: list[UsageRunRead]


class PilotMetricsRead(BaseModel):
    decision_count: int
    revisit_count: int
    judgment_count: int
    share_count: int
    export_count: int
    challenge_confirmation_count: int
    active_days: int
    repeat_use_observed: bool
    latest_activity_at: datetime | None = None


class RevisitRequest(BaseModel):
    filename: str = "new-evidence.txt"
    content: str = Field(min_length=1, max_length=2_000_000)
    media_type: str = "text/plain"
    model_id: str | None = Field(default=None, min_length=1, max_length=160)


class RevisitFinding(BaseModel):
    premise_id: str
    premise_statement: str
    relationship: Relationship
    confidence_band: str
    explanation: str
    missing_context_question: str | None = None
    old_excerpt: str | None = None
    new_excerpt: str
    source_fallback_performed: bool
    finding_type: Literal["premise_change", "new_constraint"] = "premise_change"
    detection_source: Literal["model", "deterministic_rules", "deterministic_safety_net"] = "model"
    human_judgment: Literal["worth_reviewing", "not_material", "needs_context", "false_positive"] | None = None
    human_notes: str | None = None
    judged_at: datetime | None = None


class RevisitFindingJudgmentRequest(BaseModel):
    judgment: Literal["worth_reviewing", "not_material", "needs_context", "false_positive"]
    notes: str | None = Field(default=None, max_length=4000)


class RevisitPremiseInput(BaseModel):
    premise_id: str
    kind: PremiseKind
    statement: str
    old_excerpt: str | None = None


class RevisitAssessment(BaseModel):
    premise_id: str
    relevant: bool
    relationship: Relationship
    confidence_band: Literal["low", "medium", "high"]
    explanation: str
    new_excerpt: str
    missing_context_question: str | None = None


class RevisitAssessmentBatch(BaseModel):
    findings: list[RevisitAssessment]


class RevisitRead(BaseModel):
    id: str
    decision_id: str
    status: str
    findings: list[RevisitFinding]
    provider: str | None = None
    model: str | None = None
    prompt_version: str | None = None
    latency_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float | None = None
    evidence_filename: str | None = None
    created_at: datetime


class HealthRead(BaseModel):
    status: str
    service: str


class ShareCreate(BaseModel):
    expires_at: datetime | None = None


class ShareRead(BaseModel):
    id: str
    decision_id: str
    token: str
    status: str
    url: str | None
    created_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class ShareDecisionRead(BaseModel):
    id: str
    title: str
    question: str
    context: str
    chosen_option: str | None
    rationale: str
    criticality: Criticality
    preservation_policy: str
    status: str
    premises: list[DecisionPremiseRead]
    revisits: list[RevisitRead]
    shared_at: datetime
