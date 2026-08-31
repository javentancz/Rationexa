from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import DecisionRow, DecisionShareRow, PremiseRow, RevisitRow, now_utc
from .schemas import DecisionPremiseRead, RevisitRead, ShareDecisionRead, ShareRead, SourceAnchor

SECRET_PLACEHOLD = "***redacted provider secret***"
ARTIFACT_NOTICE = "Private source artifact not included in the shared record."
_SECRET_KEYWORDS = ("api_key", "apikey", "secret", "token", "password", "authorization", "bearer", "openai", "ollama")


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def scrub_shared_text(value: object | None) -> str | None:
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


def scrub_shared_dict(data: object) -> object:
    if isinstance(data, dict):
        scrubbed = {}
        for key, value in data.items():
            if isinstance(key, str) and "artifact" in key.lower():
                scrubbed[key] = ARTIFACT_NOTICE
            elif isinstance(key, str) and any(secret in key.lower() for secret in _SECRET_KEYWORDS):
                scrubbed[key] = SECRET_PLACEHOLD
            else:
                scrubbed[key] = scrub_shared_dict(value)
        return scrubbed
    if isinstance(data, list):
        return [scrub_shared_dict(item) for item in data]
    return scrub_shared_text(data)


def share_read(share: DecisionShareRow, base_url: str) -> ShareRead:
    url = f"{base_url.rstrip('/')}/share/{share.token}" if share.status == "active" else None
    return ShareRead(
        id=share.id,
        decision_id=share.decision_id,
        token=share.token,
        status=share.status,
        url=url,
        created_at=_as_utc(share.created_at),
        expires_at=_as_utc(share.expires_at),
        revoked_at=_as_utc(share.revoked_at),
    )


def shared_premise(premise: PremiseRow) -> DecisionPremiseRead:
    anchor = None
    if premise.anchor is not None:
        anchor = SourceAnchor(
            exact_excerpt=scrub_shared_text(premise.anchor.exact_excerpt) or "",
            start_offset=premise.anchor.start_offset,
            end_offset=premise.anchor.end_offset,
            page_number=premise.anchor.page_number,
        )
    return DecisionPremiseRead(
        id=premise.id,
        kind=premise.kind,
        statement=scrub_shared_text(premise.statement) or "",
        qualifiers=scrub_shared_text(premise.qualifiers) or "",
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
            findings=scrub_shared_dict(revisit.findings) or [],
            provider=revisit.provider,
            model=revisit.model,
            prompt_version=revisit.prompt_version,
            latency_ms=revisit.latency_ms,
            input_tokens=revisit.input_tokens,
            output_tokens=revisit.output_tokens,
            estimated_cost_usd=revisit.estimated_cost_usd,
            evidence_filename=None,
            created_at=_as_utc(revisit.created_at),
        )
        for revisit in revisits
    ]
    return ShareDecisionRead(
        id=decision.id,
        title=scrub_shared_text(decision.title) or "",
        question=scrub_shared_text(decision.question) or "",
        context=scrub_shared_text(decision.context) or "",
        chosen_option=scrub_shared_text(decision.chosen_option),
        rationale=scrub_shared_text(decision.rationale) or "",
        criticality=decision.criticality,
        preservation_policy=decision.preservation_policy,
        status=decision.status,
        premises=[shared_premise(premise) for premise in decision.premises],
        revisits=revisits_for_share,
        shared_at=_as_utc(shared_at),
    )


def is_expired(share: DecisionShareRow) -> bool:
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
    if is_expired(share):
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
