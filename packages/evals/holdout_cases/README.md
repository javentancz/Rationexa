# Sealed holdout cases

Do not commit holdout decisions, evidence, or labels to this repository. The
development agent and model-selection workflow must not inspect them while
prompts or normalization rules are being tuned.

An independent reviewer should maintain at least 30 cases in a separate local
directory or controlled repository. Each case uses the same three-file format:
`case.json`, `decision.md`, and `new-evidence.md`.

Before the first scored run:

1. Complete and independently review every label.
2. Generate a private manifest containing each case ID and content hash.
3. Validate that its IDs and hashes do not overlap `development-v1`.
4. Freeze the code commit, prompt versions, model IDs, and thresholds.
5. Run the holdout once. Record all results before making changes.

Use the checked-in `holdout.manifest.example.json` only as a schema template.
