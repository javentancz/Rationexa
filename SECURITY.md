# Security policy

## Supported versions

Security fixes are applied to the latest code on `main`. Older commits and
unmaintained forks are not supported. Until Rationexa publishes a stable
release, deployments should track reviewed commits rather than assume semantic
version compatibility.

## Report a vulnerability

Please do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/javentancz/Rationexa/security/advisories/new).
If that channel is unavailable, email `javentanzhe@gmail.com` with the subject
`Rationexa security report`.

Include the affected commit or deployment, impact, reproduction steps, and any
suggested remediation. Remove real provider keys, session tokens, personal
data, and customer source material from screenshots or test cases.

Reports involving cross-workspace access, authentication bypass, provider-key
exposure, share-token leakage, or export sanitization are treated as highest
priority. We will acknowledge a report as soon as practical, investigate it,
and coordinate disclosure after a fix is available.

## Security boundary

Provider keys are workspace-scoped and encrypted at rest. Public share records
must be built from an explicit allowlist and never include provider keys, raw
session metadata, private source artifacts, or internal workspace identifiers.
AI output remains a review aid and must not silently mutate preserved decisions.
