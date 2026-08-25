# Rationexa local-model comparison

Generated: 2026-08-25T07:23:57.889284+00:00
Dataset: development-v1
Manifest SHA-256: 6a12f29e96e9dce41f9e8e7debefb8f7e6a321bb781585843c72546ee1cb18a2

Scores use model extraction output, but revisit scoring gives every model the same curated premises.

## Stage 1 trust and evaluation gate: BLOCKED

A blocked gate means the system remains an experimental human-in-the-loop prototype.

- Dataset blocker: `minimum_case_count` is 12; requires >= 30.
- Dataset blocker: `independently_reviewed_cases` is 0; requires >= 12.
- Model blocker (qwen3.5:9b): `revisit_detection_recall` is 0.875; requires >= 0.9.
- Model blocker (qwen3.5:9b): `critical_miss_count` is 1; requires <= 0.
- Model blocker (gemma4:e4b): `false_positive_count` is 1; requires <= 0.

| Model | Cases | Extraction recall | Anchor rate | Revisit recall | Relationship precision | False positives | Critical misses | Fabricated quotes | Gate | Time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen3.5:9b | 12/12 | 95.8% | 100.0% | 87.5% | 92.3% | 0 | 1 | 0 | BLOCKED | 559.29s |
| gemma4:e4b | 12/12 | 95.8% | 100.0% | 100.0% | 94.1% | 1 | 0 | 0 | BLOCKED | 356.70s |

## qwen3.5:9b

- **docker-hub-pull-limits** — extraction 100.0%; revisit 50.0%; false positives 0; findings: docker-rate-trigger=supports
- **github-actions-ubuntu20-retirement** — extraction 100.0%; revisit 50.0%; false positives 0; findings: ubuntu20-availability=supersedes, ubuntu20-retirement-trigger=supersedes
- **ingress-nginx-retirement** — extraction 100.0%; revisit 50.0%; false positives 0; findings: ingress-maintenance=supersedes
- **node-18-eol** — extraction 100.0%; revisit 50.0%; false positives 0; findings: node-supported-runtime=contradicts
- **postgresql-open-source** — extraction 50.0%; revisit 100.0%; false positives 0; findings: postgres-open-source=supports
- **prompt-injection-no-alert** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **python-39-eol** — extraction 100.0%; revisit 100.0%; false positives 0; findings: python-supported-runtime=contradicts, python-eol-trigger=supports
- **self-hosted-registry-scope** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **sqlite-file-compatibility** — extraction 100.0%; revisit 100.0%; false positives 0; findings: sqlite-portable-format=supports
- **terraform-bsl-license** — extraction 100.0%; revisit 100.0%; false positives 0; findings: terraform-oss-license=contradicts, terraform-mpl-continuity=contradicts
- **unrelated-attestations** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **xz-security-advisory** — extraction 100.0%; revisit 100.0%; false positives 0; findings: xz-upstream-trust=weakens, xz-signed-package=supports

## gemma4:e4b

- **docker-hub-pull-limits** — extraction 100.0%; revisit 100.0%; false positives 0; findings: docker-anonymous-unlimited=contradicts, docker-rate-trigger=supports
- **github-actions-ubuntu20-retirement** — extraction 100.0%; revisit 100.0%; false positives 0; findings: ubuntu20-availability=supersedes, ubuntu20-retirement-trigger=supports
- **ingress-nginx-retirement** — extraction 100.0%; revisit 100.0%; false positives 0; findings: ingress-maintenance=contradicts, ingress-migration=supports
- **node-18-eol** — extraction 100.0%; revisit 100.0%; false positives 1; findings: node-supported-runtime=contradicts, node-migration-work=supports, node-repeatability=supports
- **postgresql-open-source** — extraction 50.0%; revisit 100.0%; false positives 0; findings: postgres-open-source=supports
- **prompt-injection-no-alert** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **python-39-eol** — extraction 100.0%; revisit 100.0%; false positives 0; findings: python-supported-runtime=contradicts, python-eol-trigger=supports
- **self-hosted-registry-scope** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **sqlite-file-compatibility** — extraction 100.0%; revisit 100.0%; false positives 0; findings: sqlite-portable-format=supports
- **terraform-bsl-license** — extraction 100.0%; revisit 100.0%; false positives 0; findings: terraform-oss-license=contradicts, terraform-mpl-continuity=contradicts
- **unrelated-attestations** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **xz-security-advisory** — extraction 100.0%; revisit 100.0%; false positives 0; findings: xz-upstream-trust=contradicts, xz-signed-package=supports
