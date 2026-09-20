"""Add premise monitors and grounded evidence proposals."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260919_07"
down_revision: str | None = "20260830_06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assumption_monitors",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("decision_id", sa.String(length=36), nullable=False),
        sa.Column("premise_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("source_urls", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["decision_id"], ["decisions.id"]),
        sa.ForeignKeyConstraint(["premise_id"], ["premises.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_assumption_monitors_decision_id", "assumption_monitors", ["decision_id"])
    op.create_index("ix_assumption_monitors_premise_id", "assumption_monitors", ["premise_id"])
    op.create_index(
        "ix_assumption_monitors_decision_created",
        "assumption_monitors",
        ["decision_id", "created_at"],
    )
    op.create_index(
        "ix_assumption_monitors_premise_status",
        "assumption_monitors",
        ["premise_id", "status"],
    )

    op.create_table(
        "monitor_evidence_proposals",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("monitor_id", sa.String(length=36), nullable=False),
        sa.Column("evidence_artifact_id", sa.String(length=36), nullable=False),
        sa.Column("source_url", sa.String(length=1000), nullable=False),
        sa.Column("source_title", sa.String(length=255), nullable=False),
        sa.Column("exact_excerpt", sa.Text(), nullable=False),
        sa.Column("start_offset", sa.Integer(), nullable=False),
        sa.Column("end_offset", sa.Integer(), nullable=False),
        sa.Column("relationship", sa.String(length=30), nullable=False),
        sa.Column("confidence_band", sa.String(length=20), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("recommendation", sa.Text(), nullable=False),
        sa.Column("submitted_by", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("human_action", sa.String(length=40), nullable=True),
        sa.Column("human_notes", sa.Text(), nullable=True),
        sa.Column("draft_action", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["evidence_artifact_id"], ["artifacts.id"]),
        sa.ForeignKeyConstraint(["monitor_id"], ["assumption_monitors.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monitor_evidence_proposals_monitor_id", "monitor_evidence_proposals", ["monitor_id"])
    op.create_index(
        "ix_monitor_evidence_monitor_created",
        "monitor_evidence_proposals",
        ["monitor_id", "created_at"],
    )
    op.create_index(
        "ix_monitor_evidence_monitor_status",
        "monitor_evidence_proposals",
        ["monitor_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_monitor_evidence_monitor_status", table_name="monitor_evidence_proposals")
    op.drop_index("ix_monitor_evidence_monitor_created", table_name="monitor_evidence_proposals")
    op.drop_index("ix_monitor_evidence_proposals_monitor_id", table_name="monitor_evidence_proposals")
    op.drop_table("monitor_evidence_proposals")
    op.drop_index("ix_assumption_monitors_premise_status", table_name="assumption_monitors")
    op.drop_index("ix_assumption_monitors_decision_created", table_name="assumption_monitors")
    op.drop_index("ix_assumption_monitors_premise_id", table_name="assumption_monitors")
    op.drop_index("ix_assumption_monitors_decision_id", table_name="assumption_monitors")
    op.drop_table("assumption_monitors")
