# Pull public build images anonymously from Docker Hub

Date: 2024-01-10

Status: Accepted

## Decision

Allow ephemeral CI workers to pull public base images anonymously from Docker
Hub. This avoids distributing registry credentials to short-lived workers.

## Premises

- Anonymous pulls are expected to remain effectively unlimited at our CI
  volume.
- The build fleet can retry occasional transient registry errors.
- Revisit authentication or mirroring if rate limits can interrupt builds.

> Test adaptation: this fixture evaluates a usage-policy change.
