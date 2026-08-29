"""Add indexes used by workspace bootstrap and decision-library queries."""

from collections.abc import Sequence

from alembic import op

revision: str = "20260829_05"
down_revision: str | None = "20260828_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_decisions_workspace_created", "decisions", ["workspace_id", "created_at"])
    op.create_index("ix_premises_decision_id", "premises", ["decision_id"])
    op.create_index(
        "ix_revisit_checks_decision_created",
        "revisit_checks",
        ["decision_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_revisit_checks_decision_created", table_name="revisit_checks")
    op.drop_index("ix_premises_decision_id", table_name="premises")
    op.drop_index("ix_decisions_workspace_created", table_name="decisions")
