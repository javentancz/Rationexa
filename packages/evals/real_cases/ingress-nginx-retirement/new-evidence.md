# Ingress NGINX has been retired

Evidence date: 2026-03-24

Official sources:

- https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/
- https://kubernetes.io/blog/2026/03/30/kubernetes-v1-36-sneak-peek/
- https://kubernetes.io/blog/2026/03/20/ingress2gateway-1-0-release/

## New evidence

The Kubernetes project retired the community Ingress NGINX controller on
March 24, 2026. Existing deployments and installation artifacts continue to
work, but the retired project no longer receives releases, bug fixes, or
security updates.

Kubernetes recommends migrating to Gateway API or another maintained ingress
controller. Ingress2Gateway 1.0 is available to help translate Ingress
resources and common Ingress NGINX annotations, although migration still
requires testing because not every behavior maps directly.

## Why this matters

The original decision depended on the controller being an operable,
upgradeable platform component. Retirement weakens that premise and creates a
security-maintenance risk. It does not prove that the original decision was
wrong at the time, and it does not mean running deployments immediately stop
working. It does mean the decision deserves review and a migration plan.

> Test adaptation: this file summarizes official Kubernetes announcements for
> evaluation. Follow the links above for the complete source material.
