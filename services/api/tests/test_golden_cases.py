import json
from pathlib import Path

from rationexa_api.providers import DeterministicProvider

CASES = Path(__file__).parents[3] / "packages" / "evals" / "golden_cases"


def test_all_golden_cases_extract_an_expected_premise_kind() -> None:
    provider = DeterministicProvider()
    paths = sorted(CASES.glob("*.json"))
    assert len(paths) == 5

    for path in paths:
        case = json.loads(path.read_text())
        result = provider.extract(case["source"], path.name)
        kinds = {premise.kind.value for premise in result.premises}
        assert set(case["expected_kinds"]) & kinds, f"{path.name}: {kinds}"
        assert all(
            premise.anchor is None or premise.anchor.exact_excerpt in case["source"] for premise in result.premises
        )
