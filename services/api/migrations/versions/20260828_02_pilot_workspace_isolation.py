"""Strengthen pilot account and workspace isolation.

Revision ID: 20260828_02
Revises: 20260828_01
Create Date: 2026-08-28
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260828_02"
down_revision: str | None = "20260828_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        naming = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
        with op.batch_alter_table("artifacts", recreate="always", naming_convention=naming) as batch:
            batch.drop_constraint("uq_artifacts_sha256", type_="unique")
            batch.create_unique_constraint("uq_artifacts_workspace_sha256", ["workspace_id", "sha256"])
        with op.batch_alter_table("accounts") as batch:
            batch.create_unique_constraint("uq_accounts_email", ["email"])
        with op.batch_alter_table("workspaces") as batch:
            batch.create_unique_constraint("uq_workspaces_owner_account_id", ["owner_account_id"])
        with op.batch_alter_table("workspace_secrets") as batch:
            batch.create_unique_constraint(
                "uq_workspace_secrets_workspace_provider",
                ["workspace_id", "provider"],
            )
    else:
        op.drop_constraint("artifacts_sha256_key", "artifacts", type_="unique")
        op.create_unique_constraint(
            "uq_artifacts_workspace_sha256",
            "artifacts",
            ["workspace_id", "sha256"],
        )
        op.create_unique_constraint("uq_accounts_email", "accounts", ["email"])
        op.create_unique_constraint("uq_workspaces_owner_account_id", "workspaces", ["owner_account_id"])
        op.create_unique_constraint(
            "uq_workspace_secrets_workspace_provider",
            "workspace_secrets",
            ["workspace_id", "provider"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("workspace_secrets") as batch:
            batch.drop_constraint("uq_workspace_secrets_workspace_provider", type_="unique")
        with op.batch_alter_table("workspaces") as batch:
            batch.drop_constraint("uq_workspaces_owner_account_id", type_="unique")
        with op.batch_alter_table("accounts") as batch:
            batch.drop_constraint("uq_accounts_email", type_="unique")
        with op.batch_alter_table("artifacts", recreate="always") as batch:
            batch.drop_constraint("uq_artifacts_workspace_sha256", type_="unique")
            batch.create_unique_constraint("uq_artifacts_sha256", ["sha256"])
    else:
        op.drop_constraint(
            "uq_workspace_secrets_workspace_provider",
            "workspace_secrets",
            type_="unique",
        )
        op.drop_constraint("uq_workspaces_owner_account_id", "workspaces", type_="unique")
        op.drop_constraint("uq_accounts_email", "accounts", type_="unique")
        op.drop_constraint("uq_artifacts_workspace_sha256", "artifacts", type_="unique")
        op.create_unique_constraint("artifacts_sha256_key", "artifacts", ["sha256"])
