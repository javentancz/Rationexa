"""Persist workspace-scoped background job state."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260830_06"
down_revision: str | None = "20260829_05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "auth_attempts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_auth_attempts_fingerprint", "auth_attempts", ["fingerprint"])
    op.create_index("ix_auth_attempts_created_at", "auth_attempts", ["created_at"])
    op.create_index(
        "ix_auth_attempts_fingerprint_created",
        "auth_attempts",
        ["fingerprint", "created_at"],
    )
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("phase", sa.String(length=120), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_jobs_workspace_id", "jobs", ["workspace_id"])
    op.create_index("ix_jobs_workspace_created", "jobs", ["workspace_id", "created_at"])
    op.create_index("ix_jobs_workspace_status", "jobs", ["workspace_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_jobs_workspace_status", table_name="jobs")
    op.drop_index("ix_jobs_workspace_created", table_name="jobs")
    op.drop_index("ix_jobs_workspace_id", table_name="jobs")
    op.drop_table("jobs")
    op.drop_index("ix_auth_attempts_fingerprint_created", table_name="auth_attempts")
    op.drop_index("ix_auth_attempts_created_at", table_name="auth_attempts")
    op.drop_index("ix_auth_attempts_fingerprint", table_name="auth_attempts")
    op.drop_table("auth_attempts")
