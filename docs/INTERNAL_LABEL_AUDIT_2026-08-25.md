# Internal development-label audit — 2026-08-25

## Scope and status

All 30 cases in the visible `development-v2` set were rechecked against their
decision text, later-evidence text, and linked primary sources. This is an
internal audit performed after model outputs were already available. It does
not satisfy the Stage 1 independent-review gate, and every case intentionally
retains `curated_pending_independent_review` status.

The audit checked that extraction keywords occur in the original decision,
canonical excerpts are grounded in that decision, premise kinds follow the
current extraction standard, expected relationships describe what the later
evidence does to the old premise, and irrelevant or adversarial evidence has no
positive labels.

## Corrections

Sixteen cases required a label correction.

- Twelve cases contained 16 extraction keywords that did not occur in their
  decision source. These were replaced with source-exact terms without changing
  the intended concept: Angular 19, CentOS 7, CodeQL v2, Create React App,
  Docker Content Trust, GitHub artifact v3, macOS 13 runners, Kubernetes 1.31,
  npm classic tokens, PostgreSQL 13, Slack history limits, and Ubuntu 20.04.
- `github-actions-pricing-postponed` now evaluates two pricing material claims
  instead of treating the effective-date portion of one price as a separate
  assumption.
- `postgresql-open-source` now classifies the externally verifiable open-source
  licensing statement as a material claim rather than a plain fact.
- `ingress-nginx-retirement` now represents the team's maintenance obligation
  as a hard constraint grounded in the exact responsibility excerpt. Retirement
  weakens the ability to fulfill that obligation; it does not erase or
  supersede the obligation itself.
- `xz-security-advisory` no longer rewards a `supports` finding for the signed
  package constraint. The compromise makes that rule more important but does
  not prove the requirement is fulfilled; the separate upstream-trust
  assumption remains the material finding.

The other 14 cases required no label change: AWS SDK v2, Docker Hub pull
limits, .NET 6, GitHub Actions Node 20, GitHub Ubuntu 20.04 runner, Let's
Encrypt OCSP, Node 18, prompt injection, Python 3.9, Redis licensing,
self-hosted registry scope, SQLite compatibility, Terraform licensing, and
unrelated artifact attestations.

## Integrity checks

- Case count: 30.
- Extraction keywords absent from original decision text after correction: 0.
- Canonical old excerpts absent after whitespace normalization: 0.
- Cases marked independently reviewed: 0, intentionally.
- Frozen manifest hashes were refreshed for the 16 corrected cases.
- An automated regression now rejects future extraction labels or canonical
  excerpts that are not grounded in the decision source.

## External review still required

A qualified reviewer who has not seen model outputs must independently confirm
the labels before the dataset can be marked reviewed or used for a Stage 1
release claim. A separate sealed holdout remains necessary for production model
selection.
