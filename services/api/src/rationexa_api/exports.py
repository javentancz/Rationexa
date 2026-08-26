import re
from collections.abc import Sequence
from datetime import datetime

from .db import DecisionRow, RevisitRow


def export_filename(title: str, extension: str = "md") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return f"{slug[:80] or 'decision'}-record.{extension}"


def _inline(value: object | None, fallback: str = "Not recorded") -> str:
    if value is None or str(value).strip() == "":
        return fallback
    text = " ".join(str(value).split())
    for character in ("\\", "`", "*", "_", "[", "]", "<", ">", "#", "|"):
        text = text.replace(character, f"\\{character}")
    return text


def _paragraph(value: object | None, fallback: str = "Not recorded") -> str:
    if value is None or str(value).strip() == "":
        return fallback
    return str(value).strip().replace("<", "&lt;").replace(">", "&gt;")


def _label(value: object | None, fallback: str = "Not recorded") -> str:
    return _inline(str(value).replace("_", " ") if value is not None else None, fallback)


def _blockquote(value: object | None) -> str:
    text = _paragraph(value, "No excerpt recorded")
    return "\n".join(f"> {line}" if line else ">" for line in text.splitlines())


def _timestamp(value: datetime | str | None) -> str:
    if value is None:
        return "Not recorded"
    return value.isoformat() if isinstance(value, datetime) else str(value)


def render_decision_markdown(decision: DecisionRow, revisits: Sequence[RevisitRow]) -> str:
    lines = [
        f"# {_inline(decision.title, 'Untitled decision')}",
        "",
        "A human-reviewed Rationexa decision record. AI findings are evidence-review aids, not autonomous decisions.",
        "",
        "## Decision",
        "",
        f"- **Status:** {_inline(decision.status)}",
        f"- **Criticality:** {_inline(decision.criticality)}",
        f"- **Saved:** {_timestamp(decision.created_at)}",
        f"- **Preservation policy:** {_inline(decision.preservation_policy)}",
        "",
        "### Question",
        "",
        _paragraph(decision.question),
        "",
        "### Chosen option",
        "",
        _paragraph(decision.chosen_option, "Not established"),
        "",
        "### Context",
        "",
        _paragraph(decision.context),
        "",
        "### Rationale",
        "",
        _paragraph(decision.rationale),
        "",
        "## Preserved premises",
        "",
    ]

    if not decision.premises:
        lines.extend(["No premises were preserved.", ""])
    for index, premise in enumerate(decision.premises, start=1):
        lines.extend(
            [
                f"### P{index} — {_label(premise.kind)}",
                "",
                _paragraph(premise.statement),
                "",
                f"- **Importance:** {_inline(premise.importance)}",
                f"- **Claim status:** {_label(premise.claim_status)}",
                f"- **Qualifiers:** {_inline(premise.qualifiers)}",
                "",
            ]
        )
        if premise.anchor:
            lines.extend(["**Reviewed source excerpt**", "", _blockquote(premise.anchor.exact_excerpt), ""])
            if premise.anchor.page_number is not None:
                lines.extend([f"Source page: {premise.anchor.page_number}", ""])

    lines.extend(["## Revisit history", ""])
    if not revisits:
        lines.extend(["No revisit checks have been recorded.", ""])

    for revisit_index, revisit in enumerate(revisits, start=1):
        total_tokens = (
            revisit.input_tokens + revisit.output_tokens
            if revisit.input_tokens is not None and revisit.output_tokens is not None
            else None
        )
        cost = f"${revisit.estimated_cost_usd:.6f}" if revisit.estimated_cost_usd is not None else "Not recorded"
        lines.extend(
            [
                f"### Revisit {revisit_index} — {_timestamp(revisit.created_at)}",
                "",
                f"- **Evidence:** {_inline(revisit.evidence_filename, 'New evidence')}",
                f"- **Review status:** {_label(revisit.status)}",
                f"- **Provider / model:** {_inline(revisit.provider, 'Unknown')} / {_inline(revisit.model, 'Unknown')}",
                f"- **Prompt version:** {_inline(revisit.prompt_version, 'Unknown')}",
                f"- **Latency:** {f'{revisit.latency_ms} ms' if revisit.latency_ms is not None else 'Not recorded'}",
                f"- **Tokens:** {total_tokens if total_tokens is not None else 'Not recorded'}",
                f"- **Estimated cost:** {cost}",
                "",
            ]
        )
        if not revisit.findings:
            lines.extend(["No material relationship was found.", ""])
            continue

        for finding_index, finding in enumerate(revisit.findings, start=1):
            finding_type = str(finding.get("finding_type") or "premise_change").replace("_", " ")
            relationship = str(finding.get("relationship") or "unknown").replace("_", " ")
            lines.extend(
                [
                    f"#### Finding {finding_index} — {_inline(finding_type)} / {_inline(relationship)}",
                    "",
                    f"- **Premise:** {_inline(finding.get('premise_statement'))}",
                    f"- **Confidence:** {_inline(finding.get('confidence_band'), 'Unknown')}",
                    f"- **Detection source:** {_label(finding.get('detection_source'), 'Unknown')}",
                    f"- **Human judgment:** {_label(finding.get('human_judgment'), 'Not reviewed')}",
                    f"- **Judged:** {_timestamp(finding.get('judged_at'))}",
                    "",
                    "**Explanation**",
                    "",
                    _paragraph(finding.get("explanation")),
                    "",
                    "**New evidence excerpt**",
                    "",
                    _blockquote(finding.get("new_excerpt")),
                    "",
                ]
            )
            if finding.get("old_excerpt"):
                lines.extend(["**Original source excerpt**", "", _blockquote(finding["old_excerpt"]), ""])
            if finding.get("missing_context_question"):
                lines.extend(
                    ["**Missing context question**", "", _paragraph(finding["missing_context_question"]), ""]
                )
            if finding.get("human_notes"):
                lines.extend(["**Human notes**", "", _paragraph(finding["human_notes"]), ""])

    lines.extend(["---", "", "Exported from Rationexa. Verify source evidence before acting on this record.", ""])
    return "\n".join(lines)
