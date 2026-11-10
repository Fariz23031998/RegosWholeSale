"""partner bot balance notification schedule

Revision ID: 025
Revises: 024
Create Date: 2026-11-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "025"
down_revision: Union[str, None] = "024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "balance_notify_enabled" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
    if "balance_notify_time" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_time",
                sa.String(length=5),
                nullable=False,
                server_default="09:00",
            ),
        )
    if "balance_notify_option" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_option",
                sa.String(length=16),
                nullable=False,
                server_default="daily",
            ),
        )
    if "balance_notify_days" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_days",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            ),
        )
    if "balance_notify_last_slot" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column("balance_notify_last_slot", sa.String(length=32), nullable=True),
        )


def downgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    for name in (
        "balance_notify_last_slot",
        "balance_notify_days",
        "balance_notify_option",
        "balance_notify_time",
        "balance_notify_enabled",
    ):
        if name in columns:
            op.drop_column("partner_telegram_bots", name)
