import json
from collections import Counter
from pathlib import Path

from rationexa_api.evaluation import load_cases, score_extraction, score_revisit
from rationexa_api.schemas import ExtractionResult, RevisitFinding


def test_load_cases_requires_case_metadata(tmp_path: Path) -> None:
    case_dir = tmp_path / "sample"
    case_dir.mkdir()
    (case_dir / "case.json").write_text(json.dumps({"id": "sample"}))
    (case_dir / "decision.md").write_text("decision")
    (case_dir / "new-evidence.md").write_text("evidence")

    cases = load_cases(tmp_path)

    assert cases[0].case_id == "sample"
    assert cases[0].evidence == "evidence"


def test_score_extraction_checks_kind_keywords_and_anchors() -> None:
    result = ExtractionResult.model_validate(
        {
            "title": "Runtime",
            "decision_question": "Which runtime?",
            "premises": [
                {
                    "candidate_id": "p1",
                    "kind": "material_claim",
                    "statement": "Node 18 remains supported.",
                    "anchor": {"exact_excerpt": "Node 18", "start_offset": 0, "end_offset": 7},
                },
                {"candidate_id": "p2", "kind": "assumption", "statement": "Upgrades are simple."},
            ],
        }
    )

    score = score_extraction(
        result,
        [
            {"kind": "material_claim", "keywords": ["Node 18", "supported"]},
            {"kind": "revisit_condition", "keywords": ["migration"]},
        ],
        "Node 18 remains supported.",
    )

    assert score["concept_recall"] == 0.5
    assert score["anchor_rate"] == 0.5


def test_score_revisit_separates_relationship_errors_and_false_positives() -> None:
    canonical = [
        {"premise_id": "affected", "expected_relationships": ["supersedes"]},
        {"premise_id": "unrelated", "expected_relationships": []},
    ]
    findings = [
        RevisitFinding(
            premise_id="affected",
            premise_statement="Old runtime is supported.",
            relationship="weakens",
            confidence_band="high",
            explanation="It is now EOL.",
            new_excerpt="end-of-life",
            source_fallback_performed=True,
        ),
        RevisitFinding(
            premise_id="unrelated",
            premise_statement="Tooling is repeatable.",
            relationship="supports",
            confidence_band="low",
            explanation="Incorrectly treated as related.",
            new_excerpt="Node.js",
            source_fallback_performed=False,
        ),
    ]

    score = score_revisit(findings, canonical)

    assert score["detection_recall"] == 1.0
    assert score["relationship_accuracy"] == 0.0
    assert score["false_positive_ids"] == ["unrelated"]


def test_real_case_suite_meets_stage_one_smoke_coverage() -> None:
    cases_dir = Path(__file__).parents[3] / "packages" / "evals" / "real_cases"
    cases = load_cases(cases_dir)
    categories = Counter(case.metadata["category"] for case in cases)

    assert len(cases) >= 12
    assert categories["lifecycle"] >= 4
    assert categories["contradiction"] + categories["weakening"] >= 3
    assert categories["positive_support"] >= 2
    assert categories["irrelevant"] + categories["irrelevant_scope"] + categories["adversarial"] >= 3

    for case in cases:
        assert case.metadata["review_status"] == "curated_pending_independent_review"
        assert case.metadata["evidence_source_urls"]
        assert case.metadata["extraction_expectations"]
        assert case.metadata["canonical_premises"]
