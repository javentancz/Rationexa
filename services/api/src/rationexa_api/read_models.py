from datetime import UTC, datetime

from .db import AssumptionMonitorRow, DecisionRow, ExtractionRow, MonitorEvidenceProposalRow, RevisitRow
from .schemas import (
    DecisionChallengeRead,
    DecisionPremiseRead,
    DecisionRead,
    ExtractionRead,
    ExtractionResult,
    MonitorEvidenceRead,
    MonitorRead,
    RevisitRead,
    SourceAnchor,
)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


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
        created_at=_as_utc(row.created_at),
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
        created_at=_as_utc(row.created_at),
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
        created_at=_as_utc(row.created_at),
    )


def monitor_evidence_read(row: MonitorEvidenceProposalRow) -> MonitorEvidenceRead:
    return MonitorEvidenceRead(
        id=row.id,
        monitor_id=row.monitor_id,
        source_url=row.source_url,
        source_title=row.source_title,
        exact_excerpt=row.exact_excerpt,
        start_offset=row.start_offset,
        end_offset=row.end_offset,
        relationship=row.relationship,
        confidence_band=row.confidence_band,
        explanation=row.explanation,
        recommendation=row.recommendation,
        submitted_by=row.submitted_by,
        status=row.status,
        human_action=row.human_action,
        human_notes=row.human_notes,
        draft_action=row.draft_action,
        created_at=_as_utc(row.created_at),
        reviewed_at=_as_utc(row.reviewed_at),
    )


def monitor_read(row: AssumptionMonitorRow, proposals: list[MonitorEvidenceProposalRow]) -> MonitorRead:
    return MonitorRead(
        id=row.id,
        decision_id=row.decision_id,
        premise_id=row.premise_id,
        name=row.name,
        instructions=row.instructions,
        source_urls=row.source_urls,
        status=row.status,
        proposals=[monitor_evidence_read(proposal) for proposal in proposals],
        created_at=_as_utc(row.created_at),
        updated_at=_as_utc(row.updated_at),
    )
