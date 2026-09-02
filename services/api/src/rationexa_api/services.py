import hashlib
import io
import re
from pathlib import Path

from .schemas import Relationship, RevisitFinding, SourceAnchor


def extract_artifact_text(content: bytes, media_type: str) -> tuple[str, str]:
    if media_type == "application/pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted:
            raise ValueError("Encrypted PDFs are not supported in Stage 1")
        pages = []
        for index, page in enumerate(reader.pages, start=1):
            pages.append(f"\n[[PAGE {index}]]\n{page.extract_text() or ''}")
        text = "".join(pages).strip()
        if not text:
            raise ValueError("This PDF has no extractable text; OCR is not supported yet")
        return text, "pypdf-v1"
    try:
        return content.decode("utf-8"), "text-v1"
    except UnicodeDecodeError as exc:
        raise ValueError("Text artifacts must be UTF-8 encoded") from exc


def persist_artifact(content: bytes, artifact_dir: Path, filename: str) -> tuple[str, str]:
    digest = hashlib.sha256(content).hexdigest()
    target_dir = artifact_dir / digest[:2]
    target_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(filename).suffix.lower()[:12]
    target = target_dir / f"{digest}{suffix}"
    if not target.exists():
        target.write_bytes(content)
    return digest, str(target)


def validate_anchor(anchor: SourceAnchor | None, source_text: str) -> SourceAnchor | None:
    if anchor is None:
        return None
    excerpt = anchor.exact_excerpt
    start = source_text.find(excerpt)
    if start < 0:
        return None
    return SourceAnchor(
        exact_excerpt=excerpt,
        start_offset=start,
        end_offset=start + len(excerpt),
        page_number=_page_at_offset(source_text, start),
    )


def _page_at_offset(source_text: str, offset: int) -> int | None:
    markers = list(re.finditer(r"\[\[PAGE (\d+)\]\]", source_text[: offset + 1]))
    return int(markers[-1].group(1)) if markers else None


NEGATION_CUES = (
    "no longer",
    "does not",
    "doesn't",
    "cannot",
    "removed",
    "ended",
    "deprecated",
    "retired",
)
CHANGE_CUES = ("now supports", "introduced", "increased", "decreased", "changed", "replaced", "retired")


def compare_premise(
    premise_id: str,
    premise_statement: str,
    old_excerpt: str | None,
    new_evidence: str,
    criticality: str,
) -> RevisitFinding | None:
    premise_terms = meaningful_terms(premise_statement)
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", new_evidence) if part.strip()]
    ranked = sorted(
        (
            (len(premise_terms & meaningful_terms(sentence)), premise_terms & meaningful_terms(sentence), sentence)
            for sentence in sentences
        ),
        reverse=True,
    )
    if not ranked:
        return None
    overlap, shared_terms, best = ranked[0]
    material_terms = {"deprecat", "maintenance", "migrat", "retir", "security", "version", "price", "limit"}
    if overlap < 2 and not shared_terms.intersection(material_terms):
        return None
    old_lower = premise_statement.lower()
    new_lower = best.lower()
    old_negative = any(cue in old_lower for cue in NEGATION_CUES)
    new_negative = any(cue in new_lower for cue in NEGATION_CUES)
    changed = any(cue in new_lower for cue in CHANGE_CUES)

    if old_negative != new_negative and (changed or overlap >= 2):
        relationship = Relationship.CONTRADICTS
    elif any(cue in new_lower for cue in ("deprecated", "retired", "replaced by")):
        relationship = Relationship.SUPERSEDES
    elif any(cue in new_lower for cue in ("reduced", "lower", "limited", "weaker")):
        relationship = Relationship.WEAKENS
    elif any(cue in new_lower for cue in ("confirmed", "continues", "still supports", "unchanged")) or (
        "migrat" in meaningful_terms(premise_statement) and "recommend" in new_lower
    ):
        relationship = Relationship.SUPPORTS
    else:
        relationship = Relationship.UNCLEAR

    return RevisitFinding(
        premise_id=premise_id,
        premise_statement=premise_statement,
        relationship=relationship,
        confidence_band="high" if overlap >= 3 else "medium",
        explanation=f"The new evidence materially {relationship.value} this preserved premise.",
        missing_context_question=(
            "What operational or business threshold would make this change material?"
            if relationship in {Relationship.WEAKENS, Relationship.UNCLEAR}
            else None
        ),
        old_excerpt=old_excerpt,
        new_excerpt=best,
        source_fallback_performed=criticality in {"important", "critical"} and old_excerpt is not None,
        detection_source="deterministic_rules",
    )


def meaningful_terms(value: str) -> set[str]:
    stop = {
        "the",
        "a",
        "an",
        "and",
        "or",
        "to",
        "of",
        "in",
        "for",
        "is",
        "are",
        "we",
        "it",
        "this",
        "that",
        "with",
        "project",
        "service",
        "system",
        "controller",
        "ingress",
        "existing",
        "new",
    }
    aliases = {
        "deprecated": "deprecat",
        "deprecation": "deprecat",
        "migrate": "migrat",
        "migrating": "migrat",
        "migration": "migrat",
        "retired": "retir",
        "retirement": "retir",
        "upgrade": "maintenance",
        "upgrades": "maintenance",
        "update": "maintenance",
        "updates": "maintenance",
        "release": "maintenance",
        "releases": "maintenance",
    }
    terms = re.findall(r"[a-z0-9][a-z0-9_-]+", value.lower())
    return {
        aliases.get(term, term) for term in terms if term not in stop and (len(term) > 2 or re.fullmatch(r"v\d+", term))
    }
