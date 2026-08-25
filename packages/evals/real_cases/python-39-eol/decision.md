# Standardize the service on Python 3.9

Date: 2023-06-01

Status: Accepted

Source context: https://peps.python.org/pep-0596/

## Decision

Standardize the service and its production container on Python 3.9. The team
already operates this runtime and its dependency set is stable.

## Premises

- Python 3.9 will continue receiving upstream security fixes for the expected
  service lifetime.
- Keeping one runtime reduces build and debugging differences.
- Revisit the runtime before upstream support ends.

> Test adaptation: this is a concise decision fixture paired with official
> Python lifecycle evidence.
