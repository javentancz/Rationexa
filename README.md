# Rationexa

Rationexa is a human-in-the-loop technical decision review project. Its Stage 1 goal is to preserve the premises and source evidence behind technical decisions, then identify when new evidence may weaken or contradict a premise worth reviewing.

## Current status

The repository is at the execution-planning stage. The build is intentionally milestone-gated: premise extraction, reliable source anchoring, premise conflict detection, real-user trust, and repeat usage must be proven in sequence.

See [the Stage 1 execution plan](docs/STAGE_1_EXECUTION_PLAN.md) for the proposed architecture, data contracts, APIs, evaluation strategy, acceptance gates, and first 10 working days.

## Stage 1 boundary

Rationexa assists review; it does not autonomously declare decisions wrong, reverse recommendations, assign authoritative business materiality, or monitor sources continuously.
