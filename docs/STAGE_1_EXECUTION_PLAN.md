# Rationexa Stage 1 Execution Plan

Status: build-ready working plan
Planning assumption: one focused builder, 16-24 weeks
Source of scope: Execution Proposal v14; Master Vision Blueprint v1 is context only

## 1. Outcome to prove

Stage 1 is successful when a technical user can import an existing decision artifact, inspect and correct the premises extracted from it, trace consequential premises to original evidence, compare those premises with new evidence, and decide whether the decision deserves another look.

The product makes one narrow promise:

> You assumed X. This new evidence appears to contradict or weaken X. Here is the source, and here is the context we are missing. Worth another look?

It does not decide that the original decision is wrong, autonomously score business materiality, reverse a recommendation, or monitor the internet for changes.

## 2. Stage 1 scope boundary

### Build now

- Import plain text, Markdown, and text-extractable PDF decision artifacts.
- Extract a structured decision record with explicit uncertainty.
- Separate requirements, constraints, facts, assumptions, unknowns, material claims, rationale, and revisit conditions.
- Let a human confirm, edit, reject, or mark high-attention items unknown.
- Suggest Routine, Important, or Critical; require a human confirmation or default to Important.
- Preserve L0, L1, and L2 representations.
- Anchor consequential premises to source excerpts and source locations.
- Accept pasted or uploaded new evidence on demand.
- Classify the relationship between new evidence and a premise as supports, weakens, contradicts, supersedes, or unclear.
- Show missing context, provenance, uncertainty, and original-source fallback.
- Record the human's review judgment.
- Run a versioned evaluation harness against development and holdout cases.
- Capture latency, token use, model cost, corrections, and failures.

### Explicitly defer

- Automated web monitoring and proactive alerts.
- Autonomous materiality or recommendation reversal.
- Community, reputation, feeds, voting, or a public decision network.
- Teams, SSO, RBAC, enterprise audit, policy workflows, and approval workflows.
- Jira, Confluence, Slack, GitHub, ServiceNow, or monitoring integrations.
- Decision dependency graphs, cascade analysis, portfolio dashboards, and decision debt.
- Agents, multi-agent debate, architecture drift, incident learning, and digital twins.
- Kubernetes, a graph database, and a general-purpose vector platform.
- Billing, subscriptions, and polished export beyond what is needed for user tests.

## 3. Definition of the minimal end-to-end demo

1. User creates a case and imports an ADR, architecture note, assessment, or meeting note.
2. The system stores the original artifact and extracts candidate decision structure.
3. The review screen highlights only hard constraints, consequential assumptions, reversal-sensitive unknowns, revisit conditions, and unsupported material claims.
4. User corrects the extraction and confirms decision criticality.
5. The system creates a decision record with L0 summary, L1 structured memory, and L2 source artifacts/anchors.
6. User pastes or uploads new evidence.
7. The system retrieves related premises, classifies each relationship, and cites the relevant old and new excerpts.
8. For Important or Critical decisions, the system reads the anchored L2 excerpt before presenting a high-confidence conflict.
9. The result asks for missing context and lets the user record `worth_reviewing`, `not_material`, `needs_context`, or `false_positive`.
10. The full run is reproducible through the evaluation harness.

## 4. Recommended architecture

Use a small monorepo:

```text
rationexa/
  apps/
    web/                 # Next.js + TypeScript
  services/
    api/                 # FastAPI + Python
  packages/
    contracts/           # generated/shared API schemas
    evals/               # Golden Cases, scorers, reports
  docs/
    adr/                  # Rationexa's own technical decisions
  infra/
    docker/               # local PostgreSQL and app setup
```

### Runtime components

- Web: Next.js, TypeScript, server-rendered shell with client-side review interactions.
- API: FastAPI, Pydantic v2, SQLAlchemy 2, Alembic.
- Primary store: PostgreSQL.
- Search: PostgreSQL full-text search first. Add pgvector only if lexical/entity retrieval fails measured cases.
- Artifact storage: local filesystem in development behind an `ArtifactStore` interface; S3-compatible object storage only when hosted testing needs it.
- AI: one provider implementation behind a provider-neutral gateway. Accept a user key for development; never persist raw keys in logs or database rows.
- Jobs: synchronous calls during Gates 1-2. Add a simple database-backed worker only when PDF extraction or revisit latency harms testing.
- Observability: structured JSON logs, request/run IDs, prompt version, model, latency, token usage, cost estimate, validation failures, and user corrections.
- Packaging: Docker Compose for local PostgreSQL and documented one-command startup. No Kubernetes.

### Trust boundaries

- Original artifacts are immutable after ingestion; replacements create revisions.
- AI outputs are candidates until accepted by a human.
- L1 fields link back to L2 anchors; summaries never overwrite source evidence.
- Material factual claims are `verified`, `unverified`, `conflicted`, or `stale`.
- Important/Critical high-confidence revisit results require original-source fallback.
- Every AI result records model, prompt version, input artifact IDs, timestamp, and validation status.
- User-supplied keys are resolved per request and redacted from telemetry.

## 5. Core data contracts

Use UUIDs, UTC timestamps, append-only revisions for user-visible history, and JSONB only for model traces or fields that are genuinely variable. Keep product concepts relational.

### Decision

```text
id, title, question, context, chosen_option, rationale
criticality: routine | important | critical
criticality_source: ai_suggested | human_confirmed | defaulted
preservation_policy: compact | key_excerpts | strict
status: draft | review_required | decision_ready | archived
owner_name, created_at, updated_at, current_revision_id
```

### Premise

Represent Requirement, Constraint, Fact, Assumption, Unknown, MaterialClaim, and RevisitCondition in one table initially, with typed fields:

```text
id, decision_id, revision_id
kind: requirement | hard_constraint | soft_constraint | fact | assumption |
      unknown | material_claim | revisit_condition
statement, qualifiers, importance
quality_state: draft | confirmed | verified
claim_status: verified | unverified | conflicted | stale | not_applicable
attention_reason, human_action, created_by: ai | human
```

Keep `kind` and `quality_state` separate. A confirmed assumption is not a verified fact.

### Artifact and SourceAnchor

```text
Artifact:
  id, decision_id, filename, media_type, storage_uri, sha256
  source_type, publisher, published_or_updated_at, retrieved_at
  user_supplied, official_domain_claimed, content_status
  extracted_text, parser_version

SourceAnchor:
  id, premise_id, artifact_id
  exact_excerpt, page_number, section_label
  start_offset, end_offset, fragment_id
  anchor_status: proposed | confirmed | rejected
  created_by, confirmed_by, confirmed_at
```

Store both human-readable location data and stable offsets. The excerpt is a snapshot for audit; offsets/fragment IDs enable navigation and re-validation.

### RevisitCheck and RevisitFinding

```text
RevisitCheck:
  id, decision_id, new_evidence_artifact_id
  status: queued | running | needs_review | completed | failed
  prompt_version, model, started_at, completed_at

RevisitFinding:
  id, revisit_check_id, premise_id
  relationship: supports | weakens | contradicts | supersedes | unclear
  confidence_band: low | medium | high
  explanation, missing_context_question
  original_anchor_id, new_evidence_anchor_id
  source_fallback_performed, validation_status
  human_judgment: worth_reviewing | not_material | needs_context |
                  false_positive | not_reviewed
  human_notes
```

### EvaluationCase and ModelRun

```text
EvaluationCase:
  id, split: dev | holdout | real_user
  original_artifact, expected_decision, new_evidence
  expected_premises, expected_relationships, expected_missing_context
  critical_premise_ids, provenance, annotator_notes

ModelRun:
  id, case_id, task, prompt_version, schema_version, model
  raw_output_uri, parsed_output, latency_ms
  input_tokens, output_tokens, estimated_cost
  scorer_results, error_type
```

### Entity

Keep the future expansion seam without building a graph:

```text
Entity: id, type, normalized_name
DecisionEntity: decision_id, entity_id, relationship, confidence, confirmed
```

Supported types: system, service, team, vendor, technology, component, business_unit, policy.

## 6. Initial API surface

```text
POST   /v1/artifacts                         upload/import source
POST   /v1/decisions/extractions             start extraction
GET    /v1/extractions/{id}                  get candidate structure
POST   /v1/extractions/{id}/review            submit corrections/actions
POST   /v1/decisions                          finalize decision record
GET    /v1/decisions/{id}                     get L0/L1 record and anchors
GET    /v1/decisions/{id}/source-context      fetch bounded L2 context
POST   /v1/decisions/{id}/revisit-checks      compare with new evidence
GET    /v1/revisit-checks/{id}                get findings
POST   /v1/revisit-findings/{id}/judgment     record human judgment
POST   /v1/evaluations/runs                   run a versioned case set
GET    /v1/evaluations/runs/{id}              metrics and failures
GET    /healthz
```

Return typed error codes for unsupported files, parsing failure, schema validation, provider errors, context overflow, and missing source fallback. Do not expose model-provider errors directly to users.

## 7. AI pipeline design

### Pipeline A: decision extraction

1. Parse artifact into page/section-aware fragments.
2. Send bounded source fragments plus extraction schema to the model.
3. Require exact evidence snippets for high-attention candidates.
4. Validate JSON against a strict schema.
5. Reject invented quotes and anchors that cannot be found in source text.
6. Merge duplicate premises without deleting qualifiers.
7. Compute attention reasons using deterministic rules.
8. Present candidates for exception-based review.

The model must be allowed to return `unknown` and `not_present`. The prompt must prohibit converting opinions or forecasts into facts.

### Pipeline B: anchor validation

1. Normalize text without changing semantic content.
2. Match each proposed quote against the original fragment.
3. Record exact offsets, page/section, and match quality.
4. Reject anchors with missing negation, units, dates, scope, or conditional language.
5. Require human confirmation for consequential premises during Gates 1-2.

### Pipeline C: premise revisit

1. Filter premises by entities, explicit terms, and material-claim type.
2. Retrieve relevant new-evidence fragments.
3. Ask whether each fragment relates to a specific premise.
4. Classify relationship and require reasons tied to both excerpts.
5. Ask for the smallest missing-context question that blocks materiality judgment.
6. Fetch old L2 evidence for Important/Critical decisions before any high-confidence conflict.
7. Validate citations and contradictions deterministically where possible.
8. Present findings to the human; never mutate the Decision automatically.

### Prompt and schema versioning

- Store prompts as named files with semantic versions.
- Every run records prompt, schema, parser, and model versions.
- Golden Cases pin expected behavior, not exact wording.
- Changes to prompts or schemas require a regression run and a short decision note.

## 8. Milestone plan and acceptance gates

The ranges below are working timeboxes, not automatic extensions. End every gate with `continue`, `narrow`, `change`, `pause`, or `stop and package`.

### Foundation - Week 1

Deliver:

- Monorepo, local development environment, CI, database migrations, and seed command.
- Shared schemas and error contract.
- Prompt/run registry and structured telemetry.
- Five initial Golden Cases selected from varied technical decisions.
- A one-page test-user recruitment brief.

Exit when a sample artifact can be stored, parsed, and replayed through a stubbed extraction run.

### Gate 1: premise extraction - Weeks 2-5

Build:

- Text/Markdown/PDF import.
- Decision and premise schema.
- Structured extraction endpoint.
- Candidate review UI with confirm/edit/reject/unknown actions.
- Criticality suggestion and human override.
- Golden Case scorer for premise matching, type correctness, qualifier preservation, and correction rate.

Provisional pass criteria, reviewed rather than gamed:

- At least 10 varied development cases; 30 is preferred before freezing the gate.
- At least 90% recall on human-labeled critical premises.
- No systematic fact/assumption collapse in the holdout review.
- At least 90% of sampled qualifiers such as negation, dates, scope, units, and conditions preserved.
- Median user correction effort is low enough that reviewing beats rewriting the record manually.
- Every critical miss is documented and assigned an error category.

Stop/narrow trigger: the model repeatedly invents premises or drops decisive qualifiers after two distinct pipeline approaches.

### Gate 2: source anchors - Weeks 6-9

Build:

- Immutable artifact storage and page/section fragments.
- Exact excerpt and offset anchors.
- Anchor validation and human confirmation UI.
- Material-claim status and provenance labels.
- L0/L1/L2 retrieval rules and Important/Critical fallback test.

Provisional pass criteria:

- 100% of confirmed consequential premises have an anchor or an explicit `unanchored` reason.
- At least 90% of sampled anchors take the reviewer to the correct passage without search.
- Zero accepted invented quotes in the evaluated set.
- Important/Critical source fallback succeeds in every automated test.
- Users can verify a premise's origin in under 30 seconds in moderated tests.

Stop/narrow trigger: exact source traceability remains unreliable for the supported input formats. Reduce formats before adding retrieval complexity.

### Gate 3: premise conflict detection - Weeks 10-15

Build:

- New evidence import.
- Premise-anchored retrieval and relationship classifier.
- Missing-context question generation.
- Original/new evidence side-by-side review UI.
- Human judgment capture.
- Regression and holdout scoring for premise match, relationship classification, false positives, and critical misses.

Provisional pass criteria:

- At least 30 regression cases spanning supports, weakens, contradicts, supersedes, and unclear; begin moving toward 100+ with real examples.
- Premise-match recall of at least 90% on critical premises.
- Relationship precision of at least 80% on the available holdout set.
- Critical misses are zero in the release candidate set; any miss blocks a high-trust claim and receives explicit analysis.
- Most experienced reviewers judge surfaced conflicts as relevant enough to inspect.
- Every finding shows both evidence anchors, uncertainty, and missing context where needed.

Stop/narrow trigger: useful recall requires false-positive volume that reviewers will not tolerate. Narrow supported claim types or domains.

### Gate 4: real-user trust - Weeks 16-20

Recruit 5-8 consultants, solution architects, engineering leads, or experienced developers. Ask for historical decisions with real evidence; redact sensitive details when necessary.

Build only usability changes needed to run tests:

- Case onboarding and consent/data handling note.
- Minimal saved case history.
- Feedback and failure-report capture.
- Review-time instrumentation.

Evidence target:

- At least 15 real decisions across at least 5 users.
- At least 3 users bring a second decision without being led through the entire process again.
- Users can identify the source of a finding and explain why it was surfaced.
- Review time is meaningfully lower than their current reconstruction workflow.
- Corrections, false positives, and critical misses are published honestly with sample size.

Do not use compliments as the gate. Look for actual workflow use and repeat behavior.

### Gate 5: repeat usage or pull - Weeks 21-24 or concurrent with Gate 4

Pass toward Stage 2 only if a cluster of behaviors appears:

- Repeat real-world use.
- A user asks to retain access or use it on an active project.
- A record is shared with a colleague or client.
- A specific persistence, sharing, or integration request repeats across users.
- A user or team demonstrates willingness to pay.

If pull is weak, do not build collaboration, dashboards, or agents. Diagnose problem, ICP, workflow, reliability, and product form; then narrow, reposition, or package Stage 1 as an open framework.

## 9. Evaluation system

### Dataset progression

- Cases 1-5: feasibility and debugging only.
- Cases 6-30: regression and failure-mode discovery.
- Cases 31-100+: early reliability evaluation with a locked holdout split and real-user examples.
- Production/pilot cases: product validation, never silently mixed into the training/development set.

### Annotation rules

- Two humans review critical-premise labels where feasible.
- Preserve disagreement instead of forcing false consensus.
- Record the expected related premise, relationship, missing context, and whether the item deserves another look.
- Tag each case by domain, input quality, claim type, criticality, source type, and failure mode.
- Never tune prompts against the holdout examples one by one.

### Metrics

- Extraction: premise precision/recall, critical-premise recall, type accuracy, qualifier preservation, correction rate.
- Anchors: coverage, exact-match validity, location correctness, unsupported-anchor count, verification time.
- Revisit: premise-match precision/recall, relationship precision/recall, false-positive rate, critical-miss count/rate.
- Human value: worth-another-look agreement, explanation usefulness, source-traceability trust, review time saved.
- Operations: p50/p95 latency, schema-validation failures, retries, input/output tokens, estimated model cost.

Always show numerator, denominator, sample provenance, and confidence intervals where meaningful. Never market small curated-set results as general accuracy.

## 10. First 10 working days

### Days 1-2: product contracts

- Write ADR-001 for the Stage 1 trust boundary.
- Finalize Decision, Premise, Artifact, SourceAnchor, RevisitCheck, and ModelRun schemas.
- Define the extraction and revisit JSON schemas.
- Select five deliberately different Golden Cases.

### Days 3-4: repository skeleton

- Scaffold Next.js, FastAPI, PostgreSQL, Alembic, shared contracts, linting, formatting, unit tests, and CI.
- Add `.env.example`, key-redaction tests, and a local seed command.
- Implement `/healthz` and one database integration test.

### Days 5-6: ingestion

- Build text and Markdown import first.
- Add PDF text extraction with page-aware fragments.
- Store artifact checksum, parser version, and immutable source text.
- Reject unsupported/encrypted/scanned PDFs with a clear error; OCR is not a Week 1 requirement.

### Days 7-8: extraction vertical slice

- Implement one model provider behind the AI gateway.
- Add prompt/schema versioning and strict output validation.
- Run extraction for one case end to end and show candidate premises.
- Validate proposed source snippets against the artifact text.

### Days 9-10: human review and baseline

- Implement confirm/edit/reject/unknown actions for high-attention items.
- Save a reviewed Decision revision.
- Run all five cases and publish the baseline failure report.
- Hold the first two user interviews using artifacts, not feature mockups.
- Write the Gate 1 continue/narrow decision and the next two-week backlog.

## 11. Backlog order

### Epic A - Foundations

- Repository, CI, Docker Compose, migrations, configuration, error model, telemetry.

### Epic B - Artifact ingestion

- Text/Markdown import, PDF parser, fragments, checksums, provenance, storage interface.

### Epic C - Decision extraction

- Extraction schema, prompt, provider adapter, validation, deduplication, attention rules, correction UI.

### Epic D - Decision memory

- L0 card, L1 premises, L2 artifacts, revisions, criticality, preservation policy.

### Epic E - Source anchoring

- Quote validation, offsets, page/section navigation, anchor review, material-claim gate.

### Epic F - Revisit intelligence

- New evidence, premise retrieval, relationship classification, missing context, fallback, review judgment.

### Epic G - Evaluation

- Case format, loaders, scorers, reports, holdout discipline, cost/latency tracking, error taxonomy.

### Epic H - Pilot operations

- Minimal case history, data-handling note, feedback capture, test-user onboarding, export of evaluation results.

## 12. Test strategy

- Unit tests for schemas, state transitions, deterministic attention rules, quote matching, redaction, and scorers.
- Property tests for offset/anchor round trips and Unicode/whitespace normalization.
- Contract tests for the model gateway using recorded fixtures with no secrets.
- Integration tests with PostgreSQL for revision history and artifact immutability.
- Golden Case regression tests in CI using stored model outputs; live-model evaluation runs manually or on a controlled schedule.
- End-to-end tests for import -> review -> finalize -> revisit -> judgment.
- Security tests for file size/type limits, path traversal, prompt-injection content in uploaded sources, log redaction, and tenant-ready row ownership even before multi-tenancy.

## 13. Product screens

Keep the UI to five surfaces:

1. Import: upload/paste, source type, basic metadata.
2. Extraction review: decision summary plus high-attention premise queue.
3. Decision record: L0 summary, L1 premises, expandable L2 anchors and revision history.
4. Revisit: add new evidence and run the check.
5. Finding review: old premise, old source, new evidence, relationship, uncertainty, missing context, and human judgment.

An evaluation report can be developer-facing JSON/Markdown until Gate 3. Do not build a product dashboard for it.

## 14. Key risks and countermeasures

- Premise loss or semantic drift: exact anchors, qualifier checks, human correction, L2 fallback.
- Hallucinated evidence: source-substring validation and rejected unsupported anchors.
- False fact conversion: separate kind from quality state; prompt and scorer specifically test opinions/assumptions.
- Alert-style noise: on-demand checks only; premise-anchored retrieval; human-led materiality.
- Prompt overfitting: dev/holdout split, versioned prompts, error taxonomy, real-user cases.
- Provider lock-in: narrow provider interface, but implement only one provider initially.
- BYOK leakage: ephemeral secret handling, redaction tests, no key persistence by default.
- PDF complexity: support text-extractable PDFs first and give explicit failure messages for scanned/encrypted files.
- Premature infrastructure: PostgreSQL and synchronous execution until measured latency or retrieval evidence justifies more.
- Endless research: fixed gate reviews and written continue/narrow/change/stop decisions.

## 15. Decisions to make before coding beyond Day 2

Defaults are proposed so work can start immediately:

- First model provider: choose the provider you already have reliable API access to; wrap it behind `ModelProvider`.
- Authentication: single local developer identity for Gates 1-3; add simple hosted auth only for external pilot users.
- Artifact storage: filesystem locally; S3-compatible storage only for hosted Gate 4.
- PDF scope: text-extractable documents only initially.
- Criticality default: Important if the user does not choose.
- Vector search: off by default until retrieval evaluation shows need.
- Deployment: one managed web service, one API service, one PostgreSQL database for pilot; private networking and enterprise controls are deferred.
- Open-source license and repository boundary: decide before public release, not before the first extraction slice.

## 16. Definition of done for Stage 1

Stage 1 is done when:

- The minimal demo works on supported formats with reproducible setup.
- The five deliverables exist: decision framework, revisit engine, case set, evaluation harness, and minimal demo.
- Gate 1-4 decisions and evidence are written down.
- Every displayed finding is traceable to original and new evidence.
- Important/Critical findings enforce source fallback.
- Known failures and sample sizes are disclosed.
- At least one of these outcomes is chosen explicitly:
  - proceed to Stage 2 because repeat use and pull exist;
  - narrow or reposition and run another bounded experiment;
  - stop productization and publish/package the framework, benchmark, demo, and learning.

The build should optimize for trustworthy evidence about the product thesis, not for feature completeness.
