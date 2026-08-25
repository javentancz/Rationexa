# Extraction recall rerun — 2026-08-25

## Result

A fresh extraction-only run was completed across all 30 cases after the
internal label audit. Qwen reached 86.7% concept recall and Gemma reached 91.7%.
Qwen produced 99.5% valid source anchors and Gemma produced 100%; neither model
produced an invalid anchor.

| Model | Concept recall | Valid anchors | Invalid anchors | Elapsed |
| --- | ---: | ---: | ---: | ---: |
| `qwen3.5:9b` | 86.7% | 99.5% | 0 | 728.07 s |
| `gemma4:e4b` | 91.7% | 100% | 0 | 542.40 s |

Gemma clears the numerical 90% extraction threshold on this visible development
set. This does not pass the Stage 1 gate: the labels have not yet been reviewed
independently and the models have not been tested on a sealed holdout.

## Miss pattern

Both models missed at least one expected concept in three cases:

- `postgresql-open-source`
- `github-actions-pricing-postponed`
- `github-artifact-v3-retirement`

Qwen also had partial misses in Docker Content Trust, the GitHub Actions Node 20
transition, Let's Encrypt OCSP retirement, and the Redis 7.4 license change.
Gemma also had a partial miss in the adversarial prompt-injection case.

The pricing case was the only zero-recall case for both models. It contains two
separate price-and-date claims in one decision and should remain in the suite as
a useful dense-statement stress test.

## Interpretation

The rerun measures extraction recall only. It does not replace the complete
extraction-plus-revisit benchmark and does not establish production accuracy.
No labels were changed in response to model misses. The machine-readable result
is stored in `packages/evals/reports/extraction-recall-audit-2026-08-25.json`.

The next valid step is blind review by a qualified reviewer who has not seen
these outputs, followed by a full rerun and then a sealed holdout evaluation.
