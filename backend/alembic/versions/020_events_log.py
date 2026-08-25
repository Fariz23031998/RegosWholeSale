"""events log

Revision ID: 020
Revises: 019
Create Date: 2026-07-12

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "020"
down_revision: Union[str, None] = "019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "events_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("change_type", sa.String(length=32), nullable=False),
        sa.Column("regos_item_id", sa.Integer(), nullable=True),
        sa.Column("source_action", sa.String(length=64), nullable=False, server_default=""),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_events_log_company_updated",
        "events_log",
        ["company_id", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_events_log_company_updated",
        table_name="events_log",
    )
    op.drop_table("events_log")
