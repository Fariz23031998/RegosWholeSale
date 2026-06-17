"""regos tokens per company

Revision ID: 003
Revises: 002
Create Date: 2026-05-17

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "regos_tokens",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("integration_token", sa.String(length=32), nullable=False),
        sa.Column("is_replicable", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id"),
    )
    op.create_index(op.f("ix_regos_tokens_company_id"), "regos_tokens", ["company_id"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_regos_tokens_company_id"), table_name="regos_tokens")
    op.drop_table("regos_tokens")
