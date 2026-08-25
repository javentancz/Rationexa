# Rationexa local-model comparison

Generated: 2026-08-25T05:07:35.701092+00:00

Scores use model extraction output, but revisit scoring gives every model the same curated premises.

| Model | Cases | Extraction recall | Anchor rate | Revisit recall | Relationship accuracy | False positives | Time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen3.5:9b | 3/3 | 66.7% | 29.6% | 66.7% | 66.7% | 0 | 302.61s |
| gemma4:e4b | 3/3 | 50.0% | 53.3% | 100.0% | 100.0% | 1 | 122.10s |

## qwen3.5:9b

- **ingress-nginx-retirement** — extraction 100.0%; revisit 50.0%; false positives 0; findings: ingress-maintenance=supersedes
- **node-18-eol** — extraction 50.0%; revisit 50.0%; false positives 0; findings: node-supported-runtime=contradicts
- **postgresql-open-source** — extraction 50.0%; revisit 100.0%; false positives 0; findings: postgres-open-source=supports

## gemma4:e4b

- **ingress-nginx-retirement** — extraction 100.0%; revisit 100.0%; false positives 0; findings: ingress-maintenance=contradicts, ingress-migration=supports
- **node-18-eol** — extraction 0.0%; revisit 100.0%; false positives 1; findings: node-supported-runtime=contradicts, node-migration-work=supports, node-repeatability=supports
- **postgresql-open-source** — extraction 50.0%; revisit 100.0%; false positives 0; findings: postgres-open-source=supports
