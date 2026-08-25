# Adopt NGINX Ingress Controller for preview routing

Date: 2026-02-10

Status: Accepted

Source: https://github.com/creaturekell/github-preview/blob/2a136dd149184cdd5dbaeb76d519d22b8be85803/docs/decisions/004-nginx-ingress.md

## Context

The project needs fast and reliable preview URLs for pull requests. Creating a
separate GKE ingress and load balancer for every preview was slow and produced
multiple external IPs. A Traefik-based approach added operational complexity,
custom permissions, and another routing layer to debug.

The desired design should use one external IP with wildcard DNS, minimize
moving parts, and keep the contributor workflow close to standard Kubernetes
Ingress patterns.

## Decision

Adopt the community NGINX Ingress Controller as the preview-routing layer
instead of Traefik. Each preview receives its own namespace, Service, and
Ingress. A shared ingress controller routes wildcard preview hostnames through
one LoadBalancer service.

## Rationale and assumptions

- The controller is familiar to Kubernetes operators and widely documented.
- It discovers new Ingress resources quickly enough for preview environments.
- One controller and external IP are simpler than one cloud load balancer per
  preview.
- The team accepts responsibility for controller upgrades, monitoring, and
  troubleshooting.
- A later migration to Gateway API or another controller is possible but would
  require additional work.

## Consequences

Preview routing should become faster and easier to understand. The project
must operate the controller and may eventually need to migrate its routing
configuration.

> Test adaptation: this file concisely restates the public ADR for evaluation.
> Follow the source link above for the complete original record.
