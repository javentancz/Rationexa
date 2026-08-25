# Operate a registry inside the private network

Date: 2025-02-01

Status: Accepted

## Decision

Run an OCI Distribution registry inside the production network and mirror all
approved images into it before deployment.

## Premises

- Production image pulls must remain on the private network.
- The self-hosted registry has enough storage and network capacity for
  production pulls.
- Docker Hub is only an upstream import source and is never queried by
  production nodes.

> Test adaptation: the scope qualifier is intentionally decisive.
