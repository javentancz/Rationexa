import json

import httpx
import pytest

from rationexa_api.config import Settings
from rationexa_api.providers import (
    OllamaProvider,
    _ground_excerpt,
    _normalize_extraction,
    available_models,
    get_provider,
)
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
            json={
                "message": {"role": "assistant", "content": json.dumps(extraction)},
                "prompt_eval_count": 123,
                "eval_count": 45,
            },
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
    assert provider.last_usage == {
        "input_tokens": 123,
        "output_tokens": 45,
        "estimated_cost_usd": 0.0,
    }


def test_model_catalog_and_selector_use_allowlisted_ollama_model() -> None:
    settings = Settings(
        ai_provider="ollama",
        ollama_model="qwen3.5:9b",
        ollama_models="qwen3.5:9b,gemma4:e4b",
    )

    options = available_models(settings)
    provider = get_provider(settings, "ollama/gemma4:e4b")

    assert [option.id for option in options] == ["ollama/qwen3.5:9b", "ollama/gemma4:e4b"]
    assert provider.model == "gemma4:e4b"
    provider.client.close()


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


def test_extraction_trust_boundary_repairs_and_recovers_model_anchors() -> None:
    source = "The service must stay in the EU.\nThe current provider is expected to remain available."
    result = ExtractionResult.model_validate(
        {
            "title": "Hosting",
            "decision_question": "Where should the service run?",
            "premises": [
                {
                    "candidate_id": "p1",
                    "kind": "hard_constraint",
                    "statement": "The service must stay in the EU.",
                    "anchor": {
                        "exact_excerpt": "The service must stay in the EU.",
                        "start_offset": 999,
                        "end_offset": 1000,
                    },
                },
                {
                    "candidate_id": "p2",
                    "kind": "assumption",
                    "statement": "The current provider is expected to remain available.",
                },
                {
                    "candidate_id": "p3",
                    "kind": "assumption",
                    "statement": "An invented availability guarantee.",
                    "anchor": {
                        "exact_excerpt": "An invented quote.",
                        "start_offset": 0,
                        "end_offset": 18,
                    },
                },
            ],
        }
    )

    normalized = _normalize_extraction(result, source)

    assert normalized.premises[0].anchor is not None
    assert normalized.premises[0].anchor.start_offset == 0
    assert normalized.premises[1].anchor is not None
    assert normalized.premises[1].anchor.exact_excerpt == "The current provider is expected to remain available."
    assert normalized.premises[2].anchor is None


def test_extraction_recovery_keeps_soft_wrapped_markdown_sentence_together() -> None:
    source = (
        "## Decision\n\n"
        "Choose PostgreSQL because it is open source, the team can\n"
        "implement the APIs quickly, and contributors know SQL.\n"
    )
    result = ExtractionResult.model_validate(
        {
            "title": "Database",
            "decision_question": "Which database?",
            "chosen_option": "PostgreSQL",
            "premises": [],
        }
    )

    normalized = _normalize_extraction(result, source)

    assert len(normalized.premises) == 1
    assert "implement the APIs quickly" in normalized.premises[0].statement.replace("\n", " ")
    assert normalized.premises[0].kind.value == "assumption"
    assert normalized.premises[0].anchor is not None
    anchor = normalized.premises[0].anchor
    assert source[anchor.start_offset : anchor.end_offset] == anchor.exact_excerpt


def test_extraction_recovery_does_not_duplicate_whitespace_collapsed_model_statement() -> None:
    source = "The team can\nimplement the APIs quickly."
    result = ExtractionResult.model_validate(
        {
            "title": "Database",
            "decision_question": "Which database?",
            "premises": [
                {
                    "candidate_id": "p1",
                    "kind": "assumption",
                    "statement": "The team can implement the APIs quickly.",
                }
            ],
        }
    )

    normalized = _normalize_extraction(result, source)

    assert len(normalized.premises) == 1
    assert normalized.premises[0].anchor is not None


def test_extraction_recovery_recognizes_soft_wrapped_runtime_revisit_condition() -> None:
    source = (
        "The pin assumes Node 18 remains a\n"
        "supported production runtime. Moving to a newer major version will require a\n"
        "deliberate toolchain and compatibility update."
    )
    result = ExtractionResult.model_validate(
        {
            "title": "Runtime",
            "decision_question": "Which runtime?",
            "premises": [],
        }
    )

    normalized = _normalize_extraction(result, source)

    assert [premise.kind.value for premise in normalized.premises] == ["assumption", "revisit_condition"]
    assert all(premise.anchor is not None for premise in normalized.premises)


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
