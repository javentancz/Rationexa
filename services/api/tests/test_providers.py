import json

import httpx
import pytest

from rationexa_api.config import Settings
from rationexa_api.providers import OllamaProvider, _ground_excerpt, _normalize_extraction
from rationexa_api.schemas import ExtractionResult, Relationship, RevisitPremiseInput


def test_ollama_provider_sends_schema_and_validates_response() -> None:
    captured: dict = {}
    extraction = {
        "title": "Gateway choice",
        "decision_question": "Which gateway should we use?",
        "context": "A gateway is required.",
        "chosen_option": "Vendor B",
        "rationale": "Existing team experience.",
        "suggested_criticality": "important",
        "criticality_reason": "Production-facing dependency.",
        "premises": [
            {
                "candidate_id": "candidate-1",
                "kind": "assumption",
                "statement": "Vendor B does not support external users.",
                "qualifiers": "",
                "importance": "high",
                "quality_state": "draft",
                "claim_status": "not_applicable",
                "attention_reason": "Assumption requires review",
                "anchor": {
                    "exact_excerpt": "Vendor B does not support external users.",
                    "start_offset": 0,
                    "end_offset": 41,
                    "page_number": None,
                },
            }
        ],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={"message": {"role": "assistant", "content": json.dumps(extraction)}},
        )

    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="http://127.0.0.1:11434",
    )
    provider = OllamaProvider(
        Settings(ollama_model="qwen3.5:9b", ollama_base_url="http://127.0.0.1:11434"),
        client=client,
    )

    result = provider.extract(extraction["premises"][0]["statement"], "decision.txt")

    assert result.title == "Gateway choice"
    assert captured["model"] == "qwen3.5:9b"
    assert captured["stream"] is False
    assert captured["think"] is False
    assert captured["options"]["temperature"] == 0
    assert captured["format"]["type"] == "object"


def test_ollama_provider_wraps_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="http://127.0.0.1:11434",
    )
    provider = OllamaProvider(Settings(ollama_model="qwen3.5:9b"), client=client)

    with pytest.raises(ValueError, match="configured timeout"):
        provider.extract("A decision was made.", "decision.txt")


def test_ground_excerpt_recovers_exact_source_whitespace() -> None:
    source = "Node 18 is end-of-life, with its last update\non March 27, 2025."

    grounded = _ground_excerpt(
        "Node 18 is end-of-life, with its last update on March 27, 2025.",
        source,
    )

    assert grounded == source
    assert _ground_excerpt("an invented quote", source) is None


def test_extraction_trust_boundary_repairs_obvious_fact_collapse() -> None:
    result = ExtractionResult.model_validate(
        {
            "title": "Ingress choice",
            "decision_question": "Which ingress should we use?",
            "chosen_option": "community NGINX Ingress Controller",
            "premises": [
                {"candidate_id": "p1", "kind": "fact", "statement": "The project needs fast preview URLs."},
                {
                    "candidate_id": "p2",
                    "kind": "fact",
                    "statement": "Adopt the community NGINX Ingress Controller.",
                },
                {
                    "candidate_id": "p3",
                    "kind": "fact",
                    "statement": "The controller is familiar and widely documented.",
                },
                {
                    "candidate_id": "p4",
                    "kind": "fact",
                    "statement": "A later migration to Gateway API is possible.",
                },
            ],
        }
    )

    normalized = _normalize_extraction(result)

    assert [premise.kind.value for premise in normalized.premises] == [
        "requirement",
        "assumption",
        "revisit_condition",
    ]
    assert all(premise.importance == "high" for premise in normalized.premises[1:])


def test_extraction_trust_boundary_recovers_omitted_source_backed_obligation() -> None:
    obligation = "The team accepts responsibility for controller upgrades, monitoring, and troubleshooting."
    source = f"Date: 2026-02-10\n{obligation}"
    result = ExtractionResult.model_validate(
        {
            "title": "Ingress choice",
            "decision_question": "Which ingress should we use?",
            "premises": [],
        }
    )

    normalized = _normalize_extraction(result, source)

    assert len(normalized.premises) == 1
    assert normalized.premises[0].kind.value == "hard_constraint"
    assert normalized.premises[0].anchor is not None
    assert normalized.premises[0].anchor.exact_excerpt == obligation


def test_ollama_revisit_uses_structured_semantic_assessment() -> None:
    captured: dict = {}
    evidence = "The retired controller no longer receives upgrades or security updates."

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        assessment = {
            "findings": [
                {
                    "premise_id": "premise-1",
                    "relevant": True,
                    "relationship": "contradicts",
                    "confidence_band": "high",
                    "explanation": "Upstream upgrades are no longer available.",
                    "new_excerpt": evidence,
                    "missing_context_question": None,
                },
                {
                    "premise_id": "premise-2",
                    "relevant": False,
                    "relationship": "unclear",
                    "confidence_band": "low",
                    "explanation": "Only a generic term overlaps.",
                    "new_excerpt": "invented text",
                    "missing_context_question": None,
                },
            ]
        }
        return httpx.Response(200, json={"message": {"role": "assistant", "content": json.dumps(assessment)}})

    provider = OllamaProvider(
        Settings(ollama_model="qwen3.5:9b"),
        client=httpx.Client(transport=httpx.MockTransport(handler), base_url="http://127.0.0.1:11434"),
    )
    findings = provider.revisit(
        [
            RevisitPremiseInput(
                premise_id="premise-1",
                kind="hard_constraint",
                statement="The team can maintain controller upgrades.",
                old_excerpt="The team can maintain controller upgrades.",
            ),
            RevisitPremiseInput(
                premise_id="premise-2",
                kind="assumption",
                statement="Preview URLs should be fast.",
            ),
        ],
        evidence,
        "critical",
    )

    assert len(findings) == 1
    assert findings[0].relationship == Relationship.CONTRADICTS
    assert findings[0].source_fallback_performed is True
    assert "genuine semantic relationship" in captured["messages"][0]["content"]
    assert captured["format"]["type"] == "object"
