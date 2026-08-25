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
- Automated case-composition gate, API tests, lint, and web build checks.

## Acceptance-gate status

### Gate 1: premise extraction — not passed

- Development case count: 12 fixtures available.
- Independent case review: pending.
- Latest three-case baseline: Qwen concept recall 66.7%; Gemma 50.0%.
- Target: at least 90% recall on human-labeled critical premises, with
  qualifier-preservation and correction-effort review.

### Gate 2: source anchors — not passed

- Exact anchor validation exists.
- Latest three-case baseline: Qwen anchor rate 29.6%; Gemma 53.3%.
- Target: at least 90% correct sampled anchors and no accepted invented quotes.
- Moderated under-30-second source-verification test: pending.

### Gate 3: conflict detection — not passed

- Revisit classifier and side-by-side evidence UI exist.
- Twelve development cases are available, but the full benchmark has not yet
  been rerun over them.
- Target: at least 30 regression cases, 90% critical premise-match recall, 80%
  relationship precision, and zero critical misses in the release candidate.

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
