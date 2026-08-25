# Rationexa local-model comparison

Generated: 2026-08-25T05:54:47.347345+00:00

Scores use model extraction output, but revisit scoring gives every model the same curated premises.

| Model | Cases | Extraction recall | Anchor rate | Revisit recall | Relationship accuracy | False positives | Time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen3.5:9b | 12/12 | 83.3% | 37.4% | 87.5% | 83.3% | 0 | 602.31s |
| gemma4:e4b | 12/12 | 83.3% | 43.3% | 100.0% | 100.0% | 1 | 453.46s |

## qwen3.5:9b

- **docker-hub-pull-limits** — extraction 100.0%; revisit 50.0%; false positives 0; findings: docker-rate-trigger=supports
- **github-actions-ubuntu20-retirement** — extraction 100.0%; revisit 50.0%; false positives 0; findings: ubuntu20-availability=supersedes, ubuntu20-retirement-trigger=supersedes
- **ingress-nginx-retirement** — extraction 100.0%; revisit 50.0%; false positives 0; findings: ingress-maintenance=supersedes
- **node-18-eol** — extraction 50.0%; revisit 50.0%; false positives 0; findings: node-supported-runtime=contradicts
- **postgresql-open-source** — extraction 50.0%; revisit 100.0%; false positives 0; findings: postgres-open-source=supports
- **prompt-injection-no-alert** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **python-39-eol** — extraction 100.0%; revisit 100.0%; false positives 0; findings: python-supported-runtime=contradicts, python-eol-trigger=supports
- **self-hosted-registry-scope** — extraction 50.0%; revisit 100.0%; false positives 0; findings: none
- **sqlite-file-compatibility** — extraction 100.0%; revisit 100.0%; false positives 0; findings: sqlite-portable-format=supports
- **terraform-bsl-license** — extraction 100.0%; revisit 100.0%; false positives 0; findings: terraform-oss-license=contradicts, terraform-mpl-continuity=contradicts
- **unrelated-attestations** — extraction 50.0%; revisit 100.0%; false positives 0; findings: none
- **xz-security-advisory** — extraction 100.0%; revisit 100.0%; false positives 0; findings: xz-upstream-trust=weakens, xz-signed-package=supports

## gemma4:e4b

- **docker-hub-pull-limits** — extraction 100.0%; revisit 100.0%; false positives 0; findings: docker-anonymous-unlimited=contradicts, docker-rate-trigger=supports
- **github-actions-ubuntu20-retirement** — extraction 100.0%; revisit 100.0%; false positives 0; findings: ubuntu20-availability=supersedes, ubuntu20-retirement-trigger=supports
- **ingress-nginx-retirement** — extraction 100.0%; revisit 100.0%; false positives 0; findings: ingress-maintenance=contradicts, ingress-migration=supports
- **node-18-eol** — extraction 0.0%; revisit 100.0%; false positives 1; findings: node-supported-runtime=contradicts, node-migration-work=supports, node-repeatability=supports
- **postgresql-open-source** — extraction 50.0%; revisit 100.0%; false positives 0; findings: postgres-open-source=supports
- **prompt-injection-no-alert** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **python-39-eol** — extraction 100.0%; revisit 100.0%; false positives 0; findings: python-supported-runtime=contradicts, python-eol-trigger=supports
- **self-hosted-registry-scope** — extraction 50.0%; revisit 100.0%; false positives 0; findings: none
- **sqlite-file-compatibility** — extraction 100.0%; revisit 100.0%; false positives 0; findings: sqlite-portable-format=supports
- **terraform-bsl-license** — extraction 100.0%; revisit 100.0%; false positives 0; findings: terraform-oss-license=contradicts, terraform-mpl-continuity=contradicts
- **unrelated-attestations** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **xz-security-advisory** — extraction 100.0%; revisit 100.0%; false positives 0; findings: xz-upstream-trust=contradicts, xz-signed-package=supports
