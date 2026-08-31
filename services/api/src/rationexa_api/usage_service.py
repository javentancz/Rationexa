from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import DecisionRow, DecisionShareRow, ExtractionRow, ProductEventRow, RevisitRow
from .schemas import DecisionChallengeRead, PilotMetricsRead, UsageModelRead, UsageRunRead, UsageSummaryRead


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _provider_location(provider: str) -> str:
    if provider in {"ollama", "deterministic"}:
        return "local"
    if provider == "unknown":
        return "unknown"
    return "hosted"


def build_usage_summary(db: Session, workspace_id: str) -> UsageSummaryRead:
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
                created_at=_as_utc(extraction.created_at),
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
                created_at=_as_utc(revisit.created_at),
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


def build_pilot_metrics(db: Session, workspace_id: str) -> PilotMetricsRead:
    events = db.scalars(
        select(ProductEventRow)
        .where(ProductEventRow.workspace_id == workspace_id)
        .order_by(ProductEventRow.created_at.desc())
    ).all()
    event_counts: dict[str, int] = {}
    for event in events:
        event_counts[event.event_type] = event_counts.get(event.event_type, 0) + 1
    active_days = len({_as_utc(event.created_at).date() for event in events})
    decision_count = (
        db.scalar(select(func.count()).select_from(DecisionRow).where(DecisionRow.workspace_id == workspace_id)) or 0
    )
    revisit_count = (
        db.scalar(
            select(func.count())
            .select_from(RevisitRow)
            .join(DecisionRow)
            .where(DecisionRow.workspace_id == workspace_id)
        )
        or 0
    )
    share_count = (
        db.scalar(
            select(func.count())
            .select_from(DecisionShareRow)
            .join(DecisionRow)
            .where(DecisionRow.workspace_id == workspace_id)
        )
        or 0
    )
    return PilotMetricsRead(
        decision_count=decision_count,
        revisit_count=revisit_count,
        judgment_count=event_counts.get("finding_judged", 0),
        share_count=share_count,
        export_count=event_counts.get("decision_exported", 0),
        challenge_confirmation_count=event_counts.get("challenge_confirmed", 0),
        active_days=active_days,
        repeat_use_observed=active_days >= 2 and revisit_count > 0,
        latest_activity_at=_as_utc(events[0].created_at) if events else None,
    )
