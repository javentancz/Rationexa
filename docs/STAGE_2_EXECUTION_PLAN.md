# Rationexa Stage 2 execution plan

Updated: 2026-08-26

## Objective

Stage 2 tests whether consultants and technical teams repeatedly use the
human-in-the-loop decision-review workflow. It does not add autonomous decision
making or enterprise governance.

## Milestone 1 - persistent decision memory

Status: implemented.

- Store multiple finalized decision records.
- Search title, question, context, and chosen option.
- Filter by decision criticality.
- Reopen a record with its preserved premises.
- Show revisit count, pending review state, and last revisit date.
- Preserve per-run evidence filename, model provenance, findings, human
  judgments, latency, token usage, and cost.

## Milestone 2 - sharing and export

Status: complete. Revocable share links and both Markdown and PDF export
are implemented.

- Create revocable read-only share links. Implemented. A link renders the
  finalized decision, its premises, and revisit history; the owner can
  list, copy, and revoke links at any time. Shared payloads scrub provider
  secrets and private source artifacts, and links can expire.
- Render a shared record at `/share/[token]`. Implemented as a read-only web
  page that fetches the shared decision from the public share endpoint; a
  revoked or expired token shows an unavailable-state message.
- Let a saved decision show its full revisit history. Implemented. Each
  previous revisit check is expandable to its findings, excerpts, and human
  judgments, so history is readable without re-running a check.
- Permit deleting a decision permanently. Implemented with a confirmation
  step; deletion cascades to premises, source anchors, revisit checks, and
  share links. Evidence artifacts are shared and are not deleted.
- Export a decision record and its revisit history to Markdown first.
  Implemented.
- Export a decision record and its revisit history to PDF. Implemented as
  a server-side render that mirrors the Markdown structure and is gated on
  the Markdown record being stable. PDF bullet fields use a two-column
  layout to avoid text overlap.
- Never expose provider keys or private source artifacts through a share link.

## Milestone 3 - lightweight challenge

- Propose the weakest assumption, missing evidence, strongest counterargument,
  and reversal condition.
- Require source-grounded explanations and human confirmation.
- Do not add multi-agent debate.

## Milestone 4 - hosted repeat-use foundation

- Add personal accounts and one personal workspace.
- Store BYOK configuration through a secrets provider, never in application
  logs or decision records.
- Add basic usage and cost visibility.
- Add team sharing only after individual repeat use is observed.

## Deferred

- SSO, RBAC, approval workflows, organizational policy, dependency graphs,
  proactive monitoring, automatic recommendation reversal, and integrations
  belong to later evidence-gated work.

## Stage 2 validation

Track records created, users returning, repeat revisit checks, records shared,
exports created, human judgments, and requests for team functionality. Product
expansion should follow observed repeated use rather than additional self-tests.
