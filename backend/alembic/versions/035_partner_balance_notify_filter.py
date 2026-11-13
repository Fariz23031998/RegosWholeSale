"""partner telegram balance notify filter negative or both

Revision ID: 035
Revises: 034
Create Date: 2026-11-13

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "035"
down_revision: Union[str, None] = "034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "balance_notify_filter" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_filter",
                sa.String(length=16),
                nullable=False,
                server_default="negative",
            ),
        )


def downgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "balance_notify_filter" in columns:
        op.drop_column("partner_telegram_bots", "balance_notify_filter")
