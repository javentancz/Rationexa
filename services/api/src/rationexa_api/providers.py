import hashlib
import json
import re
from abc import ABC, abstractmethod
from uuid import uuid4

import httpx
from openai import OpenAI

from .config import Settings
from .prompts import EXTRACTION_INSTRUCTIONS, REVISIT_INSTRUCTIONS
from .schemas import (
    CandidatePremise,
    Criticality,
    ExtractionResult,
    ModelOption,
    PremiseKind,
    Relationship,
    RevisitAssessmentBatch,
    RevisitFinding,
    RevisitPremiseInput,
    SourceAnchor,
)


class ExtractionProvider(ABC):
    name: str
    model: str
    last_usage: dict[str, int | float | None]

    @abstractmethod
    def extract(self, source_text: str, filename: str) -> ExtractionResult:
        raise NotImplementedError

    @abstractmethod
    def revisit(
        self,
        premises: list[RevisitPremiseInput],
        new_evidence: str,
        criticality: str,
    ) -> list[RevisitFinding]:
        raise NotImplementedError


class DeterministicProvider(ExtractionProvider):
    name = "deterministic"
    model = "rules-v1"

    def extract(self, source_text: str, filename: str) -> ExtractionResult:
        self.last_usage = {"input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0.0}
        sentences = _source_sentences(source_text)
        premises: list[CandidatePremise] = []
        title = filename.rsplit(".", 1)[0].replace("_", " ").strip() or "Imported decision"
        question = next(
            (sentence for sentence in sentences if sentence.endswith("?")),
            f"What decision is recorded in {title}?",
        )
        chosen = next(
            (
                sentence
                for sentence in sentences
                if re.search(r"\b(chose|selected|decided|recommend)\b", sentence, re.I)
            ),
            None,
        )

        for sentence in sentences[:80]:
            kind = self._classify(sentence)
            if kind is None:
                continue
            start = source_text.find(sentence)
            anchor = None
            if start >= 0:
                anchor = SourceAnchor(exact_excerpt=sentence, start_offset=start, end_offset=start + len(sentence))
            high_attention = kind in {
                PremiseKind.HARD_CONSTRAINT,
                PremiseKind.ASSUMPTION,
                PremiseKind.UNKNOWN,
                PremiseKind.MATERIAL_CLAIM,
                PremiseKind.REVISIT_CONDITION,
            }
            premises.append(
                CandidatePremise(
                    candidate_id=str(uuid4()),
                    kind=kind,
                    statement=sentence,
                    importance="high" if high_attention else "normal",
                    claim_status="unverified" if kind == PremiseKind.MATERIAL_CLAIM else "not_applicable",
                    attention_reason=f"{kind.value.replace('_', ' ').title()} requires review"
                    if high_attention
                    else None,
                    anchor=anchor,
                )
            )

        if not premises and sentences:
            sentence = sentences[0]
            premises.append(
                CandidatePremise(
                    candidate_id=str(uuid4()),
                    kind=PremiseKind.ASSUMPTION,
                    statement=sentence,
                    importance="high",
                    attention_reason="Unclassified source statement requires human review",
                    anchor=SourceAnchor(exact_excerpt=sentence, start_offset=0, end_offset=len(sentence)),
                )
            )

        critical = any(p.kind == PremiseKind.HARD_CONSTRAINT for p in premises)
        return _normalize_extraction(
            ExtractionResult(
                title=title.title(),
                decision_question=question,
                context=sentences[0] if sentences else "",
                chosen_option=chosen,
                rationale=" ".join(
                    sentence for sentence in sentences if re.search(r"\b(because|due to|so that)\b", sentence, re.I)
                ),
                suggested_criticality=Criticality.CRITICAL if critical else Criticality.IMPORTANT,
                criticality_reason="A hard constraint was detected."
                if critical
                else "Defaulted to Important pending human confirmation.",
                premises=premises,
            ),
            source_text,
        )

    def revisit(
        self,
        premises: list[RevisitPremiseInput],
        new_evidence: str,
        criticality: str,
    ) -> list[RevisitFinding]:
        self.last_usage = {"input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0.0}
        from .services import compare_premise

        findings = []
        for premise in premises:
            finding = compare_premise(
                premise.premise_id,
                premise.statement,
                premise.old_excerpt,
                new_evidence,
                criticality,
            )
            if finding:
                findings.append(finding)
        return _apply_deterministic_safety_net(findings, premises, new_evidence, criticality)

    @staticmethod
    def _classify(sentence: str) -> PremiseKind | None:
        value = " ".join(sentence.lower().split())
        if _is_structure_only(sentence) or value.startswith(("#", "date:", "status:", "source:")):
            return None
        if (
            value.startswith("revisit ")
            or "revisit if" in value
            or "revisit when" in value
            or bool(re.search(r"\b(?:upgrade|migrate|move|transition)\b.*\b(?:if|when|after|once)\b", value))
            or re.search(r"\b(later|eventually|future)\b.*\bmigrat", value)
            or re.search(r"\bmigrat\w*\b.*\b(possible|later|eventually|future)", value)
            or re.search(r"\bmoving\b.*\bnewer\b.*\b(version|runtime|platform)\b", value)
        ):
            return PremiseKind.REVISIT_CONDITION
        if sentence.endswith("?") or any(word in value for word in ("unknown", "unclear", "to be confirmed")):
            return PremiseKind.UNKNOWN
        if any(
            word in value
            for word in ("must not", "cannot", "prohibited", "must ", "required", "accepts responsibility")
        ):
            return PremiseKind.HARD_CONSTRAINT
        if any(
            word in value
            for word in (
                "assume",
                "expected",
                "likely",
                "we believe",
                "familiar",
                "quickly enough",
                "simpler than",
                "has enough",
            )
        ):
            return PremiseKind.ASSUMPTION
        if re.search(r"\b(can|could|will)\b.*\bquickly\b", value):
            return PremiseKind.ASSUMPTION
        material_claim_pattern = (
            r"\b(\d+(?:\.\d+)?%?|pricing|price|rate limit|supports? "
            r"(?:saml|oauth|api)|certified|region|deprecated|end.of.life)\b"
        )
        if re.search(material_claim_pattern, value):
            return PremiseKind.MATERIAL_CLAIM
        if any(word in value for word in ("need to", "needs ", "should support", "should use", "requirement")):
            return PremiseKind.REQUIREMENT
        if re.search(r"\b(?:technical strategy|core responsibilities|delivery scope)\s*:", value) or (
            re.search(r"\b(?:plan(?:ned)?|prepar(?:e|ing)|strategy)\b", value)
            and re.search(r"\b(?:analy[sz]|draft|review|test|validat|deliver|implement)", value)
        ):
            return PremiseKind.REQUIREMENT
        if any(word in value for word in ("prefer", "ideally", "nice to have")):
            return PremiseKind.SOFT_CONSTRAINT
        if any(word in value for word in ("because", "decided", "selected", "chose")):
            return PremiseKind.FACT
        return None


class OpenAIResponsesProvider(ExtractionProvider):
    name = "openai"

    def __init__(self, settings: Settings):
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required when AI_PROVIDER=openai")
        self.model = settings.openai_model
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.last_usage = {}

    def extract(self, source_text: str, filename: str) -> ExtractionResult:
        response = self.client.responses.parse(
            model=self.model,
            store=False,
            instructions=EXTRACTION_INSTRUCTIONS,
            input=f"Filename: {filename}\n\nSOURCE TEXT\n{source_text}",
            text_format=ExtractionResult,
        )
        self._capture_usage(response)
        if response.output_parsed is None:
            raise ValueError("The model did not return a valid decision extraction")
        return _normalize_extraction(response.output_parsed, source_text)

    def revisit(
        self,
        premises: list[RevisitPremiseInput],
        new_evidence: str,
        criticality: str,
    ) -> list[RevisitFinding]:
        response = self.client.responses.parse(
            model=self.model,
            store=False,
            instructions=REVISIT_INSTRUCTIONS,
            input=_revisit_input(premises, new_evidence),
            text_format=RevisitAssessmentBatch,
        )
        self._capture_usage(response)
        if response.output_parsed is None:
            raise ValueError("The model did not return valid revisit findings")
        return _validated_findings(response.output_parsed, premises, new_evidence, criticality)

    def _capture_usage(self, response: object) -> None:
        usage = getattr(response, "usage", None)
        self.last_usage = {
            "input_tokens": getattr(usage, "input_tokens", None),
            "output_tokens": getattr(usage, "output_tokens", None),
            "estimated_cost_usd": None,
        }


class OllamaProvider(ExtractionProvider):
    name = "ollama"

    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self.model = settings.ollama_model
        self.client = client or httpx.Client(
            base_url=settings.ollama_base_url.rstrip("/"),
            timeout=settings.ollama_timeout_seconds,
        )
        self.last_usage = {}

    def extract(self, source_text: str, filename: str) -> ExtractionResult:
        content = self._structured_chat(
            EXTRACTION_INSTRUCTIONS,
            f"Filename: {filename}\n\nSOURCE TEXT\n{source_text}",
            ExtractionResult.model_json_schema(),
        )
        return _normalize_extraction(ExtractionResult.model_validate_json(content), source_text)

    def revisit(
        self,
        premises: list[RevisitPremiseInput],
        new_evidence: str,
        criticality: str,
    ) -> list[RevisitFinding]:
        content = self._structured_chat(
            REVISIT_INSTRUCTIONS,
            _revisit_input(premises, new_evidence),
            RevisitAssessmentBatch.model_json_schema(),
        )
        batch = RevisitAssessmentBatch.model_validate_json(content)
        return _validated_findings(batch, premises, new_evidence, criticality)

    def _structured_chat(self, instructions: str, user_input: str, schema: dict) -> str:
        try:
            response = self.client.post(
                "/api/chat",
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": instructions},
                        {"role": "user", "content": user_input},
                    ],
                    "format": schema,
                    "stream": False,
                    "think": False,
                    "options": {"temperature": 0},
                },
            )
            response.raise_for_status()
        except httpx.ConnectError as exc:
            raise ValueError(
                "Cannot connect to Ollama. Start it with `ollama serve` and pull "
                f"the model with `ollama pull {self.model}`."
            ) from exc
        except httpx.TimeoutException as exc:
            raise ValueError(
                f"Ollama did not finish within the configured timeout while running {self.model}."
            ) from exc
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            raise ValueError(f"Ollama request failed: {detail}") from exc

        payload = response.json()
        self.last_usage = {
            "input_tokens": payload.get("prompt_eval_count"),
            "output_tokens": payload.get("eval_count"),
            "estimated_cost_usd": 0.0,
        }
        content = payload.get("message", {}).get("content")
        if not content:
            raise ValueError("Ollama returned no structured content")
        return content


def _revisit_input(premises: list[RevisitPremiseInput], new_evidence: str) -> str:
    premise_data = [premise.model_dump(mode="json", exclude={"old_excerpt"}) for premise in premises]
    return f"PRESERVED PREMISES\n{json.dumps(premise_data, indent=2)}\n\nNEW EVIDENCE\n{new_evidence}"


def _normalize_extraction(result: ExtractionResult, source_text: str | None = None) -> ExtractionResult:
    normalized = []
    chosen = (result.chosen_option or "").strip().lower()
    for premise in result.premises:
        statement = premise.statement.strip()
        if _is_structure_only(statement):
            continue
        value = statement.lower()
        duplicates_choice = bool(
            chosen and chosen in value and re.match(r"^(adopt|choose|chose|select|selected|use)\b", value)
        )
        if duplicates_choice:
            continue

        kind = premise.kind
        future_migration = (
            "revisit" in value
            or bool(re.search(r"\b(later|eventually|future)\b.*\bmigrat", value))
            or bool(re.search(r"\bmigrat\w*\b.*\b(possible|later|eventually|future)", value))
        )
        if future_migration:
            kind = PremiseKind.REVISIT_CONDITION
        elif (
            kind == PremiseKind.HARD_CONSTRAINT
            and "should" in value
            and not re.search(r"\b(must|cannot|prohibited|required)\b", value)
        ):
            kind = PremiseKind.REQUIREMENT
        elif kind == PremiseKind.FACT:
            if re.search(r"\b(must|cannot|prohibited|required)\b", value) or "accepts responsibility" in value:
                kind = PremiseKind.HARD_CONSTRAINT
            elif re.search(r"\b(needs?|requires?)\b", value) or re.search(
                r"\bshould\s+(use|provide|support|have)\b", value
            ):
                kind = PremiseKind.REQUIREMENT
            elif any(
                cue in value
                for cue in (
                    "assum",
                    "expected",
                    "likely",
                    "we believe",
                    "familiar",
                    "widely documented",
                    "quickly enough",
                    "simpler than",
                    "should become",
                )
            ):
                kind = PremiseKind.ASSUMPTION

        premise.kind = kind
        if _semantically_duplicates_existing(statement, kind, normalized):
            continue
        high_attention = kind in {
            PremiseKind.HARD_CONSTRAINT,
            PremiseKind.ASSUMPTION,
            PremiseKind.UNKNOWN,
            PremiseKind.MATERIAL_CLAIM,
            PremiseKind.REVISIT_CONDITION,
        }
        premise.importance = "high" if high_attention else "normal"
        premise.attention_reason = f"{kind.value.replace('_', ' ').title()} requires review" if high_attention else None
        if source_text:
            premise.anchor = _repair_source_anchor(premise, source_text)
        normalized.append(premise)

    if source_text:
        source_sentences = _source_recovery_spans(source_text)
        represented = {_normalized_text(premise.statement) for premise in normalized}
        for sentence in source_sentences[:120]:
            kind = DeterministicProvider._classify(sentence)
            normalized_sentence = _normalized_text(sentence)
            duplicates_choice = bool(
                chosen
                and chosen in normalized_sentence
                and re.match(r"^(adopt|choose|chose|select|selected|use)\b", normalized_sentence)
            )
            if (
                kind is None
                or duplicates_choice
                or normalized_sentence in represented
                or _semantically_duplicates_existing(sentence, kind, normalized)
            ):
                continue
            start = source_text.find(sentence)
            if start < 0:
                continue
            high_attention = kind in {
                PremiseKind.HARD_CONSTRAINT,
                PremiseKind.ASSUMPTION,
                PremiseKind.UNKNOWN,
                PremiseKind.MATERIAL_CLAIM,
                PremiseKind.REVISIT_CONDITION,
            }
            normalized.append(
                CandidatePremise(
                    candidate_id=f"recovered-{len(normalized) + 1}",
                    kind=kind,
                    statement=sentence,
                    importance="high" if high_attention else "normal",
                    quality_state="draft",
                    claim_status="unverified" if kind == PremiseKind.MATERIAL_CLAIM else "not_applicable",
                    attention_reason=(
                        f"{kind.value.replace('_', ' ').title()} recovered from source; review carefully"
                        if high_attention
                        else None
                    ),
                    anchor=SourceAnchor(
                        exact_excerpt=sentence,
                        start_offset=start,
                        end_offset=start + len(sentence),
                    ),
                )
            )
            represented.add(normalized_sentence)
    result.premises = normalized
    return result


def _repair_source_anchor(premise: CandidatePremise, source_text: str) -> SourceAnchor | None:
    """Ground a model anchor deterministically or recover one from a verbatim statement."""
    candidates = []
    if premise.anchor is not None:
        candidates.append(premise.anchor.exact_excerpt)
    candidates.append(premise.statement)

    for candidate in candidates:
        excerpt = _ground_excerpt(candidate, source_text)
        if excerpt is None:
            continue
        start = source_text.find(excerpt)
        if start >= 0:
            return SourceAnchor(
                exact_excerpt=excerpt,
                start_offset=start,
                end_offset=start + len(excerpt),
            )
    return None


def _source_sentences(source_text: str) -> list[str]:
    """Keep soft-wrapped Markdown lines together while preserving exact source text."""
    sentences = []
    for block in re.split(r"\n{2,}", source_text):
        block = block.strip()
        if not block:
            continue
        if re.match(r"^(date|status|source):", block, re.I) and "\n" in block:
            parts = block.splitlines()
        else:
            parts = re.split(r"(?<=[.!?])\s+", block)
        sentences.extend(part.strip() for part in parts if part.strip())
    return sentences


def _source_recovery_spans(source_text: str) -> list[str]:
    spans = []
    for sentence in _source_sentences(source_text):
        spans.append(sentence)
        because = re.search(r"\bbecause\b", sentence, re.I)
        if because is None:
            continue
        rationale = sentence[because.end() :].strip()
        spans.extend(clause.strip() for clause in re.split(r",\s+(?:and\s+)?", rationale) if clause.strip())
    return spans


def _normalized_text(value: str) -> str:
    return " ".join(value.lower().split())


def _is_structure_only(value: str) -> bool:
    """Reject headings and list counters that a model mislabeled as claims."""
    normalized = " ".join(value.strip().split())
    return bool(
        re.fullmatch(
            r"(?:[-*]\s*)?(?:[a-z][a-z &/]+:\s*)?(?:\d+[.)]?|[-*])",
            normalized,
            re.I,
        )
    )


def _semantically_duplicates_existing(
    statement: str,
    kind: PremiseKind,
    existing: list[CandidatePremise],
) -> bool:
    from .services import meaningful_terms

    terms = meaningful_terms(statement)
    if not terms:
        return False
    for premise in existing:
        if premise.kind != kind:
            continue
        existing_terms = meaningful_terms(premise.statement)
        smaller = min(len(terms), len(existing_terms))
        if smaller and len(terms & existing_terms) / smaller >= 0.9:
            return True
    return False


def _validated_findings(
    batch: RevisitAssessmentBatch,
    premises: list[RevisitPremiseInput],
    new_evidence: str,
    criticality: str,
) -> list[RevisitFinding]:
    premise_by_id = {premise.premise_id: premise for premise in premises}
    seen: set[str] = set()
    findings = []
    for assessment in batch.findings:
        premise = premise_by_id.get(assessment.premise_id)
        excerpt = _ground_excerpt(assessment.new_excerpt, new_evidence)
        if (
            not assessment.relevant
            or premise is None
            or assessment.premise_id in seen
            or not excerpt
            or assessment.relationship == Relationship.INTRODUCES
            or (
                premise.kind in {PremiseKind.REQUIREMENT, PremiseKind.HARD_CONSTRAINT}
                and assessment.relationship == Relationship.SUPPORTS
                and not _direct_requirement_support(premise.statement, excerpt)
            )
        ):
            continue
        seen.add(assessment.premise_id)
        findings.append(
            RevisitFinding(
                premise_id=premise.premise_id,
                premise_statement=premise.statement,
                relationship=assessment.relationship,
                confidence_band=assessment.confidence_band,
                explanation=assessment.explanation,
                missing_context_question=assessment.missing_context_question,
                old_excerpt=premise.old_excerpt,
                new_excerpt=excerpt,
                source_fallback_performed=(
                    criticality in {"important", "critical"} and premise.old_excerpt is not None
                ),
            )
        )
    return _apply_deterministic_safety_net(findings, premises, new_evidence, criticality)


def _apply_deterministic_safety_net(
    findings: list[RevisitFinding],
    premises: list[RevisitPremiseInput],
    new_evidence: str,
    criticality: str,
) -> list[RevisitFinding]:
    """Recover explicit high-risk changes without pretending the rule is model reasoning."""
    by_id = {finding.premise_id: finding for finding in findings}
    for premise in premises:
        candidate = _safety_net_finding(premise, new_evidence, criticality)
        if candidate is None:
            continue
        existing = by_id.get(premise.premise_id)
        if existing is None:
            findings.append(candidate)
            by_id[premise.premise_id] = candidate
        elif premise.kind == PremiseKind.REVISIT_CONDITION and existing.relationship != Relationship.SUPPORTS:
            index = findings.index(existing)
            findings[index] = candidate
            by_id[premise.premise_id] = candidate
    findings.extend(_new_constraint_findings(premises, new_evidence, findings))
    return findings


def _new_constraint_findings(
    premises: list[RevisitPremiseInput],
    new_evidence: str,
    findings: list[RevisitFinding],
) -> list[RevisitFinding]:
    """Surface explicit new obligations that cannot map to an old premise."""
    from .services import meaningful_terms

    represented_excerpts = {_normalized_text(finding.new_excerpt) for finding in findings}
    premise_terms = [meaningful_terms(premise.statement) for premise in premises]
    all_premise_terms = set().union(*premise_terms) if premise_terms else set()
    detected: list[RevisitFinding] = []
    for sentence in _source_sentences(new_evidence):
        normalized = _normalized_text(sentence)
        if (
            normalized in represented_excerpts
            or _looks_instructional(sentence)
            or not _is_explicit_constraint(sentence)
        ):
            continue
        terms = meaningful_terms(sentence)
        if (
            not terms
            or _materially_overlaps(terms, all_premise_terms)
            or any(_materially_overlaps(terms, existing) for existing in premise_terms)
        ):
            continue
        digest = hashlib.sha256(normalized.encode()).hexdigest()[:12]
        detected.append(
            RevisitFinding(
                premise_id=f"new-constraint-{digest}",
                premise_statement="New constraint not present in the original decision",
                relationship=Relationship.INTRODUCES,
                confidence_band="high",
                explanation=(
                    "The new evidence introduces an explicit mandatory constraint that was not "
                    "represented by any preserved premise. Human review is required before changing the decision."
                ),
                missing_context_question="Does this new constraint change the feasible solution or delivery plan?",
                new_excerpt=sentence,
                source_fallback_performed=False,
                finding_type="new_constraint",
                detection_source="deterministic_safety_net",
            )
        )
        represented_excerpts.add(normalized)
    return detected


def _is_explicit_constraint(value: str) -> bool:
    normalized = _normalized_text(value)
    return bool(
        re.search(r"\b(?:must|must not|cannot|required|prohibited|mandates?|mandatory)\b", normalized)
        or re.search(r"\b(?:security|legal|regulatory|compliance)\b.*\b(?:requires?|mandates?)\b", normalized)
    )


def _materially_overlaps(first: set[str], second: set[str]) -> bool:
    if not first or not second:
        return False
    shared = first & second
    return len(shared) >= 2 and len(shared) / min(len(first), len(second)) >= 0.25


def _looks_instructional(value: str) -> bool:
    normalized = _normalized_text(value)
    return bool(
        re.search(
            r"\b(?:ignore (?:all|any|every|previous|earlier)|mark (?:all|the)|return a finding|"
            r"claim that|system prompt|confidence 1\.0)\b",
            normalized,
        )
    )


def _safety_net_finding(
    premise: RevisitPremiseInput,
    new_evidence: str,
    criticality: str,
) -> RevisitFinding | None:
    from .services import meaningful_terms

    premise_text = f"{premise.statement} {premise.old_excerpt or ''}"
    premise_terms = meaningful_terms(premise_text)
    sentences = _source_sentences(new_evidence)
    ranked = sorted(
        (
            (len(premise_terms & meaningful_terms(sentence)), premise_terms & meaningful_terms(sentence), sentence)
            for sentence in sentences
            if _has_material_change_cue(sentence)
        ),
        reverse=True,
    )
    if not ranked or ranked[0][0] < 1:
        return None
    overlap, shared_terms, excerpt = ranked[0]
    statement = premise.statement.lower()
    is_explicit_trigger = premise.kind == PremiseKind.REVISIT_CONDITION and bool(
        re.search(r"\b(revisit|if|when|after|once|migrat\w*|upgrad\w*)\b", statement)
    )
    is_affected_obligation = (
        premise.kind in {PremiseKind.REQUIREMENT, PremiseKind.HARD_CONSTRAINT}
        and bool(re.search(r"\b(must|need|require|verification|revocation|security|support)\w*\b", statement))
        and (overlap >= 2 or bool(shared_terms & {"authentication", "revocation", "signing", "verification"}))
    )
    if not is_explicit_trigger and not is_affected_obligation:
        return None

    relationship = Relationship.SUPPORTS if is_explicit_trigger else Relationship.WEAKENS
    return RevisitFinding(
        premise_id=premise.premise_id,
        premise_statement=premise.statement,
        relationship=relationship,
        confidence_band="low",
        explanation=(
            "A deterministic safety check found an explicit change matching this review trigger; "
            "human confirmation is required."
            if is_explicit_trigger
            else "A deterministic safety check found a capability change connected to this obligation; "
            "human review is required to determine materiality."
        ),
        missing_context_question=(
            None
            if is_explicit_trigger
            else "Does the replacement path still satisfy this requirement in the deployed environment?"
        ),
        old_excerpt=premise.old_excerpt,
        new_excerpt=excerpt,
        source_fallback_performed=criticality in {"important", "critical"} and premise.old_excerpt is not None,
        detection_source="deterministic_safety_net",
    )


def _has_material_change_cue(value: str) -> bool:
    return bool(
        re.search(
            r"\b(retir\w*|deprecat\w*|end(?:ed|ing)? of (?:life|support)|eol|no longer|"
            r"turned off|revok\w*|replac\w*|transition\w*|must change|migrat\w*|"
            r"support (?:ends|ended)|reduc\w*|postpon\w*)\b",
            value.lower(),
        )
    )


def _direct_requirement_support(statement: str, excerpt: str) -> bool:
    """Reject generic 'supports' labels based only on a shared product name."""
    stopwords = {
        "and",
        "for",
        "from",
        "have",
        "must",
        "needs",
        "remain",
        "service",
        "should",
        "support",
        "supports",
        "that",
        "the",
        "this",
        "with",
    }
    statement_tokens = {
        token for token in re.findall(r"[a-z0-9][a-z0-9.-]+", statement.lower()) if token not in stopwords
    }
    excerpt_tokens = {token for token in re.findall(r"[a-z0-9][a-z0-9.-]+", excerpt.lower()) if token not in stopwords}
    return len(statement_tokens & excerpt_tokens) >= 2


def _ground_excerpt(candidate: str, source_text: str) -> str | None:
    """Return the exact source span, tolerating whitespace collapsed by a model."""
    candidate = candidate.strip()
    if not candidate:
        return None
    if candidate in source_text:
        return candidate
    tokens = candidate.split()
    if not tokens:
        return None
    match = re.search(r"\s+".join(re.escape(token) for token in tokens), source_text)
    return match.group(0) if match else None


def available_models(settings: Settings) -> list[ModelOption]:
    provider = settings.ai_provider.lower()
    if provider == "ollama":
        descriptions = {
            "qwen3.5:9b": ("Qwen 3.5 9B", "Careful premise extraction; lower false-positive rate in the current eval"),
            "gemma4:e4b": ("Gemma 4 E4B", "Faster evidence revisits; stronger relationship recall in the current eval"),
        }
        return [
            ModelOption(
                id=f"ollama/{model}",
                provider="ollama",
                model=model,
                label=descriptions.get(model, (model, "Locally configured Ollama model"))[0],
                location="local",
                best_for=descriptions.get(model, (model, "Locally configured Ollama model"))[1],
            )
            for model in settings.configured_ollama_models
        ]
    if provider == "openai":
        return [
            ModelOption(
                id=f"openai/{settings.openai_model}",
                provider="openai",
                model=settings.openai_model,
                label=settings.openai_model,
                location="hosted",
                best_for="Hosted structured extraction and evidence review",
            )
        ]
    return [
        ModelOption(
            id="deterministic/rules-v1",
            provider="deterministic",
            model="rules-v1",
            label="Deterministic rules",
            location="local",
            best_for="Fast tests without a language model",
        )
    ]


def default_model_id(settings: Settings) -> str:
    return available_models(settings)[0].id


def get_provider(settings: Settings, model_id: str | None = None) -> ExtractionProvider:
    options = available_models(settings)
    selected = next((option for option in options if option.id == (model_id or default_model_id(settings))), None)
    if selected is None:
        raise ValueError("The selected model is not in the server's configured model allowlist")
    if selected.provider == "ollama":
        return OllamaProvider(settings.model_copy(update={"ollama_model": selected.model}))
    if selected.provider == "openai":
        return OpenAIResponsesProvider(settings.model_copy(update={"openai_model": selected.model}))
    return DeterministicProvider()
