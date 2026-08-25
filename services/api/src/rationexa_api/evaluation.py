"""Repeatable local-model evaluation over Rationexa's real-world cases."""

from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import Settings
from .providers import ExtractionProvider, OllamaProvider
from .schemas import ExtractionResult, RevisitPremiseInput


@dataclass(frozen=True)
class RealCase:
    directory: Path
    metadata: dict[str, Any]
    decision: str
    evidence: str

    @property
    def case_id(self) -> str:
        return str(self.metadata["id"])


def load_cases(cases_dir: Path) -> list[RealCase]:
    cases = []
    for metadata_path in sorted(cases_dir.glob("*/case.json")):
        directory = metadata_path.parent
        cases.append(
            RealCase(
                directory=directory,
                metadata=json.loads(metadata_path.read_text()),
                decision=(directory / "decision.md").read_text(),
                evidence=(directory / "new-evidence.md").read_text(),
            )
        )
    if not cases:
        raise ValueError(f"No real cases found in {cases_dir}")
    return cases


def score_extraction(
    result: ExtractionResult,
    expectations: list[dict[str, Any]],
    source_text: str | None = None,
) -> dict[str, Any]:
    matches = []
    for expectation in expectations:
        expected_kind = expectation["kind"]
        keywords = [keyword.lower() for keyword in expectation["keywords"]]
        matching_premise = next(
            (
                premise
                for premise in result.premises
                if premise.kind.value == expected_kind
                and all(keyword in premise.statement.lower() for keyword in keywords)
            ),
            None,
        )
        matches.append(
            {
                "kind": expected_kind,
                "keywords": expectation["keywords"],
                "matched": matching_premise is not None,
                "premise": matching_premise.statement if matching_premise else None,
            }
        )

    anchored = sum(_valid_anchor(premise.anchor, source_text) for premise in result.premises)
    return {
        "premise_count": len(result.premises),
        "anchor_rate": round(anchored / len(result.premises), 3) if result.premises else 0.0,
        "concept_recall": round(sum(item["matched"] for item in matches) / len(matches), 3) if matches else 1.0,
        "expectation_matches": matches,
        "premises": [premise.model_dump(mode="json") for premise in result.premises],
    }


def _valid_anchor(anchor: Any, source_text: str | None) -> bool:
    if anchor is None:
        return False
    if source_text is None:
        return True
    return (
        anchor.end_offset <= len(source_text)
        and source_text[anchor.start_offset : anchor.end_offset] == anchor.exact_excerpt
    )


def canonical_inputs(metadata: dict[str, Any]) -> list[RevisitPremiseInput]:
    return [
        RevisitPremiseInput(
            premise_id=item["premise_id"],
            kind=item["kind"],
            statement=item["statement"],
            old_excerpt=item.get("old_excerpt"),
        )
        for item in metadata["canonical_premises"]
    ]


def score_revisit(findings: list[Any], canonical: list[dict[str, Any]]) -> dict[str, Any]:
    expected = {item["premise_id"]: set(item["expected_relationships"]) for item in canonical}
    expected_relevant = {premise_id for premise_id, relationships in expected.items() if relationships}
    finding_by_id = {finding.premise_id: finding for finding in findings}
    detected = expected_relevant & finding_by_id.keys()
    correct = {
        premise_id
        for premise_id in detected
        if finding_by_id[premise_id].relationship.value in expected[premise_id]
    }
    false_positives = set(finding_by_id) - expected_relevant

    return {
        "expected_relevant": len(expected_relevant),
        "finding_count": len(findings),
        "detection_recall": round(len(detected) / len(expected_relevant), 3) if expected_relevant else 1.0,
        "relationship_accuracy": round(len(correct) / len(expected_relevant), 3) if expected_relevant else 1.0,
        "false_positive_count": len(false_positives),
        "false_positive_ids": sorted(false_positives),
        "findings": [finding.model_dump(mode="json") for finding in findings],
    }


def evaluate_model(
    model: str,
    cases: list[RealCase],
    provider: ExtractionProvider,
    on_case_completed: Callable[[list[dict[str, Any]]], None] | None = None,
) -> dict[str, Any]:
    case_results = []
    for case in cases:
        started = time.perf_counter()
        try:
            extraction = provider.extract(case.decision, "decision.md")
            extraction_seconds = time.perf_counter() - started
            revisit_started = time.perf_counter()
            findings = provider.revisit(
                canonical_inputs(case.metadata),
                case.evidence,
                case.metadata["criticality"],
            )
            revisit_seconds = time.perf_counter() - revisit_started
            case_results.append(
                {
                    "case_id": case.case_id,
                    "status": "passed",
                    "extraction_seconds": round(extraction_seconds, 2),
                    "revisit_seconds": round(revisit_seconds, 2),
                    "extraction": score_extraction(
                        extraction,
                        case.metadata["extraction_expectations"],
                        case.decision,
                    ),
                    "revisit": score_revisit(findings, case.metadata["canonical_premises"]),
                }
            )
        except Exception as exc:  # keep a multi-model run useful when one model fails
            case_results.append(
                {
                    "case_id": case.case_id,
                    "status": "error",
                    "error": f"{type(exc).__name__}: {exc}",
                    "elapsed_seconds": round(time.perf_counter() - started, 2),
                }
            )
        if on_case_completed is not None:
            on_case_completed(list(case_results))

    passed = [item for item in case_results if item["status"] == "passed"]
    aggregate = {
        "cases_passed": len(passed),
        "cases_total": len(case_results),
        "concept_recall": _mean([item["extraction"]["concept_recall"] for item in passed]),
        "anchor_rate": _mean([item["extraction"]["anchor_rate"] for item in passed]),
        "revisit_detection_recall": _mean([item["revisit"]["detection_recall"] for item in passed]),
        "relationship_accuracy": _mean([item["revisit"]["relationship_accuracy"] for item in passed]),
        "false_positive_count": sum(item["revisit"]["false_positive_count"] for item in passed),
        "total_seconds": round(
            sum(item["extraction_seconds"] + item["revisit_seconds"] for item in passed),
            2,
        ),
    }
    return {"model": model, "aggregate": aggregate, "cases": case_results}


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 3) if values else None


def markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "# Rationexa local-model comparison",
        "",
        f"Generated: {report['generated_at']}",
        "",
        "Scores use model extraction output, but revisit scoring gives every model the same curated premises.",
        "",
        "| Model | Cases | Extraction recall | Anchor rate | Revisit recall "
        "| Relationship accuracy | False positives | Time |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for model_result in report["models"]:
        aggregate = model_result["aggregate"]
        lines.append(
            f"| {model_result['model']} | {aggregate['cases_passed']}/{aggregate['cases_total']} "
            f"| {_percent(aggregate['concept_recall'])} | {_percent(aggregate['anchor_rate'])} "
            f"| {_percent(aggregate['revisit_detection_recall'])} "
            f"| {_percent(aggregate['relationship_accuracy'])} "
            f"| {aggregate['false_positive_count']} | {aggregate['total_seconds']:.2f}s |"
        )

    for model_result in report["models"]:
        lines.extend(["", f"## {model_result['model']}", ""])
        for case in model_result["cases"]:
            if case["status"] == "error":
                lines.append(f"- **{case['case_id']}** — ERROR: {case['error']}")
                continue
            extraction = case["extraction"]
            revisit = case["revisit"]
            relationships = ", ".join(
                f"{finding['premise_id']}={finding['relationship']}" for finding in revisit["findings"]
            ) or "none"
            lines.append(
                f"- **{case['case_id']}** — extraction {_percent(extraction['concept_recall'])}; "
                f"revisit {_percent(revisit['relationship_accuracy'])}; "
                f"false positives {revisit['false_positive_count']}; findings: {relationships}"
            )
    lines.append("")
    return "\n".join(lines)


def _percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def run(
    models: list[str],
    cases_dir: Path,
    timeout_seconds: float,
    checkpoint_path: Path | None = None,
) -> dict[str, Any]:
    cases = load_cases(cases_dir)
    model_results = []
    for model in models:
        settings = Settings(ollama_model=model, ollama_timeout_seconds=timeout_seconds)
        provider = OllamaProvider(settings)

        def checkpoint(case_results: list[dict[str, Any]], current_model: str = model) -> None:
            latest = case_results[-1]
            print(
                f"[{current_model}] {len(case_results)}/{len(cases)} "
                f"{latest['case_id']}: {latest['status']}",
                flush=True,
            )
            if checkpoint_path is not None:
                _write_json_atomic(
                    checkpoint_path,
                    {
                        "status": "running",
                        "updated_at": datetime.now(UTC).isoformat(),
                        "case_ids": [case.case_id for case in cases],
                        "models_requested": models,
                        "models_completed": model_results,
                        "current_model": current_model,
                        "current_model_cases": case_results,
                    },
                )

        try:
            model_results.append(evaluate_model(model, cases, provider, checkpoint))
        finally:
            provider.client.close()
    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "cases": [case.case_id for case in cases],
        "models": model_results,
    }
    if checkpoint_path is not None:
        _write_json_atomic(
            checkpoint_path,
            {
                "status": "complete",
                "updated_at": datetime.now(UTC).isoformat(),
                "report": report,
            },
        )
    return report


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def main() -> None:
    repo_root = Path(__file__).resolve().parents[4]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", default=["qwen3.5:9b", "gemma4:e4b"])
    parser.add_argument(
        "--cases-dir",
        type=Path,
        default=repo_root / "packages/evals/real_cases",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root / "packages/evals/reports/local-model-comparison",
    )
    parser.add_argument("--timeout-seconds", type=float, default=300)
    args = parser.parse_args()

    report = run(
        args.models,
        args.cases_dir,
        args.timeout_seconds,
        checkpoint_path=args.output.with_suffix(".checkpoint.json"),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    args.output.with_suffix(".md").write_text(markdown_report(report))
    print(markdown_report(report))


if __name__ == "__main__":
    main()
