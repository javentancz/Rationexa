import json
from collections import Counter
from pathlib import Path

import pytest

from rationexa_api.evaluation import (
    _write_json_atomic,
    case_content_hash,
    evaluate_model,
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
    evals_dir = Path(__file__).parents[3] / "packages" / "evals"
    manifest, cases = load_dataset(
        evals_dir / "datasets" / "development.manifest.json",
        evals_dir / "real_cases",
    )
    categories = Counter(case.metadata["category"] for case in cases)

    assert manifest["id"] == "development-v1"
    assert manifest["status"] == "frozen"
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


def test_saved_benchmark_premises_are_groundable_after_offset_repair() -> None:
    repo_root = Path(__file__).parents[3]
    report = json.loads(
        (repo_root / "packages" / "evals" / "reports" / "local-model-comparison.json").read_text()
    )

    for model in report["models"]:
        for case in model["cases"]:
            source = (
                repo_root / "packages" / "evals" / "real_cases" / case["case_id"] / "decision.md"
            ).read_text()
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
