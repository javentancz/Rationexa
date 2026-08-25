# Twelve-case local-model analysis

Generated: 2026-08-25

Review status: development baseline; case labels are curated and pending
independent review.

## Outcome

Both models completed all 12 cases without a timeout or structured-output
failure.

- Qwen 3.5 9B: 83.3% extraction concept recall, 37.4% validated anchor rate,
  87.5% revisit detection recall, 83.3% relationship accuracy, zero false
  positives, and 602.31 seconds total model time.
- Gemma 4 E4B: 83.3% extraction concept recall, 43.3% validated anchor rate,
  100% revisit detection recall, 100% relationship accuracy, one false
  positive, and 453.46 seconds total model time.

Gemma was about 25% faster in total and stronger on the curated revisit labels.
Qwen was more conservative and produced no false positives. Neither model met
the Stage 1 extraction or anchor target.

## Important failures

- Qwen missed one expected relationship in each of the Docker Hub, GitHub
  Actions, ingress-nginx, and Node.js lifecycle cases.
- Gemma incorrectly related the Node.js repeatability requirement to Node 18
  end-of-life evidence.
- Both models missed extraction expectations in the PostgreSQL and
  self-hosted-registry cases.
- Gemma missed both extraction expectations in the Node.js case.
- Both models resisted the indirect prompt-injection fixture and produced no
  alert for all three irrelevant/adversarial cases except Gemma's unrelated
  Node.js finding above.

## Anchor root cause and fix

Many model excerpts were present in the source, but their numeric offsets were
wrong or omitted. The provider normalizer classified the premises without
repairing those anchors.

The API now deterministically:

1. Finds the model's excerpt in the source while tolerating collapsed
   whitespace.
2. Recomputes exact start and end offsets.
3. Falls back to the premise statement only when that statement occurs
   verbatim in the source.
4. Removes the anchor when neither candidate can be grounded.

Rescoring the saved output with the production grounding function shows that
all saved premises can be grounded after repair: Qwen 100% (76 of 76) and Gemma
100% (66 of 66). This is a deterministic replay result rather than a fresh
model run, so the original pre-fix benchmark remains preserved above. A
regression test now replays every saved premise through the repair function.

## Current model decision

Do not freeze a production default yet. Keep Qwen as the conservative local
default and Gemma as the faster comparison model. After independent label
review and a fresh run with repaired grounding, evaluate whether a split
default—Qwen for extraction and Gemma for revisit—beats either model alone.

## Next reliability work

1. Independently review the 12-case labels and rerun both local models.
2. Review extraction misses and qualifier preservation after grounding.
3. Add Compare mode using the same versioned prompts and case suite.
4. Test one hosted provider only after the local baseline is accepted.
