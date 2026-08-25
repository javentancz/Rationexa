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

## Acceptance-gate status

### Gate 1: premise extraction — not passed

- Development case count: 12 fixtures available.
- Independent case review: pending.
- Latest 12-case baseline: both Qwen and Gemma reached 83.3% concept recall.
- Replaying the saved outputs through corrected source-based labels and the
  wrapped-Markdown recovery reaches 100% concept recall for both models. A
  fresh run and independent label review remain required before passing.
- Target: at least 90% recall on human-labeled critical premises, with
  qualifier-preservation and correction-effort review.

### Gate 2: source anchors — not passed

- Exact anchor validation exists.
- Latest 12-case baseline before deterministic offset repair: Qwen anchor rate
  37.4%; Gemma 43.3%.
- Deterministic replay of all saved premises through the repair reaches 100%
  grounded anchors for both models. The original pre-fix benchmark is retained,
  and the replay is enforced by an automated regression test.
- Target: at least 90% correct sampled anchors and no accepted invented quotes.
- Moderated under-30-second source-verification test: pending.

### Gate 3: conflict detection — not passed

- Revisit classifier and side-by-side evidence UI exist.
- Twelve development cases are available and both local models completed the
  full baseline. Qwen reached 87.5% revisit recall and 83.3% relationship
  accuracy with no false positives. Gemma reached 100% on both curated metrics
  with one false positive.
- Target: at least 30 regression cases, 90% critical premise-match recall, 80%
  relationship precision, and zero critical misses in the release candidate.
- Generalization status: the visible 12-case set is now restricted to
  development/debugging. No holdout score exists yet.

### Gate 4: real-user trust — not started

- Required: 5–8 relevant users testing historical decisions with captured
  correction effort, relevance, trust, and repeat-use intent.

## Next build sequence

1. Independently review and correct the labels in the 12-case suite.
2. Run Qwen and Gemma over all 12 cases and classify every miss.
3. Fix extraction and anchor reliability before adding more providers.
4. Add Compare mode plus progress, timeout, and cancellation controls.
5. Persist revisit model, prompt, latency, and cost provenance.
6. Add one hosted provider to the same benchmark; do not select a default by
   reputation alone.
7. Expand to 30 regression cases and conduct the Gate 4 user test.

## Release language

Until the gates pass, describe Rationexa as an experimental, human-in-the-loop
decision-review prototype. Do not claim that it reliably detects every stale or
contradicted technical decision.
