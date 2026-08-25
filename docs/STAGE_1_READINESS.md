# Stage 1 readiness

Updated: 2026-08-25

## Current verdict

The Stage 1 prototype is complete and the project has moved into Stage 2 repeat-
use development. This is a product-scope decision, not a claim that model
accuracy has been independently validated.

The 30-case development regression set remains frozen and executable.
Independent label review, a sealed holdout run, and moderated user tests are
deferred trust-validation work. Rationexa therefore remains human-in-the-loop:
it surfaces evidence for review and never decides that the original decision is
wrong.

## Implemented

- Text, Markdown, and PDF import.
- Typed premise extraction with exact-anchor validation.
- Human confirm, edit, reject, and finalize workflow.
- New-evidence revisit workflow with evidence displayed beside findings.
- Local Qwen, Gemma, and Ornith model selection.
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
- Internal label audit: all 30 cases rechecked, 16 cases corrected, and zero
  extraction keywords or canonical excerpts remain ungrounded in the decision
  source. This audit was not independent because model outputs were already
  visible.
- Fresh extraction-only run after the audit: Qwen reached 86.7% concept recall
  and Gemma reached 91.7%. Gemma clears the numerical 90% threshold on this
  visible development set; Qwen does not.
- Independent label review remains required before this development score can
  count toward release readiness.
- Target: at least 90% recall on human-labeled critical premises, with
  qualifier-preservation and correction-effort review.

### Gate 2: source anchors — not passed

- Exact anchor validation exists.
- The fresh extraction-only run produced 99.5% valid anchors for Qwen and 100%
  for Gemma, with zero invalid anchors from either model.
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
  cases and produced zero additional alerts. The enterprise-project regression
  correctly surfaced the later enterprise privacy mandate as a new constraint.
- Target: at least 30 regression cases, 90% critical premise-match recall, 80%
  relationship precision, and zero critical misses in the release candidate.
- Generalization status: the visible 30-case set is restricted to
  development/debugging. No holdout score exists yet.

### Ornith 1.5 9B challenger run

- Ornith completed all 30 development cases with no runtime, schema, or fabricated-quote failures.
- Its initial run reached 98.3% revisit recall, 98.0% relationship precision, zero critical misses,
  and one false positive. The false positive described a constraint as desirable rather than proving
  that it was fulfilled; the requirement-support guard now rejects that pattern, and the focused
  rerun retained the real security finding with zero false positives.
- Initial extraction scoring was 78.3%, primarily because grounded expectation and mandatory
  statements were assigned the wrong premise kind. Source-grounded kind normalization raises the
  same output set to 96.7%; a fresh five-case rerun covering those patterns reached 100% concept
  recall and 100% valid anchors.
- These are development results, not independent release evidence. Gemma remains the established
  extraction baseline until the frozen 30-case set is rerun under the updated extraction pipeline.

### Gate 4: real-user trust — instrumentation ready, sessions not started

- Finding-level judgments and timestamps are now persisted in the product.
- Required: 5–8 relevant users testing historical decisions with captured
  correction effort, relevance, trust, and repeat-use intent.

## Transition decision

Stage 2 starts with persistent decision memory, search, reopening, and revisit
history. Independent review and a sealed holdout remain required before any
future claim of validated accuracy or autonomous operation. They do not block a
supervised product pilot where a human reviews every premise and finding.

## Release language

Until the gates pass, describe Rationexa as an experimental, human-in-the-loop
decision-review prototype. Do not claim that it reliably detects every stale or
contradicted technical decision.
