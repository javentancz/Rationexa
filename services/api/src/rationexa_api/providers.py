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
    RevisitAssessmentBatch,
    RevisitFinding,
    RevisitPremiseInput,
    SourceAnchor,
)


class ExtractionProvider(ABC):
    name: str
    model: str

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
        sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", source_text) if part.strip()]
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
        return findings

    @staticmethod
    def _classify(sentence: str) -> PremiseKind | None:
        value = sentence.lower()
        if value.startswith(("#", "date:", "status:", "source:")):
            return None
        if (
            "revisit if" in value
            or "revisit when" in value
            or re.search(r"\b(later|eventually|future)\b.*\bmigrat", value)
            or re.search(r"\bmigrat\w*\b.*\b(possible|later|eventually|future)", value)
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
            for word in ("assume", "expected", "likely", "we believe", "familiar", "quickly enough", "simpler than")
        ):
            return PremiseKind.ASSUMPTION
        material_claim_pattern = (
            r"\b(\d+(?:\.\d+)?%?|pricing|price|rate limit|supports? "
            r"(?:saml|oauth|api)|certified|region|deprecated|end.of.life)\b"
        )
        if re.search(material_claim_pattern, value):
            return PremiseKind.MATERIAL_CLAIM
        if any(word in value for word in ("need to", "needs ", "should support", "should use", "requirement")):
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

    def extract(self, source_text: str, filename: str) -> ExtractionResult:
        response = self.client.responses.parse(
            model=self.model,
            store=False,
            instructions=EXTRACTION_INSTRUCTIONS,
            input=f"Filename: {filename}\n\nSOURCE TEXT\n{source_text}",
            text_format=ExtractionResult,
        )
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
        if response.output_parsed is None:
            raise ValueError("The model did not return valid revisit findings")
        return _validated_findings(response.output_parsed, premises, new_evidence, criticality)


class OllamaProvider(ExtractionProvider):
    name = "ollama"

    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self.model = settings.ollama_model
        self.client = client or httpx.Client(
            base_url=settings.ollama_base_url.rstrip("/"),
            timeout=settings.ollama_timeout_seconds,
        )

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
        content = payload.get("message", {}).get("content")
        if not content:
            raise ValueError("Ollama returned no structured content")
        return content


def _revisit_input(premises: list[RevisitPremiseInput], new_evidence: str) -> str:
    premise_data = [premise.model_dump(mode="json", exclude={"old_excerpt"}) for premise in premises]
    return f"PRESERVED PREMISES\n{json.dumps(premise_data, indent=2)}\n\nNEW EVIDENCE\n{new_evidence}"


def _normalize_extraction(result: ExtractionResult, source_text: str | None = None) -> ExtractionResult:
    normalized = []
    for premise in result.premises:
        statement = premise.statement.strip()
        value = statement.lower()
        chosen = (result.chosen_option or "").strip().lower()
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
        high_attention = kind in {
            PremiseKind.HARD_CONSTRAINT,
            PremiseKind.ASSUMPTION,
            PremiseKind.UNKNOWN,
            PremiseKind.MATERIAL_CLAIM,
            PremiseKind.REVISIT_CONDITION,
        }
        premise.importance = "high" if high_attention else "normal"
        premise.attention_reason = f"{kind.value.replace('_', ' ').title()} requires review" if high_attention else None
        normalized.append(premise)

    if source_text:
        source_sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", source_text) if part.strip()]
        represented = "\n".join(premise.statement.lower() for premise in normalized)
        for sentence in source_sentences[:120]:
            kind = DeterministicProvider._classify(sentence)
            if kind is None or sentence.lower() in represented:
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
            represented += f"\n{sentence.lower()}"
    result.premises = normalized
    return result


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
    return findings


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
