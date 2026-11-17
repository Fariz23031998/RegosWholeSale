"""optional price_type_id on unit conversions

Revision ID: 042
Revises: 041
Create Date: 2026-11-17

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "042"
down_revision: Union[str, None] = "041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("unit_conversions")}
    if "price_type_id" not in columns:
        op.add_column(
            "unit_conversions",
            sa.Column("price_type_id", sa.Integer(), nullable=True),
        )
        op.create_index(
            op.f("ix_unit_conversions_price_type_id"),
            "unit_conversions",
            ["price_type_id"],
            unique=False,
        )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_unit_conversions_price_type_id"),
        table_name="unit_conversions",
    )
    op.drop_column("unit_conversions", "price_type_id")
