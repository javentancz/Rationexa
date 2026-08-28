"""Create the Stage 2 decision-memory schema.

Revision ID: 20260828_01
Revises:
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_01"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(255)),
        sa.Column("password_hash", sa.String(255)),
        sa.Column("password_salt", sa.String(64)),
        sa.Column("password_iterations", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_accounts_email", "accounts", ["email"])

    op.create_table(
        "schema_migrations",
        sa.Column("version", sa.String(80), primary_key=True),
        sa.Column("description", sa.String(255), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_account_id", sa.String(36), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_workspaces_owner_account_id", "workspaces", ["owner_account_id"])

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_sessions_account_id", "sessions", ["account_id"])

    op.create_table(
        "workspace_secrets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("encrypted_value", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_workspace_secrets_workspace_id", "workspace_secrets", ["workspace_id"])
    op.create_index(
        "ix_workspace_secrets_workspace_provider",
        "workspace_secrets",
        ["workspace_id", "provider"],
    )

    op.create_table(
        "product_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("decision_id", sa.String(36)),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_product_events_workspace_id", "product_events", ["workspace_id"])
    op.create_index("ix_product_events_decision_id", "product_events", ["decision_id"])
    op.create_index("ix_product_events_event_type", "product_events", ["event_type"])
    op.create_index(
        "ix_product_events_workspace_created",
        "product_events",
        ["workspace_id", "created_at"],
    )

    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("media_type", sa.String(120), nullable=False),
        sa.Column("source_type", sa.String(80), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False, unique=True),
        sa.Column("storage_uri", sa.String(500), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=False),
        sa.Column("parser_version", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_artifacts_workspace_id", "artifacts", ["workspace_id"])

    op.create_table(
        "extractions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("artifact_id", sa.String(36), sa.ForeignKey("artifacts.id"), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("prompt_version", sa.String(40), nullable=False),
        sa.Column("latency_ms", sa.Integer()),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("estimated_cost_usd", sa.Float()),
        sa.Column("output", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_extractions_workspace_id", "extractions", ["workspace_id"])

    op.create_table(
        "decisions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("extraction_id", sa.String(36), sa.ForeignKey("extractions.id"), nullable=False, unique=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("context", sa.Text(), nullable=False),
        sa.Column("chosen_option", sa.Text()),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("criticality", sa.String(20), nullable=False),
        sa.Column("preservation_policy", sa.String(30), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("challenge", sa.JSON()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_decisions_workspace_id", "decisions", ["workspace_id"])

    op.create_table(
        "premises",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("decision_id", sa.String(36), sa.ForeignKey("decisions.id"), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("qualifiers", sa.Text(), nullable=False),
        sa.Column("importance", sa.String(20), nullable=False),
        sa.Column("quality_state", sa.String(20), nullable=False),
        sa.Column("claim_status", sa.String(20), nullable=False),
    )

    op.create_table(
        "source_anchors",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("premise_id", sa.String(36), sa.ForeignKey("premises.id"), nullable=False, unique=True),
        sa.Column("artifact_id", sa.String(36), sa.ForeignKey("artifacts.id"), nullable=False),
        sa.Column("exact_excerpt", sa.Text(), nullable=False),
        sa.Column("start_offset", sa.Integer(), nullable=False),
        sa.Column("end_offset", sa.Integer(), nullable=False),
        sa.Column("page_number", sa.Integer()),
        sa.Column("anchor_status", sa.String(20), nullable=False),
    )

    op.create_table(
        "revisit_checks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("decision_id", sa.String(36), sa.ForeignKey("decisions.id"), nullable=False),
        sa.Column("evidence_artifact_id", sa.String(36), sa.ForeignKey("artifacts.id"), nullable=False),
        sa.Column("evidence_filename", sa.String(255)),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("findings", sa.JSON(), nullable=False),
        sa.Column("provider", sa.String(80)),
        sa.Column("model", sa.String(120)),
        sa.Column("prompt_version", sa.String(40)),
        sa.Column("latency_ms", sa.Integer()),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("estimated_cost_usd", sa.Float()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "decision_shares",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("decision_id", sa.String(36), sa.ForeignKey("decisions.id"), nullable=False),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_decision_shares_decision_id", "decision_shares", ["decision_id"])


def downgrade() -> None:
    op.drop_index("ix_decision_shares_decision_id", table_name="decision_shares")
    op.drop_table("decision_shares")
    op.drop_table("revisit_checks")
    op.drop_table("source_anchors")
    op.drop_table("premises")
    op.drop_index("ix_decisions_workspace_id", table_name="decisions")
    op.drop_table("decisions")
    op.drop_index("ix_extractions_workspace_id", table_name="extractions")
    op.drop_table("extractions")
    op.drop_index("ix_artifacts_workspace_id", table_name="artifacts")
    op.drop_table("artifacts")
    op.drop_index("ix_product_events_workspace_created", table_name="product_events")
    op.drop_index("ix_product_events_event_type", table_name="product_events")
    op.drop_index("ix_product_events_decision_id", table_name="product_events")
    op.drop_index("ix_product_events_workspace_id", table_name="product_events")
    op.drop_table("product_events")
    op.drop_index("ix_workspace_secrets_workspace_provider", table_name="workspace_secrets")
    op.drop_index("ix_workspace_secrets_workspace_id", table_name="workspace_secrets")
    op.drop_table("workspace_secrets")
    op.drop_index("ix_sessions_account_id", table_name="sessions")
    op.drop_table("sessions")
    op.drop_index("ix_workspaces_owner_account_id", table_name="workspaces")
    op.drop_table("workspaces")
    op.drop_table("schema_migrations")
    op.drop_index("ix_accounts_email", table_name="accounts")
    op.drop_table("accounts")
