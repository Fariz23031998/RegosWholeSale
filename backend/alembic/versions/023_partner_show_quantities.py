"""partner bot product quantity display

Revision ID: 023
Revises: 022
Create Date: 2026-11-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    if "show_product_quantities" not in _column_names("partner_telegram_bots"):
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "show_product_quantities",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )


def downgrade() -> None:
    op.drop_column("partner_telegram_bots", "show_product_quantities")
