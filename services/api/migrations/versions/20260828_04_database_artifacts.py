"""Allow durable artifact bytes to live in PostgreSQL.

Revision ID: 20260828_04
Revises: 20260828_03
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_04"
down_revision: str | None = "20260828_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("artifacts", sa.Column("binary_content", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column("artifacts", "binary_content")
