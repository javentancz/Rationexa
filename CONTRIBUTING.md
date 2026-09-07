# Contributing to Rationexa

Thank you for helping improve Rationexa. Small, focused changes with tests are
the easiest to review.

## Ways to contribute

- Reproduce and narrow a bug using the bug-report issue form.
- Improve accessibility, responsive behavior, documentation, or tests.
- Add a sanitized deterministic-rule edge case to the development suite.
- Measure a PostgreSQL query or cold-start regression with reproducible data.
- Pick an issue labeled
  [`good first issue`](https://github.com/javentancz/Rationexa/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

Search existing issues before starting. For a new feature, schema change, trust
boundary change, or substantial refactor, open a feature-request issue first so
the approach can be agreed and work is not duplicated.

## Product boundary

Rationexa is human-in-the-loop decision memory. AI may extract premises, map
new evidence, and propose challenges. It must never silently rewrite a decision
or present model output as organizational truth. Preserve source excerpts,
provider/model provenance, prompt version, latency, known cost, and explicit
human judgments.

## Development setup

Follow the [Docker trial](README.md#one-command-docker-trial) or the
[manual local setup](README.md#full-local-development-setup). PostgreSQL is the
supported shared and pilot database; SQLite remains available for isolated
offline tests and demos.

Fork the repository, clone your fork, and create a focused branch:

```bash
git clone https://github.com/YOUR_USERNAME/Rationexa.git
cd Rationexa
git remote add upstream https://github.com/javentancz/Rationexa.git
git switch -c fix/short-description
```

## Before opening a pull request

Run the same entry point used by CI:

```bash
pnpm validate
```

For changes to persistence or migrations, also run:

```bash
docker compose up -d db
TEST_DATABASE_URL=postgresql+psycopg://rationexa:rationexa@localhost:5433/rationexa \
  pnpm validate:postgres
```

Database model changes must include a new Alembic revision. Never edit an
already-applied revision or import into a populated target. UI changes must
preserve keyboard, focus, responsive, tooltip, and portal behavior.

## Pull requests

- Explain the user problem and the trust boundary affected.
- Keep unrelated formatting or refactors out of the change.
- Add regression coverage for persistence, isolation, deletion, sharing,
  authentication, or migration behavior when relevant.
- Never commit provider keys, tokens, private source material, production data,
  or holdout evaluation cases.
- Describe evaluation results as development evidence, not production accuracy.

Open the pull request against `javentancz/Rationexa:main`, complete every
section of the template, and link the issue it addresses. Draft pull requests
are welcome for early design feedback, but CI must pass before review. Clearly
disclose generated code and verify it yourself; maintainers may close automated
or low-context submissions that the author cannot explain or support.

By submitting a contribution, you agree that it is licensed under the
[Apache License 2.0](LICENSE).
