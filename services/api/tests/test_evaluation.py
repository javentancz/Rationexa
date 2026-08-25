import json
from collections import Counter
from pathlib import Path

import pytest

from rationexa_api.evaluation import (
    RealCase,
    _write_json_atomic,
    case_content_hash,
    evaluate_model,
    evaluate_trust_gate,
    load_cases,
    load_dataset,
    score_extraction,
    score_revisit,
    validate_dataset_separation,
)
from rationexa_api.providers import DeterministicProvider, _repair_source_anchor
from rationexa_api.schemas import CandidatePremise, ExtractionResult, RevisitFinding


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
    assert score["invalid_anchor_count"] == 0
    assert score["unanchored_premise_count"] == 1


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

    score = score_revisit(findings, canonical, "It is now end-of-life. Node.js")

    assert score["detection_recall"] == 1.0
    assert score["relationship_accuracy"] == 0.0
    assert score["relationship_precision"] == 0.0
    assert score["false_positive_ids"] == ["unrelated"]
    assert score["missed_relevant_count"] == 0
    assert score["ungrounded_finding_count"] == 0


def test_trust_gate_requires_reviewed_cases_and_zero_critical_misses(tmp_path: Path) -> None:
    cases = [
        RealCase(
            directory=tmp_path,
            metadata={"review_status": "independently_reviewed"},
            decision="decision",
            evidence="evidence",
        )
    ]
    aggregate = {
        "cases_passed": 1,
        "cases_total": 1,
        "concept_recall": 1.0,
        "anchor_rate": 1.0,
        "revisit_detection_recall": 1.0,
        "relationship_precision": 1.0,
        "false_positive_count": 0,
        "critical_miss_count": 0,
        "fabricated_quote_count": 0,
    }
    thresholds = {
        "name": "Test trust gate",
        "minimum_case_count": 1,
        "require_independent_review": True,
        "minimum_concept_recall": 0.9,
        "minimum_anchor_rate": 0.9,
        "minimum_revisit_detection_recall": 0.9,
        "minimum_relationship_precision": 0.8,
        "maximum_false_positives": 0,
        "maximum_critical_misses": 0,
        "maximum_fabricated_quotes": 0,
    }

    passed = evaluate_trust_gate(
        {"models": [{"model": "test", "aggregate": aggregate}]},
        cases,
        thresholds,
    )
    failed = evaluate_trust_gate(
        {"models": [{"model": "test", "aggregate": {**aggregate, "critical_miss_count": 1}}]},
        cases,
        thresholds,
    )

    assert passed["passed"] is True
    assert failed["passed"] is False
    assert (
        next(check for check in failed["models"][0]["checks"] if check["metric"] == "critical_miss_count")["passed"]
        is False
    )


def test_real_case_suite_meets_stage_one_smoke_coverage() -> None:
    evals_dir = Path(__file__).parents[3] / "packages" / "evals"
    manifest, cases = load_dataset(
        evals_dir / "datasets" / "development.manifest.json",
        evals_dir / "real_cases",
    )
    categories = Counter(case.metadata["category"] for case in cases)

    assert manifest["id"] == "development-v2"
    assert manifest["status"] == "frozen"
    assert len(cases) >= 30
    assert categories["lifecycle"] >= 4
    assert categories["contradiction"] + categories["weakening"] >= 3
    assert categories["positive_support"] >= 2
    assert categories["irrelevant"] + categories["irrelevant_scope"] + categories["adversarial"] >= 3

    for case in cases:
        assert case.metadata["review_status"] == "curated_pending_independent_review"
        assert case.metadata["evidence_source_urls"]
        assert case.metadata["extraction_expectations"]
        assert case.metadata["canonical_premises"]
        normalized_decision = " ".join(case.decision.lower().split())
        for expectation in case.metadata["extraction_expectations"]:
            assert all(keyword.lower() in normalized_decision for keyword in expectation["keywords"]), (
                case.case_id,
                expectation,
            )
        for premise in case.metadata["canonical_premises"]:
            if premise.get("old_excerpt"):
                assert " ".join(premise["old_excerpt"].lower().split()) in normalized_decision, (
                    case.case_id,
                    premise["premise_id"],
                )


def test_saved_benchmark_premises_are_groundable_after_offset_repair() -> None:
    repo_root = Path(__file__).parents[3]
    report = json.loads((repo_root / "packages" / "evals" / "reports" / "local-model-comparison.json").read_text())

    assert report["trust_gate"]["passed"] is False
    assert all(model["aggregate"]["fabricated_quote_count"] == 0 for model in report["models"])

    for model in report["models"]:
        for case in model["cases"]:
            source = (repo_root / "packages" / "evals" / "real_cases" / case["case_id"] / "decision.md").read_text()
            for premise_data in case["extraction"]["premises"]:
                premise = CandidatePremise.model_validate(premise_data)
                assert _repair_source_anchor(premise, source) is not None, (
                    model["model"],
                    case["case_id"],
                    premise.statement,
                )


def test_evaluator_reports_progress_after_each_case() -> None:
    cases_dir = Path(__file__).parents[3] / "packages" / "evals" / "real_cases"
    cases = load_cases(cases_dir)[:2]
    completed_counts = []

    result = evaluate_model(
        "rules-v1",
        cases,
        DeterministicProvider(),
        lambda completed: completed_counts.append(len(completed)),
    )

    assert completed_counts == [1, 2]
    assert result["aggregate"]["cases_passed"] == 2


def test_checkpoint_writer_replaces_complete_json_atomically(tmp_path: Path) -> None:
    checkpoint = tmp_path / "comparison.checkpoint.json"

    _write_json_atomic(checkpoint, {"status": "running", "completed": 1})
    _write_json_atomic(checkpoint, {"status": "complete", "completed": 2})

    assert json.loads(checkpoint.read_text()) == {"status": "complete", "completed": 2}
    assert not checkpoint.with_suffix(".json.tmp").exists()


def test_frozen_dataset_rejects_changed_case_content(tmp_path: Path) -> None:
    cases_root = tmp_path / "cases"
    case_dir = cases_root / "sample"
    case_dir.mkdir(parents=True)
    (case_dir / "case.json").write_text(json.dumps({"id": "sample"}))
    (case_dir / "decision.md").write_text("Original decision")
    (case_dir / "new-evidence.md").write_text("Original evidence")
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "id": "frozen-test",
                "cases": [{"id": "sample", "sha256": case_content_hash(case_dir)}],
            }
        )
    )

    load_dataset(manifest_path, cases_root)
    (case_dir / "decision.md").write_text("Decision changed after freezing")

    with pytest.raises(ValueError, match="Frozen case sample changed"):
        load_dataset(manifest_path, cases_root)


def test_dataset_separation_rejects_id_or_content_leakage() -> None:
    development = {"id": "development", "cases": [{"id": "case-a", "sha256": "aaa"}]}

    with pytest.raises(ValueError, match="Case ID case-a"):
        validate_dataset_separation(
            development,
            {"id": "holdout", "cases": [{"id": "case-a", "sha256": "bbb"}]},
        )

    with pytest.raises(ValueError, match="duplicates content"):
        validate_dataset_separation(
            development,
            {"id": "holdout", "cases": [{"id": "case-b", "sha256": "aaa"}]},
        )
