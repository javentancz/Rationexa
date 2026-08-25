# Model provider standard

Rationexa treats language models as replaceable reasoning engines behind one
product contract. The UI selects a stable model ID; the API resolves that ID
through a server-side allowlist and constructs the matching provider adapter.

## Required pattern

Every provider adapter must implement the same two operations:

1. `extract(source_text, filename) -> ExtractionResult`
2. `revisit(premises, new_evidence, criticality) -> RevisitFinding[]`

All providers must use the same versioned prompts and structured schemas. A
provider must not bypass source-anchor validation, quote grounding, critical
decision gates, or human premise review.

Validated model findings may be supplemented by narrowly scoped deterministic
safety checks for explicit lifecycle triggers and affected security or
verification obligations. These candidates must retain their detection source,
use low confidence, cite an exact evidence excerpt, and require human review.

Model IDs use `provider/model`, for example `ollama/qwen3.5:9b`. The browser may
only submit IDs returned by `GET /v1/models`; arbitrary provider names or model
strings are rejected. API keys remain server-side.

Every persisted AI operation should record:

- provider and exact model/version;
- prompt version and schema version;
- input artifact hashes;
- latency and validation failures;
- human corrections and final disposition.

The extraction record already persists provider, model, and prompt version.
Revisit provenance should become a persisted field when database migrations
are introduced; the current UI displays it for the active result.

## Current adapters

- Ollama: Qwen 3.5 9B, Gemma 4 E4B, and Ornith 1.5 9B are configured locally.
- OpenAI: an optional hosted structured-output adapter exists when configured.
- Claude, Grok, and hosted DeepSeek are not wired yet. Add each as a separate
  adapter without changing domain schemas or UI request shapes.

Different models will produce different premise boundaries, classifications,
relationships, confidence, explanations, false positives, and latency. Model
names are therefore provenance, not an implementation detail.

## Evaluation gates

The visible development suite contains 30 source-backed cases. It is broad
enough for repeatable development regression, but it is not a production model
selection set until its labels have been independently reviewed:

- four lifecycle, retirement, or supersession cases;
- three contradiction or weakening cases;
- two positive-support cases;
- three irrelevant or adversarial cases that should produce no alert.

Include short and long ADRs, messy Markdown/PDF extraction, ambiguous evidence,
license or policy changes, security advisories, pricing changes, and evidence
that contains prompt-injection text. Score extraction coverage, valid anchor
rate, revisit recall, relationship accuracy, false positives, latency, and
human correction rate. Keep a separate sealed pilot set of at least 30
independently reviewed cases before making broad reliability claims.

The checked-in 30 cases are the visible, frozen `development-v2` set. They may
be used for debugging but never described as holdout accuracy. Model selection
requires a sealed, independently reviewed set of at least 30 cases stored
outside the development repository. Freeze the code commit, prompt versions,
model IDs, thresholds, case IDs, and case hashes before the first holdout run.
Reject any development/holdout overlap by case ID or content hash, and record
the dataset manifest hash in every report.
