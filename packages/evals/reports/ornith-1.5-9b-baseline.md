# Rationexa local-model comparison

Generated: 2026-08-25T14:57:19.218260+00:00
Dataset: development-v2
Manifest SHA-256: 08eb23fc3ea09832b6c869f58158bd0c0da885db79c34f53d7d34f29820e1533

Scores use model extraction output, but revisit scoring gives every model the same curated premises.

## Stage 1 trust and evaluation gate: BLOCKED

A blocked gate means the system remains an experimental human-in-the-loop prototype.

- Dataset blocker: `independently_reviewed_cases` is 0; requires >= 30.
- Model blocker (ornith-1.5:9b): `concept_recall` is 0.783; requires >= 0.9.
- Model blocker (ornith-1.5:9b): `false_positive_count` is 1; requires <= 0.

| Model | Cases | Extraction recall | Anchor rate | Revisit recall | Relationship precision | False positives | Critical misses | Fabricated quotes | Gate | Time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ornith-1.5:9b | 30/30 | 78.3% | 99.2% | 98.3% | 98.0% | 1 | 0 | 0 | BLOCKED | 1205.21s |

## ornith-1.5:9b

- **docker-hub-pull-limits** — extraction 100.0%; revisit 100.0%; false positives 0; findings: docker-anonymous-unlimited=contradicts, docker-rate-trigger=supports
- **github-actions-ubuntu20-retirement** — extraction 100.0%; revisit 100.0%; false positives 0; findings: ubuntu20-availability=contradicts, ubuntu20-retirement-trigger=supports
- **ingress-nginx-retirement** — extraction 100.0%; revisit 100.0%; false positives 0; findings: ingress-maintenance=weakens, ingress-migration=supports
- **node-18-eol** — extraction 100.0%; revisit 100.0%; false positives 0; findings: node-supported-runtime=contradicts, node-migration-work=supports
- **postgresql-open-source** — extraction 50.0%; revisit 100.0%; false positives 0; findings: postgres-open-source=supports
- **prompt-injection-no-alert** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **python-39-eol** — extraction 100.0%; revisit 50.0%; false positives 0; findings: python-supported-runtime=contradicts
- **self-hosted-registry-scope** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **sqlite-file-compatibility** — extraction 100.0%; revisit 100.0%; false positives 0; findings: sqlite-portable-format=supports
- **terraform-bsl-license** — extraction 50.0%; revisit 100.0%; false positives 0; findings: terraform-oss-license=contradicts, terraform-mpl-continuity=contradicts
- **unrelated-attestations** — extraction 100.0%; revisit 100.0%; false positives 0; findings: none
- **xz-security-advisory** — extraction 50.0%; revisit 100.0%; false positives 1; findings: xz-upstream-trust=weakens, xz-signed-package=supports
- **angular-19-unsupported** — extraction 100.0%; revisit 100.0%; false positives 0; findings: angular19-supported=contradicts, angular19-trigger=supports
- **aws-sdk-js-v2-end-of-support** — extraction 50.0%; revisit 100.0%; false positives 0; findings: awsv2-updates=contradicts, awsv3-migration=supports
- **centos-7-eol** — extraction 50.0%; revisit 100.0%; false positives 0; findings: centos7-updates=contradicts, centos7-trigger=supports
- **codeql-action-v2-retired** — extraction 100.0%; revisit 100.0%; false positives 0; findings: codeqlv2-supported=contradicts, codeqlv3-trigger=supports
- **create-react-app-deprecation** — extraction 100.0%; revisit 100.0%; false positives 0; findings: cra-maintained=contradicts, cra-trigger=supports
- **docker-content-trust-retirement** — extraction 0.0%; revisit 100.0%; false positives 0; findings: dct-available=supersedes, dct-signed=weakens
- **dotnet-6-end-of-support** — extraction 100.0%; revisit 100.0%; false positives 0; findings: dotnet6-supported=contradicts, dotnet6-trigger=supports
- **github-actions-node20-transition** — extraction 50.0%; revisit 100.0%; false positives 0; findings: actions-node20=contradicts, actions-node24-trigger=supports
- **github-actions-pricing-postponed** — extraction 100.0%; revisit 100.0%; false positives 0; findings: actions-selfhosted-charge=contradicts, actions-hosted-discount=supports
- **github-artifact-v3-retirement** — extraction 50.0%; revisit 100.0%; false positives 0; findings: artifact-v3-works=contradicts, artifact-v4-trigger=supports
- **github-macos13-runner-retirement** — extraction 50.0%; revisit 100.0%; false positives 0; findings: macos13-trigger=supports, macos13-available=contradicts
- **kubernetes-131-eol** — extraction 100.0%; revisit 100.0%; false positives 0; findings: k8s131-supported=contradicts, k8s131-trigger=supports
- **letsencrypt-ocsp-retirement** — extraction 50.0%; revisit 100.0%; false positives 0; findings: le-ocsp-available=contradicts, le-revocation=weakens
- **npm-classic-token-revocation** — extraction 100.0%; revisit 100.0%; false positives 0; findings: npm-token-works=contradicts, npm-oidc-trigger=supports
- **postgresql-13-eol** — extraction 50.0%; revisit 100.0%; false positives 0; findings: pg13-supported=contradicts, pg13-trigger=supports
- **redis-74-license-change** — extraction 100.0%; revisit 100.0%; false positives 0; findings: redis-osi=contradicts, redis-bsd=contradicts
- **slack-history-rate-limit** — extraction 100.0%; revisit 100.0%; false positives 0; findings: slack-throughput=contradicts, slack-limit-trigger=supports
- **ubuntu-2004-standard-support** — extraction 50.0%; revisit 100.0%; false positives 0; findings: ubuntu20-standard=contradicts, ubuntu20-trigger=supports
