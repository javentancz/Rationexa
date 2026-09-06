from pathlib import Path

from rationexa_api.schemas import Relationship, SourceAnchor
from rationexa_api.services import compare_premise, locate_source_excerpt, meaningful_terms, validate_anchor

REAL_CASE = (
    Path(__file__).parents[3] / "packages" / "evals" / "real_cases" / "ingress-nginx-retirement" / "new-evidence.md"
)


def test_anchor_is_recomputed_from_exact_source() -> None:
    source = "Context. Vendor B does not support external users. Decision."
    proposed = SourceAnchor(
        exact_excerpt="Vendor B does not support external users.",
        start_offset=999,
        end_offset=1000,
    )

    result = validate_anchor(proposed, source)

    assert result is not None
    assert source[result.start_offset : result.end_offset] == result.exact_excerpt


def test_invented_anchor_is_rejected() -> None:
    source = "The source contains no pricing statement."
    proposed = SourceAnchor(exact_excerpt="The price is $10.", start_offset=0, end_offset=17)

    assert validate_anchor(proposed, source) is None


def test_anchor_normalizes_browser_typography_but_preserves_raw_offsets() -> None:
    source = 'Decision:\r\nVendor\u00a0B uses “EU-only” storage — with audit logs.'
    candidate = 'Vendor B uses "EU-only" storage - with audit logs.'

    located = locate_source_excerpt(candidate, source)

    assert located is not None
    excerpt, start, end = located
    assert excerpt == 'Vendor\u00a0B uses “EU-only” storage — with audit logs.'
    assert source[start:end] == excerpt
    validated = validate_anchor(SourceAnchor(exact_excerpt=candidate, start_offset=0, end_offset=1), source)
    assert validated is not None
    assert (validated.start_offset, validated.end_offset) == (start, end)
    assert validated.exact_excerpt == excerpt


def test_revisit_detects_negation_change() -> None:
    result = compare_premise(
        premise_id="premise-1",
        premise_statement="Vendor B does not support external users.",
        old_excerpt="Vendor B does not support external users.",
        new_evidence="Vendor B now supports external users for enterprise tenants.",
        criticality="important",
    )

    assert result is not None
    assert result.relationship == Relationship.CONTRADICTS
    assert result.source_fallback_performed is True


def test_revisit_preserves_ambiguous_evidence_as_unclear() -> None:
    result = compare_premise(
        premise_id="premise-1",
        premise_statement="Vendor pricing will remain within the approved annual limit.",
        old_excerpt="Vendor pricing will remain within the approved annual limit.",
        new_evidence="Vendor pricing might change next year, but no new annual limit is confirmed.",
        criticality="important",
    )

    assert result is not None
    assert result.relationship == Relationship.UNCLEAR
    assert result.missing_context_question is not None


def test_revisit_distinguishes_negation_from_continued_support() -> None:
    contradicted = compare_premise(
        premise_id="premise-1",
        premise_statement="Vendor B supports SAML for enterprise tenants.",
        old_excerpt="Vendor B supports SAML for enterprise tenants.",
        new_evidence="Vendor B no longer supports SAML for enterprise tenants.",
        criticality="critical",
    )
    supported = compare_premise(
        premise_id="premise-1",
        premise_statement="Vendor B supports SAML for enterprise tenants.",
        old_excerpt="Vendor B supports SAML for enterprise tenants.",
        new_evidence="Vendor B still supports SAML for enterprise tenants.",
        criticality="critical",
    )

    assert contradicted is not None and contradicted.relationship == Relationship.CONTRADICTS
    assert supported is not None and supported.relationship == Relationship.SUPPORTS


def test_meaningful_terms_keeps_short_version_identifiers() -> None:
    assert {"move", "v4"} <= meaningful_terms("Workflows must move to v4.")


def test_ingress_retirement_filters_noise_and_detects_upgrade_conflict() -> None:
    evidence = REAL_CASE.read_text()

    unrelated = compare_premise(
        premise_id="preview-speed",
        premise_statement="The project needs fast and reliable preview URLs for pull requests.",
        old_excerpt="The project needs fast and reliable preview URLs for pull requests.",
        new_evidence=evidence,
        criticality="critical",
    )
    conflict = compare_premise(
        premise_id="controller-upgrades",
        premise_statement="The team accepts responsibility for controller upgrades, monitoring, and troubleshooting.",
        old_excerpt="The team accepts responsibility for controller upgrades, monitoring, and troubleshooting.",
        new_evidence=evidence,
        criticality="critical",
    )

    assert unrelated is None
    assert conflict is not None
    assert conflict.relationship == Relationship.CONTRADICTS
    assert "word" not in conflict.explanation.lower()
