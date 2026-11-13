"""partner telegram balance notify after document/payment types

Revision ID: 034
Revises: 033
Create Date: 2026-11-13

"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "034"
down_revision: Union[str, None] = "033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFAULT_BALANCE_NOTIFY_AFTER_TYPES = {
    "purchase": False,
    "return_purchase": False,
    "wholesale": False,
    "wholesale_return": False,
    "payment": False,
}


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "balance_notify_after_types" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_after_types",
                sa.JSON(),
                nullable=False,
                # Space after ":" avoids SQLAlchemy text() bind-param parsing of ":false".
                server_default=sa.text(
                    "'" + json.dumps(_DEFAULT_BALANCE_NOTIFY_AFTER_TYPES) + "'"
                ),
            ),
        )


def downgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "balance_notify_after_types" in columns:
        op.drop_column("partner_telegram_bots", "balance_notify_after_types")
