# ADR-0001: Stage 1 Trust Boundary

- Status: Accepted
- Date: 2026-08-25

## Context

Rationexa must be useful before it has enough evidence to make autonomous materiality judgments. The first implementation needs to preserve decision premises and source evidence without presenting model output as organizational truth.

## Decision

Stage 1 will:

- treat all AI-extracted fields as draft candidates;
- separate premise kind from quality state;
- validate source anchors against immutable original text;
- require human confirmation before finalizing a decision premise;
- preserve unverified material claims as visibly unverified;
- retrieve original source evidence for Important and Critical revisit findings;
- present premise relationships and missing context, not a verdict that the decision is wrong;
- use Ollama with Qwen3.5 9B as the default local AI provider;
- retain a deterministic provider so tests do not require a model process.

The local provider sends a Pydantic JSON schema to Ollama's structured-output API and validates the returned content. The optional OpenAI provider uses the Responses API with a typed structured output and `store=False`. User-supplied source text is treated as untrusted data inside both extraction paths.

## Consequences

- The initial workflow includes explicit human review and cannot be fully autonomous.
- Some captured context remains draft and is excluded from finalized decision premises.
- Source formats without extractable text fail clearly instead of being processed with implicit OCR.
- Model-provider quality can improve without changing the product trust boundary.
- Revisit findings remain candidates for human judgment.
