import re
from abc import ABC, abstractmethod
from uuid import uuid4

from openai import OpenAI

from .config import Settings
from .prompts import EXTRACTION_INSTRUCTIONS
from .schemas import (
    CandidatePremise,
    Criticality,
    ExtractionResult,
    PremiseKind,
    SourceAnchor,
)


class ExtractionProvider(ABC):
    name: str
    model: str

    @abstractmethod
    def extract(self, source_text: str, filename: str) -> ExtractionResult:
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
        return ExtractionResult(
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
        )

    @staticmethod
    def _classify(sentence: str) -> PremiseKind | None:
        value = sentence.lower()
        if "revisit if" in value or "revisit when" in value:
            return PremiseKind.REVISIT_CONDITION
        if sentence.endswith("?") or any(word in value for word in ("unknown", "unclear", "to be confirmed")):
            return PremiseKind.UNKNOWN
        if any(word in value for word in ("must not", "cannot", "prohibited", "must ", "required")):
            return PremiseKind.HARD_CONSTRAINT
        if any(word in value for word in ("assume", "expected", "likely", "we believe")):
            return PremiseKind.ASSUMPTION
        material_claim_pattern = (
            r"\b(\d+(?:\.\d+)?%?|pricing|price|rate limit|supports? "
            r"(?:saml|oauth|api)|certified|region|deprecated|end.of.life)\b"
        )
        if re.search(material_claim_pattern, value):
            return PremiseKind.MATERIAL_CLAIM
        if any(word in value for word in ("need to", "should support", "requirement")):
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
        return response.output_parsed


def get_provider(settings: Settings) -> ExtractionProvider:
    if settings.ai_provider.lower() == "openai":
        return OpenAIResponsesProvider(settings)
    return DeterministicProvider()
