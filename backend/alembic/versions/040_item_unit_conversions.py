"""item unit conversions for secondary units

Revision ID: 040
Revises: 039
Create Date: 2026-11-17

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "040"
down_revision: Union[str, None] = "039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "item_unit_conversions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("regos_item_id", sa.Integer(), nullable=False),
        sa.Column("secondary_unit_id", sa.Integer(), nullable=False),
        sa.Column("conversion_factor", sa.Numeric(18, 6), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "company_id",
            "regos_item_id",
            name="uq_item_unit_conversions_company_item",
        ),
    )
    op.create_index(
        op.f("ix_item_unit_conversions_company_id"),
        "item_unit_conversions",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_item_unit_conversions_regos_item_id"),
        "item_unit_conversions",
        ["regos_item_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_item_unit_conversions_regos_item_id"),
        table_name="item_unit_conversions",
    )
    op.drop_index(
        op.f("ix_item_unit_conversions_company_id"),
        table_name="item_unit_conversions",
    )
    op.drop_table("item_unit_conversions")
