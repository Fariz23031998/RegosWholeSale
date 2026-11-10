"""partner bot catalog category allowlist

Revision ID: 024
Revises: 023
Create Date: 2026-11-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    if "catalog_product_group_ids" not in _column_names("partner_telegram_bots"):
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "catalog_product_group_ids",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            ),
        )


def downgrade() -> None:
    op.drop_column("partner_telegram_bots", "catalog_product_group_ids")
