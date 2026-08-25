# Stage 1 readiness

Updated: 2026-08-25

## Current verdict

The Stage 1 product workflow is implemented as a working prototype. Stage 1 is
not release-complete because the reliability and real-user gates have not yet
passed.

The 12-case suite is the development/model-selection minimum. The 30-case
regression set and moderated user tests remain part of the Stage 1 definition
of done.

## Implemented

- Text, Markdown, and PDF import.
- Typed premise extraction with exact-anchor validation.
- Human confirm, edit, reject, and finalize workflow.
- New-evidence revisit workflow with evidence displayed beside findings.
- Local Qwen and Gemma model selection.
- Optional OpenAI-compatible hosted adapter.
- Repeatable evaluation harness and 12 curated source-backed cases.
- Frozen `development-v1` manifest with content-integrity and holdout-leakage
  checks; sealed holdout collection remains external and pending.
- Background extraction and revisit jobs with visible phases, polling,
  cancellation, and late-result suppression.
- Automated case-composition gate, API tests, lint, and web build checks.
- Machine-readable Stage 1 trust gate with explicit case-count, independent-review,
  recall, precision, false-positive, critical-miss, and fabricated-quote thresholds.
- Side-by-side Compare mode with disagreement, latency, token, prompt, model, and
  cost provenance.

## Acceptance-gate status

### Gate 1: premise extraction — not passed

- Development case count: 12 fixtures available.
- Independent case review: pending.
- Fresh 2026-08-25 run: Qwen and Gemma each reached 95.8% concept recall.
- Independent label review remains required before this development score can
  count toward release readiness.
- Target: at least 90% recall on human-labeled critical premises, with
  qualifier-preservation and correction-effort review.

### Gate 2: source anchors — not passed

- Exact anchor validation exists.
- Fresh 2026-08-25 run after deterministic repair: both models reached 100%
  exact-anchor validity and produced zero ungrounded/fabricated finding excerpts.
- Target: at least 90% correct sampled anchors and no accepted invented quotes.
- Moderated under-30-second source-verification test: pending.

### Gate 3: conflict detection — not passed

- Revisit classifier and side-by-side evidence UI exist.
- Twelve development cases are available and both local models completed the
  fresh trust-gate run. Qwen reached 87.5% revisit recall and 92.3% relationship
  precision with no false positives, but missed the critical `ingress-migration`
  relationship. Gemma reached 100% revisit recall and 94.1% relationship
  precision with no critical misses, but produced one false positive on
  `node-repeatability`.
- Target: at least 30 regression cases, 90% critical premise-match recall, 80%
  relationship precision, and zero critical misses in the release candidate.
- Generalization status: the visible 12-case set is now restricted to
  development/debugging. No holdout score exists yet.

### Gate 4: real-user trust — not started

- Required: 5–8 relevant users testing historical decisions with captured
  correction effort, relevance, trust, and repeat-use intent.

## Next build sequence

1. Independently review and correct the labels in the 12-case suite.
2. Classify and address Qwen's critical ingress migration miss and Gemma's Node
   repeatability false positive without weakening prompt-injection resistance.
3. Expand to 30 independently reviewed regression cases and rerun the gate.
4. Conduct the Gate 4 moderated user test.
5. Add a hosted provider only after the trust gate is stable; do not select a
   default by reputation alone.

## Release language

Until the gates pass, describe Rationexa as an experimental, human-in-the-loop
decision-review prototype. Do not claim that it reliably detects every stale or
contradicted technical decision.
