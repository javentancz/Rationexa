import json

import httpx
import pytest

from rationexa_api.config import Settings
from rationexa_api.providers import OllamaProvider


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
