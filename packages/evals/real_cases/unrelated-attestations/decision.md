# Use least-recently-used cache eviction

Date: 2024-04-10

Status: Accepted

## Decision

Configure the application cache to evict least-recently-used entries when the
memory ceiling is reached.

## Premises

- The cache must remain within a fixed memory budget.
- Least-recently-used eviction is expected to match the traffic pattern.
- Cache misses are recoverable from the primary database.

> Test adaptation: the evidence is deliberately real but unrelated.
