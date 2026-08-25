# Stage 1 readiness

Updated: 2026-08-25

## Current verdict

The Stage 1 product workflow is implemented as a working prototype. Stage 1 is
not release-complete because the reliability and real-user gates have not yet
passed.

The 30-case development regression set is implemented and frozen. Independent
label review, a sealed holdout run, and moderated user tests remain part of the
Stage 1 definition of done.

## Implemented

- Text, Markdown, and PDF import.
- Typed premise extraction with exact-anchor validation.
- Human confirm, edit, reject, and finalize workflow.
- New-evidence revisit workflow with evidence displayed beside findings.
- Local Qwen and Gemma model selection.
- Optional OpenAI-compatible hosted adapter.
- Repeatable evaluation harness and 30 curated source-backed cases.
- Frozen `development-v2` manifest with content-integrity and holdout-leakage
  checks; sealed holdout collection remains external and pending.
- Background extraction and revisit jobs with visible phases, polling,
  cancellation, and late-result suppression.
- Automated case-composition gate, API tests, lint, and web build checks.
- Machine-readable Stage 1 trust gate with explicit case-count, independent-review,
  recall, precision, false-positive, critical-miss, and fabricated-quote thresholds.
- Side-by-side Compare mode with disagreement, latency, token, prompt, model, and
  cost provenance.
- Deterministic lifecycle safety net with explicit origin labels, low-confidence
  handling, exact evidence grounding, and human confirmation requirements.
- Persisted human judgments for every revisit finding: worth reviewing, not
  material, needs context, or false positive.
- Deterministic recovery of explicit scope, responsibility, validation, and
  technical-strategy statements omitted by a model.
- Separate new-constraint findings for mandatory obligations introduced only
  in later evidence, with exact quotes and mandatory human review.

## Acceptance-gate status

### Gate 1: premise extraction — not passed

- Development case count: 30 fixtures available; the minimum-count check passes.
- Independent case review: pending.
- Fresh 2026-08-25 run: Qwen reached 70.0% concept recall and Gemma reached
  68.3%; both remain below the 90% gate.
- Independent label review remains required before this development score can
  count toward release readiness.
- Target: at least 90% recall on human-labeled critical premises, with
  qualifier-preservation and correction-effort review.

### Gate 2: source anchors — not passed

- Exact anchor validation exists.
- Fresh 30-case run after deterministic repair: both models reached 100%
  exact-anchor validity and produced zero ungrounded/fabricated finding excerpts.
- Target: at least 90% correct sampled anchors and no accepted invented quotes.
- Moderated under-30-second source-verification test: pending.

### Gate 3: conflict detection — not passed

- Revisit classifier and side-by-side evidence UI exist.
- Both local models completed all 30 cases. Qwen reached 88.3% revisit recall
  and 91.1% relationship precision with no false positives, but had critical
  misses in `ingress-nginx-retirement` and `letsencrypt-ocsp-retirement`.
  Gemma reached 91.7% revisit recall and 100% relationship precision with no
  false positives, but had critical misses in
  `docker-content-trust-retirement` and `letsencrypt-ocsp-retirement`.
- The prompt and validation changes removed Gemma's earlier
  `node-repeatability` false positive. Gemma now catches the complete ingress
  migration case; Qwen catches the migration premise but still assigns the
  wrong relationship to the maintenance premise, so that critical case remains
  failed.
- Both models produced zero fabricated evidence excerpts.
- A focused post-fix run on the three previously failing critical scenarios
  produced 100% relationship recall and accuracy for both Qwen and Gemma, with
  no false positives. The safety net recovered omitted ingress migration,
  Docker verification, and OCSP revocation relationships when needed.
- The safety net alone was scanned across all 30 visible cases: it recovered 14
  expected high-risk relationships and introduced zero false positives. This is
  a development-set result, not holdout evidence.
- The new-constraint detector was also scanned across all 30 frozen development
  cases and produced zero additional alerts. The Singapore manual regression
  correctly surfaced the later enterprise privacy mandate as a new constraint.
- Target: at least 30 regression cases, 90% critical premise-match recall, 80%
  relationship precision, and zero critical misses in the release candidate.
- Generalization status: the visible 30-case set is restricted to
  development/debugging. No holdout score exists yet.

### Gate 4: real-user trust — instrumentation ready, sessions not started

- Finding-level judgments and timestamps are now persisted in the product.
- Required: 5–8 relevant users testing historical decisions with captured
  correction effort, relevance, trust, and repeat-use intent.

## Next build sequence

1. Have a qualified reviewer independently check all 30 case labels without
   seeing model outputs, then freeze the reviewed manifest.
2. Rerun the complete 30-case suite after independent label review; the focused
   critical-case rerun passes, but extraction recall and generalization remain
   unproven.
3. Run a sealed, non-overlapping 30-case holdout against the frozen code,
   prompts, thresholds, and model versions.
4. Conduct the Gate 4 moderated user test.
5. Add a hosted provider only after the trust gate is stable; do not select a
   default by reputation alone.

## Release language

Until the gates pass, describe Rationexa as an experimental, human-in-the-loop
decision-review prototype. Do not claim that it reliably detects every stale or
contradicted technical decision.
