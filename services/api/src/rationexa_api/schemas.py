from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


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


class ExtractionRead(BaseModel):
    id: str
    artifact_id: str
    status: str
    provider: str
    model: str
    prompt_version: str
    result: ExtractionResult
    created_at: datetime


class PremiseReview(BaseModel):
    candidate_id: str
    action: str = Field(pattern="^(confirm|edit|reject|unknown)$")
    statement: str | None = None
    kind: PremiseKind | None = None


class ExtractionReviewRequest(BaseModel):
    reviews: list[PremiseReview]


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


class RevisitRequest(BaseModel):
    filename: str = "new-evidence.txt"
    content: str = Field(min_length=1, max_length=2_000_000)
    media_type: str = "text/plain"


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


class RevisitRead(BaseModel):
    id: str
    decision_id: str
    status: str
    findings: list[RevisitFinding]
    created_at: datetime


class HealthRead(BaseModel):
    status: str
    service: str
