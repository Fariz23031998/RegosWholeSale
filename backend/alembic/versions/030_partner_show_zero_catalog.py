"""partner telegram show zero price/quantity catalog settings

Revision ID: 030
Revises: 029
Create Date: 2026-11-11

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "show_zero_quantity" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "show_zero_quantity",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
    if "show_zero_price" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "show_zero_price",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "show_zero_price" in columns:
        op.drop_column("partner_telegram_bots", "show_zero_price")
    if "show_zero_quantity" in columns:
        op.drop_column("partner_telegram_bots", "show_zero_quantity")
