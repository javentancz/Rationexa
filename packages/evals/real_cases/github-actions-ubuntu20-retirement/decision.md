# Pin release jobs to Ubuntu 20.04

Date: 2024-05-20

Status: Accepted

## Decision

Use GitHub's hosted `ubuntu-20.04` runner for release jobs. Its installed
toolchain matches the existing native dependencies and avoids changing the
release image during the current cycle.

## Premises

- The hosted ubuntu-20.04 image is expected to remain available for the release
  workflow.
- A fixed image is more repeatable than `ubuntu-latest`.
- Revisit this pin when GitHub announces that the runner image will be retired.

> Test adaptation: this fixture is paired with GitHub's official retirement
> announcement.
