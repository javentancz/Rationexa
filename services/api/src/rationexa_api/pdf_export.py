import io
from collections.abc import Sequence
from datetime import datetime

from fpdf import FPDF

from .db import DecisionRow, RevisitRow

_NON_LATIN = {
    "\u2014": "-",
    "\u2013": "-",
    "\u2026": "...",
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2022": "*",
    "\u2192": "->",
    "\u00a0": " ",
}


def _pdf_text(value: object | None, fallback: str = "Not recorded") -> str:
    if value is None or str(value).strip() == "":
        result = fallback
    else:
        text = " ".join(str(value).split())
        for symbol, replacement in _NON_LATIN.items():
            text = text.replace(symbol, replacement)
        result = text.encode("latin-1", "replace").decode("latin-1")
    return result


def _pdf_label(value: object | None, fallback: str = "Not recorded") -> str:
    return _pdf_text(str(value).replace("_", " ") if value is not None else None, fallback)


def _pdf_timestamp(value: object | None) -> str:
    if value is None:
        return "Not recorded"
    if isinstance(value, datetime):
        return value.isoformat()
    return _pdf_text(value)


class DecisionPdf(FPDF):
    def __init__(self) -> None:
        super().__init__(orientation="P", unit="mm", format="a4")
        self.set_auto_page_break(auto=True, margin=18)
        self.set_margins(18, 16, 18)
        self.add_page()

    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(130, 137, 131)
        self.cell(0, 6, f"Rationexa page {self.page_no()}", align="C")


def _content(pdf: DecisionPdf) -> float:
    return pdf.w - pdf.l_margin - pdf.r_margin


def _heading(pdf: DecisionPdf, text: str, size: int, color=(31, 96, 66), before: float = 4.0) -> None:
    pdf.ln(before)
    pdf.set_font("Helvetica", "B", size)
    pdf.set_text_color(*color)
    pdf.multi_cell(_content(pdf), size * 0.5, _pdf_text(text), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(23, 32, 25)


def _paragraph(pdf: DecisionPdf, text: str | None, fallback: str = "Not recorded") -> None:
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(40, 47, 42)
    pdf.multi_cell(_content(pdf), 5.2, _pdf_text(text, fallback), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1.5)


def _bullet(pdf: DecisionPdf, label: str, value: str | None) -> None:
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(31, 96, 66)
    pdf.multi_cell(_content(pdf), 5.0, f"{label}: ", new_x="LMARGIN", new_y="TOP")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(40, 47, 42)
    pdf.multi_cell(_content(pdf) - 38, 5.0, _pdf_text(value, "Not recorded"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1.0)
    pdf.set_text_color(23, 32, 25)


def _quote(pdf: DecisionPdf, text: str | None) -> None:
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(70, 83, 74)
    content = _content(pdf) - 6
    pdf.set_x(pdf.l_margin + 3)
    pdf.multi_cell(content, 4.6, _pdf_text(text, "No excerpt recorded"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1.5)
    pdf.set_text_color(23, 32, 25)


def render_decision_pdf(decision: DecisionRow, revisits: Sequence[RevisitRow]) -> bytes:
    pdf = DecisionPdf()

    _heading(pdf, _pdf_text(decision.title, "Untitled decision"), 22, color=(23, 32, 25), before=0)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(102, 113, 106)
    pdf.multi_cell(
        _content(pdf),
        4.6,
        "A human-reviewed Rationexa decision record. AI findings are evidence-review aids, not autonomous decisions.",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(1.0)
    pdf.set_text_color(23, 32, 25)

    _heading(pdf, "Decision", 14)
    _bullet(pdf, "Status", _pdf_label(decision.status))
    _bullet(pdf, "Criticality", _pdf_label(decision.criticality))
    _bullet(pdf, "Saved", _pdf_timestamp(decision.created_at))
    _bullet(pdf, "Preservation policy", _pdf_label(decision.preservation_policy))

    _heading(pdf, "Question", 11, before=6)
    _paragraph(pdf, decision.question)
    _heading(pdf, "Chosen option", 11, before=6)
    _paragraph(pdf, decision.chosen_option, "Not established")
    _heading(pdf, "Context", 11, before=6)
    _paragraph(pdf, decision.context)
    _heading(pdf, "Rationale", 11, before=6)
    _paragraph(pdf, decision.rationale)

    _heading(pdf, "Preserved premises", 14, before=8)
    if not decision.premises:
        _paragraph(pdf, "No premises were preserved.")
    for index, premise in enumerate(decision.premises, start=1):
        _heading(pdf, f"P{index} - {_pdf_label(premise.kind)}", 11, before=4)
        _paragraph(pdf, premise.statement)
        _bullet(pdf, "Importance", _pdf_label(premise.importance))
        _bullet(pdf, "Claim status", _pdf_label(premise.claim_status))
        _bullet(pdf, "Qualifiers", _pdf_label(premise.qualifiers))
        if premise.anchor:
            _heading(pdf, "Reviewed source excerpt", 9, color=(102, 113, 106), before=2)
            _quote(pdf, premise.anchor.exact_excerpt)
            if premise.anchor.page_number is not None:
                _bullet(pdf, "Source page", str(premise.anchor.page_number))

    _heading(pdf, "Revisit history", 14, before=8)
    if not revisits:
        _paragraph(pdf, "No revisit checks have been recorded.")

    for revisit_index, revisit in enumerate(revisits, start=1):
        total_tokens = (
            revisit.input_tokens + revisit.output_tokens
            if revisit.input_tokens is not None and revisit.output_tokens is not None
            else None
        )
        cost = f"${revisit.estimated_cost_usd:.6f}" if revisit.estimated_cost_usd is not None else "Not recorded"
        _heading(pdf, f"Revisit {revisit_index} - {_pdf_timestamp(revisit.created_at)}", 11, before=6)
        _bullet(pdf, "Evidence", _pdf_label(revisit.evidence_filename, "New evidence"))
        _bullet(pdf, "Review status", _pdf_label(revisit.status))
        _bullet(
            pdf,
            "Provider / model",
            f"{_pdf_label(revisit.provider, 'Unknown')} / {_pdf_label(revisit.model, 'Unknown')}",
        )
        _bullet(pdf, "Prompt version", _pdf_label(revisit.prompt_version, "Unknown"))
        _bullet(pdf, "Latency", f"{revisit.latency_ms} ms" if revisit.latency_ms is not None else "Not recorded")
        _bullet(pdf, "Tokens", str(total_tokens) if total_tokens is not None else "Not recorded")
        _bullet(pdf, "Estimated cost", cost)
        pdf.ln(1.0)

        if not revisit.findings:
            _paragraph(pdf, "No material relationship was found.")
            continue

        for finding_index, finding in enumerate(revisit.findings, start=1):
            finding_type = str(finding.get("finding_type") or "premise_change").replace("_", " ")
            relationship = str(finding.get("relationship") or "unknown").replace("_", " ")
            _heading(
                pdf,
                f"Finding {finding_index} - {finding_type} / {relationship}",
                9,
                color=(61, 100, 141),
                before=3,
            )
            _bullet(pdf, "Premise", finding.get("premise_statement"))
            _bullet(pdf, "Confidence", finding.get("confidence_band"))
            _bullet(pdf, "Detection source", finding.get("detection_source"))
            _bullet(pdf, "Human judgment", finding.get("human_judgment"))
            _bullet(pdf, "Judged", _pdf_timestamp(finding.get("judged_at")))
            _heading(pdf, "Explanation", 9, color=(102, 113, 106), before=2)
            _paragraph(pdf, finding.get("explanation"))
            _heading(pdf, "New evidence excerpt", 9, color=(102, 113, 106), before=2)
            _quote(pdf, finding.get("new_excerpt"))
            if finding.get("old_excerpt"):
                _heading(pdf, "Original source excerpt", 9, color=(102, 113, 106), before=2)
                _quote(pdf, finding.get("old_excerpt"))
            if finding.get("missing_context_question"):
                _heading(pdf, "Missing context question", 9, color=(167, 102, 28), before=2)
                _paragraph(pdf, finding.get("missing_context_question"))
            if finding.get("human_notes"):
                _heading(pdf, "Human notes", 9, color=(102, 113, 106), before=2)
                _paragraph(pdf, finding.get("human_notes"))

    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 8.5)
    pdf.set_text_color(130, 137, 131)
    pdf.multi_cell(
        _content(pdf),
        4.4,
        "Exported from Rationexa. Verify source evidence before acting on this record.",
        new_x="LMARGIN",
        new_y="NEXT",
    )

    output = io.BytesIO()
    pdf.output(output)
    return output.getvalue()
