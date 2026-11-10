"""partner bot balance notification templates

Revision ID: 026
Revises: 025
Create Date: 2026-11-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_EMPTY_TEMPLATES = """'{"uz":"","ru":"","en":""}'"""


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    if "balance_notify_templates" not in _column_names("partner_telegram_bots"):
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_templates",
                sa.JSON(),
                nullable=False,
                server_default=sa.text(_EMPTY_TEMPLATES),
            ),
        )


def downgrade() -> None:
    if "balance_notify_templates" in _column_names("partner_telegram_bots"):
        op.drop_column("partner_telegram_bots", "balance_notify_templates")
